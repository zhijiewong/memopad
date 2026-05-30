# Changelog

All notable changes to Memopad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] — 2026-05-30

A split-view rework that makes two-pane editing feel native: opens land in the pane
you're looking at, the focused pane is unmistakable, and the layout survives a relaunch.

### Added

- **Pane-aware file open** — opening a file (Quick Open, file tree, search result) routes
  to the **focused** pane instead of always the primary one
- **Focused-pane indicator** — the active pane gets a clear accent border; the inactive
  pane is dimmed
- **`Ctrl+1` / `Ctrl+2`** — focus the primary / secondary pane; the cursor follows
- **Split state persists across relaunch** — split layout, secondary buffer, focused pane,
  and per-pane cursor/scroll are restored from `session.json`

### Changed

- **`Ctrl+\`** toggles split independently of the current layout (no longer order-sensitive)
- Closing the last buffer in a pane falls back independently per pane

### Fixed

- **`Ctrl+Shift+F` now opens Find-in-files reliably.** After the file-tree sidebar landed,
  the sidebar defaulted to the file-tree tab and `Ctrl+Shift+F` no longer switched to the
  search tab, leaving project search unreachable. It now selects the search tab and focuses
  the query field.
- E2E suite restored to green (65/65) — repaired a missing `__memopadTestGetActiveBufferPath`
  hook, stale tab/title-bar selectors, and cross-spec sidebar-state leakage in the tests.

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- No file create / rename / delete in the tree (still read-only)
- Split view is two panes max, horizontal only

## [0.2.0] — 2026-05-29

Ten v2 slices over four sessions. v2's theme is the workspace folder: every new feature operates over a persistent root opened with `Ctrl+K Ctrl+O`. Backward-compatible with v0.1.0 session.json files.

### Added

- **Find in files** (`Ctrl+Shift+F`) — project-wide search via ripgrep crates, sidebar results panel, click-to-jump
- **File tree sidebar** with lazy expand-on-click; respects `.gitignore`
- **Replace in files** with confirm dialog, dirty-buffer block, per-file outcome list; preview expands regex backreferences (`$1`, `$&`)
- **Recent folders** list (`Ctrl+R`) — last 10 opened folders surfaced as palette entries; persisted across sessions
- **fs watcher** (notify-debouncer-full) — file tree auto-refreshes; external-change banner triggers without window refocus
- **File tree right-click menu** — Reveal in Explorer, Copy Path, Copy Relative Path
- **Split view** (`Ctrl+\`) — two horizontal panes; tab strip + commands target the focused pane
- **Per-pane cursor + scroll** — each pane remembers its own viewport for the same buffer
- **Quick open by filename** (`Ctrl+P`) — fuzzy match across all workspace files with recent-file boost
- **Sidebar toggle** (`Ctrl+B`) + tab cycle (`Ctrl+Shift+E`)
- **Backref-aware replace preview** in the Search panel

### Changed

- The command palette is now `Ctrl+Shift+P` only (was also `Ctrl+P`). `Ctrl+P` now opens Quick Open.
- `SessionState` JSON schema gained `workspace_folder` + `recent_folders` (both `#[serde(default)]`); old session.json files load unchanged.

### Known limitations (carried over from v0.1.0)

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- No file create / rename / delete in the tree (still read-only)
- Split view is two panes max, horizontal only; not persisted across relaunch
- fs watcher watches the workspace folder only — open files outside still rely on focus-based rescan

## [0.1.0] — 2026-05-27

The first public release. Six implementation phases over the v1 plan.

### Added

- Multi-buffer editing with drag-reorderable tabs in the title bar
- CodeMirror 6 editor with syntax highlighting (Rust, JS/TS, JSON, Markdown)
- Inline find / replace strip with regex and case-sensitive toggles
- Command palette (`Ctrl+K`) with fuzzy search and recent-first ordering
- Memopad Dark + Memopad Light themes; follows system preference
- JetBrains Mono bundled font
- Status bar with clickable encoding + line-ending segments
- Right-click tab context menu (Close, Close Others, Close to Right, Copy Path, Reveal in Explorer)
- Encoding-aware file I/O preserving UTF-8 / UTF-8 BOM / UTF-16 LE / UTF-16 BE
- Atomic save (write to `.tmp`, fsync, rename) — no torn files
- On-disk journal of dirty buffer snapshots — survives `kill -9`
- Session restore — reopens the same tabs and active buffer
- External-change detection on window focus with Reload / Keep / Diff actions
- Per-tab cursor and scroll position restoration
- Auto-update wired to GitHub Releases via Tauri updater
- GitHub Actions CI (TypeScript + Vitest + scoped cargo tests)
- WebdriverIO e2e suite (45 tests against the real release binary)

### Known limitations

- Windows only (macOS and web planned for v2)
- Unsigned MSI — Windows SmartScreen warning on first install
- Find-in-files, file-tree sidebar, and split view are explicit non-goals for v1
