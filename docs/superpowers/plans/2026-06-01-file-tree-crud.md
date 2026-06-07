# File Tree CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add New File, New Folder, Rename, and Delete (to Recycle Bin) to the workspace file tree, closing the "read-only tree" limitation carried since 0.1.0.

**Architecture:** Each operation threads through four layers, following existing patterns — a Rust command in `files.rs` (sandboxed under the workspace via a shared `resolve_under` guard), a typed binding in `lib/tauri.ts`, an action on `useWorkspace`, and UI in `TreeNode` / `FileTreePanel`. Rename and delete sync open buffers via `useBuffers`. Delete moves to the Windows Recycle Bin through the `trash` crate.

**Tech Stack:** Rust / Tauri 2 commands, `trash` crate; React 18 + TS, Zustand stores; Vitest (unit), WebdriverIO + Mocha (e2e).

Spec: `docs/superpowers/specs/2026-06-01-file-tree-crud-design.md`

---

## File Structure

**Rust (backend):**
- `src-tauri/src/files.rs` — add `is_valid_filename`, `resolve_under`, `create_file`, `create_dir`, `rename_entry`, `delete_entry`; new `FilesError` variants; unit tests. Refactor `list_dir_under` to use `resolve_under`.
- `src-tauri/Cargo.toml` — add `trash = "5"`.
- `src-tauri/src/lib.rs` — four `#[tauri::command]` wrappers + handler registration.

**Frontend:**
- `src/lib/tauri.ts` — `createFile`, `createDir`, `renamePath`, `deletePath` bindings.
- `src/stores/buffers.ts` — `renamePath`, `handleDeletedPath` actions.
- `src/stores/workspace.ts` — `createEntry`, `renameEntry`, `deleteEntry` actions + UI state (`editState`, `pendingDelete`).
- `src/components/InlineEditRow.tsx` — **new**: shared inline name input (used for rename + create).
- `src/components/ConfirmDialog.tsx` — **new**: generic confirm modal (delete confirmation).
- `src/components/TreeNode.tsx` — context-menu items, rename/create rendering, F2/Delete keys.
- `src/components/FileTreePanel.tsx` — header New File / New Folder buttons, root create row, ConfirmDialog host, e2e test hooks.

**Tests:**
- `src-tauri/src/files.rs` `#[cfg(test)]` — Rust unit tests.
- `src/tests/files-crud.test.ts` — **new**: workspace + buffer CRUD store tests (Vitest).
- `tests/e2e/file-tree-crud.spec.ts` — **new**: e2e.
- `tests/e2e/file-tree-context-menu.spec.ts` — **modify**: item-count assertion changes (Rename/Delete added).

---

## Task 1: Rust filename validation + shared sandbox guard

**Files:**
- Modify: `src-tauri/src/files.rs`

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)] mod tests` block in `src-tauri/src/files.rs`:

```rust
#[test]
fn valid_filenames_accepted() {
    assert!(is_valid_filename("notes.txt"));
    assert!(is_valid_filename("My File-2 (1).md"));
}

#[test]
fn invalid_filenames_rejected() {
    assert!(!is_valid_filename(""));
    assert!(!is_valid_filename("."));
    assert!(!is_valid_filename(".."));
    assert!(!is_valid_filename("a/b"));
    assert!(!is_valid_filename("a\\b"));
    for bad in ["a<b", "a>b", "a:b", "a\"b", "a|b", "a?b", "a*b"] {
        assert!(!is_valid_filename(bad), "{bad} should be rejected");
    }
}

#[test]
fn resolve_under_rejects_escape() {
    let ws = tmp("ru_ws");
    let outside = tmp("ru_out");
    assert!(resolve_under(&ws, &outside).is_err());
}

#[test]
fn resolve_under_accepts_child() {
    let ws = tmp("ru_child");
    touch(&ws, "a.txt");
    let child = ws.join("a.txt");
    let resolved = resolve_under(&ws, &child).unwrap();
    assert!(resolved.ends_with("a.txt"));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib files::tests::valid_filenames_accepted`
Expected: FAIL — `cannot find function is_valid_filename`.

- [ ] **Step 3: Implement**

In `src-tauri/src/files.rs`, after the `use` lines, add the constant and validator, and add the shared guard above `list_dir_under`. Also extend `FilesError`.

Add reserved-char constant + validator near the top (after imports):

```rust
const RESERVED_CHARS: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Validate a bare filename: non-empty, not "." / "..", no path separators,
/// no Windows-reserved characters.
pub fn is_valid_filename(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    !name.chars().any(|c| RESERVED_CHARS.contains(&c))
}
```

Extend the `FilesError` enum and its `Display`:

```rust
#[derive(Debug)]
pub enum FilesError {
    PathMissing,
    NotADirectory,
    AlreadyExists,
    InvalidName,
    Trash(String),
    Io(std::io::Error),
}
```

```rust
impl std::fmt::Display for FilesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FilesError::PathMissing => write!(f, "Folder no longer accessible"),
            FilesError::NotADirectory => write!(f, "Path is not a directory"),
            FilesError::AlreadyExists => write!(f, "A file or folder with that name already exists"),
            FilesError::InvalidName => write!(f, "Invalid name"),
            FilesError::Trash(m) => write!(f, "Could not move to Recycle Bin: {}", m),
            FilesError::Io(e) => write!(f, "{}", e),
        }
    }
}
```

Add the shared guard and refactor `list_dir_under` to use it (replace the existing body):

```rust
/// Canonicalize `path` and confirm it resolves under `workspace`.
fn resolve_under(workspace: &Path, path: &Path) -> Result<std::path::PathBuf, FilesError> {
    let ws_canon = workspace.canonicalize().map_err(|_| FilesError::PathMissing)?;
    let path_canon = path.canonicalize().map_err(|_| FilesError::PathMissing)?;
    if !path_canon.starts_with(&ws_canon) {
        return Err(FilesError::PathMissing);
    }
    Ok(path_canon)
}

/// Public: validate that `path` is under `workspace`, then list it.
pub fn list_dir_under(workspace: &Path, path: &Path) -> Result<Vec<DirEntry>, FilesError> {
    let path_canon = resolve_under(workspace, path)?;
    list_dir(&path_canon)
}
```

(Delete the old `list_dir_under` body — the two inline `canonicalize` calls are now inside `resolve_under`.)

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib files::`
Expected: PASS (existing `files::` tests still green, 4 new ones pass).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/files.rs
git commit -m "feat(files): add filename validation + shared resolve_under guard"
```

---

## Task 2: Rust create_file + create_dir

**Files:**
- Modify: `src-tauri/src/files.rs`

- [ ] **Step 1: Write failing tests**

Add to the test module:

```rust
#[test]
fn create_file_creates_empty_file() {
    let ws = tmp("cf");
    let entry = create_file(&ws, &ws, "new.txt").unwrap();
    assert_eq!(entry.name, "new.txt");
    assert_eq!(entry.is_dir, false);
    assert!(ws.join("new.txt").is_file());
}

#[test]
fn create_dir_creates_folder() {
    let ws = tmp("cd");
    let entry = create_dir(&ws, &ws, "sub").unwrap();
    assert_eq!(entry.is_dir, true);
    assert!(ws.join("sub").is_dir());
}

#[test]
fn create_file_rejects_duplicate() {
    let ws = tmp("cf_dup");
    touch(&ws, "dup.txt");
    let err = create_file(&ws, &ws, "dup.txt").unwrap_err();
    matches!(err, FilesError::AlreadyExists).then_some(()).unwrap();
}

#[test]
fn create_file_rejects_invalid_name() {
    let ws = tmp("cf_inv");
    let err = create_file(&ws, &ws, "a/b.txt").unwrap_err();
    matches!(err, FilesError::InvalidName).then_some(()).unwrap();
}

#[test]
fn create_file_rejects_parent_outside_workspace() {
    let ws = tmp("cf_ws");
    let outside = tmp("cf_out");
    let err = create_file(&ws, &outside, "x.txt").unwrap_err();
    matches!(err, FilesError::PathMissing).then_some(()).unwrap();
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib files::tests::create_file_creates_empty_file`
Expected: FAIL — `cannot find function create_file`.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/files.rs` (after `list_dir_under`):

```rust
/// Create an empty file named `name` inside `parent` (which must be under `workspace`).
pub fn create_file(workspace: &Path, parent: &Path, name: &str) -> Result<DirEntry, FilesError> {
    if !is_valid_filename(name) {
        return Err(FilesError::InvalidName);
    }
    let parent_canon = resolve_under(workspace, parent)?;
    if !parent_canon.is_dir() {
        return Err(FilesError::NotADirectory);
    }
    let target = parent_canon.join(name);
    if target.exists() {
        return Err(FilesError::AlreadyExists);
    }
    std::fs::File::create(&target)?;
    Ok(DirEntry {
        name: name.to_string(),
        path: target.to_string_lossy().to_string(),
        is_dir: false,
    })
}

/// Create a directory named `name` inside `parent` (which must be under `workspace`).
pub fn create_dir(workspace: &Path, parent: &Path, name: &str) -> Result<DirEntry, FilesError> {
    if !is_valid_filename(name) {
        return Err(FilesError::InvalidName);
    }
    let parent_canon = resolve_under(workspace, parent)?;
    if !parent_canon.is_dir() {
        return Err(FilesError::NotADirectory);
    }
    let target = parent_canon.join(name);
    if target.exists() {
        return Err(FilesError::AlreadyExists);
    }
    std::fs::create_dir(&target)?;
    Ok(DirEntry {
        name: name.to_string(),
        path: target.to_string_lossy().to_string(),
        is_dir: true,
    })
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib files::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/files.rs
git commit -m "feat(files): create_file + create_dir commands"
```

---

## Task 3: Rust rename_entry

**Files:**
- Modify: `src-tauri/src/files.rs`

- [ ] **Step 1: Write failing tests**

```rust
#[test]
fn rename_entry_renames_file() {
    let ws = tmp("rn");
    touch(&ws, "old.txt");
    let new_path = rename_entry(&ws, &ws.join("old.txt"), "new.txt").unwrap();
    assert!(new_path.ends_with("new.txt"));
    assert!(!ws.join("old.txt").exists());
    assert!(ws.join("new.txt").is_file());
}

#[test]
fn rename_entry_rejects_existing_target() {
    let ws = tmp("rn_dup");
    touch(&ws, "a.txt");
    touch(&ws, "b.txt");
    let err = rename_entry(&ws, &ws.join("a.txt"), "b.txt").unwrap_err();
    matches!(err, FilesError::AlreadyExists).then_some(()).unwrap();
}

#[test]
fn rename_entry_rejects_invalid_name() {
    let ws = tmp("rn_inv");
    touch(&ws, "a.txt");
    let err = rename_entry(&ws, &ws.join("a.txt"), "x/y.txt").unwrap_err();
    matches!(err, FilesError::InvalidName).then_some(()).unwrap();
}

#[test]
fn rename_entry_rejects_path_outside_workspace() {
    let ws = tmp("rn_ws");
    let outside = tmp("rn_out");
    touch(&outside, "a.txt");
    let err = rename_entry(&ws, &outside.join("a.txt"), "b.txt").unwrap_err();
    matches!(err, FilesError::PathMissing).then_some(()).unwrap();
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib files::tests::rename_entry_renames_file`
Expected: FAIL — `cannot find function rename_entry`.

- [ ] **Step 3: Implement**

Add to `src-tauri/src/files.rs`:

```rust
/// Rename the entry at `path` to `new_name`, staying in the same parent directory.
/// Returns the new absolute path. Allows a case-only rename (Windows-insensitive fs)
/// but rejects collision with a *different* existing entry.
pub fn rename_entry(workspace: &Path, path: &Path, new_name: &str) -> Result<String, FilesError> {
    if !is_valid_filename(new_name) {
        return Err(FilesError::InvalidName);
    }
    let path_canon = resolve_under(workspace, path)?;
    let parent = path_canon.parent().ok_or(FilesError::PathMissing)?;
    let target = parent.join(new_name);
    if target.exists() {
        // The only acceptable "exists" is the source itself differing only by case.
        let same = target.canonicalize().ok().as_deref() == Some(path_canon.as_path());
        if !same {
            return Err(FilesError::AlreadyExists);
        }
    }
    std::fs::rename(&path_canon, &target)?;
    Ok(target.to_string_lossy().to_string())
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib files::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/files.rs
git commit -m "feat(files): rename_entry command"
```

---

## Task 4: Rust delete_entry (Recycle Bin) + trash dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/files.rs`

- [ ] **Step 1: Add dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
trash = "5"
```

- [ ] **Step 2: Write failing tests**

The actual Recycle-Bin move needs a real desktop shell, so unit tests cover the **path guard** only (the happy path is covered in e2e Task 12):

```rust
#[test]
fn delete_entry_rejects_path_outside_workspace() {
    let ws = tmp("del_ws");
    let outside = tmp("del_out");
    touch(&outside, "a.txt");
    let err = delete_entry(&ws, &outside.join("a.txt")).unwrap_err();
    matches!(err, FilesError::PathMissing).then_some(()).unwrap();
}

#[test]
fn delete_entry_rejects_missing_path() {
    let ws = tmp("del_missing");
    let err = delete_entry(&ws, &ws.join("nope.txt")).unwrap_err();
    matches!(err, FilesError::PathMissing).then_some(()).unwrap();
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib files::tests::delete_entry_rejects_missing_path`
Expected: FAIL — `cannot find function delete_entry`.

- [ ] **Step 4: Implement**

Add to `src-tauri/src/files.rs`:

```rust
/// Move the entry at `path` to the OS Recycle Bin / Trash.
pub fn delete_entry(workspace: &Path, path: &Path) -> Result<(), FilesError> {
    let path_canon = resolve_under(workspace, path)?;
    trash::delete(&path_canon).map_err(|e| FilesError::Trash(e.to_string()))
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib files::`
Expected: PASS (the two guard tests pass without touching the Recycle Bin, since `resolve_under` fails first).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/files.rs
git commit -m "feat(files): delete_entry to Recycle Bin via trash crate"
```

---

## Task 5: Register Tauri commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add command wrappers**

In `src-tauri/src/lib.rs`, after the existing `list_dir` command (around line 121), add:

```rust
#[tauri::command]
fn create_file(workspace_folder: String, parent: String, name: String)
    -> Result<files::DirEntry, String> {
    files::create_file(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&parent),
        &name,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_dir(workspace_folder: String, parent: String, name: String)
    -> Result<files::DirEntry, String> {
    files::create_dir(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&parent),
        &name,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_path(workspace_folder: String, path: String, new_name: String)
    -> Result<String, String> {
    files::rename_entry(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&path),
        &new_name,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_path(workspace_folder: String, path: String) -> Result<(), String> {
    files::delete_entry(
        std::path::Path::new(&workspace_folder),
        std::path::Path::new(&path),
    ).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register in the handler**

In the `tauri::generate_handler![...]` list, after `list_dir,` add:

```rust
            create_file,
            create_dir,
            rename_path,
            delete_path,
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean (warnings OK).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(files): register create/rename/delete tauri commands"
```

---

## Task 6: Frontend IPC bindings

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add bindings**

In `src/lib/tauri.ts`, after the `listDir` function (around line 170), add:

```ts
export async function createFile(
  workspaceFolder: string, parent: string, name: string,
): Promise<DirEntry> {
  return invoke<DirEntry>('create_file', { workspaceFolder, parent, name });
}

export async function createDir(
  workspaceFolder: string, parent: string, name: string,
): Promise<DirEntry> {
  return invoke<DirEntry>('create_dir', { workspaceFolder, parent, name });
}

export async function renamePath(
  workspaceFolder: string, path: string, newName: string,
): Promise<string> {
  return invoke<string>('rename_path', { workspaceFolder, path, newName });
}

export async function deletePath(workspaceFolder: string, path: string): Promise<void> {
  return invoke<void>('delete_path', { workspaceFolder, path });
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean (trust tsc, not the LSP).

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(tauri): create/rename/delete IPC bindings"
```

---

## Task 7: Buffer sync (renamePath + handleDeletedPath)

**Files:**
- Modify: `src/stores/buffers.ts`
- Test: `src/tests/files-crud.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `src/tests/files-crud.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { useBuffers } from '../stores/buffers';

function openClean(path: string, content = 'x') {
  return useBuffers.getState().openBuffer({ path, content, encoding: 'utf-8', eol: 'lf' });
}

describe('buffers.renamePath', () => {
  beforeEach(() => useBuffers.getState().resetAll());

  it('rewrites an open buffer whose path matches the renamed file', () => {
    const id = openClean('C:/proj/old.txt');
    useBuffers.getState().renamePath('C:/proj/old.txt', 'C:/proj/new.txt');
    const b = useBuffers.getState().buffers.find((x) => x.id === id);
    expect(b?.path).toBe('C:/proj/new.txt');
  });

  it('rewrites buffers under a renamed folder (prefix)', () => {
    const id = openClean('C:/proj/src/a.txt');
    useBuffers.getState().renamePath('C:/proj/src', 'C:/proj/lib');
    const b = useBuffers.getState().buffers.find((x) => x.id === id);
    expect(b?.path).toBe('C:/proj/lib/a.txt');
  });

  it('leaves unrelated buffers untouched', () => {
    const id = openClean('C:/proj/other.txt');
    useBuffers.getState().renamePath('C:/proj/old.txt', 'C:/proj/new.txt');
    const b = useBuffers.getState().buffers.find((x) => x.id === id);
    expect(b?.path).toBe('C:/proj/other.txt');
  });
});

describe('buffers.handleDeletedPath', () => {
  beforeEach(() => useBuffers.getState().resetAll());

  it('closes a clean buffer at the deleted path', () => {
    const id = openClean('C:/proj/gone.txt');
    useBuffers.getState().handleDeletedPath('C:/proj/gone.txt');
    expect(useBuffers.getState().buffers.find((x) => x.id === id)).toBeUndefined();
  });

  it('keeps a dirty buffer at the deleted path', () => {
    const id = openClean('C:/proj/dirty.txt');
    useBuffers.getState().setActiveContent('edited');
    useBuffers.getState().handleDeletedPath('C:/proj/dirty.txt');
    expect(useBuffers.getState().buffers.find((x) => x.id === id)).toBeDefined();
  });

  it('closes clean buffers under a deleted folder', () => {
    const id = openClean('C:/proj/sub/a.txt');
    useBuffers.getState().handleDeletedPath('C:/proj/sub');
    expect(useBuffers.getState().buffers.find((x) => x.id === id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/files-crud.test.ts`
Expected: FAIL — `renamePath is not a function`.

- [ ] **Step 3: Implement**

In `src/stores/buffers.ts`, add to the `BuffersState` interface (near `replaceBuffer`):

```ts
  renamePath: (oldPath: string, newPath: string) => void;
  handleDeletedPath: (deletedPath: string) => void;
```

Add the implementations inside `create<BuffersState>(...)` (e.g. after `replaceBuffer`):

```ts
  renamePath: (oldPath, newPath) => {
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const oldNorm = norm(oldPath);
    const oldPrefix = oldNorm + '/';
    set((s) => ({
      buffers: s.buffers.map((b) => {
        if (b.path == null) return b;
        const bn = norm(b.path);
        if (bn === oldNorm) return { ...b, path: newPath };
        if (bn.startsWith(oldPrefix)) {
          // Folder rename: keep the remainder (with its original separators).
          return { ...b, path: newPath + b.path.slice(oldPath.length) };
        }
        return b;
      }),
    }));
  },

  handleDeletedPath: (deletedPath) => {
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    const dn = norm(deletedPath);
    const prefix = dn + '/';
    const toClose = get().buffers.filter((b) => {
      if (b.path == null) return false;
      const bn = norm(b.path);
      return (bn === dn || bn.startsWith(prefix)) && !b.dirty;
    });
    for (const b of toClose) get().closeBuffer(b.id);
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/tests/files-crud.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/buffers.ts src/tests/files-crud.test.ts
git commit -m "feat(buffers): renamePath + handleDeletedPath sync"
```

---

## Task 8: Workspace store CRUD actions

**Files:**
- Modify: `src/stores/workspace.ts`
- Test: `src/tests/files-crud.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

Append to `src/tests/files-crud.test.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../stores/workspace';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe('useWorkspace CRUD', () => {
  beforeEach(() => {
    useWorkspace.setState({
      workspaceFolder: 'C:/proj',
      expanded: new Set<string>(),
      childrenByPath: new Map(),
      loadingByPath: new Set<string>(),
    } as never);
    useBuffers.getState().resetAll();
    vi.clearAllMocks();
  });

  it('createEntry invokes create_file and refreshes the parent', async () => {
    mockInvoke
      .mockResolvedValueOnce({ name: 'new.txt', path: 'C:/proj/new.txt', is_dir: false }) // create_file
      .mockResolvedValueOnce([{ name: 'new.txt', path: 'C:/proj/new.txt', is_dir: false }]); // list_dir
    await useWorkspace.getState().createEntry('C:/proj', 'new.txt', false);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'create_file', {
      workspaceFolder: 'C:/proj', parent: 'C:/proj', name: 'new.txt',
    });
    expect(useWorkspace.getState().childrenByPath.get('C:/proj')?.[0]?.name).toBe('new.txt');
  });

  it('renameEntry invokes rename_path and syncs buffers', async () => {
    useBuffers.getState().openBuffer({ path: 'C:/proj/old.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
    mockInvoke
      .mockResolvedValueOnce('C:/proj/new.txt') // rename_path
      .mockResolvedValueOnce([]); // list_dir refresh
    const newPath = await useWorkspace.getState().renameEntry('C:/proj/old.txt', 'new.txt');
    expect(newPath).toBe('C:/proj/new.txt');
    expect(useBuffers.getState().buffers[0].path).toBe('C:/proj/new.txt');
  });

  it('deleteEntry invokes delete_path and closes clean buffer', async () => {
    const id = useBuffers.getState().openBuffer({ path: 'C:/proj/gone.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
    mockInvoke
      .mockResolvedValueOnce(undefined) // delete_path
      .mockResolvedValueOnce([]); // list_dir refresh
    await useWorkspace.getState().deleteEntry('C:/proj/gone.txt');
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'delete_path', {
      workspaceFolder: 'C:/proj', path: 'C:/proj/gone.txt',
    });
    expect(useBuffers.getState().buffers.find((b) => b.id === id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/files-crud.test.ts`
Expected: FAIL — `createEntry is not a function`.

- [ ] **Step 3: Implement**

In `src/stores/workspace.ts`, add a `parentOf` helper above the `create<WorkspaceState>` call:

```ts
/** The parent directory of an absolute path (handles both separators). */
function parentOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx <= 0 ? p : p.slice(0, idx);
}
```

Add to the `WorkspaceState` interface:

```ts
  createEntry: (parentPath: string, name: string, isDir: boolean) => Promise<DirEntry>;
  renameEntry: (path: string, newName: string) => Promise<string>;
  deleteEntry: (path: string) => Promise<void>;
```

Add the implementations inside the store (e.g. after `refreshSubtree`):

```ts
  async createEntry(parentPath, name, isDir) {
    const folder = get().workspaceFolder;
    if (!folder) throw new Error('No workspace open');
    const { createFile, createDir } = await import('../lib/tauri');
    const entry = isDir
      ? await createDir(folder, parentPath, name)
      : await createFile(folder, parentPath, name);
    if (!get().expanded.has(parentPath)) {
      const next = new Set(get().expanded);
      next.add(parentPath);
      set({ expanded: next });
    }
    await get().refreshSubtree(parentPath);
    return entry;
  },

  async renameEntry(path, newName) {
    const folder = get().workspaceFolder;
    if (!folder) throw new Error('No workspace open');
    const { renamePath } = await import('../lib/tauri');
    const newPath = await renamePath(folder, path, newName);
    await get().refreshSubtree(parentOf(path));
    const { useBuffers } = await import('./buffers');
    useBuffers.getState().renamePath(path, newPath);
    return newPath;
  },

  async deleteEntry(path) {
    const folder = get().workspaceFolder;
    if (!folder) throw new Error('No workspace open');
    const { deletePath } = await import('../lib/tauri');
    await deletePath(folder, path);
    const { useBuffers } = await import('./buffers');
    useBuffers.getState().handleDeletedPath(path);
    await get().refreshSubtree(parentOf(path));
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/tests/files-crud.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspace.ts src/tests/files-crud.test.ts
git commit -m "feat(workspace): createEntry/renameEntry/deleteEntry actions"
```

---

## Task 9: ConfirmDialog component

**Files:**
- Create: `src/components/ConfirmDialog.tsx`

- [ ] **Step 1: Implement**

Create `src/components/ConfirmDialog.tsx`:

```tsx
import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="min-w-[320px] rounded border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-200 shadow-xl">
        <h2 className="mb-2 font-medium">{title}</h2>
        <p className="mb-4 text-neutral-400">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            className="rounded bg-red-700 px-3 py-1 text-white hover:bg-red-600"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ConfirmDialog.tsx
git commit -m "feat(ui): ConfirmDialog component"
```

---

## Task 10: InlineEditRow component

**Files:**
- Create: `src/components/InlineEditRow.tsx`

- [ ] **Step 1: Implement**

Create `src/components/InlineEditRow.tsx`. It owns its input value + error; `onCommit` is async and may reject (duplicate/invalid) — on reject we keep the input open and show the message.

```tsx
import { useEffect, useRef, useState } from 'react';

interface Props {
  depth: number;
  isDir: boolean;
  initialValue: string;
  /** Resolve to commit + close; reject with an Error to keep the row open and show the message. */
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}

export function InlineEditRow({ depth, isDir, initialValue, onCommit, onCancel }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  async function commit() {
    const name = value.trim();
    if (name === '') { onCancel(); return; }
    setBusy(true);
    try {
      await onCommit(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div style={{ paddingLeft: `${depth * 12 + 6}px` }} className="py-0.5">
      <input
        ref={ref}
        data-testid="inline-edit-input"
        value={value}
        disabled={busy}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => { if (!busy) onCancel(); }}
        className="w-[90%] rounded border border-neutral-600 bg-neutral-800 px-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
        placeholder={isDir ? 'Folder name' : 'File name'}
      />
      {error && (
        <div data-testid="inline-edit-error" className="mt-0.5 text-[11px] text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/InlineEditRow.tsx
git commit -m "feat(ui): InlineEditRow for tree rename/create"
```

---

## Task 11: Wire CRUD UI state into the workspace store

**Files:**
- Modify: `src/stores/workspace.ts`

This adds the transient UI state the tree components read (which row is being renamed, which parent is getting a new child, which entry is pending delete). Kept in the store so any node + the panel + the dialog share it.

- [ ] **Step 1: Implement**

In `src/stores/workspace.ts`, add the type above the store and fields/actions to the interface + implementation.

Type (above `create<WorkspaceState>`):

```ts
export type TreeEditState =
  | { mode: 'rename'; path: string }
  | { mode: 'create'; parent: string; isDir: boolean }
  | null;
```

Interface additions:

```ts
  editState: TreeEditState;
  setEditState: (e: TreeEditState) => void;
  pendingDelete: DirEntry | null;
  setPendingDelete: (e: DirEntry | null) => void;
```

Initial state (in the object passed to `create`): `editState: null,` and `pendingDelete: null,`.

Implementations:

```ts
  setEditState(e) { set({ editState: e }); },
  setPendingDelete(e) { set({ pendingDelete: e }); },
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/stores/workspace.ts
git commit -m "feat(workspace): tree edit + pending-delete UI state"
```

---

## Task 12: TreeNode — menu items, rename/create rendering, keyboard

**Files:**
- Modify: `src/components/TreeNode.tsx`

- [ ] **Step 1: Implement**

Rewrite `src/components/TreeNode.tsx` to: render an `InlineEditRow` instead of the label when this node is being renamed; render a create-row as the first child when this folder is the create target; add Rename/Delete (and New File/New Folder on folders) to the context menu; handle F2/Delete keys.

```tsx
import { useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';
import { openFile as openFileIpc, type DirEntry, revealInExplorer } from '../lib/tauri';
import { TabContextMenu, type TabContextMenuItem } from './TabContextMenu';
import { InlineEditRow } from './InlineEditRow';
import { relativeToWorkspace } from '../lib/path';

interface Props {
  entry: DirEntry;
  depth: number;
}

export function TreeNode({ entry, depth }: Props) {
  const expanded = useWorkspace((s) => s.expanded);
  const childrenByPath = useWorkspace((s) => s.childrenByPath);
  const loadingByPath = useWorkspace((s) => s.loadingByPath);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);
  const editState = useWorkspace((s) => s.editState);
  const setEditState = useWorkspace((s) => s.setEditState);
  const setPendingDelete = useWorkspace((s) => s.setPendingDelete);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const isOpen = expanded.has(entry.path);
  const kids = childrenByPath.get(entry.path);
  const isLoading = loadingByPath.has(entry.path);

  const isRenaming = editState?.mode === 'rename' && editState.path === entry.path;
  const isCreateHere = editState?.mode === 'create' && editState.parent === entry.path;

  const onClick = async () => {
    if (entry.is_dir) {
      await toggleExpand(entry.path);
      return;
    }
    const existing = useBuffers.getState().buffers.find((b) => b.path === entry.path);
    if (existing) {
      useBuffers.getState().switchTo(existing.id);
      return;
    }
    try {
      const opened = await openFileIpc(entry.path);
      useBuffers.getState().openBuffer(opened);
    } catch {
      // swallow — existing fs error UI handles the message
    }
  };

  async function beginCreate(isDir: boolean) {
    if (!expanded.has(entry.path)) await toggleExpand(entry.path);
    setEditState({ mode: 'create', parent: entry.path, isDir });
  }

  function buildMenuItems(): TabContextMenuItem[] {
    const workspaceFolder = useWorkspace.getState().workspaceFolder ?? '';
    const items: TabContextMenuItem[] = [];
    if (entry.is_dir) {
      items.push({ label: 'New File', enabled: true, onClick: () => { void beginCreate(false); } });
      items.push({ label: 'New Folder', enabled: true, onClick: () => { void beginCreate(true); } });
    }
    items.push({ label: 'Rename', enabled: true, onClick: () => setEditState({ mode: 'rename', path: entry.path }) });
    items.push({ label: 'Delete', enabled: true, onClick: () => setPendingDelete(entry) });
    items.push({
      label: 'Reveal in Explorer', enabled: true,
      onClick: () => { revealInExplorer(entry.path).catch((err) => console.error('reveal:', err)); },
    });
    items.push({
      label: 'Copy Path', enabled: true,
      onClick: () => { navigator.clipboard.writeText(entry.path).catch((err) => console.error('clipboard:', err)); },
    });
    items.push({
      label: 'Copy Relative Path', enabled: workspaceFolder !== '',
      onClick: () => {
        const rel = relativeToWorkspace(entry.path, workspaceFolder);
        navigator.clipboard.writeText(rel).catch((err) => console.error('clipboard:', err));
      },
    });
    return items;
  }

  return (
    <>
      {isRenaming ? (
        <InlineEditRow
          depth={depth}
          isDir={entry.is_dir}
          initialValue={entry.name}
          onCommit={async (name) => {
            await useWorkspace.getState().renameEntry(entry.path, name);
            setEditState(null);
          }}
          onCancel={() => setEditState(null)}
        />
      ) : (
        <button
          type="button"
          data-testid="tree-row"
          data-depth={depth}
          data-is-dir={entry.is_dir}
          onClick={onClick}
          onContextMenu={(e) => { e.preventDefault(); setMenuPos({ x: e.clientX, y: e.clientY }); }}
          onKeyDown={(e) => {
            if (e.key === 'F2') { e.preventDefault(); setEditState({ mode: 'rename', path: entry.path }); }
            else if (e.key === 'Delete') { e.preventDefault(); setPendingDelete(entry); }
          }}
          title={entry.path}
          className="block w-full cursor-pointer truncate text-left text-xs text-neutral-300 hover:bg-neutral-800"
          style={{ paddingLeft: `${depth * 12 + 6}px`, paddingTop: 2, paddingBottom: 2 }}
        >
          <span className="mr-1 inline-block w-3 text-neutral-500">
            {entry.is_dir ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span className="text-neutral-500">{entry.is_dir ? '📁' : '📄'}</span>
          <span className="ml-1">{entry.name}</span>
        </button>
      )}
      {entry.is_dir && isOpen && (
        <>
          {isCreateHere && editState?.mode === 'create' && (
            <InlineEditRow
              depth={depth + 1}
              isDir={editState.isDir}
              initialValue=""
              onCommit={async (name) => {
                await useWorkspace.getState().createEntry(entry.path, name, editState.isDir);
                setEditState(null);
              }}
              onCancel={() => setEditState(null)}
            />
          )}
          {isLoading && !kids && (
            <div
              data-testid="tree-loading"
              className="px-2 py-0.5 text-xs italic text-neutral-500"
              style={{ paddingLeft: `${(depth + 1) * 12 + 6}px` }}
            >
              Loading…
            </div>
          )}
          {kids?.map((k) => (
            <TreeNode key={k.path} entry={k} depth={depth + 1} />
          ))}
        </>
      )}
      {menuPos && (
        <TabContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={buildMenuItems()}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/TreeNode.tsx
git commit -m "feat(ui): tree node rename/create/delete + keyboard"
```

---

## Task 13: FileTreePanel — header buttons, root create, dialog host, hooks

**Files:**
- Modify: `src/components/FileTreePanel.tsx`

- [ ] **Step 1: Implement**

Rewrite `src/components/FileTreePanel.tsx` to add: New File / New Folder header buttons (create at root), a root-level `InlineEditRow` when the create target is the workspace folder, the `ConfirmDialog` host driven by `pendingDelete`, and `window.__memopad*` e2e hooks.

```tsx
import { useEffect } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';
import { TreeNode } from './TreeNode';
import { InlineEditRow } from './InlineEditRow';
import { ConfirmDialog } from './ConfirmDialog';

export function FileTreePanel() {
  const folder = useWorkspace((s) => s.workspaceFolder);
  const childrenByPath = useWorkspace((s) => s.childrenByPath);
  const loadingByPath = useWorkspace((s) => s.loadingByPath);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);
  const refreshSubtree = useWorkspace((s) => s.refreshSubtree);
  const watcherError = useWorkspace((s) => s.watcherError);
  const editState = useWorkspace((s) => s.editState);
  const setEditState = useWorkspace((s) => s.setEditState);
  const pendingDelete = useWorkspace((s) => s.pendingDelete);
  const setPendingDelete = useWorkspace((s) => s.setPendingDelete);

  useEffect(() => {
    if (!folder) return;
    if (childrenByPath.has(folder)) return;
    if (loadingByPath.has(folder)) return;
    toggleExpand(folder).catch(() => {});
  }, [folder, childrenByPath, loadingByPath, toggleExpand]);

  // e2e test hooks — drive CRUD without simulating the native context menu.
  useEffect(() => {
    const w = window as unknown as {
      __memopadTreeCreate?: (parent: string, name: string, isDir: boolean) => Promise<unknown>;
      __memopadTreeRename?: (path: string, newName: string) => Promise<unknown>;
      __memopadTreeDelete?: (path: string) => Promise<unknown>;
    };
    w.__memopadTreeCreate = (parent, name, isDir) =>
      useWorkspace.getState().createEntry(parent, name, isDir);
    w.__memopadTreeRename = (path, newName) =>
      useWorkspace.getState().renameEntry(path, newName);
    w.__memopadTreeDelete = (path) => useWorkspace.getState().deleteEntry(path);
    return () => {
      delete w.__memopadTreeCreate;
      delete w.__memopadTreeRename;
      delete w.__memopadTreeDelete;
    };
  }, []);

  if (!folder) return null;

  const short = folder.split(/[/\\]/).slice(-2).join('/');
  const kids = childrenByPath.get(folder);
  const rootLoading = loadingByPath.has(folder);
  const isRootCreate = editState?.mode === 'create' && editState.parent === folder;

  return (
    <div data-testid="file-tree-panel" className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-1 text-xs text-neutral-400">
        <span className="truncate" title={folder}>{short}</span>
        <span className="flex items-center gap-1">
          <button
            type="button" title="New File" data-testid="file-tree-new-file"
            onClick={() => setEditState({ mode: 'create', parent: folder, isDir: false })}
            className="rounded px-1 text-neutral-500 hover:text-neutral-200"
          >🖹</button>
          <button
            type="button" title="New Folder" data-testid="file-tree-new-folder"
            onClick={() => setEditState({ mode: 'create', parent: folder, isDir: true })}
            className="rounded px-1 text-neutral-500 hover:text-neutral-200"
          >🗀</button>
          <button
            type="button" title="Refresh" data-testid="file-tree-refresh"
            onClick={() => refreshSubtree(folder).catch(() => {})}
            className="rounded px-1 text-neutral-500 hover:text-neutral-200"
          >↻</button>
        </span>
      </div>
      {watcherError && (
        <div data-testid="fs-watcher-error" className="border-b border-amber-700 bg-amber-900/40 px-3 py-1 text-xs text-amber-200">
          Live updates unavailable — refresh manually.
          <button
            type="button"
            onClick={() => useWorkspace.getState().setWatcherError(null)}
            className="ml-2 text-amber-300 hover:text-amber-100"
          >×</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {isRootCreate && editState?.mode === 'create' && (
          <InlineEditRow
            depth={0}
            isDir={editState.isDir}
            initialValue=""
            onCommit={async (name) => {
              await useWorkspace.getState().createEntry(folder, name, editState.isDir);
              setEditState(null);
            }}
            onCancel={() => setEditState(null)}
          />
        )}
        {rootLoading && !kids && (
          <div className="px-3 py-1 text-xs italic text-neutral-500">Loading…</div>
        )}
        {kids?.map((k) => (
          <TreeNode key={k.path} entry={k} depth={0} />
        ))}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.is_dir ? 'Delete folder' : 'Delete file'}
          message={`Move "${pendingDelete.name}" to the Recycle Bin?`}
          confirmLabel="Move to Recycle Bin"
          onConfirm={() => {
            const target = pendingDelete.path;
            setPendingDelete(null);
            useWorkspace.getState().deleteEntry(target).catch((err) => console.error('delete:', err));
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
```

Note: `useBuffers` is imported but only referenced indirectly through store actions — if `npx tsc --noEmit` flags it as unused, remove the import. (Kept minimal: the import line can be dropped since this component does not call `useBuffers` directly.)

**Correction:** remove the `import { useBuffers } ...` line — this component never references it directly. Final import block is the other five.

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean (no unused-import error).

- [ ] **Step 3: Commit**

```bash
git add src/components/FileTreePanel.tsx
git commit -m "feat(ui): file tree header create buttons + delete dialog + e2e hooks"
```

---

## Task 14: Update the context-menu e2e item-count assertion

**Files:**
- Modify: `tests/e2e/file-tree-context-menu.spec.ts`

The menu on a **file** row now has 5 items (Rename, Delete, Reveal, Copy Path, Copy Relative Path). The existing test asserts exactly 3 — update it.

- [ ] **Step 1: Update the assertions**

In `tests/e2e/file-tree-context-menu.spec.ts`, replace the assertion block at the end of the test:

```ts
    const items = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="menuitem"]')).map(b => b.textContent || '');`,
    );
    // File row menu: Rename, Delete, Reveal in Explorer, Copy Path, Copy Relative Path.
    expect(items.length).to.equal(5);
    expect(items[0]).to.match(/Rename/);
    expect(items[1]).to.match(/Delete/);
    expect(items[2]).to.match(/Reveal in Explorer/);
    expect(items[3]).to.match(/Copy Path/);
    expect(items[4]).to.match(/Copy Relative Path/);
```

- [ ] **Step 2: Commit** (e2e runs in the suite later; no isolated run here)

```bash
git add tests/e2e/file-tree-context-menu.spec.ts
git commit -m "test(e2e): update file-tree menu item-count for Rename/Delete"
```

---

## Task 15: e2e — create / rename / delete round-trip

**Files:**
- Create: `tests/e2e/file-tree-crud.spec.ts`

Uses the `__memopadTree*` hooks (Task 13) to drive CRUD, then asserts the tree + buffer state. Operates in a temp subfolder of the workspace fixture so it leaves no residue. Filename keeps it before `fs-watcher` / `layout` alphabetically but it resets the sidebar tab in `beforeEach` to respect the tab-leak gotcha.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/file-tree-crud.spec.ts`:

```ts
import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

describe('file-tree CRUD', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadShowFilesPanel?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadShowFilesPanel?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
    });
    await sleep(150);
  });

  it('creates, renames, and deletes a file via the tree', async () => {
    // Open the workspace + sidebar.
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(400);

    // Create a file at the workspace root.
    await classicExecute<unknown>(
      `return window.__memopadTreeCreate(${JSON.stringify(FIXTURE)}, 'crud-tmp.txt', false);`,
    );
    await sleep(300);
    let hasFile = await classicExecute<boolean>(
      `return Array.from(document.querySelectorAll('[data-testid="tree-row"]'))
        .some(r => (r.textContent || '').includes('crud-tmp.txt'));`,
    );
    expect(hasFile, 'created file should appear in the tree').to.equal(true);

    // Open it, then rename — the open buffer's path should follow.
    const createdPath = path.join(FIXTURE, 'crud-tmp.txt');
    await classicExecute<unknown>(
      `var w = window;
       return (async () => {
         const opened = await w.__memopadOpenPathForTest
           ? w.__memopadOpenPathForTest(${JSON.stringify(createdPath)})
           : null;
         return opened;
       })();`,
    ).catch(() => undefined);
    await classicExecute<unknown>(
      `return window.__memopadTreeRename(${JSON.stringify(createdPath)}, 'crud-renamed.txt');`,
    );
    await sleep(300);
    const hasRenamed = await classicExecute<boolean>(
      `return Array.from(document.querySelectorAll('[data-testid="tree-row"]'))
        .some(r => (r.textContent || '').includes('crud-renamed.txt'));`,
    );
    expect(hasRenamed, 'renamed file should appear').to.equal(true);

    // Delete (to Recycle Bin) and confirm it leaves the tree.
    const renamedPath = path.join(FIXTURE, 'crud-renamed.txt');
    await classicExecute<unknown>(
      `return window.__memopadTreeDelete(${JSON.stringify(renamedPath)});`,
    );
    await sleep(400);
    hasFile = await classicExecute<boolean>(
      `return Array.from(document.querySelectorAll('[data-testid="tree-row"]'))
        .some(r => (r.textContent || '').includes('crud-renamed.txt'));`,
    );
    expect(hasFile, 'deleted file should be gone from the tree').to.equal(false);
  });
});
```

Note: this spec relies on `__memopadTestSetWorkspace`, `__memopadShowFilesPanel`, and `__memopadTestReset` hooks (already present from prior work). The optional `__memopadOpenPathForTest` block is best-effort and tolerated if absent.

- [ ] **Step 2: Note on running**

The full e2e suite runs against the release build. Per project norm, run the whole suite once at the end (Task 17), not per-spec mid-plan. To run just this spec after a release build exists:
`npx mocha --grep "file-tree CRUD"`
Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/file-tree-crud.spec.ts
git commit -m "test(e2e): file-tree CRUD round-trip"
```

---

## Task 16: Version bump + CHANGELOG (0.4.0)

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump versions to 0.4.0**

- `package.json`: `"version": "0.3.0"` → `"0.4.0"`.
- `src-tauri/Cargo.toml`: `version = "0.3.0"` → `"0.4.0"` (the `[package]` version).
- `src-tauri/tauri.conf.json`: `"version": "0.3.0"` → `"0.4.0"`.

- [ ] **Step 2: Sync Cargo.lock**

Run: `cargo update -p memopad --manifest-path src-tauri/Cargo.toml`
(Or `cargo build` — either refreshes the `memopad` entry in `Cargo.lock` to 0.4.0.)

- [ ] **Step 3: Add CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add a new section:

```markdown
## [0.4.0] — 2026-06-01

The file tree becomes editable: create, rename, and delete files and folders without
leaving Memopad.

### Added

- **New File / New Folder** — via the file-tree header buttons (at the workspace root) or
  the right-click menu on any folder; inline name entry with duplicate/invalid-name feedback
- **Rename** — `F2` or the right-click menu; inline edit. Open buffers follow the rename
  (including buffers under a renamed folder)
- **Delete to Recycle Bin** — `Delete` key or the right-click menu, with a confirm dialog.
  Deletions are recoverable from the Windows Recycle Bin

### Changed

- Deleting a file closes its editor tab only if the buffer is clean; a buffer with unsaved
  edits stays open so nothing is lost (saving re-creates the file)

### Fixed

- (none)

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- Rename is same-directory only (no move); no drag-to-move, multi-select, or cut/copy/paste
- Split view is two panes max, horizontal only
```

Also remove the stale "No file create / rename / delete in the tree (still read-only)" line from the **0.3.0** Known limitations? No — leave historical entries intact; the new 0.4.0 entry supersedes it.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all green.

- [ ] **Step 5: Commit**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: bump to 0.4.0 + changelog for file-tree CRUD"
```

---

## Task 17: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: all green (including new `files::` tests).

- [ ] **Step 2: TS typecheck + unit tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all green.

- [ ] **Step 3: Release build + full e2e**

Run (Bash tool):
```bash
rm -f src-tauri/target/release/app.exe
npm run tauri build || echo "unsigned build exit tolerated"
test -f src-tauri/target/release/app.exe
npx mocha
```
Expected: full suite green, including `file-tree CRUD` (1) and the updated `file-tree context menu` (1).

- [ ] **Step 4: Manual smoke (GUI)**

Per the GUI-verification memory: drive the real WebView via the e2e harness + `takeScreenshot`, then `Read` the PNG. Confirm: New File creates an inline input → typing + Enter adds the row; F2 renames a row; Delete shows the confirm dialog and removes the row; the file lands in the Recycle Bin.

- [ ] **Step 5: Final commit (if any smoke fixups)** — otherwise nothing to commit.

---

## Self-Review notes

- **Spec coverage:** create_file/dir (T2,T5,T6,T8,T10,T13), rename (T3,T5,T6,T7,T8,T10), delete→Recycle Bin (T4,T5,T6,T7,T8,T13 dialog), name validation (T1), buffer sync clean/dirty (T7,T8), menu+keyboard triggers (T10), confirm dialog (T9,T13), tests Rust/vitest/e2e (T1-4,T7-8,T15), version+changelog (T16). All spec sections map to tasks.
- **Type consistency:** `createEntry/renameEntry/deleteEntry`, `renamePath/handleDeletedPath`, `editState/TreeEditState`, `pendingDelete/setPendingDelete`, `InlineEditRow`, `ConfirmDialog` names are used identically across tasks.
- **Gotcha captured:** the existing 3-item context-menu e2e assertion is updated in T14 (would otherwise fail). Tab-leak / alphabetical-order e2e gotcha handled in T15 `beforeEach`.
