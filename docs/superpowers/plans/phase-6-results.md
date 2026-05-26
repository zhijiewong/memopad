# Phase 6 — Results

## Automated test gates

- Vitest: 50 tests passing (was 43)
- cargo test: 51 tests passing (unchanged)
- e2e (WebdriverIO): 45 tests passing (was 44)
- tsc --noEmit: exit 0
- CI workflow: `.github/workflows/ci.yml` runs the first three on push/PR

## Build artifacts

- MSI size: 5.63 MB (Phase 5 baseline 4.26 MB)
- app.exe size: 13.64 MB (Phase 5 baseline 10.33 MB)

## New surface

- Per-tab cursor position + scroll restoration (CodeMirror dispatches selection on mount, throttled writes on update)
- Diff view in the external-change banner — line diff between buffer and on-disk content
- GitHub Actions CI: tsc + Vitest + scoped cargo tests on Windows runner
- Auto-updater wired (Rust plugin + JS check + UpdateBanner). Public key is a placeholder until the keypair is generated per `docs/superpowers/notes/release-process.md`.
- CSS @import order fixed (Vite warning gone)
- gitignore covers `*.key` (signing keys) and `src-tauri/WixTools/`

## Manual smoke

- [ ] App launches cleanly with no regressions
- [ ] Type text, move cursor mid-line, switch to another tab and back — cursor is at the same offset
- [ ] Scroll down in a long file, switch tabs and back — scroll position restored
- [ ] External change banner's "Diff" button opens a modal showing add/del lines
- [ ] X button still closes (no regression)
- [ ] Kill-9 + relaunch still restores dirty content (no regression)
- [ ] Find/replace (Ctrl+F / Ctrl+H) still works (no regression)
- [ ] Theme switching still works (no regression)

## What is intentionally NOT in this phase

- e2e in CI — `tauri-driver` requires a desktop session and Windows runner setup is complex. Tracked for Phase 7.
- Tagged-release automation — no `release.yml` workflow yet; release is manual per `docs/superpowers/notes/release-process.md`.
- Code signing — requires a paid cert.
- Updater pubkey is a placeholder; first real release requires the one-time setup in the release-process doc.

## Known follow-ups

- Phase 7: e2e in CI, tag-triggered release automation, signed builds when a cert is obtained.
- The Tauri updater's `downloadAndInstall()` is expected to auto-relaunch on Windows; if it doesn't in practice on the first real release, add explicit `relaunch()` from `@tauri-apps/plugin-process` to `src/lib/updater.ts`.
- v2 features (find-in-files, file tree, split view) — explicit non-goals per spec but Phase 7+ candidates.
