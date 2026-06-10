# Changelog

All notable changes to Memopad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] — 2026-06-10

### Added

- **Code folding** — foldable blocks get arrows in the gutter; click to collapse a
  block to "…" and click the placeholder to expand it. **Ctrl+Shift+[ / ]** fold and
  unfold the current block; **Ctrl+Alt+[ / ]** (also in the palette as **View: Fold
  All / Unfold All**) fold and unfold everything. Folding is on by default and can be
  switched off with **View: Toggle Code Folding** (persisted, like word wrap and the
  minimap); turning it off automatically unfolds everything first.

## [1.3.0] — 2026-06-09

### Added

- **Column / multi-cursor editing** — hold **Alt and drag** to make a rectangular
  (column) selection, then type to edit every row at once. Add stacked cursors from the
  keyboard with **Ctrl+Alt+↑ / Ctrl+Alt+↓** (also in the command palette as **Edit: Add
  Cursor Above / Below**), and press **Esc** to collapse back to a single cursor. The
  status bar shows the active cursor count (e.g. "3 cursors") while more than one is live.

## [1.2.1] — 2026-06-08

### Fixed

- **Folder-move errors** now read "Cannot move a folder into itself or its own
  subfolder" instead of a generic "Invalid name".
- **Crash recovery** is more robust — a single unreadable journal file no longer aborts
  the entire session replay on startup.
- **Encoding** and **line-ending** status-bar pickers now dismiss on `Esc`, matching the
  language and context-menu popovers.

### Changed

- Internal hardening with no user-facing behavior change: removed panic-prone error
  handling in folder search, extracted a shared atomic file-write helper used by save and
  replace-in-files, and renamed the shared context-menu component (it serves both the tab
  strip and the file tree).

## [1.2.0] — 2026-06-07

### Added

- **Bracket navigation** — **Go to Matching Bracket** (`Ctrl+Shift+\`) jumps the caret
  between a bracket and its partner; **Select to Matching Bracket** extends the
  selection to it. Both are in the command palette ("Edit: Go to / Select to Matching
  Bracket") and are syntax-aware, working across `()`, `[]`, and `{}`.

## [1.1.0] — 2026-06-07

### Added

- **Syntax highlighting** — broad language coverage (~30 languages, including JavaScript/
  TypeScript, JSON, Markdown, Rust, Python, HTML, CSS, XML, SQL, C/C++, Java, PHP, YAML,
  TOML, shell, Go, Ruby, Lua, Perl, PowerShell, C#, Kotlin, Scala, Swift, R, Dockerfile,
  CMake, diff, and `.properties`). The language is auto-detected from the file name or
  extension when a file is opened.
- **Language picker** — a clickable **language** segment in the status bar opens a
  filterable picker to override the language for the current buffer; **Auto-detect** reverts
  to the detected language. Also reachable via the **View: Set Language…** command. The
  override lives only in memory for the focused buffer and resets when the file is reloaded
  from disk.

## [1.0.0] — 2026-06-04

First stable release. Memopad is now a complete "quiet Notepad++ alternative": a fast,
crash-safe editor with a full file manager and multiple restorable windows. This release
is a stability milestone over 0.12.0 — no new features beyond it; the README is refreshed
to cover the full feature set built across 0.4.0–0.12.0.

Highlights since 0.1.0:

- **Editing** — multi-buffer tabs, split view, find/replace, word wrap, indent guides,
  minimap, line operations (duplicate / move / delete), Go to Line + Ln/Col indicator,
  encoding-aware I/O, dark/light themes.
- **Files** — workspace folder, file-tree sidebar with full CRUD (create / rename /
  delete-to-Recycle-Bin) and drag-to-move, find/replace in files, quick open, recent
  files and folders, a live filesystem watcher with failure detection.
- **Windows** — multiple independent windows, each restored on relaunch; Quit preserves
  the layout.
- **Reliability** — per-keystroke crash journal (per window), session restore,
  external-change detection, command palette, auto-update.

## [0.12.0] — 2026-06-03

### Added

- **Multiple windows** — open a new window with **New Window (`Ctrl+Shift+N`)**; each window has
  its own tabs, workspace, and split. All open windows are restored on relaunch.
- **Quit (`Ctrl+Q`)** closes the app while preserving the window layout for next launch; closing
  a single window with its × forgets just that window.

### Changed

- The session file now stores per-window state plus shared editor preferences / recent lists.
  Existing sessions are migrated automatically on first launch.

### Known limitations

- Windows only; unsigned MSI (SmartScreen on first install)
- No cross-window tab drag; two horizontal panes max per window

## [0.11.0] — 2026-06-03

### Fixed

- The file tree now shows **"Live updates unavailable — refresh manually"** when the file
  watcher fails to start or the workspace folder becomes inaccessible (deleted / renamed /
  unmounted). Previously these failed silently and the tree could go stale without warning.

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- Watcher liveness is checked on window focus; a watcher that dies while the folder still
  exists is not auto-detected
- Split view is two panes max, horizontal only

## [0.10.0] — 2026-06-02

### Added

- **Recent files** — `Ctrl+E` opens a quick-pick of recently edited files (most-recent first),
  via the command palette. Persisted across relaunch; entries that no longer exist are dropped
  when selected.

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- Recent files is a global MRU (no per-workspace scoping or pinning)
- Split view is two panes max, horizontal only

## [0.9.0] — 2026-06-02

### Added

- **Code minimap** — a scrollable overview of the file on the editor's right edge. Toggle via
  the command palette ("View: Toggle Minimap"). Global and remembered across relaunch; off by
  default.

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- Minimap rendering is fixed (block style, always-on overlay); not configurable
- Split view is two panes max, horizontal only

## [0.8.0] — 2026-06-02

The file tree learns to move things.

### Added

- **Drag-to-move** — drag a file or folder onto another folder, or onto the tree root,
  to move it. Open editors follow the move; moving a folder into itself/a descendant or
  onto a name that already exists is blocked (with a brief banner for collisions).

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- Drag-to-move targets folders and the root only (not files); no multi-select, copy-on-drag,
  or OS drag in/out
- Split view is two panes max, horizontal only

## [0.7.0] — 2026-06-01

Line editing shortcuts surfaced and rounded out.

### Added

- **`Ctrl+D` duplicates the current line.**
- **Command-palette entries** for line operations: Move Line Up (`Alt+↑`), Move Line
  Down (`Alt+↓`), Duplicate Line (`Ctrl+D`), Delete Line (`Ctrl+Shift+K`) — the
  `Alt`-based moves, `Ctrl+Alt+↑/↓` copy, and `Ctrl+Shift+K` delete were already
  available; they're now discoverable.

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- Split view is two panes max, horizontal only

## [0.6.0] — 2026-06-01

Cursor navigation: always know where the caret is, and jump anywhere by line number.

### Added

- **Ln/Col indicator** — the status bar shows the focused editor's caret position
  (`Ln x, Col y`, 1-based).
- **Go to Line** — `Ctrl+G` (or the command palette, "Edit: Go to Line") opens a dialog
  to jump the caret to a line number; out-of-range values clamp to the nearest line.

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- Column counts characters (a tab is one column), not visual width
- Split view is two panes max, horizontal only

## [0.5.0] — 2026-06-01

Editor view polish: soft word wrap and indentation guides, both global and
remembered across relaunch.

### Added

- **Word wrap** — soft-wrap long lines to the viewport. Toggle via `Alt+Z`, the
  command palette ("View: Toggle Word Wrap"), or the **Wrap** status-bar segment.
  Off by default.
- **Indent guides** — faint vertical lines at each indentation level. Toggle via the
  command palette ("View: Toggle Indent Guides"). On by default.
- Both preferences are global (apply to all panes) and persist in `session.json`.

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- No per-file or per-language wrap/guide overrides
- Split view is two panes max, horizontal only

## [0.4.0] — 2026-06-01

The file tree becomes editable: create, rename, and delete files and folders without
leaving Memopad.

### Added

- **New File / New Folder** — via the file-tree header buttons (at the workspace root) or
  the right-click menu on any folder; inline name entry with duplicate/invalid-name feedback
- **Rename** — `F2` or the right-click menu; inline edit. Open buffers follow the rename
  (including buffers under a renamed folder)
- **Delete to Recycle Bin** — `Delete` key or the right-click menu, with a confirm dialog.
  Deletions are recoverable from the Windows Recycle Bin

### Changed

- Deleting a file closes its editor tab only if the buffer is clean; a buffer with unsaved
  edits stays open so nothing is lost (saving re-creates the file)

### Fixed

- (none)

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- Rename is same-directory only (no move); no drag-to-move, multi-select, or cut/copy/paste
- Split view is two panes max, horizontal only

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
