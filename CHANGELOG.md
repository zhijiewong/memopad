# Changelog

All notable changes to Memopad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
