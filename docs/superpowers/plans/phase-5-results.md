# Phase 5 — Results

## Automated test gates

- Vitest: 43 tests passing (was 32)
- cargo test: 51 tests passing (unchanged)
- e2e (WebdriverIO): 44 tests passing (was 36)
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 4.26 MB (Phase 4 baseline 4.07 MB)
- app.exe size: 10.33 MB (Phase 4 baseline 10.14 MB)

## New surface

- Bundle identifier `dev.memopad.editor` (was `dev.memopad.app`)
- JetBrains Mono bundled (regular + bold woff2)
- Memopad Dark + Memopad Light CodeMirror themes
- CSS-variable-driven app chrome that follows theme
- Theme palette commands: Toggle Theme, Use Dark, Use Light, Use System
- Inline find/replace strip with regex + case-sensitive toggles, live match count
- Ctrl+F / Ctrl+H keybindings + palette entries (edit.find / edit.replace)
- 500 ms tail-debounced session.json save

## Bugs found and fixed during execution

- `setSearchQuery` was dispatched but `@codemirror/search`'s `search()` state-field extension was never added to the editor extensions. Without it, the search query was never registered, replaceAll silently no-op'd, and match counts always returned 0. Fix: add `search()` to the CM extensions array.

## Manual smoke

- [ ] App launches into the chromeless window with line numbers, theme-appropriate background
- [ ] Switching theme via palette (Ctrl+K → "Use Light Theme") changes the app chrome AND editor colors
- [ ] Ctrl+F opens the find strip; typing a query highlights matches and shows match count
- [ ] Ctrl+H opens the replace strip; Replace all applies the change to every occurrence
- [ ] Escape closes the search strip
- [ ] X button still closes the app (no regression)
- [ ] Kill-9 acceptance still passes (no regression on Phase 4)

## Known follow-ups (Phase 6 candidates)

- Per-tab cursor position + scroll restoration
- Diff view in external-change banner
- GitHub Actions CI running the e2e suite + perf gates
- Tauri updater plugin + GitHub Releases manifest
- Code-signing certificate for the MSI
- Find-in-files (was a v2 feature; can land in Phase 6)
- File-tree sidebar (v2; Phase 6 candidate)
