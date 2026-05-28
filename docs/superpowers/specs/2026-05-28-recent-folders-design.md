# Recent Folders — v2 Slice 4 Design

Date: 2026-05-28
Status: Approved (awaiting implementation plan)
Predecessors:
- `2026-05-27-find-in-files-design.md` (slice 1; introduced workspace folder + Sidebar)
- `2026-05-28-file-tree-design.md` (slice 2; introduced Sidebar tabs)
- `2026-05-28-replace-in-files-design.md` (slice 3; replace UI)

## Goal

Persist a most-recently-used list of the last 10 workspace folders the user opened, surface them as dynamic command palette entries, and add `Ctrl+R` as a shortcut that opens the palette pre-filtered to those entries. Clicking an entry sets the workspace to that folder (or removes the entry if the folder no longer exists). Smallest slice in the v2 series.

## Non-goals (this slice)

- **Timestamps or per-entry metadata.** Just paths.
- **Pin / favorite individual entries.** Pure MRU.
- **Multi-folder workspaces.** Each entry is one folder.
- **Workspace name / nickname.** Display uses the basename + dimmed full path.
- **Cross-machine sync.** Local `session.json` only.
- **Boot-time filesystem validation.** Drops invalid entries only on click.

## Pillars

1. **Reuse `SessionState`.** New field `recent_folders: Vec<String>` with `#[serde(default)]`. Old `session.json` files load with `recent_folders: []`.
2. **Two ways in.** Dynamic palette entries titled `Open Recent: <basename>` (full path dimmed) appear when the palette is open. `Ctrl+R` opens the palette with the query pre-set to `Open Recent: ` so only those entries are shown.
3. **Best-effort cleanup.** On click, if `stat_file` rejects, drop the entry from the list and surface a brief error. No boot-time stat sweep.

## Architecture

### Rust — `src-tauri/src/session.rs`

Extend `SessionState`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionState {
    pub tabs: Vec<TabEntry>,
    pub active_id: Option<String>,
    #[serde(default)]
    pub workspace_folder: Option<String>,
    #[serde(default)]
    pub recent_folders: Vec<String>,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            tabs: Vec::new(),
            active_id: None,
            workspace_folder: None,
            recent_folders: Vec::new(),
        }
    }
}
```

No new Tauri commands. The existing `session_save` / `session_load` handle the new field.

### Frontend store — `src/stores/workspace.ts`

```ts
recentFolders: string[];

pushRecentFolder(path: string): void;
removeRecentFolder(path: string): void;
setRecent(list: string[]): void;
```

`pushRecentFolder(path)` semantics:
- Case-insensitive dedup: remove any existing entry where `existing.toLowerCase() === path.toLowerCase()`.
- Insert `path` (preserving its original case) at index 0.
- Truncate to 10 entries.

`removeRecentFolder(path)`:
- Case-insensitive remove. Idempotent: no-op if absent.

`setRecent(list)`:
- Bulk-set, used by boot rehydration. Truncates to 10 defensively.

Modify the existing `openFolder()` action: after the line that sets `workspaceFolder: picked`, call `get().pushRecentFolder(picked)`.

### Persistence wiring

- `src/lib/tauri.ts` `SessionState` interface gains `recent_folders?: string[]`.
- `src/lib/boot.ts`: after session loads, call `useWorkspace.getState().setRecent(session.recent_folders ?? [])`.
- `src/App.tsx` `persistSession`: include `recent_folders: useWorkspace.getState().recentFolders` in the save payload.

### Commands + dynamic registration — `src/commands/builtins.ts`

Add to `registerBuiltins()`:

```ts
register({
  id: 'workspace.openRecent',
  title: 'Open Recent Folder…',
  shortcut: 'Ctrl+R',
  run: () => {
    (window as unknown as { __memopadOpenPaletteWithQuery?: (q: string) => void })
      .__memopadOpenPaletteWithQuery?.('Open Recent: ');
  },
});
```

New helper `registerRecentFolderCommands(paths: string[])` (also in `builtins.ts`, exported):

```ts
export function registerRecentFolderCommands(paths: string[]) {
  const { commands, register, unregister } = useCommands.getState();
  // Unregister previous dynamic recents.
  for (const c of commands) {
    if (c.id.startsWith('workspace.recent.')) unregister(c.id);
  }
  // Register fresh ones.
  paths.forEach((p, i) => {
    const basename = p.split(/[/\\]/).filter(Boolean).pop() ?? p;
    register({
      id: `workspace.recent.${i}`,
      title: `Open Recent: ${basename}`,
      // Subtitle / full path shown in palette match rendering; ok to encode in title for v1.
      run: async () => {
        const { useWorkspace } = await import('../stores/workspace');
        const { statFile } = await import('../lib/tauri');
        try {
          await statFile(p);
        } catch {
          useWorkspace.getState().removeRecentFolder(p);
          // Surface error via existing toast/banner. If none exists for this kind of error, console.warn is acceptable for v1.
          console.warn(`Recent folder no longer exists: ${p}`);
          return;
        }
        useWorkspace.getState().setFolder(p);
        useWorkspace.getState().pushRecentFolder(p);
      },
    });
  });
}
```

Wire-up: in `App.tsx`'s boot effect (the existing `useEffect(() => { bootRestore().then(...) }, [])`), AFTER `bootRestore()` resolves, call `registerRecentFolderCommands(useWorkspace.getState().recentFolders)`. Also subscribe to `useWorkspace` so any change to `recentFolders` re-runs `registerRecentFolderCommands`. Use a shallow check on the array reference to avoid loops.

```ts
useEffect(() => {
  const unsub = useWorkspace.subscribe((state, prev) => {
    if (state.recentFolders !== prev.recentFolders) {
      registerRecentFolderCommands(state.recentFolders);
    }
  });
  return unsub;
}, []);
```

### Palette pre-filter — `src/components/CommandPalette.tsx` (minor change)

Currently the palette opens with an empty query. Add a window-level hook `__memopadOpenPaletteWithQuery(q: string)` that:
1. Sets the palette's query to `q`.
2. Opens the palette.

Implementation: add a new state `const [presetQuery, setPresetQuery] = useState('')` in `App.tsx`. Define the hook to call `setPresetQuery(q)` then `setPaletteOpen(true)`. Pass `presetQuery` as a prop to `<CommandPalette initialQuery={presetQuery} />`. The palette uses `useState(initialQuery)` to seed its internal query state.

Reset `presetQuery` to `''` when the palette closes.

### Keybinding — `src/App.tsx`

Add a new branch in the existing keydown ladder near `Ctrl+B`:

```ts
if (key === 'r' && !e.shiftKey) {
  e.preventDefault();
  runCommand('workspace.openRecent');
  return;
}
```

Browser's default `Ctrl+R` (refresh) is swallowed by Tauri's WebView so this is safe.

## Data flow

### Opening a folder for the first time
1. User runs `workspace.openFolder` (palette or `Ctrl+K Ctrl+O`).
2. `useWorkspace.openFolder()`: dialog → set `workspaceFolder` → `pushRecentFolder(picked)`.
3. `recentFolders` updates → store subscription fires → `registerRecentFolderCommands` re-runs → palette now has new dynamic entries.
4. Session-save subscription persists `recent_folders` to `session.json`.

### Opening a recent folder via palette
1. User opens palette (any way: `Ctrl+K`, `Ctrl+R`, etc.).
2. User types `Open Recent: ` (or arrives pre-filtered via `Ctrl+R`).
3. User clicks an entry.
4. `run` handler: `stat_file(path)`. If ok → `setFolder + pushRecentFolder`. If err → `removeRecentFolder + console.warn`.

### Boot
1. `bootRestore()` reads session.
2. `useWorkspace.setRecent(session.recent_folders ?? [])`.
3. `useWorkspace.setFolder(session.workspace_folder ?? null)` (existing).
4. App effect: `registerRecentFolderCommands(recentFolders)`.

### Clearing the workspace
- `closeFolder()` does NOT clear `recentFolders`. The recent list survives across workspace open/close.

## Error handling

| Scenario | Behavior |
| --- | --- |
| Folder deleted between open and click | `stat_file` rejects → entry dropped, console.warn. |
| Permission denied on stat | Same as deleted — entry dropped. The user can re-add by opening manually. |
| Path is now a file, not a folder | `stat_file` succeeds but `set_folder` would try to `list_dir_under` later. The dialog only picks directories so this can only happen if the user manipulated the path externally. We don't validate `is_dir` here; the file tree's empty-state will show an error if the folder is no longer accessible. Acceptable. |
| Same folder opened with different case (Windows) | Dedup uses `toLowerCase()` comparison; the most recent open's casing is what's stored. |
| Same path appears multiple times in legacy session | `setRecent` truncates to 10 but doesn't dedup the input. Acceptable — even if legacy state contains duplicates, the first `pushRecentFolder` after that will dedup. |
| User has >10 recents in legacy session.json | `setRecent` truncates to 10 keeping the head (most-recent). |

## Testing

### Rust — `src-tauri/src/session.rs` (target 2 tests)

- `loads_old_session_without_recent_folders` — legacy JSON lacking the field deserializes with `recent_folders: []`.
- `round_trips_recent_folders` — save a SessionState with `["C:/a", "C:/b"]` and load asserts the same.

### Vitest — `src/tests/workspace-recent.test.ts` (target 4 cases)

- `pushRecentFolder_dedups_case_insensitive`
- `pushRecentFolder_moves_to_front`
- `pushRecentFolder_caps_at_10`
- `removeRecentFolder_removes_case_insensitive`

### Vitest — `src/tests/commands.test.ts` (add 1 case)

- `registerRecentFolderCommands_replaces_previous_entries` — pre-register a stale `workspace.recent.0`, call with new list of 2, assert the stale one is gone and the new ones are present.

### WebdriverIO e2e — `tests/e2e/recent-folders.spec.ts` (target 1 test)

- `Ctrl+R_opens_palette_with_recent_entries_and_clicking_one_sets_workspace` — seed via test hook `__memopadTestPushRecent('C:/tmp/proj')`, hit Ctrl+R, assert palette filtered + entry visible, click it, assert `workspaceFolder` set.

### Gates

- vitest 68 → ~73 (+4 workspace-recent + 1 commands)
- cargo 73 → 75 (+2 session)
- e2e 9 → 10 (+1 recent-folders)
- `tsc --noEmit` clean

## Risks and open questions

- **Window hook overload.** This slice adds `__memopadOpenPaletteWithQuery` to the growing pile of `__memopad*` window hooks. Acceptable; refactor to a single `__memopad` object later if the count keeps growing.
- **Subscription dispatch loop.** The `useWorkspace.subscribe((state, prev) => ...)` callback inspects `recentFolders` reference. Because `pushRecentFolder` always creates a new array, the comparison is sound. Don't replace with deep equality.
- **Palette match ranking.** Dynamic `workspace.recent.*` entries all start with `Open Recent:` so the fuzzy ranker treats them as a group. Pre-filtering via `Ctrl+R` sets the query to `Open Recent: ` which matches all of them at the top. Ranking within the group is by `recordRecentlyUsed` priority — which we don't set for these. Acceptable; they'll show in registration order (most-recent first).
- **Stat IPC vs `fs::open_file`.** We use `stat_file` because it's lightweight (doesn't read the file). The existing `stat_file` command from Phase 4 already handles missing paths with a rejection.
