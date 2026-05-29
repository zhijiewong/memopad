# v2 Split View — Results

## Automated test gates

- Vitest: 78 tests passing (+5 split-view buffer tests)
- cargo test: 75 tests passing (no Rust changes)
- e2e (WebdriverIO): spec written (1 test); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 6.43 MB
- app.exe size: 15.79 MB

## What shipped

- `src/stores/buffers.ts` — `splitActive`, `secondaryId`, `focusedPane` state + `toggleSplit` / `setFocusedPane` / `setFocusedBuffer` actions + `selectFocused` / `selectFocusedId` selectors. `closeBuffer` falls back secondary to primary.
- `src/components/EditorPane.tsx` — new, extracted from Editor. Owns one CodeMirror instance, gated on `focused`.
- `src/components/Editor.tsx` — orchestrator. Renders 1 or 2 EditorPanes based on `splitActive`. ExternalChangeBanner + SearchStrip remain single-instance.
- `src/components/TabStrip.tsx` — highlights + clicks target focused buffer.
- `src/components/ExternalChangeBanner.tsx`, `src/components/StatusBar.tsx` — read focused buffer instead of active.
- `src/commands/builtins.ts` — tab.next / tab.prev / file.save / tab.close target focused buffer. New `view.toggleSplit` command (Ctrl+\).
- `src/App.tsx` — Ctrl+\ keybinding.

## What is intentionally NOT in this slice

- More than two panes
- Vertical splits
- Per-pane cursor / scroll state
- Per-pane tab strips
- Drag-to-swap / drag buffers across panes
- Serializing split state to session.json
- Resizing the split (50/50 fixed)

## Follow-ups

1. Per-pane cursor/scroll state
2. Rename TabContextMenu → ContextMenu (polish from slice 6)
3. Multi-pane / recursive tree split
4. Session-persisted split state
