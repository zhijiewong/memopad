# Quick Open by Filename (Ctrl+P) — v2 Slice 10 Design

Date: 2026-05-29
Status: Approved (awaiting implementation plan)
Predecessors:
- `2026-05-27-find-in-files-design.md` (slice 1; introduced workspace folder)
- `2026-05-28-file-tree-design.md` (slice 2; introduced ignore-based file walking in `files.rs`)
- `2026-05-29-split-view-design.md` (slice 8; introduced focused-pane concept used for "where to open the picked file")

## Goal

Press `Ctrl+P`, fuzzy-find any file in the workspace folder, hit Enter to open it in the focused pane. Like VS Code's command palette but scoped to files only. Reuses the existing `ignore` crate walk and the existing `fs::open_file` + `buffers.openBuffer` pipeline.

## Non-goals (this slice)

- **Multi-folder workspaces.** One workspace folder, same as slices 1–9.
- **Index / cache between Ctrl+P opens.** Each press triggers a fresh walk.
- **Symbol search (Ctrl+Shift+O), workspace symbol search.** File names only.
- **Match content excerpts in the result row.** Just basename + dim relative path.
- **Custom include/exclude patterns at query time.** Whatever the workspace's `.gitignore` says, plus the standard `ignore` hidden-file filters.
- **Streaming results.** All-at-once (cap 10,000 files), same approach as `find_in_folder`.
- **History across sessions.** Recent boost uses in-memory `recentlyClosed` + currently-open buffers; no persisted MRU.

## Pillars

1. **Walk on each open.** A new Tauri command `walk_files(workspace) -> WalkResponse` runs the `ignore` crate's recursive walk every time the palette opens. Typical workspaces finish in <100ms.
2. **Client-side fuzzy match.** A small pure helper `fuzzyMatch(query, path)` returns either a score + matched-index array or null. The palette ranks results client-side; no IPC on every keystroke.
3. **Single UI surface.** A new `QuickOpenPalette` component owns the modal + input + result list. Triggered by `Ctrl+P` or the `quickOpen.show` command.
4. **Open into the focused pane.** Slice 8's `focusedPane` decides whether the opened file lands in the primary or secondary pane.

## Architecture

### Rust — `src-tauri/src/files.rs` additions (~50 LOC + tests)

```rust
pub const MAX_QUICK_OPEN_FILES: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalkResponse {
    pub files: Vec<String>,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

pub fn walk_files(workspace: &Path) -> Result<WalkResponse, FilesError>;
```

Implementation:
- Validate `workspace.exists()` + `is_dir()`; `Err(PathMissing)` / `Err(NotADirectory)` otherwise.
- Build `ignore::WalkBuilder::new(workspace).standard_filters(true).require_git(false).build()`.
- Iterate entries; for each `is_file()` entry, push `entry.path().to_string_lossy().to_string()` into `files`.
- Stop pushing once `files.len() >= MAX_QUICK_OPEN_FILES`; set `truncated = true`.
- Sort `files` alphabetically (case-insensitive) for stable rendering order before any client-side ranking.
- Returns `WalkResponse { files, truncated, elapsed_ms }`.

Tauri command in `lib.rs`:

```rust
#[tauri::command]
fn walk_files(workspace_folder: String) -> Result<files::WalkResponse, String> {
    files::walk_files(std::path::Path::new(&workspace_folder)).map_err(|e| e.to_string())
}
```

Register in the `invoke_handler!` macro and re-export `WalkResponse` from `files.rs` (already public via the module path).

### Frontend IPC wrapper — `src/lib/tauri.ts` additions

```ts
export interface WalkResponse {
  files: string[];
  truncated: boolean;
  elapsed_ms: number;
}

export async function walkFiles(workspaceFolder: string): Promise<WalkResponse> {
  return invoke<WalkResponse>('walk_files', { workspaceFolder });
}
```

### Pure matcher — `src/lib/quick-open.ts` (new, ~60 LOC)

```ts
export interface FuzzyMatch {
  path: string;
  score: number;
  matchedIndices: number[];
}

/**
 * Subsequence fuzzy match. Returns null if the lowercase chars of `query`
 * don't appear in `path` in order.
 *
 * Scoring:
 *   +N*N  per contiguous run of length N (rewards typing prefixes)
 *   +20   bonus if the entire query lies within the basename
 *   +10   bonus if the match starts at a path-segment boundary
 *
 * Recent-file boost is applied separately by `rankPaths`.
 */
export function fuzzyMatch(query: string, path: string): FuzzyMatch | null { ... }

/**
 * Score `paths` against `query`, applying a +10 recent-file boost when
 * a path is found in `recentPaths`. Returns up to 50 matches sorted by
 * descending score (stable by path for ties).
 */
export function rankPaths(paths: string[], query: string, recentPaths: string[]): FuzzyMatch[] { ... }
```

Implementation outline of `fuzzyMatch`:
- Lowercase both inputs.
- Walk path char by char with a `qi` pointer into query. When `query[qi] === path[i]`, record `matchedIndices.push(i)`, increment `qi`.
- If `qi < query.length` after the loop, return null.
- Compute score by walking `matchedIndices`: for each contiguous run (consecutive indices), add `length * length`.
- Find the basename slice (`Math.max(lastIndexOf('/'), lastIndexOf('\\')) + 1`). If every matched index is within that range, add 20.
- If `matchedIndices[0]` is 0 OR `path[matchedIndices[0] - 1]` is a separator, add 10.

`rankPaths` walks `paths`, calls `fuzzyMatch`, filters out nulls, applies `+10` to entries whose `path` is in `recentPaths` (use a `Set` for O(1) lookup), sorts by `score` descending then `path` ascending for tie-breaks, returns the first 50.

### `src/components/QuickOpenPalette.tsx` (new, ~120 LOC)

State:
```ts
const [query, setQuery] = useState('');
const [files, setFiles] = useState<string[] | null>(null);     // null = still loading
const [error, setError] = useState<string | null>(null);
```

On mount:
- If `!useWorkspace.getState().workspaceFolder`, render empty state with "Open a folder first" + a button.
- Otherwise, call `walkFiles(workspaceFolder)` and put `response.files` into `files`. Catch errors into `error`.

On query change:
- Compute `matches = rankPaths(files ?? [], query, recentPaths)` where `recentPaths` is computed from:
  ```ts
  const buffers = useBuffers.getState().buffers.map((b) => b.path).filter((p): p is string => !!p);
  const recentlyClosed = useBuffers.getState().recentlyClosed.map((b) => b.path).filter((p): p is string => !!p);
  const recentPaths = Array.from(new Set([...buffers, ...recentlyClosed]));
  ```
- Render up to 50 result rows.

Result row:
- `data-testid="quick-open-row"`, role="option".
- Basename in bold; the rest of the relative path (workspace-stripped) dim.
- Highlighted via the `matchedIndices` array (wrap matched chars in `<mark>`).
- Click or Enter (when arrowed-to) → opens file (see below).

Keyboard:
- Up / Down arrows move selection.
- Enter opens the selected row.
- Escape closes the palette.

Open flow:
```ts
async function openPicked(path: string) {
  try {
    const existing = useBuffers.getState().buffers.find((b) => b.path === path);
    if (existing) {
      useBuffers.getState().setFocusedBuffer(existing.id);
    } else {
      const opened = await openFile(path);
      const newId = useBuffers.getState().openBuffer(opened);
      // openBuffer already updates the active buffer; we additionally route it
      // through setFocusedBuffer so the secondary pane gets the file when split.
      useBuffers.getState().setFocusedBuffer(newId);
    }
    onClose();
  } catch (err) {
    setError((err as Error).message);
  }
}
```

The palette modal mirrors the existing `CommandPalette` shell:
- Full-screen overlay `<div className="fixed inset-0 z-40 bg-black/40">`.
- Card centered top with input + list.
- Outside-click + Escape close.

### Command + keybinding

`src/commands/builtins.ts`:

```ts
register({
  id: 'quickOpen.show',
  title: 'Go to File…',
  shortcut: 'Ctrl+P',
  run: () => {
    (window as unknown as { __memopadShowQuickOpen?: () => void })
      .__memopadShowQuickOpen?.();
  },
});
```

`src/App.tsx`:
- Add a new state `const [quickOpenShown, setQuickOpenShown] = useState(false)`.
- Register a window hook `__memopadShowQuickOpen = () => setQuickOpenShown(true)`.
- Add a keydown branch `if (key === 'p' && !e.shiftKey) { e.preventDefault(); runCommand('quickOpen.show'); return; }` (note: this REPLACES the existing `Ctrl+Shift+P` palette branch — the new mapping is Ctrl+P for QuickOpen and Ctrl+Shift+P still opens the CommandPalette).
- Mount `{quickOpenShown && <QuickOpenPalette onClose={() => setQuickOpenShown(false)} />}` near the existing `CommandPalette` mount.

CONFLICT NOTE: Currently `Ctrl+P` is bound (in the existing slice-1 code) to the same palette as `Ctrl+Shift+P` — both opened the CommandPalette. After this slice, `Ctrl+P` → QuickOpen, `Ctrl+Shift+P` → CommandPalette. This is consistent with VS Code's UX expectations.

## Data flow

### Pressing Ctrl+P
1. User presses Ctrl+P. `App.tsx` keydown handler fires `runCommand('quickOpen.show')`.
2. The command's `run` calls the window hook `__memopadShowQuickOpen`.
3. `App.tsx` setter flips `quickOpenShown = true`; the palette mounts.

### Palette mount
1. `QuickOpenPalette` mounts. Reads `useWorkspace.getState().workspaceFolder`.
2. If null: render empty state with an "Open folder…" button that calls `useWorkspace.getState().openFolder()`.
3. Else: invoke `walkFiles(workspaceFolder)` IPC.
4. On resolve, set `files`. Initially `query === ''`, so `rankPaths` returns the first 50 paths from `files` (already sorted alphabetically by Rust). User can start typing to refine.

### Typing in the input
1. User types. `setQuery` updates.
2. `useMemo` recomputes `matches = rankPaths(files, query, recentPaths)`. For workspaces under 10k files this runs in <10ms.
3. Result rows re-render. If `matches.length === 0`, render "No matches."

### Opening a file
1. User presses Enter on the highlighted row (or clicks it).
2. `openPicked(path)` runs. If already open, switches the focused pane to that buffer. Else: `openFile` IPC + `openBuffer` + `setFocusedBuffer(newId)`. Closes the palette.

### Closing without opening
1. Escape or outside-click closes the palette. No state side-effect.

## Error handling

| Scenario | Behavior |
| --- | --- |
| `walk_files` rejects (e.g. workspace folder deleted) | `setError(message)`. Palette renders error in place of result list. User closes + reopens to retry. |
| `openFile` rejects on Enter | `setError(message)`. Palette stays open; user can try another row. |
| Walk finishes with `truncated: true` (>10k files) | Render a small dim "(showing first 10,000 files; refine your query)" footer above the result list. |
| `Ctrl+P` pressed while palette already open | Window hook re-runs `setQuickOpenShown(true)` — no-op since it's already true. Acceptable. |
| Workspace folder is null when palette opens | Render empty state described above. |
| Recent paths are stale (file moved/deleted) | The recent path receives its +10 boost; if it doesn't match the query, it stays out of results. If it matches but the file is gone, opening it surfaces the existing `fs::open_file` error path. |
| Query contains characters that look like regex meta | Pure literal subsequence match — no regex. No escape needed. |

## Testing

### Rust — `src-tauri/src/files.rs` (target 3 new tests)

- `walk_files_returns_all_files_under_workspace` — tempdir with `a.txt`, `sub/b.rs`, `sub/c.json`; assert all three paths present, regardless of dir depth.
- `walk_files_respects_gitignore` — tempdir with `.gitignore` excluding `target/`; create `target/foo` and `src/main.rs`; assert only `src/main.rs` is returned.
- `walk_files_caps_at_MAX_QUICK_OPEN_FILES` — generate 10,500 files; assert `response.files.len() <= MAX_QUICK_OPEN_FILES` and `response.truncated === true`.

### Vitest — `src/tests/quick-open.test.ts` (target 4 cases)

- `fuzzyMatch_returns_null_when_query_chars_dont_appear_in_order` — `fuzzyMatch('xyz', 'C:/proj/abc.rs')` is `null`.
- `fuzzyMatch_scores_contiguous_runs_higher_than_scattered` — `fuzzyMatch('app', 'src/App.tsx').score > fuzzyMatch('app', 'src/a/p/p.tsx').score`.
- `fuzzyMatch_boosts_basename_match` — `fuzzyMatch('app', 'src/proj/App.tsx').score > fuzzyMatch('app', 'src/AppDir/x.tsx').score` (when both match, the basename-confined match wins).
- `rankPaths_recent_files_outrank_equally_scored_non_recent` — given two paths with equal fuzzy score, the one in `recentPaths` ranks first.

### WebdriverIO e2e — `tests/e2e/quick-open.spec.ts` (target 1 test)

- `ctrl_p_opens_palette_and_enter_opens_picked_file` — set workspace to slice-1 fixture, press Ctrl+P, assert `[data-testid="quick-open-row"]` rows render, type `notes`, press Enter, assert the active buffer's path ends with `notes.txt`.

### Gates to ship

- vitest: +4 (quick-open)
- cargo test: +3 (walk_files)
- e2e: +1 (quick-open)
- `tsc --noEmit` clean
- Manual smoke: open Memopad's own source folder. Press Ctrl+P. Type "App.tsx". Hit Enter. Confirm App.tsx opens in the focused pane.

## Risks and open questions

- **Walk performance on huge repos.** Workspaces of 5k–10k files complete in <100ms on a modern SSD. Larger workspaces hit the cap and feel snappy because the cap kicks in mid-walk. If users routinely open the linux kernel as a workspace, that's a future polish problem (add a cache + slice-5 fs-watcher invalidation).
- **Recent-boost weight tuning.** `+10` is a guess. If users complain that recents dominate even with vaguely-related queries, drop to `+5`. If recents barely register, bump to `+25`. Tunable in code, not the spec.
- **Open into focused pane while split is active.** Slice 8's `setFocusedBuffer` is the public API for "put this buffer in whichever pane is focused." Reusing it keeps the slice's surface tiny.
- **Empty workspace folder.** A valid workspace with zero files inside (after gitignore) returns `files: []`. The palette renders "No matches." Acceptable.
- **Non-UTF8 paths.** `to_string_lossy()` at the Rust boundary may produce a slightly mangled path string for files with truly invalid Unicode in their names. They won't match any query the user types but will appear in the unfiltered top-50 view. Acceptable; the file `fs::open_file` may then fail. Surfaced via existing error path.
- **Conflict with existing Ctrl+P palette binding.** Slice 1 originally bound Ctrl+P to open the CommandPalette. This spec splits: Ctrl+P → QuickOpen; Ctrl+Shift+P → CommandPalette. Updates the keymap in `App.tsx`.
