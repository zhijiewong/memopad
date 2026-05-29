# v2 File Tree Context Menu — Results

## Automated test gates

- Vitest: 77 tests passing (T1 added 4; baseline was 73)
- cargo test: 75 tests passing (no Rust changes)
- e2e (WebdriverIO): spec written (1 test); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 6.43 MB
- app.exe size: 15.79 MB

## What shipped

- `src/lib/path.ts` — `relativeToWorkspace` pure helper + 4 tests
- `src/components/TreeNode.tsx` — right-click `onContextMenu` handler, `menuPos` state, mounts the existing `TabContextMenu` with three items: Reveal in Explorer, Copy Path, Copy Relative Path
- No new Rust, no new Tauri commands, no new IPC types
- Reuses existing `revealInExplorer` IPC and the existing `TabContextMenu` component

## What is intentionally NOT in this slice

- New file / delete / rename actions
- Per-row hover button
- Native OS context menu
- Toast/banner feedback on copy success
- Menu overflow handling at viewport edges
- Renaming `TabContextMenu` to a more generic name

## Follow-ups (next v2 slices)

1. Backref-aware replace preview in Snippet
2. Split view
3. Rename TabContextMenu → ContextMenu (polish)
