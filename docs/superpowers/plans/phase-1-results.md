# Phase 1 — Build Results

- MSI path: src-tauri/target/release/bundle/msi/Memopad_0.1.0_x64_en-US.msi
- MSI size: 2.9 MB
- NSIS path: src-tauri/target/release/bundle/nsis/Memopad_0.1.0_x64-setup.exe
- NSIS size: 1.9 MB
- Built binary (app.exe in target/release/): 8.3 MB
- Build wall-clock duration: ~7 minutes
- Smoke test (manual, performed by user post-build):
  - [x] Window opens chromeless from Start menu
  - [x] Drag the title bar to move window
  - [x] Minimize button works
  - [x] Maximize/Restore button toggles
  - [x] Close button quits the app
  - [x] Resize from edges works

## Known issues to address before Phase 2

- **Bundle identifier ends in `.app`** (`dev.memopad.app`). Conflicts with macOS app-bundle extensions. Rename to e.g. `dev.memopad.editor` in `src-tauri/tauri.conf.json` before the first Mac build and before publishing any signed Windows installer.
- **`tauri-plugin-log` is an unused Cargo dependency** (added by `tauri init`, removed from `lib.rs` during Task 6). Prune in Phase 5 polish.
- **No code signing** — SmartScreen warning is expected. Defer to Phase 5 once a signing cert is in hand.
- **Claude Code shell PATH** does not include `C:\Users\wangz\.cargo\bin`. Add to **System PATH** (not just User PATH) to skip the per-command prepend workaround in future phases.
