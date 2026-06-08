# Polish Pass — v1.2.1 Design

**Date:** 2026-06-08
**Status:** Approved (scope: all items; process: full superpowers cycle)
**Release:** v1.2.1 (patch — fixes & polish, no new features)

## Motivation

After shipping v1.2.0 (Bracket Navigation), a codebase review pass was run across
the React/TypeScript frontend and the Rust/Tauri backend to find low-risk polish
opportunities before starting the next feature. Two parallel code-review agents
surfaced findings; the high-impact ones were independently verified against the
source before inclusion here. Every item below is a correctness fix, a dead-code
removal, an efficiency win, or a consistency fix — no new functionality.

Baseline at start: `npx tsc --noEmit` clean, 194/194 unit tests pass, e2e suite
green (87/87 per memory). These gates must remain green after each change.

## Scope

Eleven items across backend and frontend, grouped into logical commits. Each item
is individually testable. TDD applies: where behavior changes, write/extend a test
first; pure mechanical cleanups (rename, dead-code removal, vestigial keywords) are
covered by the existing suite plus tsc.

### Backend (Rust — `src-tauri/src`)

**B1. `find_in_folder` — remove panicking `Arc`/`Mutex` dance** (`search.rs:268,272`)
The folder search walker is single-threaded (`.build()`, not `.build_parallel()`),
so the `Arc<Mutex<Vec<FileMatch>>>` accumulator is pure overhead and ends in
`Arc::try_unwrap(files).unwrap().into_inner().unwrap()` — two production panics that
the type system can't rule out. Replace the accumulator with a plain
`let mut files: Vec<FileMatch> = Vec::new();` pushed to directly inside the loop.
The `total` counter (`Arc<AtomicUsize>`) is shared with the per-file `CollectSink`
and stays as-is. *Behavior unchanged; existing search tests cover it.*

**B2. `replay_at` — skip-on-error for a failed dir entry** (`journal.rs:105`)
`let entry = entry?;` propagates a single `DirEntry` read error and aborts the whole
session replay, losing every other restorable buffer. Every other error in the loop
is skipped (`Err(_) => continue`). Make this one consistent:
`let entry = match entry { Ok(e) => e, Err(_) => continue };`
*Add a unit test if feasible to simulate; otherwise covered by inspection + existing
journal tests.*

**B3. `move_entry` cycle detection — dedicated error variant** (`files.rs:206`)
Moving a folder into itself or a descendant returns `FilesError::InvalidName`, which
the frontend renders as "Invalid name" — misleading. Add a `FilesError::Cycle`
variant with `Display` "Cannot move a folder into itself or its own subfolder" and
return it at `files.rs:206`. Update the corresponding move test (currently asserting
`InvalidName` around `files.rs:571/579` — identify which assertion covers the cycle
case) to expect `Cycle`.

**B4. `find_in_folder` — reuse `build_matcher_pattern`** (`search.rs:201`)
`find_in_folder` inlines the same regex/whole-word/escape pattern construction that
`replace_in_files` already factored into `build_matcher_pattern` (`search.rs:81`).
Replace the inline construction with a call to the helper so the two search paths
can't drift. *Behavior unchanged; existing search tests cover both paths.*

**B5. Shared `atomic_write` helper** (`fs.rs:344`, `search.rs:147`)
`save_file` (`fs.rs`) and the replace path in `replace_in_files` (`search.rs`) both
hand-roll write-tmp-`sync_all`-rename. The `search.rs` copy uses
`t.file_name().unwrap_or_default()` which silently yields a bare `.tmp` name on a
pathological path (collision risk during bulk replace). Extract:
```rust
pub fn atomic_write(target: &Path, bytes: &[u8]) -> std::io::Result<()>
```
into `fs.rs`, returning a proper error when `file_name()` is `None`. Have both
callers use it. *Add a focused unit test for `atomic_write` (round-trip write +
overwrite); existing save/replace tests guard the call sites.*

### Frontend (TypeScript / React — `src`)

**F1. Delete the dead `session-debounce.ts` module** (`src/lib/session-debounce.ts`)
The module (`scheduleSessionSave` / `flushSessionSave`) is never imported in
production. The obvious "improvement" — routing `persistWindow` through it — was
considered and **rejected**: `App.tsx:142–147` documents that the synchronous
every-change `sessionSaveWindow` is load-bearing, because it guarantees
`session.json` is current at window-close time *without* an `onCloseRequested`
handler (which interferes with the Tauri 2 / WebView2 close path). Debouncing would
reintroduce a close-time staleness window. So the correct action is to delete the
unused module and its test (`session-debounce.test.ts`) per YAGNI, leaving the
synchronous save as-is. *No behavior change; removing dead code only.*

**F2. Remove dead `__memopadShowFilesPanel` + add effect cleanup** (`Sidebar.tsx:18–28`)
`__memopadShowFilesPanel` is registered but has zero callers. Remove it. The effect
also lacks a cleanup return, leaking stale closures on `window` across remounts. Add
a cleanup that clears the globals it still sets (`__memopadToggleSidebarTab`,
`__memopadShowSearchPanel`). Verify `__memopadShowSearchPanel` *is* still called
before keeping it; remove if also dead.

**F3. Rename `TabContextMenu` → `ContextMenu`** (also closes backlog candidate #3)
`TabContextMenu.tsx` is imported by both `TabStrip.tsx` (tabs) and `TreeNode.tsx`
(file-tree nodes); the type alias `TabContextMenuItem` is used to build tree items.
The name is a misnomer. Rename file → `ContextMenu.tsx`, component → `ContextMenu`,
type → `ContextMenuItem`. Update both import sites. Mechanical; tsc + existing tests
guard it. Check for any e2e selector / test-id referencing the old name.

**F4. `Escape` dismiss for `EncodingPopover` / `EolPopover`**
Both popovers dismiss only on outside `mousedown`. Their siblings
(`TabContextMenu`/`ContextMenu`, `LanguagePopover`) handle `Escape`. Add an `Escape`
keydown listener (in the same `useEffect`, cleaned up on unmount) calling `onClose`.
Consistency for keyboard users.

**F5. Trivials**
- `App.tsx:192` — drop the vestigial `async` on the `onKey` keydown handler (nothing
  is awaited; it silently returns a swallowed Promise).
- `EditorPane.tsx:361` — `view.scrollDOM.scrollTop = scrollTop ?? 0` sits inside an
  `if (scrollTop != null)` guard; simplify to `= scrollTop`.
- `GoToLineDialog.tsx:13` — `focused.content.split('\n').length` runs every render;
  wrap in `useMemo` keyed on `focused?.content`.

## Out of scope (noted, not done)

- `stat.rs:19` `u128 as i64` cast — only wraps past year ~292 million; skip.
- `journal.rs:82` `buffer_id` filename sanitization — buffer IDs are app-generated
  UUIDs, not externally reachable; defensive only. Skip for this pass.
- Splitting large files (`buffers.ts`, `EditorPane.tsx`, `SearchPanel.tsx`),
  extracting shared `Tab` type — structural refactors beyond a polish pass.

## Build sequence

1. Backend commit: B1–B5 (Rust), `cargo test` green.
2. Frontend correctness commit: F1, F2, F4 + tests.
3. Rename commit: F3 (isolated for a clean mechanical diff).
4. Trivials commit: F5.

Each commit: stage explicit paths (never `git add -A`). Gates after each:
`npx tsc --noEmit`, `npm test`, and `cargo test` for backend commits.

## Gates / Definition of done

- `npx tsc --noEmit` clean.
- `npm test` — all unit tests pass (≥194).
- `cargo test` (in `src-tauri`) — all pass.
- e2e suite green (`tauri build --no-bundle` then mocha) — no regressions; add a
  selector update if F3 touches any test-id.
- Manual smoke: trigger a folder-into-itself move → confirm the new "Cannot move…"
  message; open Encoding/EOL popovers → `Esc` dismisses; type rapidly in a buffer →
  confirm window-session save is debounced (not per-keystroke).
- Merge `--no-ff`, tag `v1.2.1`, signed GitHub release.
