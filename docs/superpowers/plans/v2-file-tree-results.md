# v2 File Tree — Results

## Automated test gates

- Vitest: 61 tests passing (baseline 56; +5 tree = 61 expected)
- cargo test: 70 tests passing (baseline 62; +7 files = 69 expected; +1 extra stat test)
- e2e (WebdriverIO): spec written (3 tests); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 6.42 MB (slice-1 baseline 6.40 MB)
- app.exe size: 15.81 MB (slice-1 baseline 15.79 MB)

## What shipped

- `src-tauri/src/files.rs` — `list_dir` + `list_dir_under` + 7 tests
- `src/stores/workspace.ts` gained `expanded` / `childrenByPath` / `loadingByPath` + 3 actions
- `src/components/SidebarTabs.tsx`, `FileTreePanel.tsx`, `TreeNode.tsx`
- `Sidebar.tsx` now hosts tabs and switches Files/Search
- New command + keybinding: `view.toggleSidebarTab` (Ctrl+Shift+E)
- Empty-state copy updated to "Open a folder to browse and search."

## What is intentionally NOT in this slice

- Create / rename / delete / move file operations
- Drag-and-drop
- Filesystem watching (manual refresh button only)
- Search-within-tree
- Persisted expansion state across sessions

## Follow-ups (next v2 slices)

1. Replace-in-files (preview/confirm)
2. Recent folders (Ctrl+R)
3. fs watcher (notify crate) for auto-refresh
4. File-tree right-click context menu (Reveal in Explorer, Copy path, etc.)
