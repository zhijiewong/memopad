# Phase 3 — Results

## Automated test gates

- Vitest: 22 tests passing (was 10)
- cargo test (fs): 29 tests passing (unchanged)
- e2e (WebdriverIO): 23 tests passing (was 11)
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 4.03 MB (Phase 2 baseline 3.91 MB)
- app.exe size: 10.06 MB (Phase 2 baseline 9.74 MB)
- Build wall-clock: 0.6 minutes (warm cache)

## New surface

- Multi-buffer store with tab order + recently-closed stack
- TabStrip in the title bar: drag-reorder, middle-click close, right-click context menu
- StatusBar with clickable encoding + EOL popovers
- Command palette (Ctrl+K / Ctrl+Shift+P) with fuzzy search + recent-first ordering
- New IPC: reveal_in_explorer
- New keybindings: Ctrl+N (new), Ctrl+W (close), Ctrl+Shift+T (reopen), Ctrl+Tab / Ctrl+Shift+Tab (switch)

## Known follow-ups for Phase 4

- Per-tab cursor position (currently CodeMirror remounts on tab switch)
- Session restore (reopen the same tabs on relaunch) — Phase 4
- Crash recovery journal — Phase 4
- External-change detection — Phase 4
- Encoding change in status bar marks dirty but doesn't re-encode the buffer's
  original content; saving and reopening will round-trip through the new
  encoding, which is correct for v1 but worth revisiting if a user expects
  "preview-then-apply" semantics.
