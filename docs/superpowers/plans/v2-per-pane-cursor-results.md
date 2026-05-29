# v2 Per-Pane Cursor & Scroll — Results

## Automated test gates

- Vitest: 82 tests passing (+4 per-pane cursor tests)
- cargo test: 75 tests passing (no Rust changes)
- e2e (WebdriverIO): no new tests
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 6.43 MB
- app.exe size: 15.79 MB

## What shipped

- `src/stores/buffers.ts` — `secondaryPaneState: Map<bufferId, {cursor, scrollTop}>` + `setSecondaryCursor` / `setSecondaryScrollTop` actions + `selectPaneState` selector. `closeBuffer` clears the Map entry on close.
- `src/components/EditorPane.tsx` — new `pane: 'primary' | 'secondary'` prop. Reads cursor + scrollTop via `selectPaneState` (primitive selectors to avoid stale-object re-renders). Writes branch on pane: primary writes to existing per-buffer fields; secondary writes to the new Map.
- `src/components/Editor.tsx` — passes `pane="primary"` (single-pane and primary side) or `pane="secondary"` to each EditorPane mount.

## What is intentionally NOT in this slice

- Persisting secondary pane state to session.json
- Migrating buffer.cursor/scrollTop to a different shape
- Per-pane folding / wrap settings

## Follow-ups

1. Session-persisted secondary state (paired with session-persisted split state)
2. Rename TabContextMenu → ContextMenu (polish from slice 6)
3. Multi-pane / recursive tree split
