# Phase 4 — Results

## Automated test gates

- Vitest: 32 tests passing (was 22)
- cargo test: 51 tests passing (was 29 — +22 across journal/session/stat)
- e2e (WebdriverIO): 28 tests passing (was 23)
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 4.07 MB (Phase 3 baseline 4.03 MB)
- app.exe size: 10.14 MB (Phase 3 baseline 10.06 MB)

## Manual acceptance — spec §3.4 / §5.1 #1

Kill-and-relaunch verification (cannot be driven through a single tauri-driver session):

- [ ] Type 50+ chars in a new buffer, wait 1s, force-kill the process, relaunch
- [ ] All typed content restored
- [ ] Tab dirty-marked
- [ ] No file written to disk for the unsaved buffer

## New surface

- Per-buffer journal at `%APPDATA%\dev.memopad.app\journals\<bufferId>.jsonl` — JSONL, last-10 retention, fsync per append
- Session file at `%APPDATA%\dev.memopad.app\session.json` — written on each store mutation and on close-requested
- Boot module: replays journal → restores dirty buffers preserving their ids; falls back to opening session paths for clean tabs
- External change banner with Reload / Keep mine (Diff disabled — Phase 5)
- Re-stat on window focus
- `replaceBuffer` store action — in-place content swap used by the Reload path (fixes the close-then-restore wart documented in the plan)

## Known follow-ups for Phase 5

- Per-tab cursor position (still deferred from Phase 3)
- Diff view enabled in the external-change banner
- session.json is rewritten on every store mutation — usually cheap but consider debouncing in Phase 5
- Find / replace, themes, packaging — Phase 5 proper
