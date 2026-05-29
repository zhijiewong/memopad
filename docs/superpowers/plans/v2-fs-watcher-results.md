# v2 FS Watcher — Results

## Automated test gates

- Vitest: 79 tests passing (baseline 73; +4 fs-watcher + 2 workspace-watcher = 79 expected)
- cargo test: 86 tests passing (baseline 75; +11 watcher = 86 expected)
- e2e (WebdriverIO): spec written (1 test); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 6.54 MB (slice-4 baseline 6.43 MB)
- app.exe size: 16.13 MB (slice-4 baseline 15.80 MB)

## What shipped

- `src-tauri/src/watcher.rs` — `notify-debouncer-full` wrapper, `map_debounced_event` helper, `start` / `start_with_sender` / `stop`, 11 tests
- New Tauri commands: `watch_start`, `watch_stop`; state `WatcherHandle`
- `src/lib/fs-watcher.ts` — `handleEvent` dispatcher + `startFsWatcher` / `stopFsWatcher` orchestrators
- `src/stores/workspace.ts` gained `watcherError` + `setWatcherError`
- `src/App.tsx` subscribes to `workspaceFolder` and starts/stops the watcher
- `src/components/FileTreePanel.tsx` renders a dismissible warning row when `watcherError` is set

## What is intentionally NOT in this slice

- Watching files outside the workspace folder
- Heartbeat / watcher-died detection
- Reload-on-modify auto-action (banner shows; user picks)
- Per-subfolder watcher lifecycle
- Rename event coalescing (surfaces as separate Remove + Create)
- Buffer-side flag on `remove` (Phase 4 focus rescan handles this)

## Follow-ups (next v2 slices)

1. File-tree right-click context menu
2. Backref-aware replace preview in Snippet
3. Split view
