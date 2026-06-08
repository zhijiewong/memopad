# Polish Pass (v1.2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a low-risk polish release (v1.2.1) that fixes three Rust correctness issues, removes two duplications, deletes dead frontend code, renames a misnamed component, and adds keyboard-dismiss consistency — with zero new features.

**Architecture:** Backend changes are localized refactors/fixes inside `src-tauri/src` (search, journal, files, fs). Frontend changes touch `src/components`, `src/lib`, and `src/App.tsx`. Work is grouped into four commits: backend, frontend-correctness, rename, trivials.

**Tech Stack:** Rust + Tauri 2 backend (`cargo test`); React + TypeScript + Zustand + CodeMirror 6 frontend (`vitest`, `npx tsc --noEmit`); e2e via `tauri build` + mocha.

**Spec:** `docs/superpowers/specs/2026-06-08-polish-pass-design.md`

**Baseline gates (must stay green):** `npx tsc --noEmit` clean · `npm test` ≥194 passing · `cargo test` (in `src-tauri`) all passing.

**Conventions:** stage explicit paths only (never `git add -A`); trust `npx tsc --noEmit` over the LSP; run `cargo test` from inside `src-tauri`.

---

## GROUP A — Backend (Rust)

### Task A1: `find_in_folder` — drop the `Arc<Mutex>` accumulator and its panicking unwraps

**Files:**
- Modify: `src-tauri/src/search.rs:210` (accumulator decl), `:268` (push), `:272` (unwrap dance)

The folder walker here is single-threaded (`walker.build()`, not `build_parallel()`), so the `Arc<Mutex<Vec<FileMatch>>>` is needless and ends in two production-panicking `unwrap()`s. Replace with a plain `Vec`. The `total` counter stays `Arc<AtomicUsize>` (it is shared into each `CollectSink`).

- [ ] **Step 1: Replace the accumulator declaration**

In `src-tauri/src/search.rs`, change line 210 from:

```rust
    let files: Arc<Mutex<Vec<FileMatch>>> = Arc::new(Mutex::new(Vec::new()));
```

to:

```rust
    let mut files: Vec<FileMatch> = Vec::new();
```

- [ ] **Step 2: Replace the push inside the walker loop**

Change line 268 from:

```rust
            files.lock().unwrap().push(FileMatch { path: sink.path, matches: sink.matches });
```

to:

```rust
            files.push(FileMatch { path: sink.path, matches: sink.matches });
```

- [ ] **Step 3: Replace the unwrap dance after the loop**

Change line 272 from:

```rust
    let mut files = Arc::try_unwrap(files).unwrap().into_inner().unwrap();
    files.sort_by(|a, b| a.path.cmp(&b.path));
```

to:

```rust
    files.sort_by(|a, b| a.path.cmp(&b.path));
```

(`files` is already `mut` from Step 1, so the `let mut files` rebinding is removed entirely.)

- [ ] **Step 4: Remove now-unused imports if the compiler flags them**

`Mutex` may now be unused. Run the build (Step 5); if `cargo` warns `unused import: Mutex`, remove `Mutex` from the `use std::sync::{...}` line at the top of `search.rs` (keep `Arc`, `atomic::*` — still used by `total`).

- [ ] **Step 5: Build and test**

Run: `cd src-tauri && cargo test`
Expected: compiles with no warnings about `files`/`Mutex`; all search tests pass (the find-in-folder tests exercise this path).

---

### Task A2: `replay_at` — skip a failed dir entry instead of aborting the whole replay

**Files:**
- Modify: `src-tauri/src/journal.rs:105`

Every other error in this loop is skipped (`Err(_) => continue`); the `entry?` is the lone inconsistency. A single unreadable `DirEntry` should not lose all other restorable buffers.

- [ ] **Step 1: Replace the propagating `?`**

In `src-tauri/src/journal.rs`, change line 105 from:

```rust
        let entry = entry?;
```

to:

```rust
        let entry = match entry { Ok(e) => e, Err(_) => continue };
```

- [ ] **Step 2: Build and test**

Run: `cd src-tauri && cargo test`
Expected: compiles; existing journal/replay tests pass. (A failed-`DirEntry` case can't be portably simulated in a unit test; this defensive change is covered by inspection + the existing replay tests proving the happy path is unchanged.)

---

### Task A3: `move_entry` cycle detection — dedicated `FilesError::Cycle` variant

**Files:**
- Modify: `src-tauri/src/files.rs:46` (enum), `:55-64` (Display), `:206` (return site)
- Test: `src-tauri/src/files.rs:566-580` (two existing tests assert the wrong variant)

Moving a folder into itself / a descendant currently returns `InvalidName` ("Invalid name") — misleading in the UI. Add a `Cycle` variant.

- [ ] **Step 1: Update the two tests to expect `Cycle` (red first)**

In `src-tauri/src/files.rs`, change line 571 (inside `move_entry_rejects_into_self`) from:

```rust
        matches!(err, FilesError::InvalidName).then_some(()).unwrap();
```

to:

```rust
        matches!(err, FilesError::Cycle).then_some(()).unwrap();
```

And change line 579 (inside `move_entry_rejects_into_descendant`) identically (same one-line replacement).

- [ ] **Step 2: Run the tests to verify they fail to compile**

Run: `cd src-tauri && cargo test move_entry_rejects`
Expected: FAIL — compile error `no variant named Cycle found for enum FilesError`.

- [ ] **Step 3: Add the `Cycle` variant to the enum**

In the `pub enum FilesError {` block (line 46), add a `Cycle` variant alongside `InvalidName` (line 50):

```rust
    InvalidName,
    Cycle,
```

- [ ] **Step 4: Add the `Display` arm**

In the `impl std::fmt::Display for FilesError`, after the `InvalidName` arm (line 61), add:

```rust
            FilesError::Cycle => write!(f, "Cannot move a folder into itself or its own subfolder"),
```

- [ ] **Step 5: Return `Cycle` from the cycle-detection branch**

Change line 206 from:

```rust
        return Err(FilesError::InvalidName);
```

to:

```rust
        return Err(FilesError::Cycle);
```

(Note: only the cycle branch at line 206 changes. The other `InvalidName` returns — name validation at lines 131/152/175 — stay as `InvalidName`.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test move_entry`
Expected: PASS — both `move_entry_rejects_into_self` and `move_entry_rejects_into_descendant` green; `move_entry_moves_file_into_subdir` and `move_entry_rejects_collision` still green.

- [ ] **Step 7: Confirm the new message reaches the frontend (read-only check)**

Confirm `FilesError` is surfaced to JS via its `Display` string (search `files.rs`/`lib.rs` for where `FilesError` is converted to the command's error return). No code change expected — just verify the new arm is on the same path as the others.

---

### Task A4: `find_in_folder` — reuse the existing `build_matcher_pattern` helper

**Files:**
- Modify: `src-tauri/src/search.rs:201-202`

`find_in_folder` inlines the same pattern logic that `build_matcher_pattern` (`search.rs:81`) already encapsulates for `replace_in_files`. Calling the helper keeps the two search paths from drifting. Signature: `fn build_matcher_pattern(query: &str, opts: &FindOptions) -> String`.

- [ ] **Step 1: Replace the inline pattern construction**

In `src-tauri/src/search.rs`, replace lines 201-202:

```rust
    let pattern = if opts.regex { query.to_string() } else { regex::escape(query) };
    let pattern = if opts.whole_word { format!(r"\b(?:{})\b", pattern) } else { pattern };
```

with:

```rust
    let pattern = build_matcher_pattern(query, opts);
```

(Confirm the local variable holding options in `find_in_folder` is named `opts` and is `&FindOptions` / coercible to it; adjust the call to match the actual binding if it differs.)

- [ ] **Step 2: Build and test**

Run: `cd src-tauri && cargo test`
Expected: compiles; all find-in-folder tests pass (regex, whole-word, and plain-text search cases prove the helper produces identical patterns).

---

### Task A5: Shared `atomic_write` helper in `fs.rs`; use it from `save_file` and `replace_in_files`

**Files:**
- Modify: `src-tauri/src/fs.rs` (add `atomic_write`; rewrite `save_file` body around line 342-366)
- Modify: `src-tauri/src/search.rs:147-161` (replace the inline tmp-write closure)
- Test: `src-tauri/src/fs.rs` (test module) — add an `atomic_write` round-trip test

Both `save_file` and the replace path hand-roll write-tmp → fsync → rename. The `search.rs` copy uses `file_name().unwrap_or_default()`, which silently yields a bare `.tmp` name on a pathological path. Extract one helper that errors instead.

- [ ] **Step 1: Write the failing test for `atomic_write`**

In the `#[cfg(test)] mod tests` of `src-tauri/src/fs.rs`, add:

```rust
#[test]
fn atomic_write_creates_and_overwrites() {
    let dir = std::env::temp_dir().join(format!("memopad_aw_{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let target = dir.join("file.txt");

    atomic_write(&target, b"hello").unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"hello");

    atomic_write(&target, b"world!").unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"world!");

    // no leftover .tmp sibling
    assert!(!dir.join("file.txt.tmp").exists());

    std::fs::remove_dir_all(&dir).ok();
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd src-tauri && cargo test atomic_write_creates_and_overwrites`
Expected: FAIL — compile error `cannot find function atomic_write`.

- [ ] **Step 3: Add the `atomic_write` function to `fs.rs`**

Add this `pub fn` to `src-tauri/src/fs.rs` (module level, near `save_file`):

```rust
/// Atomically write `bytes` to `target`: write a sibling `.tmp`, fsync, then rename
/// over the target. Returns an error (never panics) if `target` has no file name.
pub fn atomic_write(target: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = {
        let name = target.file_name().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no file name")
        })?;
        let mut new_name = name.to_os_string();
        new_name.push(".tmp");
        let mut t = target.to_path_buf();
        t.set_file_name(new_name);
        t
    };
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, target)?;
    Ok(())
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test atomic_write_creates_and_overwrites`
Expected: PASS.

- [ ] **Step 5: Rewrite `save_file` to call `atomic_write`**

In `src-tauri/src/fs.rs`, replace the tmp-build + create/write/sync + rename block (lines ~343-365, from `let target = std::path::PathBuf::from(&path);` through the `std::fs::rename(...)?;`) with:

```rust
    let target = std::path::PathBuf::from(&path);
    atomic_write(&target, &bytes)
        .map_err(|e| format!("atomic write {}: {}", target.display(), e))?;
    Ok(())
```

(Keep the preceding `let bytes = encode_string(&content, encoding);` line. Remove the now-redundant `use std::io::Write;` local import in `save_file` if the compiler flags it as unused.)

- [ ] **Step 6: Rewrite the replace path in `search.rs` to call `atomic_write`**

In `src-tauri/src/search.rs`, replace lines 147-161 (the `let tmp_path = { ... };` block and the `let write_result = (|| ... )();` closure) with:

```rust
        let new_bytes = crate::fs::encode_string(&new_text, encoding);
        let write_result = crate::fs::atomic_write(&path, &new_bytes);
```

(The existing `let new_bytes = crate::fs::encode_string(&new_text, encoding);` at line 146 is now produced by this block — ensure it appears exactly once. The downstream `match write_result { Ok(()) => ... }` at line 163 is unchanged.)

- [ ] **Step 7: Build and test the full backend**

Run: `cd src-tauri && cargo test`
Expected: compiles with no unused-import warnings; all tests pass — including the existing `save_file` and `replace_in_files` tests, which now exercise `atomic_write` indirectly.

---

### Task A6: Commit the backend group

- [ ] **Step 1: Stage and commit**

```bash
git add src-tauri/src/search.rs src-tauri/src/journal.rs src-tauri/src/files.rs src-tauri/src/fs.rs
git commit -m "fix(backend): remove panicking unwraps, add Cycle error, dedup atomic write

- find_in_folder: plain Vec instead of Arc<Mutex> + double-unwrap
- replay_at: skip a failed dir entry instead of aborting the whole replay
- move_entry: FilesError::Cycle for self/descendant moves (was InvalidName)
- find_in_folder: reuse build_matcher_pattern
- extract fs::atomic_write; use from save_file and replace_in_files

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## GROUP B — Frontend correctness

### Task B1: Delete the dead `session-debounce` module

**Files:**
- Delete: `src/lib/session-debounce.ts`
- Delete: `src/tests/session-debounce.test.ts`

Never imported in production (`persistWindow` calls `sessionSaveWindow` directly, deliberately — see `App.tsx:142-147`). Remove per YAGNI.

- [ ] **Step 1: Confirm zero production imports**

Run: `git grep -n "session-debounce\|scheduleSessionSave\|flushSessionSave" -- src ':!src/lib/session-debounce.ts' ':!src/tests/session-debounce.test.ts'`
Expected: no output (no other references).

- [ ] **Step 2: Delete both files**

```bash
git rm src/lib/session-debounce.ts src/tests/session-debounce.test.ts
```

- [ ] **Step 3: Verify gates**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; tests pass (count drops by the session-debounce cases, still all green).

---

### Task B2: Remove dead `__memopadShowFilesPanel` global and add the missing effect cleanup

**Files:**
- Modify: `src/components/Sidebar.tsx:18-28`

`__memopadShowFilesPanel` has zero callers. `__memopadShowSearchPanel` IS called (from `App.tsx:175`) — keep it. The effect also leaks globals on remount (no cleanup return).

- [ ] **Step 1: Confirm caller presence/absence (read-only)**

Run: `git grep -n "__memopadShowFilesPanel\|__memopadShowSearchPanel\|__memopadToggleSidebarTab" -- src`
Expected: `__memopadShowFilesPanel` appears ONLY in `Sidebar.tsx` (dead). `__memopadShowSearchPanel` appears in `Sidebar.tsx` AND `App.tsx` (keep). `__memopadToggleSidebarTab` appears in `Sidebar.tsx` AND `App.tsx` (keep).

- [ ] **Step 2: Rewrite the effect**

In `src/components/Sidebar.tsx`, replace the `useEffect` block (lines 18-28) with:

```tsx
  useEffect(() => {
    const w = window as unknown as {
      __memopadToggleSidebarTab?: () => void;
      __memopadShowSearchPanel?: () => void;
    };
    w.__memopadToggleSidebarTab = () => {
      setActiveTab((t) => (t === 'files' ? 'search' : 'files'));
    };
    w.__memopadShowSearchPanel = () => {
      setActiveTab('search');
    };
    return () => {
      w.__memopadToggleSidebarTab = undefined;
      w.__memopadShowSearchPanel = undefined;
    };
  }, []);
```

- [ ] **Step 3: Verify gates**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

---

### Task B3: Add `Escape` dismiss to `EncodingPopover` and `EolPopover`

**Files:**
- Modify: `src/components/EncodingPopover.tsx:20-26`
- Modify: `src/components/EolPopover.tsx:19-25`

Both dismiss only on outside `mousedown`. Siblings (`LanguagePopover`, the context menu) handle `Escape`. Add a keydown listener in the same effect, cleaned up together.

- [ ] **Step 1: Update `EncodingPopover` effect**

In `src/components/EncodingPopover.tsx`, replace the `useEffect` (lines 20-26) with:

```tsx
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
```

- [ ] **Step 2: Update `EolPopover` effect**

In `src/components/EolPopover.tsx`, replace the `useEffect` (lines 19-25) with the identical block from Step 1 (same code — `onDown` + `onKey` + paired cleanup, deps `[onClose]`).

- [ ] **Step 3: Verify gates**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

---

### Task B4: Commit the frontend-correctness group

- [ ] **Step 1: Stage and commit**

```bash
git add src/lib/session-debounce.ts src/tests/session-debounce.test.ts src/components/Sidebar.tsx src/components/EncodingPopover.tsx src/components/EolPopover.tsx
git commit -m "fix(frontend): drop dead session-debounce + global, add Escape dismiss

- delete unused session-debounce.ts/test (sync save is load-bearing at close)
- remove dead __memopadShowFilesPanel global; add effect cleanup in Sidebar
- EncodingPopover/EolPopover dismiss on Escape (matches sibling popovers)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(`git add` of the deleted paths records the deletion; `git rm` in Task B1 already staged them — re-adding is harmless.)

---

## GROUP C — Rename `TabContextMenu` → `ContextMenu`

### Task C1: Rename the file, component, and item type; update both import sites

**Files:**
- Rename: `src/components/TabContextMenu.tsx` → `src/components/ContextMenu.tsx`
- Modify: `src/components/TabStrip.tsx` (import + JSX usage)
- Modify: `src/components/TreeNode.tsx` (import of component + `TabContextMenuItem` type)

`TabContextMenu` is used by both `TabStrip` (tabs) and `TreeNode` (file tree). The name is a misnomer. Rename component → `ContextMenu`, item type → `ContextMenuItem`.

- [ ] **Step 1: Find every reference (read-only)**

Run: `git grep -n "TabContextMenu\|TabContextMenuItem" -- src tests`
Expected: definitions in `TabContextMenu.tsx`; imports in `TabStrip.tsx` and `TreeNode.tsx`. Note any e2e/test-id references (check `tests/` and any `data-testid` in the component).

- [ ] **Step 2: Rename the file via git**

```bash
git mv src/components/TabContextMenu.tsx src/components/ContextMenu.tsx
```

- [ ] **Step 3: Rename the symbols inside `ContextMenu.tsx`**

In `src/components/ContextMenu.tsx`, rename the exported component `TabContextMenu` → `ContextMenu` and the exported item type/interface `TabContextMenuItem` → `ContextMenuItem` (update the `export function`/`export interface`/`export type` declarations and any internal self-references). Leave behavior and props identical. If the component renders a `data-testid` containing `tab-context-menu`, leave the test-id string unchanged for now unless Step 1 showed a test depends on the *name* (changing test-ids would break selectors) — note any such test-id in the commit body.

- [ ] **Step 4: Update `TabStrip.tsx`**

In `src/components/TabStrip.tsx`, change the import from `./TabContextMenu` to `./ContextMenu`, and replace `TabContextMenu` (and any `TabContextMenuItem` type usage) with `ContextMenu` / `ContextMenuItem` in the import statement and JSX/usages.

- [ ] **Step 5: Update `TreeNode.tsx`**

In `src/components/TreeNode.tsx`, change the import from `./TabContextMenu` to `./ContextMenu`, and replace `TabContextMenu` → `ContextMenu` and the type `TabContextMenuItem` → `ContextMenuItem` everywhere they appear (the file uses the item type to build tree-node menu items).

- [ ] **Step 6: Verify no stale references remain**

Run: `git grep -n "TabContextMenu" -- src tests`
Expected: no output.

- [ ] **Step 7: Verify gates**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/ContextMenu.tsx src/components/TabStrip.tsx src/components/TreeNode.tsx
git commit -m "refactor: rename TabContextMenu -> ContextMenu (used by tree too)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## GROUP D — Trivials

### Task D1: Three micro-cleanups

**Files:**
- Modify: `src/App.tsx:192` (vestigial `async`)
- Modify: `src/components/EditorPane.tsx:361` (`scrollTop ?? 0` no-op)
- Modify: `src/components/GoToLineDialog.tsx:13` (memoize line-count split)

- [ ] **Step 1: Drop the vestigial `async` keydown handler**

In `src/App.tsx`, change line 192 from:

```ts
    const onKey = async (e: KeyboardEvent) => {
```

to:

```ts
    const onKey = (e: KeyboardEvent) => {
```

(Confirm no `await` appears in the handler body before changing — the handler only calls synchronous `runCommand` / `setSidebarOpen` / window globals.)

- [ ] **Step 2: Simplify the guarded `scrollTop ?? 0`**

In `src/components/EditorPane.tsx`, locate the line inside the `if (buffer && scrollTop != null)` block (line ~361):

```tsx
      view.scrollDOM.scrollTop = scrollTop ?? 0;
```

Change it to:

```tsx
      view.scrollDOM.scrollTop = scrollTop;
```

(Verify the enclosing guard is `scrollTop != null` so the value is non-null here; if TypeScript narrows it as nullable due to the `requestAnimationFrame` closure, keep `?? 0` and skip this micro-edit rather than introduce a type error.)

- [ ] **Step 3: Memoize the line count in `GoToLineDialog`**

In `src/components/GoToLineDialog.tsx`, ensure `useMemo` is imported from `react`, then change line 13 from:

```ts
  const totalLines = focused ? focused.content.split('\n').length : 1;
```

to:

```ts
  const totalLines = useMemo(
    () => (focused ? focused.content.split('\n').length : 1),
    [focused?.content],
  );
```

- [ ] **Step 4: Verify gates**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/EditorPane.tsx src/components/GoToLineDialog.tsx
git commit -m "polish: drop vestigial async, no-op coalesce, memoize line count

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## GROUP E — Verify, review, ship

### Task E1: Full gate run + e2e

- [ ] **Step 1: Backend tests**

Run: `cd src-tauri && cargo test`
Expected: all pass.

- [ ] **Step 2: Typecheck + unit tests**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; unit tests pass (≥ baseline minus the deleted session-debounce cases).

- [ ] **Step 3: e2e suite**

Run: `npm run test:e2e` (this runs `tauri build` then mocha; CI-only signing key is not required for `--no-bundle`-style local runs — if the bundling step fails on the signing key, run `cd src-tauri && cargo tauri build --no-bundle` first, then `npx mocha`).
Expected: green, no regressions. If the rename touched any e2e selector/test-id, update the spec/test accordingly and re-run.

- [ ] **Step 4: Manual smoke (GUI)**

Using the e2e harness + `takeScreenshot` (per the gui-verification memory):
- Trigger a folder-into-itself move in the file tree → confirm the toast/message reads "Cannot move a folder into itself or its own subfolder" (not "Invalid name").
- Open the Encoding popover and the EOL popover from the status bar → press `Esc` → each dismisses.
- Right-click a tab and a tree node → context menu still appears and behaves (rename sanity).

### Task E2: Code review

- [ ] **Step 1:** Invoke `superpowers:requesting-code-review` on the full diff (`main..HEAD`) before merging. Address any high-confidence findings.

### Task E3: Merge + release (confirm with user before the outward push/release)

- [ ] **Step 1:** Update `CHANGELOG.md` with a v1.2.1 section summarizing the fixes; bump version in `package.json` and `src-tauri/Cargo.toml` + `tauri.conf.json` to `1.2.1` (match the existing release procedure). Commit as `chore: 1.2.1 — polish pass`.
- [ ] **Step 2:** Merge the branch to `main` with `--no-ff`.
- [ ] **Step 3:** Push `main`, tag `v1.2.1`, and publish the signed GitHub release (CI signing). **Confirm with the user before pushing/releasing** (outward, irreversible).

---

## Self-review notes

- **Spec coverage:** B1✓(A1), B2✓(A2), B3✓(A3), B4✓(A4), B5✓(A5); F1✓(B1, now delete), F2✓(B2), F3✓(C1), F4✓(B3), F5✓(D1). All 11 spec items mapped. Out-of-scope items (stat.rs cast, buffer_id sanitization, file splits) intentionally excluded per spec.
- **Type consistency:** `atomic_write(&Path, &[u8]) -> io::Result<()>` used identically in A5 Steps 3/5/6; `FilesError::Cycle` defined (A3 S3) before use (A3 S5) and tests (A3 S1); `ContextMenu`/`ContextMenuItem` names consistent across C1 steps.
- **Risk note:** D1 Step 2 and C1 Step 3 carry explicit "skip if it would break types/selectors" guards so a micro-edit never forces a regression.
