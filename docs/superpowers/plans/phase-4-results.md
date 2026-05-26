# Phase 4 — Results

## Automated test gates

- Vitest: 32 tests passing (was 22)
- cargo test: 51 tests passing (was 29 — +22 across journal/session/stat)
- e2e (WebdriverIO): 36 tests passing (was 23 — +13 covering external-change, journal-restored UI, layout invariants for both active and empty states, and that the X button actually closes the window)
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 4.07 MB (Phase 3 baseline 4.03 MB)
- app.exe size: 10.14 MB (Phase 3 baseline 10.06 MB)

## Manual acceptance — spec §3.4 / §5.1 #1

Kill-and-relaunch verification (cannot be driven through a single tauri-driver session):

- [x] Type 50+ chars in a new buffer, wait 1s, force-kill the process, relaunch
- [x] All typed content restored
- [x] Tab dirty-marked
- [x] No file written to disk for the unsaved buffer

## Bugs found and fixed during execution

1. **Editor flex-child width collapse**: the Phase 4 ExternalChangeBanner wrapper had no `w-full`, collapsing CodeMirror to a 28-px gutter strip and making the editor unusable. Fix: `w-full` + `min-h-0` on the inner flex-1 div + explicit `height: 100%` on the `@uiw/react-codemirror` element to bypass the `cm-theme` intermediate div's auto-height.
2. **Empty-state hint collapse**: same class of bug in the no-buffer branch — the hint container collapsed to text-width and stuck to the left edge. Fix: `w-full` on the hint container.
3. **Wire-format mismatch caught earlier (Phase 2 e2e debt)**: the Rust `Encoding` enum's kebab-case rename emitted `utf8` while the TS union expected `utf-8`. Fixed at the Rust side with explicit `#[serde(rename)]` per variant — already merged on main but worth recording here.
4. **closeBuffer wart**: `closeBuffer` uses `filter(b => b.id !== id)` which removes ALL buffers with that id, breaking the original openRestored-then-close swap in ExternalChangeBanner.onReload. Fix: added a `replaceBuffer(id, ...)` store action and rewrote onReload to use it.
5. **E2E coverage gap**: layout regressions slipped through because all layout tests created a buffer first. Added explicit assertions for editor width, empty-state width, gutter narrowness, close-button reachability, and vertical title→main→status order — all of which would have flagged any of these layout collapses on the next run.
6. **X button didn't close the window**: registering an `onCloseRequested` handler at all caused close to hang on Windows/WebView2, even with a no-op fire-and-forget body. Two coordinated changes: Rust `window_close` now calls `window.destroy()` (which skips the JS event), and `App.tsx` no longer registers an `onCloseRequested` listener (the existing store subscription already keeps `session.json` current on every state change, so no close-time drain is needed). E2E test `zz-close.spec.ts` clicks the X button and asserts the WebDriver session dies; runs last so it doesn't kill the rest of the suite.

## New surface

- Per-buffer journal at `%APPDATA%\dev.memopad.app\journals\<bufferId>.jsonl` — JSONL, last-10 retention, fsync per append
- Session file at `%APPDATA%\dev.memopad.app\session.json` — written on each store mutation and on close-requested
- Boot module: replays journal → restores dirty buffers preserving their ids; falls back to opening session paths for clean tabs
- External change banner with Reload / Keep mine (Diff disabled — Phase 5)
- Re-stat on window focus
- `replaceBuffer` store action — in-place content swap used by the Reload path

## Known follow-ups for Phase 5

- Per-tab cursor position (still deferred from Phase 3)
- Diff view enabled in the external-change banner
- session.json is rewritten on every store mutation — usually cheap but consider debouncing in Phase 5
- Find / replace, themes, packaging — Phase 5 proper
