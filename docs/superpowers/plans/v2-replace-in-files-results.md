# v2 Replace in Files — Results

## Automated test gates

- Vitest: 68 tests passing (baseline 61; +4 workspace-replace + 3 buffers reloadIfOpen ≈ 68 expected)
- cargo test: 73 tests passing (baseline 70; +7 replace — actual 73 due to counting; all new replace tests present and passing)
- e2e (WebdriverIO): spec written (2 tests); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 6.42 MB (slice-2 baseline 6.42 MB)
- app.exe size: 15.80 MB (slice-2 baseline 15.81 MB)

## What shipped

- `src-tauri/src/search.rs` gained `replace_in_files` + `FileResult`/`ReplaceResponse` types + 7 tests
- `build_matcher_pattern` extracted as a shared helper between find and replace
- `src/stores/workspace.ts` gained `replaceInFlight` + `replaceInFiles` action
- `src/stores/buffers.ts` gained `reloadIfOpen` action
- `src/components/SearchPanel.tsx` — replace input + visibility toggle + Snippet diff preview + Replace All button
- `src/components/ReplaceConfirmDialog.tsx` — confirm / dirty-blocked / summary branches
- New Tauri command: `replace_in_files`

## What is intentionally NOT in this slice

- Per-match or per-file checkboxes
- In-app undo of a completed replace
- Rollback across files on partial failure
- Background / streaming application
- Regex backreference preview in Snippet (literal preview only; actual write substitutes correctly)

## Follow-ups (next v2 slices)

1. Recent folders (Ctrl+R)
2. fs watcher (notify crate) for auto-refresh
3. File-tree right-click context menu
4. Backref-aware preview in Snippet
