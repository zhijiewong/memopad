# Memopad — Design

**Date:** 2026-05-25
**Status:** Approved (design phase) — implementation plan to follow

## 1. Product summary

Memopad is a lean code/text editor for Windows (macOS and web follow). It is positioned as "Notepad++ for people who like their tools quiet": the same purpose (fast local file editing with syntax highlighting and tabs), a modern chromeless UI, and two things it does visibly better than the incumbent:

- **Bulletproof crash recovery** — every edit is journaled to disk; nothing is lost even after a force-kill or power cut.
- **Beautiful out-of-the-box defaults** — typography, theming, and spacing that do not look like 2003.

Instant startup (cold-start under 200 ms) is a baseline hygiene goal, not a wedge.

### 1.1 v1 features

- Tabbed editing
- Syntax highlighting
- Find and replace (current file, with regex)
- Session restore (tabs, cursor, window geometry)
- Auto-save / dirty buffer recovery via on-disk journal
- Multi-cursor editing
- Encoding and line-ending controls (UTF-8 / UTF-16 / others; CRLF / LF / CR)

### 1.2 Non-goals (explicit)

These are out of scope on purpose. Saying no is part of the product.

- No plugin or extension system
- No macro recording
- No IDE features (no LSP, no debugger, no git integration, no terminal)
- No find-in-files (deferred to v2)
- No file-tree sidebar (deferred to v2)
- No split view (deferred to v2)
- No block / column selection (deferred to v2)
- No backend, no accounts, no telemetry, no sync
- No multi-window in v1

### 1.3 Success criteria

- Cold start under 200 ms on a mid-range Windows laptop, measured from process spawn to first paint
- Installed size under 20 MB
- Zero data loss after force-kill of the process mid-typing (journal recovery test passes)
- A Notepad++ user can complete their daily editing without reading documentation

## 2. Tech stack

- **Shell:** Tauri 2 (Rust core, system webview — WebView2 on Windows, WKWebView on macOS).
- **UI framework:** React + TypeScript, built with Vite.
- **Editor engine:** CodeMirror 6. Chosen over Monaco for lean bundle size, modular API, and a closer fit to a "trim" editor's goals. Monaco bundles IDE machinery we do not need.
- **Styling:** Tailwind CSS with a small layer of CSS variables for theming. No component library.
- **State:** Zustand for UI state. No Redux.
- **Persistence:**
  - Edit journal: per-buffer files under `%APPDATA%\Memopad\journals\` on Windows.
  - Session: `%APPDATA%\Memopad\session.json`.
  - Settings: `%APPDATA%\Memopad\settings.json`.
- **Packaging:** Tauri's MSI / NSIS installer for Windows. Code signing deferred until a paid cert is available; early releases ship unsigned and document the SmartScreen warning.
- **Auto-update:** Tauri's built-in updater pointed at a GitHub Releases JSON manifest. No backend infrastructure required.

### 2.1 Cross-platform note

Windows is the primary v1 target. The stack is cross-platform by construction; macOS installer and a web build are expected to fall out with limited extra work post-v1. The web build will not have filesystem parity (browser sandbox) and is treated as best-effort, not a release gate.

## 3. Architecture

Two processes communicate over Tauri IPC:

```
+--------------------- Tauri Shell (Rust) ---------------------+
|  Window / menu / system integration                          |
|  File I/O (read, write, encoding detection, EOL detection)   |
|  Journal writer (append-only snapshots, fsync per batch)     |
|  Journal replay on startup                                   |
|  Session store (open tabs, cursor positions, window geometry)|
|  Auto-updater                                                |
+-----------------------+--------------------------------------+
                        | IPC (Tauri commands + events)
+-----------------------+--------------------------------------+
|                  Web UI (React + TS)                         |
|                                                              |
|  TabStrip | EditorPane | StatusBar | CommandPalette          |
|                                                              |
|  Editor (CodeMirror 6 wrapper):                              |
|    syntax, multi-cursor, find/replace, invisibles            |
|                                                              |
|  Stores (Zustand): buffers, tabs, settings, commands         |
+--------------------------------------------------------------+
```

### 3.1 Module boundaries

Each unit does one thing, owns its state, and exposes a narrow interface.

| Module                 | Owns                                                | Exposes                                                                |
| ---------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `shell/fs` (Rust)      | Reading and writing files; encoding and EOL detect  | `open_file(path)`, `save_file(path, content, encoding, eol)`           |
| `shell/journal` (Rust) | Append-only buffer snapshots, fsync, replay         | `journal_snapshot(bufferId, content)`, `journal_replay() -> [Buffer]`, `journal_clear(bufferId)` |
| `shell/session` (Rust) | Tabs list, window geometry, last active tab         | `session_load()`, `session_save(state)`                                |
| `ui/editor`            | CodeMirror 6 instance per buffer, find/replace UI   | `<Editor bufferId={…} />`                                              |
| `ui/tabs`              | Tab strip, drag reorder, dirty indicator            | `<TabStrip />`. Performs no direct filesystem calls.                   |
| `ui/command-palette`   | Fuzzy command launcher                              | `registerCommand({ id, title, run })`                                  |
| `ui/stores/buffers`    | In-memory buffer state, dirty tracking              | `useBuffers()` hook                                                    |
| `ui/stores/settings`   | Theme, font, keybindings                            | `useSettings()` hook                                                   |

### 3.2 Key data flow — keystroke to disk

1. User types. CodeMirror emits a change. The `buffers` store updates in-memory content and the dirty flag.
2. After 250 ms of idle, the UI sends `journal_snapshot(bufferId, currentContent)` over IPC. Rust appends one JSONL line containing the full buffer snapshot and fsyncs the journal file. Snapshots are used (not deltas) to keep the journal decoupled from CodeMirror's delta shape and to keep replay simple.
3. On Ctrl+S, the UI sends `save_file(...)`. Rust writes the target file atomically (write to `<file>.tmp`, fsync, rename) and then calls `journal_clear(bufferId)`.

### 3.3 Startup flow

1. Tauri boots and reads `session.json`, producing a list of `{ path, bufferId, cursor }` entries.
2. For each entry: load file contents from disk; if a journal exists for that `bufferId`, treat the most recent snapshot as the buffer's current content (unsaved edits restored).
3. Render UI with restored buffers and focus the last active tab.

### 3.4 Crash recovery (acceptance)

Type 50 characters into a new or open buffer, force-kill the process, relaunch. All 50 characters must be present, the tab must be dirty-marked, and the original file on disk must be unchanged.

### 3.5 External file changes

No filesystem watcher in v1. When a tab is refocused, the shell re-stats the file and compares mtime + size against the value recorded at open time. If different, the UI shows a non-modal prompt with three actions: Reload (discard in-memory changes), Keep mine (mark resolved, keep in-memory), or Diff (show a side-by-side comparison in a transient view).

### 3.6 Window model

Single window in v1. Tabs may be reordered but cannot be dragged out into new windows. Multi-window is deferred.

## 4. UI behavior and visual direction

### 4.1 Layout

Chromeless. The window has a custom title bar that hosts the app menu button and the tab strip; the editor fills the body; a single-line status bar sits at the bottom.

```
+----------------------------------------------------------------+
| ≡   main.rs ●  ·  README.md   ·  notes.txt           — □ ✕     |  custom title bar
+----------------------------------------------------------------+
|                                                                |
|   fn main() {                                                  |
|       println!("hello");                                       |
|   }                                                            |
|                                                                |
|                          (editor area)                         |
|                                                                |
+----------------------------------------------------------------+
| Rust · UTF-8 · LF · Ln 2, Col 5 · spaces:4                     |  thin status bar
+----------------------------------------------------------------+
```

- The `≡` button opens the app menu (File / Edit / View / Help) as a popover, providing a discoverable entry point for users who do not know the command palette exists.
- The tab strip is part of the title bar drag region. Dirty state is a `●` dot. Middle-click closes; drag reorders; right-click menu offers Close / Close Others / Close to Right / Copy Path / Reveal in Explorer.
- No sidebar.
- The status bar shows language · encoding · EOL · cursor position · indentation. Each segment is clickable and opens a small popover to change that one thing.

### 4.2 Command palette

`Ctrl+K` (also `Ctrl+Shift+P` for VS Code muscle memory) opens a fuzzy command launcher. Recent commands surface first. Each row shows its keyboard shortcut on the right. Every action in the app must be reachable through the palette.

### 4.3 Find and replace

Inline strip at the top of the editor — not a modal. Shows live match count, regex toggle, and a replace preview that diffs the next match in place.

### 4.4 Visual defaults

- Default theme follows the system (dark / light). Ship two themes: "Memopad Dark" and "Memopad Light", both warm-neutral.
- Font: JetBrains Mono bundled; user-swappable in Settings.
- Spacing: 12 px line padding option, 1.5 line-height, generous gutters.
- Animations: tab open/close 80 ms ease-out, palette 60 ms fade. No bounces or springs.
- Custom title bar uses the system accent color for the dirty dot and the active tab underline.

### 4.5 Empty state

When no tabs are open, the editor area shows a centered, low-contrast hint:
`Ctrl+O to open · Ctrl+N to start typing · Ctrl+K for commands`
No splash screen, no recent files grid, no welcome tab.

### 4.6 Keyboard bindings (v1 minimum)

| Action              | Shortcut                                   |
| ------------------- | ------------------------------------------ |
| Command palette     | Ctrl+K, Ctrl+Shift+P                       |
| Quick switch tab    | Ctrl+Tab, Ctrl+Shift+Tab                   |
| New tab             | Ctrl+N                                     |
| Open file           | Ctrl+O                                     |
| Save                | Ctrl+S                                     |
| Save as             | Ctrl+Shift+S                               |
| Close tab           | Ctrl+W                                     |
| Reopen closed tab   | Ctrl+Shift+T                               |
| Find                | Ctrl+F                                     |
| Replace             | Ctrl+H                                     |
| Multi-cursor add    | Ctrl+Alt+↓ / Ctrl+Alt+↑, Alt+Click         |

All bindings are reachable through the command palette; nothing is hidden behind shortcuts only.

## 5. Testing strategy

Three layers, scaled to value.

| Layer            | Scope                                                                                              | Tooling                                  |
| ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Rust unit tests  | `shell/fs` (encoding/EOL detect, atomic write), `shell/journal` (append, replay, clear), `shell/session` round-trip | `cargo test`                             |
| UI unit tests    | Stores (buffers, settings), command registry, pure helpers. No DOM-heavy component tests.          | Vitest                                   |
| End-to-end       | Flows that materially matter (see acceptance scenarios)                                            | Playwright driving Tauri via `tauri-driver` |

### 5.1 Acceptance scenarios (run in CI on Windows)

1. **Crash recovery.** Open a file, type 50 chars, force-kill, relaunch. All 50 chars present, tab dirty, file on disk unchanged.
2. **Session restore.** Open 3 files, close cleanly, relaunch. Same 3 tabs, same active tab, same cursor positions.
3. **Encoding round-trip.** Open a UTF-16 LE BOM file, edit, save. Bytes on disk remain UTF-16 LE BOM. Same for CRLF/LF.
4. **External change detection.** Modify an open file externally, refocus tab. Prompt appears with Reload / Keep / Diff.
5. **Regex find and replace.** Replace `(\w+) = (\d+)` with `$2 = $1` across all matches in a file. One undo restores the original.
6. **Multi-cursor edit.** Alt-click 3 positions, type. All 3 cursors receive input.
7. **Tab drag reorder.** Drag tab 3 to position 1. Order persists across restart.

### 5.2 Performance gates (CI; build fails on regression)

- Cold start under 200 ms (process spawn → first paint), captured on a fixed-spec GitHub Actions runner.
- Installed size under 20 MB.

### 5.3 Out of scope for automated testing

- Visual / pixel-diff regression — too brittle; human review on PRs catches the cases that matter.
- CodeMirror internals — CodeMirror's job, not ours.
- macOS and web behavior in v1 CI. Added when those platforms are promoted.

### 5.4 Manual pre-release smoke

A five-minute checklist before each release: open a ~10 MB file, open a file in an uncommon encoding (e.g. Big5), drag-out / drag-in a tab, switch theme, toggle system dark/light while the app is running.

## 6. Risks and open questions

- **Journal size growth.** Per-buffer snapshot files grow without bound while a buffer is unsaved. Mitigation: keep only the last N (e.g. 10) snapshots per buffer; rotate.
- **CodeMirror 6 grammar coverage.** Some niche languages may need third-party Lezer grammars. Out of v1 scope to fix; v1 ships with a curated set (Rust, JS/TS, Python, Go, JSON, YAML, Markdown, HTML/CSS, shell, plain text).
- **WebView2 install on older Windows.** Tauri requires WebView2. Windows 11 ships it; Windows 10 may not. The installer should bootstrap WebView2 when missing.
- **Unsigned binary friction.** SmartScreen will warn until we obtain a code-signing certificate. Document the warning and the right-click → Properties → Unblock workaround in the README.
