# Tree Drag-to-Move — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 0.8.0

## Problem

The file tree (0.4.0 CRUD) can create, rename, and delete, but cannot **move** an entry
between folders. Dragging a file/folder onto another folder is the expected gesture and
the last common file-manager operation missing.

## Decisions (locked during brainstorming)

- **No confirm dialog** — a drag is intentional and the move is recoverable (drag back).
- **Drop targets are folders + the panel root only.** Dropping on a file is a no-op (not
  "into the file's parent").
- **Drag state lives in the `useWorkspace` store** (a `dragPath`), not `dataTransfer`, so the
  classic-WebDriver e2e path (which can't read `dataTransfer`) can drive it.
- Reuses the existing `resolve_under` guard, `useBuffers.renamePath` buffer sync, and the
  `__memopadTree*` hook pattern.

## Architecture

HTML5 drag-and-drop on tree rows sets a `dragPath`; dropping on a folder row (or the root
area) calls a new `useWorkspace.moveEntry(src, destDir)`, which invokes a new guarded Rust
`move_path` command, then refreshes both affected parent subtrees and rewrites open buffer
paths.

```
TreeNode (draggable) --onDragStart--> useWorkspace.dragPath = entry.path
folder row / root --onDrop--> moveEntry(dragPath, destDir)
   → IPC move_path(workspace, src, destDir) -> newPath
   → refreshSubtree(parentOf(src)) + refreshSubtree(destDir)
   → useBuffers.renamePath(src, newPath)
```

### 1. Backend — `src-tauri/src/files.rs` + `lib.rs`

New function reusing `resolve_under`:

```rust
/// Move `src` into directory `dest_dir` (both under `workspace`). Returns the new path.
pub fn move_entry(workspace: &Path, src: &Path, dest_dir: &Path) -> Result<String, FilesError> {
    let src_canon = resolve_under(workspace, src)?;
    let dest_canon = resolve_under(workspace, dest_dir)?;
    if !dest_canon.is_dir() {
        return Err(FilesError::NotADirectory);
    }
    // Reject moving a directory into itself or one of its own descendants.
    if dest_canon == src_canon || dest_canon.starts_with(&src_canon) {
        return Err(FilesError::InvalidName);
    }
    let name = src_canon.file_name().ok_or(FilesError::PathMissing)?;
    let target = dest_canon.join(name);
    if target.exists() {
        // Same-parent move is a no-op; a different existing entry is a collision.
        if target == src_canon {
            return Ok(src_canon.to_string_lossy().to_string());
        }
        return Err(FilesError::AlreadyExists);
    }
    std::fs::rename(&src_canon, &target)?;
    Ok(target.to_string_lossy().to_string())
}
```

New `#[tauri::command] fn move_path(workspace_folder, src, dest_dir) -> Result<String, String>`
registered in `generate_handler!`, mirroring the existing `rename_path` wrapper.

(No new `FilesError` variants — reuses `InvalidName` for into-self/descendant, `AlreadyExists`
for collision, `NotADirectory`, `PathMissing`.)

### 2. Frontend binding — `src/lib/tauri.ts`

```ts
export async function movePath(
  workspaceFolder: string, src: string, destDir: string,
): Promise<string> {
  return invoke<string>('move_path', { workspaceFolder, src, destDir });
}
```

### 3. Store + guard — `src/stores/workspace.ts` + `src/lib/path.ts`

UI state: `dragPath: string | null` + `setDragPath`.

Pure guard in `src/lib/path.ts` (new helper, or inline in workspace — placed in `path.ts`
beside `relativeToWorkspace`/`parentOf` consumers):

```ts
/** True when moving `src` into `destDir` is a no-op or illegal (same parent, into self, into a descendant). */
export function isInvalidMove(src: string, destDir: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const s = norm(src);
  const d = norm(destDir);
  if (d === s) return true;                 // into itself
  if (d.startsWith(s + '/')) return true;   // into a descendant
  const parent = s.slice(0, s.lastIndexOf('/'));
  if (d === parent) return true;            // already in destDir
  return false;
}
```

Action:

```ts
async moveEntry(srcPath, destDir) {
  const folder = get().workspaceFolder;
  if (!folder) throw new Error('No workspace open');
  const { movePath } = await import('../lib/tauri');
  const newPath = await movePath(folder, srcPath, destDir);
  await get().refreshSubtree(parentOf(srcPath));
  await get().refreshSubtree(destDir);
  const { useBuffers } = await import('./buffers');
  useBuffers.getState().renamePath(srcPath, newPath);
  return newPath;
}
```

(`parentOf` already exists in `workspace.ts`.)

### 4. UI — `src/components/TreeNode.tsx` + `FileTreePanel.tsx`

- **TreeNode rows** gain `draggable`, `onDragStart` → `setDragPath(entry.path)` (and clear on
  `onDragEnd`).
- **Folder rows** become drop targets: `onDragOver` → if `dragPath && !isInvalidMove(dragPath, entry.path)` then `e.preventDefault()` (enables drop) + set a local `isDropTarget` highlight;
  `onDragLeave` clears it; `onDrop` → `moveEntry(dragPath, entry.path)` (catch → set move error) +
  clear highlight + `setDragPath(null)`.
- **FileTreePanel root area** (the scroll container) is a drop target with `destDir = folder`,
  same logic.
- Drop-target highlight: an accent ring/background on the hovered valid folder.
- **Move errors** (collision) surface in an auto-clearing banner reusing the `watcherError`
  banner markup/pattern (`moveError` state in `FileTreePanel`, cleared after ~4s or on next action).
- **e2e hook** `__memopadTreeMove(src, destDir)` → `useWorkspace.getState().moveEntry(...)`,
  registered alongside the existing `__memopadTree*` hooks in `FileTreePanel`.

### 5. Buffer sync

Reuse `useBuffers.renamePath(oldPath, newPath)` — moving rewrites the path the same way a
rename does, including folder-prefix rewrites for a moved directory's open children.

## Error handling / edge cases

| Case | Handling |
|------|----------|
| Move into self / descendant | UI: invalid target, no highlight/drop. Backend: `InvalidName` guard |
| Move to current parent (no-op) | UI: invalid target. Backend: same-parent returns unchanged path |
| Name collision in dest | Backend `AlreadyExists` → auto-clearing banner |
| Drop on a file | No drop handler on file rows → ignored |
| src/dest outside workspace | `resolve_under` rejects |
| Open buffer under moved entry | `renamePath` rewrites its path |

## Testing strategy

- **Rust** (`files.rs`): move file into subdir (target exists at new location, gone from old);
  move folder; reject into-self; reject into-descendant; reject collision; reject dest outside
  workspace; same-parent no-op returns unchanged path.
- **vitest:** `isInvalidMove` table (same path, descendant, current parent, valid sibling-folder);
  `moveEntry` (mock IPC → asserts `move_path` args, refreshes both parents, buffer path follows).
- **e2e** (`tests/e2e/tree-move.spec.ts`, release build): with a workspace fixture, `__memopadTreeMove`
  a file into a subfolder → assert a `[data-testid="tree-row"]` for it appears under the folder and
  is gone from the root listing, and an open buffer's path follows. Assert an into-itself move
  leaves the tree unchanged. Reset sidebar/tab state in `beforeEach` (state-leak gotcha).
- **GUI smoke:** synthesize real `dragstart`/`dragover`/`drop` DOM events between two rows to confirm
  the DnD wiring + drop-target highlight render; screenshot. (Throwaway; deleted after.)

## Scope boundaries (YAGNI — non-goals)

- Folders + root are the only drop targets (no drop-on-file → parent).
- No multi-select drag, no copy-on-Ctrl-drag, no OS drag in/out, no manual within-folder reordering.
- No confirm dialog.

## Release

Ships as **0.8.0**. CHANGELOG: Added — drag a file or folder onto another folder (or the tree root)
to move it; open editors follow the move. Version bump in `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`. Removes the "no move" implication from the file-tree limitations.
