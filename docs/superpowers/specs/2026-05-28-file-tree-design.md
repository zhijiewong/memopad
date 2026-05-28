# File Tree Sidebar — v2 Slice 2 Design

Date: 2026-05-28
Status: Approved (awaiting implementation plan)
Predecessor: `2026-05-27-find-in-files-design.md` (slice 1; introduced workspace folder + Sidebar shell)

## Goal

Add a Files tab to the existing left sidebar so the user can browse the workspace folder set in slice 1, expand subfolders lazily, and click any file to open it as a tab. The tree honors `.gitignore` and hidden-file conventions like find-in-files does. Read-only — no create/rename/delete in this slice.

## Non-goals (this slice)

- **Create / rename / delete / move.** Each is destructive and deserves its own slice with a confirm flow.
- **Drag-and-drop tab reordering or drop-onto-folder.** Editor tabs and tree are decoupled.
- **Live filesystem watching.** Manual refresh button only. A `notify`-based watcher is a future slice.
- **Search-within-tree.** That's what the Search tab is for.
- **Symbol outline / breadcrumbs / open-files panel.** Future slices.
- **Preview tabs (italic single-click VS-Code behavior).** Single-click opens a normal tab.
- **Persisted expansion state.** Tree expansion is session-memory; resets on relaunch.

## Pillars

1. **Tabs in the sidebar header.** "Files" and "Search" share the existing 280px column; only one panel is visible at a time.
2. **Lazy expand-on-click.** Only the workspace root loads on mount; subfolders fetch their children on first expand.
3. **gitignore + dotfile filtering.** Same `ignore::WalkBuilder` filter used by find-in-files.
4. **Manual refresh.** Small `↻` button in the FileTreePanel header reloads the current view. No background watcher.
5. **Sandboxed paths.** Rust validates every `list_dir(path)` is under the active workspace folder before reading it.

## Architecture

Three layers:

### Rust — `src-tauri/src/files.rs` (new, ~80 LOC + tests)

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,      // absolute, native separators
    pub is_dir: bool,
}

#[derive(Debug)]
pub enum FilesError {
    PathMissing,
    NotADirectory,
    Io(std::io::Error),
}

pub fn list_dir(path: &Path) -> Result<Vec<DirEntry>, FilesError>;
pub fn list_dir_under(workspace: &Path, path: &Path) -> Result<Vec<DirEntry>, FilesError>;
```

Internals:
- `list_dir_under` canonicalizes both `workspace` and `path`; rejects with `PathMissing` if `path` doesn't start with `workspace`. Then delegates to `list_dir`.
- `list_dir` validates the path exists + `is_dir()`. Builds `WalkBuilder::new(path).standard_filters(true).max_depth(Some(1)).require_git(false).build()`. Iterates, skipping the root itself.
- Sorts entries: dirs first, files second; both alphabetically with `to_lowercase()` comparison.

Tauri command (in `lib.rs`):

```rust
#[tauri::command]
fn list_dir(workspace_folder: String, path: String)
    -> Result<Vec<files::DirEntry>, String> {
    files::list_dir_under(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&path),
    ).map_err(|e| e.to_string())
}
```

### Frontend store extension — `src/stores/workspace.ts`

New state fields on `WorkspaceState`:

```ts
expanded: Set<string>;
childrenByPath: Map<string, DirEntry[]>;
loadingByPath: Set<string>;
```

New actions:

```ts
toggleExpand(path: string): Promise<void>;
refreshSubtree(path: string): Promise<void>;
clearTreeCache(): void;
```

Behavior:
- `toggleExpand`: if `expanded.has(path)`, remove it and return — children stay cached. Else: add to `expanded`. If no cached children, add `path` to `loadingByPath`, call `listDir(workspaceFolder, path)`, populate `childrenByPath`, remove from `loadingByPath`.
- `refreshSubtree(path)`: same as the fetch half of `toggleExpand` but unconditional. Does NOT touch `expanded`.
- `clearTreeCache()`: wipes all three fields.
- `closeFolder()` (modified): calls `clearTreeCache()` in addition to its existing behavior.

### Frontend UI — three new/modified components

- **`src/components/SidebarTabs.tsx`** (new, ~30 LOC) — Presentational. Props: `{ active: 'files' | 'search'; onChange: (t) => void }`. Renders two button tabs; the active one shows an underline (`border-b-2 border-neutral-200`); inactive ones are dim. Stateless.

- **`src/components/FileTreePanel.tsx`** (new, ~120 LOC) — Top bar: workspace folder basename on the left, small `↻` refresh button on the right. Body: list of `<TreeNode>` rows. On mount, if no cached children for `workspaceFolder`, call `toggleExpand(workspaceFolder)` to seed.

- **`src/components/TreeNode.tsx`** (new, ~50 LOC) — Recursive. Props: `{ entry: DirEntry, depth: number }`. Renders:
  - Row with `data-testid="tree-row"`, `data-depth={depth}`, indent `paddingLeft: depth * 12px`.
  - Chevron `▸` collapsed / `▾` expanded for dirs; small file glyph for files.
  - Click on dir: `toggleExpand(entry.path)`.
  - Click on file: existing `buffers.openBuffer` + `openFile` IPC sequence (no jump-to-line).
  - When dir is expanded, recursively renders children from `childrenByPath.get(entry.path)` with `depth + 1`.
  - While `loadingByPath.has(entry.path)`, renders a single dim "Loading…" row in place of children.

- **`src/components/Sidebar.tsx`** (modified) — Adds local `useState<'files' | 'search'>('files')`. Replaces the hardcoded "Search" header with `<SidebarTabs />`. Body switches on `activeTab`. Empty-state (no workspace folder) shared by both tabs.

### Commands and keybindings — `src/commands/builtins.ts`

| Command id | Default binding | Behavior |
| --- | --- | --- |
| `view.toggleSidebarTab` | `Ctrl+Shift+E` | Cycles the active sidebar tab (`files` → `search` → `files`). Implementation: window-level helper `__memopadToggleSidebarTab` set in Sidebar. |

The existing `view.toggleSidebar` (Ctrl+B), `search.focusFindInFiles` (Ctrl+Shift+F), and `workspace.openFolder` (Ctrl+K Ctrl+O) all stay.

## Data flow

### Opening a folder (extends slice-1 behavior)
1. `workspace.openFolder` runs as before.
2. `useWorkspace.openFolder()` sets `workspaceFolder`, clears search results, **and now also calls `clearTreeCache()`**.
3. Sidebar re-renders: Files tab is the default active tab.

### Initial tree load
1. FileTreePanel mounts. Its `useEffect` checks `childrenByPath.get(workspaceFolder)`. If undefined and `!loadingByPath.has(workspaceFolder)`, calls `toggleExpand(workspaceFolder)`.
2. Store sets `loadingByPath.add(workspaceFolder)`, invokes the `list_dir` IPC.
3. Rust returns sorted entries; store puts them in `childrenByPath`, removes from `loadingByPath`.
4. Panel renders root entries.

### Expanding a folder
1. User clicks a dir row.
2. `toggleExpand(path)`:
   - If `expanded.has(path)`: remove and return. Children stay cached.
   - Else: add to `expanded`. If no cached children, fetch as in initial load.
3. Panel re-renders, showing children when fetch resolves.

### Opening a file via the tree
1. User clicks a file row.
2. Handler runs:
   ```ts
   const existing = useBuffers.getState().buffers.find((b) => b.path === path);
   if (existing) { useBuffers.getState().switchTo(existing.id); return; }
   try {
     const opened = await openFile(path);
     useBuffers.getState().openBuffer(opened);
   } catch { /* swallow — existing fs error UI handles the message */ }
   ```
3. No `openFileAtLine` call — tree clicks open at line 1.

### Refresh
1. User clicks `↻` in the FileTreePanel header.
2. Calls `refreshSubtree(workspaceFolder)`.
3. Children of the root replace the previous cached children. Nested expanded folders keep their cached children (don't auto-refresh deep).

### Tab switching
- `view.toggleSidebarTab` calls a window-level helper that toggles Sidebar's local `activeTab`. Each panel keeps its own state across switches.

### Workspace close
- `closeFolder()` wipes tree cache + results + folder. Sidebar renders empty state.

## Error handling

| Scenario | Behavior |
| --- | --- |
| Workspace folder deleted between open and tree mount | `list_dir` returns `Err(PathMissing)` → FileTreePanel body shows "Folder no longer accessible — open another folder" + button calling `closeFolder()`. |
| Subfolder deleted during expand | `list_dir(subPath)` returns `Err(PathMissing)`. Panel renders one dim "Folder no longer exists" row inside the expanded node. Refresh drops the dead entry. |
| Permission denied | `FilesError::Io(...)` surfaces. Panel renders "Cannot read folder" dim row. Other siblings unaffected. |
| Click a file that's gone | `openFile` rejects via existing fs error path. Tree row stays until refresh. |
| Path escape attempt (frontend passes a path outside workspace) | Rust `list_dir_under` rejects with `PathMissing`. Frontend cannot exploit this since the only call site passes `workspaceFolder` as the base. |
| File / folder same name in same parent | Filesystems forbid this; no special case. |
| Symlink loops | `WalkBuilder` default doesn't follow symlinks. No recursion. |
| Empty folder | `list_dir` returns `[]`. No placeholder rendered. |
| Refresh while subtree is loading | The new fetch supersedes the in-flight one via the same `loadingByPath` set; last write wins. Per-path slot, no global request-id needed. |

## Testing

### Rust — `src-tauri/src/files.rs` (target 7 tests)

- `lists_files_and_dirs_sorted` — fixture with `b.txt`, `A/`, `c.rs`, `B/`; assert order `A/, B/, b.txt, c.rs`.
- `respects_gitignore` — `.gitignore` excludes `target/`; `target` absent from result.
- `skips_hidden_dotfiles` — `.git/` and `.env` not in result.
- `max_depth_is_one` — nested `a/b/c.txt`; root listing has `a/` only.
- `errors_when_path_missing` — nonexistent path → `Err(PathMissing)`.
- `errors_when_path_is_file` — pass a file path → `Err(NotADirectory)`.
- `rejects_path_outside_workspace` — `list_dir_under(workspace, "/etc")` → `Err(PathMissing)`.

### Vitest — `src/tests/workspace-tree.test.ts` (target 5 cases)

- `toggleExpand_adds_path_and_fetches_children`
- `toggleExpand_on_expanded_path_collapses_without_refetch`
- `refreshSubtree_replaces_cached_children`
- `clearTreeCache_resets_all_three_fields`
- `closeFolder_clears_tree_cache`

### WebdriverIO e2e — `tests/e2e/file-tree.spec.ts` (target 3 tests)

Reuses `tests/e2e/fixtures/workspace/` from slice 1.

- `Files_tab_renders_workspace_root_entries` — set workspace, switch to Files tab, assert at least one `[data-testid="tree-row"]`.
- `clicking_a_folder_expands_and_loads_children` — click `sub/` row, assert child rows appear with higher `data-depth`.
- `clicking_a_file_opens_it_as_active_tab` — click `notes.txt` row, assert active buffer's path matches.

### Gates to ship

- vitest: 56 → ~61 (target +5 tree tests)
- cargo test: 62 → ~69 (target +7 files)
- e2e: 4 → 7 (target +3 file-tree)
- `tsc --noEmit` clean
- Manual smoke: open Memopad's source folder, expand `src/`, click `App.tsx`, see it open at line 1.

## Risks and open questions

- **Path normalization.** `list_dir_under` does `canonicalize`, which on Windows resolves to UNC paths (`\\?\C:\...`) and on symlinks resolves them. Make sure the comparison strips/normalizes UNC prefixes if needed. If round-trip becomes painful, swap `canonicalize` for `path.starts_with(workspace)` after both have been passed through `dunce::canonicalize` (a small crate that strips UNC). Defer adding `dunce` unless an existing test fails.
- **Tree node key stability.** React's `key` prop on `<TreeNode>` should be the absolute `path`, not the index — otherwise a refresh that reorders rows will misattribute expanded state to wrong nodes.
- **Large folders.** A folder with 10k entries renders 10k rows. Acceptable for v1; if it becomes a problem, add virtualization in a later slice (e.g. `@tanstack/react-virtual`). The 280px sidebar caps practical row count.
- **Loading flicker.** A fast `list_dir` (<50ms) shows "Loading…" briefly. Acceptable; if it bothers users we can debounce-show after 100ms.
