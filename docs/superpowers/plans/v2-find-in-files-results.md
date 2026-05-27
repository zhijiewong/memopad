# v2 Find-in-Files — Results

## Automated test gates

- Vitest: 56 tests passing (baseline 50; +6 = 56 expected)
- cargo test: 62 tests passing (baseline 51; +9 search + 2 session = 62 expected)
- e2e (WebdriverIO): spec written (4 tests); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 6.40 MB (baseline 5.62 MB)
- app.exe size: 15.79 MB (baseline 13.64 MB)

## What shipped

- `src-tauri/src/search.rs` — find_in_folder + 9 tests
- `src/stores/workspace.ts` — workspace store (persistent folder + stale-drop search)
- `src/components/Sidebar.tsx`, `src/components/SearchPanel.tsx`
- Session schema gained backward-compatible `workspace_folder`
- New commands: `workspace.openFolder`, `workspace.closeFolder`, `view.toggleSidebar`, `search.focusFindInFiles`
- Keybindings: Ctrl+B (toggle sidebar), Ctrl+Shift+F (open sidebar + focus find), Ctrl+K Ctrl+O (open folder via palette)
- `buffers.openFileAtLine` action for jump-to-match
- TitleBar gains a sidebar-toggle button (`☰`) next to the existing app-menu button

## What is intentionally NOT in this slice

- Replace across files
- File tree sidebar
- Live cancellation (Rust walk runs to completion; frontend drops stale)
- Streaming results
- Recent folders / multi-folder workspaces

## Follow-ups (next v2 slices)

1. File tree alongside SearchPanel in the same sidebar
2. Replace-in-files with preview/confirm
3. Recent folders list (Ctrl+R or palette)
4. Full e2e verification of the find-in-files spec
