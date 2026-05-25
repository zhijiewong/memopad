# Phase 2 — Results

- Vitest: 10 tests passing
- cargo test (fs module): 29 tests passing
- MSI size: 3.91 MB (Phase 1 baseline was 2.9 MB)
- app.exe size: 9.74 MB (Phase 1 baseline was 8.3 MB)

## Manual smoke

- [ ] Editor mounts under title bar with One Dark theme
- [ ] Untitled / Untitled empty state
- [ ] Typing dirties the buffer (amber dot)
- [ ] Ctrl+O opens a file via dialog; content loaded; dot clears
- [ ] Editing reapplies the dirty dot
- [ ] Ctrl+S overwrites; dot clears; new content on disk
- [ ] Ctrl+Shift+S saves to new path
- [ ] Ctrl+N resets buffer
- [ ] Syntax highlighting differs across .rs / .js / .json / .md

## Acceptance — UTF-16 LE BOM round-trip (spec 5.1 #3)

Verified by `cargo test fs::roundtrip_tests` (open, edit, save preserves BOM and decodes back to edited content).

## Known follow-ups for Phase 3

- Multi-buffer / tab strip
- "Save before close?" confirmation
- File-tree / find-in-files still out of scope until Phase 3 / Phase 4
- Encoding switching from the status bar (UI exists in Phase 3's status bar task)
