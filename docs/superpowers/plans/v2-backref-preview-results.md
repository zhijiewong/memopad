# v2 Backref-Aware Replace Preview — Results

## Automated test gates

- Vitest: 77 tests passing (+4 from replace-preview)
- cargo test: 75 tests passing (no change)
- e2e (WebdriverIO): no new tests; existing coverage unchanged
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: 6.43 MB
- app.exe size: 15.79 MB

## What shipped

- `src/lib/replace-preview.ts` — `expandBackrefs` pure helper + 4 tests
- `src/components/SearchPanel.tsx` — `Snippet` now receives `query` + `opts` and calls `expandBackrefs` to expand `$1`/`$&` etc. in the preview. `ResultsBody`, `FileGroup`, and `ResultRow` all forward the new prop.
- No Rust changes; the actual replace write is unchanged.

## What is intentionally NOT in this slice

- Live IPC on every keystroke
- Toast / banner UI for JS-vs-Rust regex divergence
- Support for Rust-only regex features in the preview (falls back to literal)

## Follow-ups (next v2 slices)

1. Split view (most invasive remaining slice)
2. Rename `TabContextMenu` → `ContextMenu` (polish from slice 6)
