# File Tree CRUD — Design

**Date:** 2026-06-01
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 0.4.0

## Problem

Every Memopad release since 0.1.0 has carried the same "Known limitation":

> No file create / rename / delete in the tree (still read-only)

The workspace file tree (`Ctrl+B` sidebar, Files tab) can list and open files but
cannot modify the filesystem. This closes that gap with the four core operations a
Notepad++-class editor is expected to have: **New File, New Folder, Rename, Delete**.

## Decisions (locked during brainstorming)

- **Delete → Windows Recycle Bin** (recoverable), via the `trash` crate — not a hard delete.
- **All four operations** ship in this cycle (New File, New Folder, Rename, Delete).
- **Triggers:** right-click context menu **plus** keyboard (`F2` rename, `Delete` key on the
  focused row) — matches Explorer / VS Code muscle memory.
- Delete shows a lightweight confirm dialog even though it is recoverable.
- A **dirty** buffer survives deletion of its on-disk file (content preserved; saving
  re-creates the file). A **clean** buffer at a deleted path is closed.

## Architecture

The feature threads through the existing four layers, following established patterns:
Rust command → `lib/tauri.ts` binding → `useWorkspace` action → `TreeNode` / `FileTreePanel` UI,
with `useBuffers` sync for rename/delete.

### 1. Backend — `src-tauri/src/files.rs` + `lib.rs`

Extract the workspace sandbox check (currently inline in `list_dir_under`) into a shared helper:

```rust
/// Canonicalize `path` and confirm it resolves under `workspace`.
fn resolve_under(workspace: &Path, path: &Path) -> Result<PathBuf, FilesError>
```

`list_dir_under` is refactored to use it (no behavior change).

Four new functions, each returning the affected entry/path so the frontend can sync
without re-walking the whole tree:

| Function | Behavior | Validation |
|----------|----------|------------|
| `create_file(ws, parent, name) -> DirEntry` | create empty file | parent resolves under ws; `name` valid; **error if exists** |
| `create_dir(ws, parent, name) -> DirEntry` | `std::fs::create_dir` | same name rules; **error if exists** |
| `rename_entry(ws, path, new_name) -> String` | rename within same parent dir | `path` resolves under ws; `new_name` valid; **error if target exists**; returns new absolute path |
| `delete_entry(ws, path) -> ()` | move to Recycle Bin (`trash::delete`) | `path` resolves under ws |

**Name validation** (`is_valid_filename`): non-empty, not `.`/`..`, contains no path
separators (`/` `\`), and none of the Windows-reserved characters `< > : " / \ | ? *`.
Reject before touching the filesystem.

**Creation path nuance:** a not-yet-existing child cannot be `canonicalize`d. So for
`create_*`, validate the **parent** via `resolve_under`, then `parent.join(name)` after the
name passes `is_valid_filename`. This prevents `..`-escape while still allowing creation.

**Rename:** new target is `path.parent().join(new_name)` — rename stays within the same
directory (move-to-another-folder is out of scope).

New `FilesError` variants: `AlreadyExists`, `InvalidName`, plus reuse of `Io`.

`Cargo.toml`: add `trash = "5"`.

`lib.rs`: four `#[tauri::command]` wrappers — `create_file`, `create_dir`, `rename_path`,
`delete_path` — registered in `generate_handler!`, mirroring the existing `list_dir` wrapper
shape (takes `workspace_folder: String` + args, maps `FilesError` to `String`).

### 2. Frontend bindings — `src/lib/tauri.ts`

Add typed wrappers over `invoke`: `createFile`, `createDir`, `renamePath`, `deletePath`,
matching the existing `listDir` / `replaceInFiles` style.

### 3. Store — `src/stores/workspace.ts`

Three actions on `useWorkspace`:

- `createEntry(parentPath, name, isDir)` → IPC `create_file`/`create_dir`, then
  `refreshSubtree(parentPath)`. Ensures `parentPath` is expanded so the new row is visible.
- `renameEntry(path, newName)` → IPC `rename_path` → returns new path → `refreshSubtree(parent)`
  → `useBuffers.getState().renamePath(oldPath, newPath)`.
- `deleteEntry(path)` → `useBuffers` sync (below) → IPC `delete_path` → `refreshSubtree(parent)`.

Each refreshes only the affected parent subtree for immediacy. The fs-watcher also fires on
these changes but is debounced; the explicit refresh avoids visible lag and the watcher
reconciles any drift.

### 4. Buffer sync — `src/stores/buffers.ts`

- **`renamePath(oldPath, newPath)`** (new action): for any open buffer whose `path` equals
  `oldPath`, or is **under** `oldPath` when a folder was renamed (path-prefix + separator
  match), rewrite `path` (and derived display name). Case-insensitive compare on Windows.
- **Delete sync** (in `deleteEntry`, before the IPC call so we know disk state): for each open
  buffer at the deleted path (or under a deleted folder) — close it if **clean**; leave it open
  if **dirty** (content preserved, a later save re-creates the file). No silent data loss.

### 5. UI — `src/components/TreeNode.tsx` + `FileTreePanel.tsx`

**Context menu** (existing `TabContextMenu`, reused) gains entries:
- On a **folder** row: New File, New Folder, Rename, Delete.
- On a **file** row: Rename, Delete.

**Panel header** (`FileTreePanel`, next to the ↻ refresh button) gets **New File** and
**New Folder** buttons that create at the workspace root (right-clicking empty tree space is
awkward / has no target row).

**Inline rename:** entering rename mode (F2 or menu) swaps the row's label `<span>` for a
controlled `<input>` prefilled with the current name, text pre-selected. Enter commits via
`renameEntry`; Esc cancels. A backend error (duplicate / invalid) keeps the input open with
red helper text beneath it; the input does not lose its value.

**Inline create:** New File / New Folder inserts a temporary input row under the (auto-expanded)
target folder. Enter commits via `createEntry`; Esc/blur-empty cancels. Same inline error
treatment.

**Delete:** a small confirm dialog ("Move *name* to the Recycle Bin?") with Cancel / Move
buttons. Recoverable, but a deliberate step. New component `ConfirmDialog` (or reuse the
pattern from `ReplaceConfirmDialog`).

**Keyboard / selection:** tree rows are already focusable `<button>`s. A `selectedPath` piece
of UI state tracks the focused row; `onKeyDown` handles `F2` (rename) and `Delete` (delete-confirm).

**Test hooks:** add `window.__memopad*` hooks as needed for e2e to drive create/rename/delete
without simulating the native context menu, consistent with the existing hook pattern.

## Error handling

| Case | Handling |
|------|----------|
| Duplicate name | Backend `AlreadyExists` → inline red helper text; input stays open |
| Invalid / reserved-char name | Client-side reject + backend `InvalidName` guard (defense in depth) |
| Path escapes workspace | `resolve_under` rejects → `PathMissing`-class error |
| Case-insensitive collision (Windows) | Backend `AlreadyExists` (fs is case-insensitive) |
| Rename/delete a folder with open buffers | Buffer-sync rewrites/closes per rules above |
| Recycle Bin unavailable (e.g. network drive) | `trash::delete` errors → surfaced as a toast/inline error; no fallback hard-delete |

## Testing strategy

- **Rust unit tests** (`files.rs`): create-file/dir happy paths; rename happy path;
  duplicate-name error; missing-parent error; **path-escape rejection** for every op;
  `is_valid_filename` table test. Delete's path-guard (reject outside workspace) is unit-tested;
  the actual Recycle-Bin move is exercised in e2e (the `trash` call needs a real desktop shell).
- **vitest** (`workspace`/`buffers` stores): `createEntry`/`renameEntry`/`deleteEntry` with
  mocked IPC; `buffers.renamePath` rewrites file + folder-prefix paths; delete sync closes clean
  / keeps dirty buffers.
- **e2e** (`tests/e2e/file-tree-crud.spec.ts`, against the release build): create a file via the
  header button → rename it via F2 → delete it via the context menu; assert the tree refreshes
  and an open buffer's path follows a rename. Uses `__memopad*` hooks, mindful of the
  alphabetical-order / tab-leak gotchas recorded in prior e2e work.

## Scope boundaries (YAGNI — explicit non-goals for this cycle)

- No drag-to-move or move-between-folders (rename is same-directory only).
- No multi-select operations.
- No cut / copy / paste of files, no duplicate-file.
- No "new file from template" / file-type pickers.
- No undo beyond the OS Recycle Bin.

These are candidate follow-ups, not part of this plan.

## Release

Lands as **0.4.0**. CHANGELOG: removes "No file create / rename / delete" from Known
limitations; adds the four operations under Added. Version bump in `package.json`,
`src-tauri/Cargo.toml`, `tauri.conf.json` (per the established release procedure).
