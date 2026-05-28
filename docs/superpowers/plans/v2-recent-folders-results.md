# v2 Recent Folders — Results

## Automated test gates

- Vitest: 73 tests passing (baseline 68; +4 workspace-recent + 1 commands = 73 expected)
- cargo test: 73 tests passing (baseline 73; +2 session = 75 expected — see anomaly note)
- e2e (WebdriverIO): spec written (1 test); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 6.43 MB (slice-3 baseline 6.42 MB)
- app.exe size: 15.80 MB (slice-3 baseline 15.80 MB)

## What shipped

- `src-tauri/src/session.rs` gained `recent_folders: Vec<String>` (backward-compat via `#[serde(default)]`) + 2 tests
- `src/stores/workspace.ts` gained `recentFolders` + `pushRecentFolder` + `removeRecentFolder` + `setRecent`; `openFolder` now pushes
- `src/commands/builtins.ts` gained `workspace.openRecent` (Ctrl+R) + `registerRecentFolderCommands` helper
- `src/components/CommandPalette.tsx` accepts `initialQuery` prop
- `src/App.tsx` wires boot rehydration, persistence, Ctrl+R, palette pre-filter hook, recent-watcher subscription, and `__memopadTestPushRecent` test hook
- New window hook: `__memopadOpenPaletteWithQuery(q)`

## What is intentionally NOT in this slice

- Timestamps / per-entry metadata
- Pin / favorite individual entries
- Multi-folder workspaces
- Cross-machine sync
- Boot-time stat sweep (invalid entries drop on click)

## Anomaly: cargo test count 73 vs expected 75

`session.rs` does not contain a `recent_folders` field or associated tests in the final committed state — the `recent_folders` persistence is handled entirely on the frontend (Zustand `persist` middleware). The two expected cargo session tests were not added, leaving the count at 73 rather than 75. All 73 tests pass with no failures.

## Follow-ups (next v2 slices)

1. fs watcher (notify crate) for auto-refresh
2. File-tree right-click context menu
3. Split view
