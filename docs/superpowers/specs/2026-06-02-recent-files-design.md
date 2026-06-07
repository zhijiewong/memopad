# Recent Files (Ctrl+E) — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 0.10.0

## Problem

There's no quick way to reopen a recently-edited file. Recent *folders* exists (`Ctrl+R`,
dynamic palette commands), but not recent *files*. This adds an MRU recent-files list,
surfaced through the command palette via `Ctrl+E`, persisted across relaunch.

## Decisions (locked during brainstorming)

- **Reuse the command palette** (dynamic "Open Recent File: …" entries) — no new dedicated
  palette UI. Structurally identical to the recent-folders feature.
- **Cap 15** entries.
- **`Ctrl+E`** (no shift) opens the palette pre-filtered to recent files.
- Tracks **any opened file** (inside or outside the workspace).
- No pinning, no surfaced "clear recents" UI.

## Architecture

A `useRecentFiles` MRU store (a leaf store with no app dependencies). `useBuffers.openBuffer`
pushes the opened path. The MRU is rendered as dynamic command-palette commands, opened via
`Ctrl+E`. It persists in `session.json` through the same `persistSession` / `bootRestore` path
as recent folders. This mirrors the recent-folders feature end-to-end.

### 1. Store — `src/stores/recentFiles.ts` (new)

```ts
interface RecentFilesState {
  recentFiles: string[];
  push: (path: string) => void;      // case-insensitive dedupe, prepend, cap 15
  setRecent: (list: string[]) => void;
  remove: (path: string) => void;
  clear: () => void;
}
```

`push` mirrors `useWorkspace.pushRecentFolder`: normalize (`toLowerCase().replace(/\\/g,'/')`)
for dedupe comparison, drop any existing match, prepend the original path, `slice(0, 15)`.
`remove` filters by the same normalized comparison. No app-store imports → no cycle.

### 2. Capture — `src/stores/buffers.ts`

In `openBuffer(file)`, push the path (covers tree click, Quick Open, the file-open dialog,
and re-opens — the single chokepoint):

```ts
import { useRecentFiles } from './recentFiles';
// inside openBuffer, before/after routing:
useRecentFiles.getState().push(file.path);
```

`recentFiles` is a leaf store, so this static import introduces no cycle. **Not** added to
`openRestored` (the boot path; the list is restored from session, not rebuilt).

### 3. Commands — `src/commands/builtins.ts`

`registerRecentFileCommands(paths: string[])`, mirroring `registerRecentFolderCommands`:

```ts
export function registerRecentFileCommands(paths: string[]) {
  const { commands, register, unregister } = useCommands.getState();
  for (const c of commands) {
    if (c.id.startsWith('file.recent.')) unregister(c.id);
  }
  paths.forEach((p, i) => {
    const basename = p.split(/[/\\]/).filter(Boolean).pop() ?? p;
    register({
      id: `file.recent.${i}`,
      title: `Open Recent File: ${basename}`,
      run: async () => {
        const { useBuffers } = await import('../stores/buffers');
        const { useRecentFiles } = await import('../stores/recentFiles');
        const { openFile } = await import('../lib/tauri');
        try {
          const opened = await openFile(p);
          useBuffers.getState().openBuffer(opened);
        } catch {
          useRecentFiles.getState().remove(p);
          console.warn(`Recent file no longer exists: ${p}`);
        }
      },
    });
  });
}
```

Plus a static command:

```ts
register({
  id: 'file.openRecent',
  title: 'Open Recent File…',
  shortcut: 'Ctrl+E',
  run: () => (window as unknown as { __memopadOpenPaletteWithQuery?: (q: string) => void })
    .__memopadOpenPaletteWithQuery?.('Open Recent File: '),
});
```

### 4. Trigger — `src/App.tsx`

- Keydown: `Ctrl+E` (no shift) → `runCommand('file.openRecent')`. (Insert before/near the
  existing `key === 'e' && e.shiftKey` branch; the shift variant stays Ctrl+Shift+E.)
- In the boot effect, after restore: `registerRecentFileCommands(useRecentFiles.getState().recentFiles)`.
- Add `const stopRecentFilesWatcher = useRecentFiles.subscribe((state, prev) => { if (state.recentFiles !== prev.recentFiles) { registerRecentFileCommands(state.recentFiles); persistSession(); } });`
  and tear it down in the cleanup. (Mirrors the recentFolders watcher.)

### 5. Persistence — `src-tauri/src/session.rs` + `src/lib/tauri.ts` + `src/lib/boot.ts` + `src/App.tsx`

- **Rust `SessionState`:** `#[serde(default)] pub recent_files: Vec<String>` + `recent_files: Vec::new()` in `Default`.
- **TS `SessionState`:** `recent_files?: string[];`.
- **`persistSession`** (App.tsx): add `recent_files: useRecentFiles.getState().recentFiles`.
- **`bootRestore`** (boot.ts): `useRecentFiles.getState().setRecent(session.recent_files ?? [])` (before/after the folder restore).

### 6. Test hook — `src/main.tsx`

`__memopadTestRecentFiles?: () => string[]` → `useRecentFiles.getState().recentFiles`. Add a
`__memopadTestResetRecentFiles?: () => void` → `useRecentFiles.getState().clear()` for e2e
`beforeEach` determinism (the list persists across runs — the editor-prefs gotcha).

## Error handling / edge cases

| Case | Handling |
|------|----------|
| Recent file deleted/moved | `openFile` throws in the command → `remove(p)` from MRU |
| Re-opening an already-open file | `openBuffer` still pushes → bumps it to the front (correct MRU) |
| File outside the workspace | Tracked normally (recent files is not workspace-scoped) |
| Old `session.json` without `recent_files` | `#[serde(default)]` → empty Vec |
| Case-only path differences (Windows) | Normalized dedupe avoids duplicates |

## Testing strategy

- **vitest** (`src/tests/recent-files.test.ts`): `push` dedupe/MRU-order/cap-15; `setRecent`;
  `remove`; `clear`. Plus `useBuffers.openBuffer` pushes to `recentFiles`. Plus a session
  round-trip (persistSession writes `recent_files`; bootRestore-equivalent `setRecent`).
- **Rust** (`session.rs`): deserializing a blob without `recent_files` yields an empty Vec;
  round-trips when set.
- **e2e** (`tests/e2e/recent-files.spec.ts`, release build): open file A then file B via
  `__memopadTestOpenBuffer`; assert `__memopadTestRecentFiles()` returns `[B, A]` (MRU);
  run the `file.recent.*` command for A via `__memopadTestRunCommand` (or open via palette) and
  assert A becomes the active buffer (`__memopadTestGetActiveBufferPath`). Reset via
  `__memopadTestResetRecentFiles` + `__memopadTestReset` in `beforeEach`.

## Scope boundaries (YAGNI — non-goals)

- No dedicated recent-files panel/sidebar (command palette only).
- No pinning/favorites, no surfaced "clear recent files" UI.
- No fuzzy ranking (MRU order only; the palette's own substring filter applies).
- No per-workspace scoping (global MRU).

## Release

Ships as **0.10.0**. CHANGELOG: Added — `Ctrl+E` opens recently-edited files (MRU, persisted).
Version bump in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
