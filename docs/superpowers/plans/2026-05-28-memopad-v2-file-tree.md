# Memopad v2 — File Tree Sidebar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Files" tab to the existing left sidebar that shows the workspace folder as a lazy-expanding read-only tree. Single click on a file opens it as an editor tab. Manual refresh button reloads the view. Honors `.gitignore` + dotfiles by default.

**Architecture:** A new `src-tauri/src/files.rs` module exposes one Tauri command `list_dir(workspace_folder, path)` that uses `ignore::WalkBuilder` at `max_depth(1)` to return one directory's children. `useWorkspace` gains three tree fields (`expanded`, `childrenByPath`, `loadingByPath`) plus `toggleExpand` / `refreshSubtree` / `clearTreeCache` actions. The sidebar header becomes tabs (`Files` / `Search`); a new `FileTreePanel` + recursive `TreeNode` render the tree; clicking a file reuses the existing `openFile` IPC + `openBuffer` action.

**Tech Stack:** Tauri 2, Rust (`ignore` crate already in deps from slice 1), React + Zustand. No new dependencies.

**Spec section reference:** `docs/superpowers/specs/2026-05-28-file-tree-design.md` (all sections).

---

## File Structure

```
memopad/
├── src-tauri/
│   └── src/
│       ├── lib.rs               MODIFY — mod files; register list_dir command
│       └── files.rs             CREATE — DirEntry, FilesError, list_dir, list_dir_under, tests
├── src/
│   ├── lib/
│   │   └── tauri.ts             MODIFY — DirEntry type + listDir IPC wrapper
│   ├── stores/
│   │   └── workspace.ts         MODIFY — tree state + actions; closeFolder clears tree
│   ├── components/
│   │   ├── Sidebar.tsx          MODIFY — activeTab state; renders <SidebarTabs/> + active panel
│   │   ├── SidebarTabs.tsx      CREATE — presentational tab bar
│   │   ├── FileTreePanel.tsx    CREATE — root header, refresh button, mounts root <TreeNode>s
│   │   └── TreeNode.tsx         CREATE — recursive row
│   ├── commands/
│   │   └── builtins.ts          MODIFY — view.toggleSidebarTab command
│   └── tests/
│       └── workspace-tree.test.ts  CREATE — 5 Vitest cases
└── tests/e2e/
    └── file-tree.spec.ts        CREATE — 3 e2e tests (reuses slice-1 fixture)
```

Boundary intent:
- **`files.rs`** owns directory listing + path sandboxing. Pure functions. Tests use a tempdir.
- **`workspace.ts`** gains a tree slice that is the SINGLE source of truth for expansion state + cached children. SearchPanel doesn't touch it; FileTreePanel doesn't touch search state.
- **`SidebarTabs.tsx`** is presentational — no store access. **`Sidebar.tsx`** owns active-tab state. **`FileTreePanel.tsx`** owns the root-load effect and refresh button. **`TreeNode.tsx`** owns one row + recursive children.

---

## Task 1: `files.rs` scaffold + types + `mod files;`

**Files:**
- Create: `src-tauri/src/files.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod files;`)

- [ ] **Step 1: Create `src-tauri/src/files.rs`**

EXACT contents:

```rust
// Directory listing for the workspace file tree.
// One Tauri command (`list_dir`) returns the immediate children of a directory
// using `ignore::WalkBuilder` so .gitignore and dotfile filtering match
// find-in-files behavior.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug)]
pub enum FilesError {
    PathMissing,
    NotADirectory,
    Io(std::io::Error),
}

impl std::fmt::Display for FilesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FilesError::PathMissing => write!(f, "Folder no longer accessible"),
            FilesError::NotADirectory => write!(f, "Path is not a directory"),
            FilesError::Io(e) => write!(f, "{}", e),
        }
    }
}

impl From<std::io::Error> for FilesError {
    fn from(e: std::io::Error) -> Self { FilesError::Io(e) }
}

/// Internal: list the immediate children of `path` (depth=1) honoring
/// .gitignore / .ignore / hidden files. Sorted: dirs first, then files,
/// both alphabetically case-insensitive. The root itself is excluded.
pub fn list_dir(_path: &Path) -> Result<Vec<DirEntry>, FilesError> {
    // Filled in by later tasks.
    Ok(Vec::new())
}

/// Public: validate that `path` is under `workspace`, then list it.
pub fn list_dir_under(_workspace: &Path, _path: &Path) -> Result<Vec<DirEntry>, FilesError> {
    // Filled in by later tasks.
    Ok(Vec::new())
}
```

- [ ] **Step 2: Declare `mod files;` in `src-tauri/src/lib.rs`**

Change the top of `src-tauri/src/lib.rs` from:

```rust
mod fs;
mod journal;
mod search;
mod session;
mod stat;
```

to:

```rust
mod files;
mod fs;
mod journal;
mod search;
mod session;
mod stat;
```

(No command registration yet — Task 5 wires it.)

- [ ] **Step 3: Verify it compiles**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: clean compile. Unused-fn warnings expected at this stage.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/files.rs src-tauri/src/lib.rs
git commit -m "files: scaffold module + types"
```

---

## Task 2: `list_dir` — sorted listing of a directory

**Files:**
- Modify: `src-tauri/src/files.rs`

- [ ] **Step 1: Append the first test**

At the bottom of `src-tauri/src/files.rs` add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "memopad_files_{}_{}_{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
            std::process::id(),
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(dir: &std::path::Path, rel: &str) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).unwrap(); }
        std::fs::write(path, b"").unwrap();
    }

    #[test]
    fn lists_files_and_dirs_sorted() {
        let dir = tmp("sorted");
        std::fs::create_dir_all(dir.join("A")).unwrap();
        std::fs::create_dir_all(dir.join("B")).unwrap();
        touch(&dir, "b.txt");
        touch(&dir, "c.rs");

        let entries = list_dir(&dir).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert_eq!(names, vec!["A", "B", "b.txt", "c.rs"]);
        assert_eq!(entries[0].is_dir, true);
        assert_eq!(entries[1].is_dir, true);
        assert_eq!(entries[2].is_dir, false);
        assert_eq!(entries[3].is_dir, false);
    }
}
```

- [ ] **Step 2: Run to confirm fail**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib files::tests::lists_files_and_dirs_sorted
cd ..
```

Expected: FAIL — the stub returns an empty vec.

- [ ] **Step 3: Implement `list_dir`**

Replace the stub `list_dir` in `src-tauri/src/files.rs`:

```rust
pub fn list_dir(path: &Path) -> Result<Vec<DirEntry>, FilesError> {
    use ignore::WalkBuilder;

    if !path.exists() {
        return Err(FilesError::PathMissing);
    }
    if !path.is_dir() {
        return Err(FilesError::NotADirectory);
    }

    let mut entries: Vec<DirEntry> = Vec::new();
    let walker = WalkBuilder::new(path)
        .standard_filters(true)
        .max_depth(Some(1))
        .require_git(false)
        .build();

    for result in walker {
        let entry = match result { Ok(e) => e, Err(_) => continue };
        // Skip the root itself.
        if entry.depth() == 0 { continue; }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();
        entries.push(DirEntry { name, path, is_dir });
    }

    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}
```

- [ ] **Step 4: Run the test**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib files::tests::lists_files_and_dirs_sorted
cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/files.rs
git commit -m "files: implement list_dir with sorting"
```

---

## Task 3: gitignore / dotfile / max-depth tests

**Files:**
- Modify: `src-tauri/src/files.rs`

- [ ] **Step 1: Append three tests inside `mod tests`**

```rust
#[test]
fn respects_gitignore() {
    let dir = tmp("ignore");
    std::fs::write(dir.join(".gitignore"), "target/\n").unwrap();
    std::fs::create_dir_all(dir.join("target")).unwrap();
    touch(&dir, "target/build.rs");
    touch(&dir, "src.rs");

    let entries = list_dir(&dir).unwrap();
    let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
    assert!(!names.contains(&"target".to_string()), "expected target/ to be filtered, got {:?}", names);
    assert!(names.contains(&"src.rs".to_string()));
}

#[test]
fn skips_hidden_dotfiles() {
    let dir = tmp("hidden");
    std::fs::create_dir_all(dir.join(".git")).unwrap();
    touch(&dir, ".env");
    touch(&dir, "visible.txt");

    let entries = list_dir(&dir).unwrap();
    let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
    assert!(!names.contains(&".git".to_string()), "expected .git to be hidden");
    assert!(!names.contains(&".env".to_string()), "expected .env to be hidden");
    assert!(names.contains(&"visible.txt".to_string()));
}

#[test]
fn max_depth_is_one() {
    let dir = tmp("depth");
    std::fs::create_dir_all(dir.join("a/b")).unwrap();
    touch(&dir, "a/b/c.txt");

    let entries = list_dir(&dir).unwrap();
    let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
    assert_eq!(names, vec!["a"]);
}
```

- [ ] **Step 2: Run them**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib files::tests::respects_gitignore
cargo test --lib files::tests::skips_hidden_dotfiles
cargo test --lib files::tests::max_depth_is_one
cd ..
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/files.rs
git commit -m "files: tests for gitignore, hidden files, max_depth=1"
```

---

## Task 4: Error tests + `list_dir_under` sandboxing

**Files:**
- Modify: `src-tauri/src/files.rs`

- [ ] **Step 1: Append four tests inside `mod tests`**

```rust
#[test]
fn errors_when_path_missing() {
    let missing = std::env::temp_dir().join("memopad_files_does_not_exist_xyz_abc");
    let _ = std::fs::remove_dir_all(&missing);
    let err = list_dir(&missing).unwrap_err();
    match err { FilesError::PathMissing => {}, other => panic!("expected PathMissing, got {:?}", other) }
}

#[test]
fn errors_when_path_is_file() {
    let dir = tmp("isfile");
    touch(&dir, "a.txt");
    let err = list_dir(&dir.join("a.txt")).unwrap_err();
    match err { FilesError::NotADirectory => {}, other => panic!("expected NotADirectory, got {:?}", other) }
}

#[test]
fn list_dir_under_lists_workspace_itself() {
    let dir = tmp("under_root");
    touch(&dir, "a.txt");
    let entries = list_dir_under(&dir, &dir).unwrap();
    let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
    assert_eq!(names, vec!["a.txt"]);
}

#[test]
fn rejects_path_outside_workspace() {
    let workspace = tmp("ws_in");
    let other = tmp("ws_out");
    let err = list_dir_under(&workspace, &other).unwrap_err();
    match err { FilesError::PathMissing => {}, other => panic!("expected PathMissing, got {:?}", other) }
}
```

- [ ] **Step 2: Run — `errors_when_path_missing` and `errors_when_path_is_file` should already pass; the two `list_dir_under` tests fail**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib files::tests::errors_when_path_missing
cargo test --lib files::tests::errors_when_path_is_file
cargo test --lib files::tests::list_dir_under_lists_workspace_itself
cargo test --lib files::tests::rejects_path_outside_workspace
cd ..
```

Expected: first two PASS, last two FAIL.

- [ ] **Step 3: Implement `list_dir_under`**

Replace the stub `list_dir_under` with:

```rust
pub fn list_dir_under(workspace: &Path, path: &Path) -> Result<Vec<DirEntry>, FilesError> {
    let ws_canon = workspace.canonicalize().map_err(|_| FilesError::PathMissing)?;
    let path_canon = path.canonicalize().map_err(|_| FilesError::PathMissing)?;
    if !path_canon.starts_with(&ws_canon) {
        return Err(FilesError::PathMissing);
    }
    list_dir(&path_canon)
}
```

- [ ] **Step 4: Re-run the two failing tests**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib files::tests::list_dir_under_lists_workspace_itself
cargo test --lib files::tests::rejects_path_outside_workspace
cd ..
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/files.rs
git commit -m "files: error variants + list_dir_under path sandboxing"
```

---

## Task 5: Wire `list_dir` as a Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command wrapper**

In `src-tauri/src/lib.rs`, after the existing `find_in_folder` `#[tauri::command]`, add:

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

- [ ] **Step 2: Register it in `invoke_handler!`**

In the `.invoke_handler(tauri::generate_handler![ ... ])` macro list, add `list_dir,` after `find_in_folder,`:

```rust
            find_in_folder,
            list_dir,
        ])
```

- [ ] **Step 3: Verify**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: clean compile.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "files: register list_dir Tauri command"
```

---

## Task 6: TypeScript IPC wrapper

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Append types + wrapper at the bottom of `src/lib/tauri.ts`**

```ts
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function listDir(workspaceFolder: string, path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>('list_dir', { workspaceFolder, path });
}
```

- [ ] **Step 2: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/tauri.ts
git commit -m "tauri: typed listDir IPC wrapper"
```

---

## Task 7: Workspace store — tree state + actions

**Files:**
- Modify: `src/stores/workspace.ts`
- Create: `src/tests/workspace-tree.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tests/workspace-tree.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../stores/workspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: 'C:/proj',
    results: null,
    inFlight: false,
    lastQuery: '',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    expanded: new Set<string>(),
    childrenByPath: new Map(),
    loadingByPath: new Set<string>(),
  } as never);
  vi.clearAllMocks();
});

describe('useWorkspace tree', () => {
  it('toggleExpand adds path and fetches children', async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: 'a.txt', path: 'C:/proj/a.txt', is_dir: false },
    ]);
    await useWorkspace.getState().toggleExpand('C:/proj');
    expect(useWorkspace.getState().expanded.has('C:/proj')).toBe(true);
    expect(useWorkspace.getState().childrenByPath.get('C:/proj')?.length).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('toggleExpand on expanded path collapses without re-fetching', async () => {
    useWorkspace.setState({
      expanded: new Set(['C:/proj']),
      childrenByPath: new Map([['C:/proj', [{ name: 'a.txt', path: 'C:/proj/a.txt', is_dir: false }]]]),
    } as never);
    await useWorkspace.getState().toggleExpand('C:/proj');
    expect(useWorkspace.getState().expanded.has('C:/proj')).toBe(false);
    expect(useWorkspace.getState().childrenByPath.get('C:/proj')?.length).toBe(1); // cache intact
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refreshSubtree replaces cached children', async () => {
    useWorkspace.setState({
      childrenByPath: new Map([['C:/proj', [{ name: 'old.txt', path: 'C:/proj/old.txt', is_dir: false }]]]),
    } as never);
    (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: 'new.txt', path: 'C:/proj/new.txt', is_dir: false },
    ]);
    await useWorkspace.getState().refreshSubtree('C:/proj');
    const kids = useWorkspace.getState().childrenByPath.get('C:/proj');
    expect(kids?.[0]?.name).toBe('new.txt');
  });

  it('clearTreeCache resets all three fields', () => {
    useWorkspace.setState({
      expanded: new Set(['C:/proj']),
      childrenByPath: new Map([['C:/proj', []]]),
      loadingByPath: new Set(['C:/proj']),
    } as never);
    useWorkspace.getState().clearTreeCache();
    expect(useWorkspace.getState().expanded.size).toBe(0);
    expect(useWorkspace.getState().childrenByPath.size).toBe(0);
    expect(useWorkspace.getState().loadingByPath.size).toBe(0);
  });

  it('closeFolder clears tree cache', () => {
    useWorkspace.setState({
      expanded: new Set(['C:/proj']),
      childrenByPath: new Map([['C:/proj', []]]),
    } as never);
    useWorkspace.getState().closeFolder();
    expect(useWorkspace.getState().expanded.size).toBe(0);
    expect(useWorkspace.getState().childrenByPath.size).toBe(0);
    expect(useWorkspace.getState().workspaceFolder).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see failure**

```powershell
npm test -- workspace-tree
```

Expected: FAIL — actions don't exist on the store.

- [ ] **Step 3: Extend the store**

In `src/stores/workspace.ts`:

3a. Add an import alongside the existing ones:

```ts
import { listDir, type DirEntry } from '../lib/tauri';
```

3b. Extend the `WorkspaceState` interface — add these inside the existing `interface WorkspaceState { ... }`:

```ts
expanded: Set<string>;
childrenByPath: Map<string, DirEntry[]>;
loadingByPath: Set<string>;

toggleExpand: (path: string) => Promise<void>;
refreshSubtree: (path: string) => Promise<void>;
clearTreeCache: () => void;
```

3c. Add the initial state values inside the `create<WorkspaceState>((set, get) => ({ ... }))` block, near the existing initial values:

```ts
expanded: new Set<string>(),
childrenByPath: new Map<string, DirEntry[]>(),
loadingByPath: new Set<string>(),
```

3d. Add the three new action implementations inside the same block. Add them right BEFORE the existing `clearResults() { set({ results: null }); },` line:

```ts
async toggleExpand(path) {
  const cur = get();
  if (cur.expanded.has(path)) {
    const next = new Set(cur.expanded);
    next.delete(path);
    set({ expanded: next });
    return;
  }
  const nextExpanded = new Set(cur.expanded);
  nextExpanded.add(path);
  set({ expanded: nextExpanded });
  if (cur.childrenByPath.has(path)) return;
  const folder = cur.workspaceFolder;
  if (!folder) return;
  const nextLoading = new Set(cur.loadingByPath);
  nextLoading.add(path);
  set({ loadingByPath: nextLoading });
  try {
    const kids = await listDir(folder, path);
    const c = get();
    const newChildren = new Map(c.childrenByPath);
    newChildren.set(path, kids);
    const newLoading = new Set(c.loadingByPath);
    newLoading.delete(path);
    set({ childrenByPath: newChildren, loadingByPath: newLoading });
  } catch {
    const c = get();
    const newLoading = new Set(c.loadingByPath);
    newLoading.delete(path);
    set({ loadingByPath: newLoading });
  }
},

async refreshSubtree(path) {
  const folder = get().workspaceFolder;
  if (!folder) return;
  const nextLoading = new Set(get().loadingByPath);
  nextLoading.add(path);
  set({ loadingByPath: nextLoading });
  try {
    const kids = await listDir(folder, path);
    const c = get();
    const newChildren = new Map(c.childrenByPath);
    newChildren.set(path, kids);
    const newLoading = new Set(c.loadingByPath);
    newLoading.delete(path);
    set({ childrenByPath: newChildren, loadingByPath: newLoading });
  } catch {
    const c = get();
    const newLoading = new Set(c.loadingByPath);
    newLoading.delete(path);
    set({ loadingByPath: newLoading });
  }
},

clearTreeCache() {
  set({
    expanded: new Set<string>(),
    childrenByPath: new Map<string, DirEntry[]>(),
    loadingByPath: new Set<string>(),
  });
},
```

3e. Modify the existing `closeFolder` action to ALSO clear the tree. Replace the existing implementation:

```ts
closeFolder() {
  set({
    workspaceFolder: null,
    results: null,
    inFlight: false,
    expanded: new Set<string>(),
    childrenByPath: new Map<string, DirEntry[]>(),
    loadingByPath: new Set<string>(),
  });
},
```

3f. Modify the existing `openFolder` action to clear the tree cache too (so opening a new folder drops the previous folder's tree). Inside the existing `if (typeof picked === 'string') { ... }` block, replace `set({ workspaceFolder: picked, results: null });` with:

```ts
set({
  workspaceFolder: picked,
  results: null,
  expanded: new Set<string>(),
  childrenByPath: new Map<string, DirEntry[]>(),
  loadingByPath: new Set<string>(),
});
```

- [ ] **Step 4: Run the tests**

```powershell
npm test -- workspace-tree
```

Expected: 5 PASS. Also run existing workspace tests to ensure no regression:

```powershell
npm test -- workspace
```

Expected: 10 PASS (5 existing + 5 new).

- [ ] **Step 5: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add src/stores/workspace.ts src/tests/workspace-tree.test.ts
git commit -m "workspace: tree state + toggleExpand/refreshSubtree/clearTreeCache"
```

---

## Task 8: SidebarTabs presentational component

**Files:**
- Create: `src/components/SidebarTabs.tsx`

- [ ] **Step 1: Create the component**

`src/components/SidebarTabs.tsx`:

```tsx
type Tab = 'files' | 'search';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

export function SidebarTabs({ active, onChange }: Props) {
  return (
    <div className="flex items-center border-b border-neutral-700">
      <TabButton label="Files" active={active === 'files'} onClick={() => onChange('files')} />
      <TabButton label="Search" active={active === 'search'} onClick={() => onChange('search')} />
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`sidebar-tab-${label.toLowerCase()}`}
      data-active={active}
      className={`flex-1 px-3 py-2 text-xs uppercase tracking-wide ${
        active
          ? 'text-neutral-200 border-b-2 border-neutral-200'
          : 'text-neutral-500 border-b-2 border-transparent hover:text-neutral-300'
      }`}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 2: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/components/SidebarTabs.tsx
git commit -m "ui: SidebarTabs presentational tab bar"
```

---

## Task 9: TreeNode recursive component

**Files:**
- Create: `src/components/TreeNode.tsx`

- [ ] **Step 1: Create the component**

`src/components/TreeNode.tsx`:

```tsx
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';
import { openFile as openFileIpc, type DirEntry } from '../lib/tauri';

interface Props {
  entry: DirEntry;
  depth: number;
}

export function TreeNode({ entry, depth }: Props) {
  const expanded = useWorkspace((s) => s.expanded);
  const childrenByPath = useWorkspace((s) => s.childrenByPath);
  const loadingByPath = useWorkspace((s) => s.loadingByPath);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);

  const isOpen = expanded.has(entry.path);
  const kids = childrenByPath.get(entry.path);
  const isLoading = loadingByPath.has(entry.path);

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

  return (
    <>
      <button
        type="button"
        data-testid="tree-row"
        data-depth={depth}
        data-is-dir={entry.is_dir}
        onClick={onClick}
        title={entry.path}
        className="block w-full cursor-pointer truncate text-left text-xs text-neutral-300 hover:bg-neutral-800"
        style={{ paddingLeft: `${depth * 12 + 6}px`, paddingTop: 2, paddingBottom: 2 }}
      >
        <span className="mr-1 inline-block w-3 text-neutral-500">
          {entry.is_dir ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="text-neutral-500">
          {entry.is_dir ? '📁' : '📄'}
        </span>
        <span className="ml-1">{entry.name}</span>
      </button>
      {entry.is_dir && isOpen && (
        <>
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
    </>
  );
}
```

- [ ] **Step 2: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/components/TreeNode.tsx
git commit -m "ui: TreeNode recursive row component"
```

---

## Task 10: FileTreePanel — header, refresh, mount root

**Files:**
- Create: `src/components/FileTreePanel.tsx`

- [ ] **Step 1: Create the component**

`src/components/FileTreePanel.tsx`:

```tsx
import { useEffect } from 'react';
import { useWorkspace } from '../stores/workspace';
import { TreeNode } from './TreeNode';

export function FileTreePanel() {
  const folder = useWorkspace((s) => s.workspaceFolder);
  const childrenByPath = useWorkspace((s) => s.childrenByPath);
  const loadingByPath = useWorkspace((s) => s.loadingByPath);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);
  const refreshSubtree = useWorkspace((s) => s.refreshSubtree);

  // On first mount with a workspace, seed the root listing.
  useEffect(() => {
    if (!folder) return;
    if (childrenByPath.has(folder)) return;
    if (loadingByPath.has(folder)) return;
    toggleExpand(folder).catch(() => {});
  }, [folder, childrenByPath, loadingByPath, toggleExpand]);

  if (!folder) return null;

  const short = folder.split(/[/\\]/).slice(-2).join('/');
  const kids = childrenByPath.get(folder);
  const rootLoading = loadingByPath.has(folder);

  return (
    <div data-testid="file-tree-panel" className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-1 text-xs text-neutral-400">
        <span className="truncate" title={folder}>{short}</span>
        <button
          type="button"
          title="Refresh"
          data-testid="file-tree-refresh"
          onClick={() => refreshSubtree(folder).catch(() => {})}
          className="rounded px-1 text-neutral-500 hover:text-neutral-200"
        >↻</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {rootLoading && !kids && (
          <div className="px-3 py-1 text-xs italic text-neutral-500">Loading…</div>
        )}
        {kids?.map((k) => (
          <TreeNode key={k.path} entry={k} depth={0} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/components/FileTreePanel.tsx
git commit -m "ui: FileTreePanel with refresh + root seeding"
```

---

## Task 11: Sidebar swaps in tabs + active panel

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Replace the body of Sidebar.tsx**

Open `src/components/Sidebar.tsx` and replace its entire contents with:

```tsx
import { useEffect, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { SearchPanel } from './SearchPanel';
import { FileTreePanel } from './FileTreePanel';
import { SidebarTabs } from './SidebarTabs';

interface Props {
  open: boolean;
  onOpenFolder: () => void;
}

type Tab = 'files' | 'search';

export function Sidebar({ open, onOpenFolder }: Props) {
  const folder = useWorkspace((s) => s.workspaceFolder);
  const [activeTab, setActiveTab] = useState<Tab>('files');

  useEffect(() => {
    (window as unknown as { __memopadToggleSidebarTab?: () => void }).__memopadToggleSidebarTab = () => {
      setActiveTab((t) => (t === 'files' ? 'search' : 'files'));
    };
  }, []);

  if (!open) return null;
  return (
    <aside
      data-testid="sidebar"
      className="flex w-[280px] shrink-0 flex-col border-r border-neutral-700 bg-neutral-900 text-neutral-200"
    >
      <SidebarTabs active={activeTab} onChange={setActiveTab} />
      {folder ? (
        activeTab === 'files' ? <FileTreePanel /> : <SearchPanel />
      ) : (
        <div className="flex flex-1 flex-col items-start gap-3 p-4 text-sm text-neutral-400">
          <p>Open a folder to browse and search.</p>
          <button
            type="button"
            onClick={onOpenFolder}
            className="rounded bg-neutral-700 px-3 py-1 text-neutral-100 hover:bg-neutral-600"
          >
            Open folder…
          </button>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Run vitest**

```powershell
npm test
```

Expected: 61 (56 baseline + 5 new tree) tests pass. No regressions.

- [ ] **Step 4: Commit**

```powershell
git add src/components/Sidebar.tsx
git commit -m "ui: Sidebar uses tabs to switch between Files and Search"
```

---

## Task 12: `view.toggleSidebarTab` command + Ctrl+Shift+E keybinding

**Files:**
- Modify: `src/commands/builtins.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Register the command**

In `src/commands/builtins.ts`, at the end of `registerBuiltins()`, append:

```ts
  register({
    id: 'view.toggleSidebarTab',
    title: 'Toggle Sidebar Tab (Files/Search)',
    run: () => {
      (window as unknown as { __memopadToggleSidebarTab?: () => void }).__memopadToggleSidebarTab?.();
    },
  });
```

- [ ] **Step 2: Bind Ctrl+Shift+E in App.tsx**

In `src/App.tsx`, find the existing keydown `useEffect`'s `onKey` function. In the ladder of `if (key === ...)` branches, find the existing `if (key === 'b' && !e.shiftKey)` branch (Ctrl+B for sidebar toggle). Right AFTER it, add:

```ts
if (key === 'e' && e.shiftKey) {
  e.preventDefault();
  (window as unknown as { __memopadToggleSidebarTab?: () => void }).__memopadToggleSidebarTab?.();
  return;
}
```

- [ ] **Step 3: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Vitest**

```powershell
npm test
```

Expected: 61 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/commands/builtins.ts src/App.tsx
git commit -m "app: view.toggleSidebarTab command + Ctrl+Shift+E"
```

---

## Task 13: e2e tests for file tree

**Files:**
- Create: `tests/e2e/file-tree.spec.ts`

- [ ] **Step 1: Create the spec**

`tests/e2e/file-tree.spec.ts`:

```ts
import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

describe('file-tree', () => {
  beforeEach(async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadToggleSidebar?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
      const open = !!document.querySelector('[data-testid="sidebar"]');
      if (open) w.__memopadToggleSidebar?.();
    });
    await sleep(150);
  });

  it('Files tab renders workspace root entries', async () => {
    // Open sidebar + set workspace fixture.
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    // Wait for the root list_dir to resolve.
    await sleep(800);
    const rowCount = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="tree-row"]').length;`,
    );
    expect(rowCount).to.be.greaterThanOrEqual(2); // notes.txt + sub/
  });

  it('clicking a folder expands it and loads children', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(800);
    // Click the row whose name is "sub" — it's the folder in the fixture.
    await classicExecute<void>(
      `const rows = document.querySelectorAll('[data-testid="tree-row"][data-is-dir="true"]');
       for (const r of rows) {
         if (r.textContent && r.textContent.indexOf('sub') !== -1) { r.click(); break; }
       }
       return undefined;`,
    );
    await sleep(600);
    const childCount = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="tree-row"][data-depth="1"]').length;`,
    );
    expect(childCount).to.be.greaterThanOrEqual(1); // sub/code.rs
  });

  it('clicking a file opens it as the active tab', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(800);
    // Click the file row "notes.txt".
    await classicExecute<void>(
      `const rows = document.querySelectorAll('[data-testid="tree-row"][data-is-dir="false"]');
       for (const r of rows) {
         if (r.textContent && r.textContent.indexOf('notes.txt') !== -1) { r.click(); break; }
       }
       return undefined;`,
    );
    await sleep(500);
    const activePath = await classicExecute<string | null>(
      `if (window.__memopadTestGetActiveBufferPath) return window.__memopadTestGetActiveBufferPath();
       const titleEl = document.querySelector('[data-tauri-drag-region]');
       return titleEl ? titleEl.textContent : null;`,
    );
    expect(activePath ?? '').to.match(/notes\.txt/);
  });
});
```

- [ ] **Step 2: Type-check e2e**

```powershell
npx tsc -p tsconfig.e2e.json --noEmit 2>&1
```

Expected: Same baseline `TransformReturn<T>` errors as other specs — no NEW error types. (slice 1 confirmed this is a pre-existing baseline.)

- [ ] **Step 3: DO NOT run `npm run e2e`** — defer to Task 14's release-build smoke.

- [ ] **Step 4: Commit**

```powershell
git add tests/e2e/file-tree.spec.ts
git commit -m "e2e: file tree renders, expands, opens files"
```

---

## Task 14: Manual smoke + results doc

**Files:**
- Create: `docs/superpowers/plans/v2-file-tree-results.md`

- [ ] **Step 1: Run lightweight gates**

```powershell
npx tsc --noEmit
```

Expected: exit 0.

```powershell
npm test
```

Capture total tests passing (expected: 61 = 56 baseline + 5 tree).

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib
cd ..
```

Capture total (expected: 69 = 62 baseline + 7 files).

- [ ] **Step 2: Release build for size + binary**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture MSI size at `src-tauri/target/release/bundle/msi/Memopad_*.msi` and app.exe size at `src-tauri/target/release/app.exe`.

Baseline (from slice 1): MSI 6.40 MB, app.exe 15.79 MB. The `ignore` crate is already pulled in; this slice adds minimal Rust footprint.

- [ ] **Step 3: Dev-shell manual smoke (if user is driving)**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri dev
```

In the launched app:
1. Ctrl+B — sidebar opens.
2. Tabs show Files + Search. Files is active.
3. Click "Open folder…" — pick `E:\Github\memopad`.
4. Tree shows top-level entries (`docs/`, `src/`, `src-tauri/`, `tests/`, `package.json`, etc.) — `.git/`, `target/`, `node_modules/` should NOT appear.
5. Expand `src/` — children load.
6. Click `App.tsx` — opens in editor.
7. Click `↻` refresh — tree re-fetches.
8. Ctrl+Shift+E — switches to Search tab. Ctrl+Shift+E again — back to Files.
9. Close folder via Search tab's `×` (or palette `workspace.closeFolder`). Sidebar empty state returns.

- [ ] **Step 4: Write the results doc**

Create `docs/superpowers/plans/v2-file-tree-results.md`:

```markdown
# v2 File Tree — Results

## Automated test gates

- Vitest: <N> tests passing (baseline 56; +5 tree = 61 expected)
- cargo test: <N> tests passing (baseline 62; +7 files = 69 expected)
- e2e (WebdriverIO): spec written (3 tests); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: <X.XX> MB (slice-1 baseline 6.40 MB)
- app.exe size: <X.XX> MB (slice-1 baseline 15.79 MB)

## What shipped

- `src-tauri/src/files.rs` — `list_dir` + `list_dir_under` + 7 tests
- `src/stores/workspace.ts` gained `expanded` / `childrenByPath` / `loadingByPath` + 3 actions
- `src/components/SidebarTabs.tsx`, `FileTreePanel.tsx`, `TreeNode.tsx`
- `Sidebar.tsx` now hosts tabs and switches Files/Search
- New command + keybinding: `view.toggleSidebarTab` (Ctrl+Shift+E)
- Empty-state copy updated to "Open a folder to browse and search."

## What is intentionally NOT in this slice

- Create / rename / delete / move file operations
- Drag-and-drop
- Filesystem watching (manual refresh button only)
- Search-within-tree
- Persisted expansion state across sessions

## Follow-ups (next v2 slices)

1. Replace-in-files (preview/confirm)
2. Recent folders (Ctrl+R)
3. fs watcher (notify crate) for auto-refresh
4. File-tree right-click context menu (Reveal in Explorer, Copy path, etc.)
```

Fill in actual numbers after running gates.

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/v2-file-tree-results.md
git commit -m "v2 file tree: record results"
```

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec section | Covered by |
| --- | --- |
| `list_dir` / `list_dir_under` Rust types & impl | Tasks 1–4 |
| ignore::WalkBuilder gitignore + dotfile filtering | Tasks 2, 3 |
| Sort: dirs first, files second, alphabetical | Task 2 |
| Path sandboxing (`list_dir_under`) | Task 4 |
| Tauri command registration | Task 5 |
| TS IPC wrapper + DirEntry type | Task 6 |
| Workspace store tree state + actions | Task 7 |
| `closeFolder` and `openFolder` clear tree cache | Task 7 (steps 3e, 3f) |
| `SidebarTabs` presentational | Task 8 |
| `TreeNode` recursive row | Task 9 |
| `FileTreePanel` with refresh + root seeding | Task 10 |
| `Sidebar` swaps in tabs | Task 11 |
| `view.toggleSidebarTab` + Ctrl+Shift+E | Task 12 |
| 5 Vitest tree tests | Task 7 |
| 7 cargo file tests | Tasks 2–4 |
| 3 e2e tests | Task 13 |
| Manual smoke + results doc | Task 14 |

**Placeholder scan:** None.

**Type / signature consistency:**
- `DirEntry { name, path, is_dir }` consistent across Rust, IPC wrapper, store, components.
- `toggleExpand` / `refreshSubtree` / `clearTreeCache` signatures match between interface definition (Task 7 step 3b), implementations (Task 7 step 3d), and tests (Task 7 step 1).
- `listDir(workspaceFolder, path)` arg order matches the Tauri command (`workspace_folder`, `path`) — Tauri auto-converts camelCase TS args to snake_case Rust args.
- `__memopadToggleSidebarTab` window-helper name consistent between Sidebar (Task 11), command (Task 12), and keybinding (Task 12).
