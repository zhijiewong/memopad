# Multi-Window (persist & restore all windows) — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 0.12.0

## Problem

Memopad is single-window. Multi-window — open several independent windows, each with its
own tabs/workspace/split, and have them all restored on relaunch — is the last original v1
non-goal and the headline 1.0 capability. Each Tauri window is a separate WebView with its
own JS context, so the Zustand stores are already per-window; the work is the **session
model**, **window orchestration**, and **lifecycle**.

## Decisions (locked during brainstorming)

- **Full**: persist + restore *all* open windows across relaunch (not just the main window).
- **Close vs. quit:** X-closing a window while others remain **forgets** it; a **"Quit
  Memopad" command (`Ctrl+Q`)** closes all windows **without** forgetting → full restore next
  launch. Crash/kill/OS-shutdown also restores everything.
- **Testing caveat:** multi-window can't be e2e-tested (the harness drives a single WebView);
  verified by Rust + vitest unit tests + manual/GUI smoke. The e2e only checks `new_window`
  doesn't break the main window.

## A. Session model split

Split the flat `SessionState` into app-global and per-window parts.

**Per-window** — `WindowSession`:

```rust
pub struct WindowSession {
    pub label: String,
    pub tabs: Vec<TabEntry>,
    pub active_id: Option<String>,
    pub workspace_folder: Option<String>,
    pub split_active: bool,
    pub secondary_id: Option<String>,
    pub focused_pane: PaneSide,
    pub secondary_pane_state: Vec<PaneCursor>,
}
```

**App-global + window list** — `AppSession`:

```rust
pub struct AppSession {
    #[serde(default)]
    pub windows: Vec<WindowSession>,
    #[serde(default)]
    pub editor_prefs: EditorPrefs,           // { word_wrap, indent_guides, minimap }: Option<bool>
    #[serde(default)]
    pub recent_folders: Vec<String>,
    #[serde(default)]
    pub recent_files: Vec<String>,
}
```

`TabEntry`, `PaneCursor`, `PaneSide` are unchanged (reused from the existing `session.rs`).
`EditorPrefs { word_wrap: Option<bool>, indent_guides: Option<bool>, minimap: Option<bool> }`.

### Migration (legacy → AppSession)

Existing `session.json` is the old flat `SessionState` (top-level `tabs`, `workspace_folder`,
`word_wrap`, …, no `windows`). On load:

```rust
pub fn load_app_session(base: &Path) -> AppSession {
    let raw = read session.json or return AppSession::default();
    let value: serde_json::Value = parse(raw) or return default;
    if value.get("windows").is_some() {
        serde_json::from_value(value).unwrap_or_default()
    } else {
        // Legacy: parse as the old flat struct and wrap into one "main" window.
        let legacy: LegacySession = serde_json::from_value(value).unwrap_or_default();
        AppSession {
            windows: vec![WindowSession {
                label: "main".into(),
                tabs: legacy.tabs, active_id: legacy.active_id,
                workspace_folder: legacy.workspace_folder,
                split_active: legacy.split_active, secondary_id: legacy.secondary_id,
                focused_pane: legacy.focused_pane, secondary_pane_state: legacy.secondary_pane_state,
            }],
            editor_prefs: EditorPrefs {
                word_wrap: legacy.word_wrap, indent_guides: legacy.indent_guides, minimap: legacy.minimap,
            },
            recent_folders: legacy.recent_folders,
            recent_files: legacy.recent_files,
        }
    }
}
```

`LegacySession` is the current `SessionState` struct, retained (renamed) for migration.

## B. Rust owns the aggregate session

Tauri `manage`s a `SessionStore(Mutex<AppSession>)`. **At startup**: `load_app_session` reads
the file; the loaded `windows` seed a `RestoreQueue(Mutex<VecDeque<WindowSession>>)`; then the
in-memory `SessionStore.windows` is **reset to empty (in memory only — NOT persisted)** so it
is rebuilt cleanly from each window's *live* label as windows save. The global fields
(`editor_prefs`/`recent_folders`/`recent_files`) are kept. A `WindowCounter(AtomicU32)` issues
new labels, seeded above any restored `win-N` (so spawned/runtime labels never collide).

> The reset is in-memory only: the file is rewritten only by a `save_*`/`forget` command, so a
> crash before any window saves leaves the on-disk session intact (and the journal still covers
> dirty buffers).

Commands (mutating ones persist `AppSession` via the existing atomic write helper):

- `session_load() -> AppSession` — clone of the in-memory aggregate (after startup reset:
  empty `windows`, populated globals; used by `applyAppGlobal`).
- `session_claim_window() -> Option<WindowSession>` — pop the front of the RestoreQueue, or
  `None` when empty.
- `session_pending_count() -> usize` — current RestoreQueue length (the main window calls this
  *after* claiming its own slice to learn how many windows to spawn).
- `session_save_window(label, ws: WindowSession)` — upsert `ws` into `SessionStore.windows` by
  `label`; persist.
- `session_save_app(prefs: EditorPrefs, recent_folders, recent_files)` — replace the global
  fields; persist.
- `session_forget_window(label)` — remove the window with `label`; persist.
- `next_window_label() -> String` — `format!("win-{}", counter.fetch_add(1))`.

The old `session_save` / `session_load` (flat) commands are removed; callers move to the new
ones.

## C. Window creation + restore orchestration

- `new_window(app) -> Result<String, String>`: `WebviewWindowBuilder::new(app, label, url)`
  with the same chromeless config as `main` (decorations off, default size). `label =
  next_window_label()`. Returns the label. Used by the "New Window" command and by restore.
- **Boot sequence (every window, in `bootRestore`):**
  1. Read `getCurrentWindow().label`.
  2. `applyAppGlobal(session_load())` — set editor prefs + recent folders/files into this
     window's stores (idempotent; every window applies the shared globals).
  3. `claimed = session_claim_window()`:
     - If `claimed` is non-null, restore its `tabs`/`workspace`/`split` into this window's
       stores (the existing restore logic, generalized to take a `WindowSession`), then
       `session_save_window(label, <current window state>)` so the canonical list is keyed by
       this window's *live* label.
     - If `claimed` is null (a brand-new runtime window, queue empty), start empty.
  4. **Main only:** after claiming its slice, call `session_pending_count()` → `k` remaining
     windows; call `new_window()` `k` times to spawn them. Each spawned window boots and claims
     the next slice in step 3. (Exact ordering among the non-main windows isn't significant —
     each gets a distinct saved slice.)

## D. Close vs. quit lifecycle

- **X-close (`window_close` command, unchanged `window.destroy()`):** before destroying, if
  `other windows exist`, call `session_forget_window(label)` (this window won't reopen). If it
  is the **last** window, do **not** forget (the session keeps it for restore).
  - The "other windows exist?" check uses a new `window_count() -> usize` command
    (`app.webview_windows().len()`), called from the frontend close handler before `window_close`.
- **Quit (`app.quit` command + `Ctrl+Q` + palette "Quit Memopad"):** closes all windows
  **without** forgetting → every currently-open window remains in the session → full restore.
  Implemented as a Rust `quit_app(app)` command that calls `app.exit(0)` (windows are not
  individually X-closed, so nothing is forgotten).
- **Crash / kill / OS-shutdown:** no `window_close` runs → session intact → all restored.

## E. Per-window crash journal

The journal (`journal.rs`) snapshots dirty buffers app-globally, keyed by `buffer_id`. Add a
`window_label: String` to the snapshot record (`Snapshot`/`RestoredEntry`). On boot a window
replays **only** entries whose `window_label` matches its own label. Legacy journal entries
(missing `window_label`) → treated as `main` (so an upgrade recovers them into the main window).
`journal_snapshot` gains a `window_label` arg; `journal_replay` filters by label
(`journal_replay(window_label) -> Vec<RestoredEntry>`).

## F. Frontend wiring

- **`src/lib/boot.ts`** — `bootRestore` becomes per-window: read label, `applyAppGlobal`,
  `claim` + restore window slice (generalize the existing tab/split restore to take a
  `WindowSession`), and (main only) spawn remaining windows. Journal replay filtered by label.
- **`src/App.tsx`** — `persistSession` splits:
  - window-data store changes (`useBuffers`) → `session_save_window(label, currentWindowSession())`;
  - app-global changes (`useEditorPrefs`, recent folders/files) → `session_save_app(...)`.
  - The existing store subscriptions are re-routed accordingly. The focus/journal effects stay,
    but journal writes pass the window label.
- **`src/lib/tauri.ts`** — new bindings: `newWindow`, `quitApp`, `windowCount`,
  `sessionClaimWindow`, `sessionSaveWindow`, `sessionSaveApp`, `sessionForgetWindow`,
  updated `sessionLoad` (→ `AppSession`), `journalSnapshot`/`journalReplay` with `windowLabel`.
- **Triggers** (`src/commands/builtins.ts` + `src/App.tsx`):
  - `window.new` → "New Window" (`Ctrl+Shift+N`) → `newWindow()`.
  - `app.quit` → "Quit Memopad" (`Ctrl+Q`) → `quitApp()`.
- **Title-bar X** (`window_close` path) — call `windowCount()`; if `> 1`, `sessionForgetWindow(label)`
  before `window_close`.

## Error handling / edge cases

| Case | Handling |
|------|----------|
| Legacy `session.json` | Migrated to one `main` window + global parts |
| New runtime window (queue empty) | `claim` returns null → starts empty |
| Two windows toggle the same pref | App-global last-write-wins via `session_save_app` |
| Same buffer_id in two windows | `genId()` is random-suffixed → collisions improbable; journal keyed by (label,id) on replay |
| Spawn fails for a restored window | Logged; main continues; that window's session stays in the file (retry next launch) |
| Close last window | Not forgotten → restored next launch (quit-by-last-close keeps it) |

## Testing strategy

- **Rust** (`session.rs`): `load_app_session` migrates a legacy blob (no `windows`) into one
  `main` window with lifted globals; round-trips a multi-window `AppSession`; `save_window`
  upserts by label (insert new, replace existing); `forget_window` removes by label;
  `next_window_label` increments and avoids seeded collisions. (`journal.rs`):
  `journal_replay(label)` returns only matching-label entries; legacy (no label) → `main`.
- **vitest:** `currentWindowSession()` maps store state → `WindowSession` correctly; the
  per-window restore reducer applies a `WindowSession`; `applyAppGlobal` sets prefs + recents;
  the persist router sends window-data to `saveWindowSession` and prefs to `saveAppGlobal`
  (mock IPC).
- **e2e** (`tests/e2e/multi-window.spec.ts`): run `__memopadTestRunCommand('window.new')`
  (via the existing hook) and assert the **main** window is still alive and responsive
  (`__memopadTestNewBuffer` still works; no error). This guards against `new_window` crashing
  the caller; it does NOT inspect the second window (harness limitation).
- **GUI/manual smoke:** open New Window (screenshot two windows is not capturable via the
  single session — manual check); relaunch restores both (manual); `Ctrl+Q` preserves, X-close
  forgets (manual).

## Scope boundaries (YAGNI — non-goals)

- Two horizontal panes max per window (unchanged); no cross-window tab drag/move.
- No per-window theme/font; windows are chromeless like today.
- No "merge all windows" / "move tab to new window" commands.
- No menu bar (the Quit lives in the command palette + `Ctrl+Q`).

## Release

Ships as **0.12.0**. CHANGELOG: Added — multiple windows (New Window `Ctrl+Shift+N`), each
independent; windows are restored on relaunch; Quit (`Ctrl+Q`) preserves the layout while
closing a single window with X forgets it. Version bump in `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. Notes the migration of existing sessions.
