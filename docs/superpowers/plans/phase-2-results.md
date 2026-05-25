# Phase 2 — Results

## Automated test gates (all green)

- **Vitest** (UI unit): 10 tests passing
- **cargo test** (Rust fs module): 29 tests passing — incl. UTF-16 LE BOM round-trip
- **e2e suite** (WebdriverIO + tauri-driver + Mocha against the real release binary): 11 tests passing
- **tsc --noEmit**: exit 0
- **`npm run test:e2e`** wall-clock: ~30 s warm (rebuild + driver chain + 11 specs)

## Build artifacts

- MSI size: 3.91 MB (Phase 1 baseline was 2.9 MB)
- app.exe size: 9.74 MB (Phase 1 baseline was 8.3 MB)

## E2E coverage (the "industrialized" replacement for manual smoke)

- `tests/e2e/smoke.spec.ts` — harness wiring (launches binary, reads title bar)
- `tests/e2e/editor.spec.ts` — empty state, dirty-on-type, reset
- `tests/e2e/file-io.spec.ts` — UTF-8 LF + CRLF open/save round-trip, missing-file error
- `tests/e2e/encoding-roundtrip.spec.ts` — **spec acceptance #3** (UTF-16 LE BOM preserved through open → edit → save → reopen)
- `tests/e2e/save-as.spec.ts` — save-to-new-path leaves original untouched

The manual runbook at `tests/smoke/runbook.md` remains as a backup for cases where the WebDriver chain misbehaves locally (rare since this run); it's no longer the primary gate.

## Known follow-ups for Phase 3

- Multi-buffer / tab strip
- "Save before close?" confirmation
- A `__memopadTestLoadOpened` window hook so e2e can drive the full open-flow including title-bar update (currently `file-io.spec.ts` exercises the Rust command but not the UI-side load)
- File-tree / find-in-files still out of scope until Phase 3 / Phase 4
- Encoding switching from the status bar (UI exists in Phase 3's status bar task)
