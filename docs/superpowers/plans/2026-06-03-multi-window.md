# Multi-Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiple independent windows (New Window `Ctrl+Shift+N`), each with its own buffers/workspace/split, all restored on relaunch; `Ctrl+Q` quits preserving the layout, X-closing one window forgets it.

**Architecture:** Rust owns an aggregate `AppSession` (`Mutex`) split into app-global parts + a per-window list; a restore-queue feeds each window its slice on boot (main spawns the rest); the crash journal is tagged per window. Each Tauri window is a separate WebView, so the Zustand stores are already per-window.

**Tech Stack:** Rust/Tauri (WebviewWindow, managed state, serde) ; React 18 + TS + Zustand ; Vitest + WebdriverIO/Mocha.

Spec: `docs/superpowers/specs/2026-06-03-multi-window-design.md`

**Testing caveat:** the e2e harness drives a single WebView; multi-window is verified by Rust + vitest unit tests + manual/GUI smoke. The e2e only asserts `new_window` doesn't break the main window.

---

## File Structure

- **Modify** `src-tauri/src/session.rs` — `LegacySession` (renamed), `WindowSession`, `EditorPrefs`, `AppSession`, `load_app_session` (migration), `save_app_session`; managed-state helpers + tests.
- **Modify** `src-tauri/src/journal.rs` — `window_label` on `Snapshot`; `replay_at` filter helper; tests.
- **Modify** `src-tauri/src/lib.rs` — managed state (`SessionStore`/`RestoreQueue`/`WindowCounter`); new session/window/quit commands; remove old `session_save`/`session_load`; updated journal commands.
- **Modify** `src/lib/tauri.ts` — types + bindings.
- **Modify** `src/lib/boot.ts` — per-window restore + spawn.
- **Modify** `src/App.tsx` — persist split, label-aware journal, New Window / Quit, X-forget.
- **Modify** `src/commands/builtins.ts` — `window.new`, `app.quit`.
- **Create** `src/tests/multi-window.test.ts` — frontend unit tests.
- **Create** `tests/e2e/multi-window.spec.ts` — guard e2e.
- **Modify** version files + `CHANGELOG.md` — 0.12.0.

---

## Task 1: Rust — AppSession model + migration

**Files:** Modify `src-tauri/src/session.rs`

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)] mod tests` block in `session.rs`:

```rust
#[test]
fn migrates_legacy_flat_session_to_one_main_window() {
    let json = r#"{ "tabs": [{"buffer_id":"b1","path":"C:/a.txt"}], "active_id":"b1",
        "workspace_folder":"C:/proj", "word_wrap": true, "recent_files": ["C:/a.txt"] }"#;
    let app: AppSession = parse_app_session(json);
    assert_eq!(app.windows.len(), 1);
    assert_eq!(app.windows[0].label, "main");
    assert_eq!(app.windows[0].active_id.as_deref(), Some("b1"));
    assert_eq!(app.windows[0].workspace_folder.as_deref(), Some("C:/proj"));
    assert_eq!(app.editor_prefs.word_wrap, Some(true));
    assert_eq!(app.recent_files, vec!["C:/a.txt".to_string()]);
}

#[test]
fn parses_new_multi_window_session() {
    let json = r#"{ "windows": [
        {"label":"main","tabs":[],"active_id":null},
        {"label":"win-1","tabs":[],"active_id":null,"workspace_folder":"C:/p2"}
    ], "editor_prefs": {"minimap": true}, "recent_folders": ["C:/p"] }"#;
    let app: AppSession = parse_app_session(json);
    assert_eq!(app.windows.len(), 2);
    assert_eq!(app.windows[1].label, "win-1");
    assert_eq!(app.windows[1].workspace_folder.as_deref(), Some("C:/p2"));
    assert_eq!(app.editor_prefs.minimap, Some(true));
}

#[test]
fn empty_or_garbage_yields_default() {
    assert!(parse_app_session("").windows.is_empty());
    assert!(parse_app_session("not json").windows.is_empty());
}
```

(`parse_app_session(&str) -> AppSession` is a small pure helper extracted so the migration is
testable without disk; `load_app_session` reads the file then calls it.)

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib session::tests::migrates_legacy_flat_session_to_one_main_window`
Expected: FAIL — `AppSession` / `parse_app_session` undefined.

- [ ] **Step 3: Implement**

In `src-tauri/src/session.rs`:

1. **Rename** the existing `pub struct SessionState` to `pub struct LegacySession` (and its
   `impl Default for SessionState` to `impl Default for LegacySession`). Keep all its fields.

2. Add the new types:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct EditorPrefs {
    #[serde(default)] pub word_wrap: Option<bool>,
    #[serde(default)] pub indent_guides: Option<bool>,
    #[serde(default)] pub minimap: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowSession {
    pub label: String,
    #[serde(default)] pub tabs: Vec<TabEntry>,
    #[serde(default)] pub active_id: Option<String>,
    #[serde(default)] pub workspace_folder: Option<String>,
    #[serde(default)] pub split_active: bool,
    #[serde(default)] pub secondary_id: Option<String>,
    #[serde(default)] pub focused_pane: PaneSide,
    #[serde(default)] pub secondary_pane_state: Vec<PaneCursor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AppSession {
    #[serde(default)] pub windows: Vec<WindowSession>,
    #[serde(default)] pub editor_prefs: EditorPrefs,
    #[serde(default)] pub recent_folders: Vec<String>,
    #[serde(default)] pub recent_files: Vec<String>,
}
```

3. Add the migration helpers:

```rust
/// Parse session JSON into an AppSession, migrating the legacy flat shape.
pub fn parse_app_session(raw: &str) -> AppSession {
    let value: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return AppSession::default(),
    };
    if value.get("windows").is_some() {
        serde_json::from_value(value).unwrap_or_default()
    } else {
        let l: LegacySession = serde_json::from_value(value).unwrap_or_default();
        AppSession {
            windows: vec![WindowSession {
                label: "main".to_string(),
                tabs: l.tabs, active_id: l.active_id, workspace_folder: l.workspace_folder,
                split_active: l.split_active, secondary_id: l.secondary_id,
                focused_pane: l.focused_pane, secondary_pane_state: l.secondary_pane_state,
            }],
            editor_prefs: EditorPrefs { word_wrap: l.word_wrap, indent_guides: l.indent_guides, minimap: l.minimap },
            recent_folders: l.recent_folders,
            recent_files: l.recent_files,
        }
    }
}

/// Read + migrate the on-disk session (empty default if absent/unreadable).
pub fn load_app_session(base_dir: &std::path::Path) -> AppSession {
    let path = session_path(base_dir);
    match std::fs::read_to_string(&path) {
        Ok(raw) => parse_app_session(&raw),
        Err(_) => AppSession::default(),
    }
}

/// Atomically write an AppSession to session.json (mirrors the existing save_at).
pub fn save_app_session(base_dir: &std::path::Path, app: &AppSession) -> std::io::Result<()> {
    use std::io::Write;
    std::fs::create_dir_all(base_dir)?;
    let path = session_path(base_dir);
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(app)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    { let mut f = std::fs::File::create(&tmp)?; f.write_all(json.as_bytes())?; f.sync_all()?; }
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
```

Keep the existing `session_path`, `TabEntry`, `PaneCursor`, `PaneSide`. The old `save_at` /
`load_at` may remain unused for now (removed in Task 3 when commands are rewired) OR delete if
the compiler flags them dead — prefer deleting in Task 3.

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib session::`
Expected: PASS (existing legacy-struct tests still compile under the `LegacySession` name —
update any that referenced `SessionState` to `LegacySession`; the migration tests pass).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/session.rs
git commit -m "feat(session): AppSession model + legacy migration"
```

---

## Task 2: Rust — journal per-window label

**Files:** Modify `src-tauri/src/journal.rs`

- [ ] **Step 1: Write failing test**

Add to `journal.rs` tests:

```rust
#[test]
fn replay_filters_by_window_label_and_defaults_legacy_to_main() {
    let dir = tmp_journals("label");
    // New entry tagged win-1:
    snapshot_at(&dir, "b1", &Snapshot {
        path: None, content: "x".into(), encoding: "utf-8".into(), eol: "lf".into(),
        window_label: "win-1".into(),
    }).unwrap();
    // Legacy-style line (no window_label) written directly:
    std::fs::write(dir.join("b2.jsonl"),
        b"{\"path\":null,\"content\":\"y\",\"encoding\":\"utf-8\",\"eol\":\"lf\"}\n").unwrap();

    let main_entries = replay_for_label(&dir, "main").unwrap();
    assert!(main_entries.iter().any(|e| e.buffer_id == "b2"), "legacy entry → main");
    assert!(!main_entries.iter().any(|e| e.buffer_id == "b1"));

    let win1 = replay_for_label(&dir, "win-1").unwrap();
    assert!(win1.iter().any(|e| e.buffer_id == "b1"));
    assert!(!win1.iter().any(|e| e.buffer_id == "b2"));
}
```

(Use the existing test helper for a temp journals dir — if none exists, add a small `tmp_journals(name)` mirroring `session.rs`'s `tmp`.)

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib journal::tests::replay_filters_by_window_label_and_defaults_legacy_to_main`
Expected: FAIL — no `window_label` field / `replay_for_label`.

- [ ] **Step 3: Implement**

In `journal.rs`, add a default fn and the field:

```rust
fn default_window_label() -> String { "main".to_string() }
```

Add to `Snapshot`:

```rust
    #[serde(default = "default_window_label")]
    pub window_label: String,
```

(`Snapshot` derives `Eq`; `String` is fine.)

Add a label-filtering replay (keep `replay_at` as the unfiltered base, used internally):

```rust
/// Replay only the entries whose snapshot.window_label matches `label`.
/// Legacy entries (no field) deserialize to "main" via serde default.
pub fn replay_for_label(journals_dir: &std::path::Path, label: &str) -> std::io::Result<Vec<RestoredEntry>> {
    let all = replay_at(journals_dir)?;
    Ok(all.into_iter().filter(|e| e.snapshot.window_label == label).collect())
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib journal::`
Expected: PASS. (Existing journal tests that build `Snapshot { ... }` literals must add
`window_label: "main".into()` — update them.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/journal.rs
git commit -m "feat(journal): per-window label + replay_for_label"
```

---

## Task 3: Rust — managed state + commands

**Files:** Modify `src-tauri/src/lib.rs`

- [ ] **Step 1: Add managed state structs + helpers**

At the top of `lib.rs` (after the existing `use` lines), add:

```rust
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};

struct SessionStore(std::sync::Mutex<session::AppSession>);
struct RestoreQueue(std::sync::Mutex<VecDeque<session::WindowSession>>);
struct WindowCounter(AtomicU32);
```

- [ ] **Step 2: Add the session/window/quit commands**

Add these `#[tauri::command]`s (they take the managed state + app handle):

```rust
fn persist_session(app: &tauri::AppHandle, store: &SessionStore) {
    if let Ok(base) = app_base_dir(app) {
        if let Ok(s) = store.0.lock() {
            let _ = session::save_app_session(&base, &s);
        }
    }
}

#[tauri::command]
fn session_load(store: tauri::State<SessionStore>) -> session::AppSession {
    store.0.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
fn session_claim_window(queue: tauri::State<RestoreQueue>) -> Option<session::WindowSession> {
    queue.0.lock().ok().and_then(|mut q| q.pop_front())
}

#[tauri::command]
fn session_pending_count(queue: tauri::State<RestoreQueue>) -> usize {
    queue.0.lock().map(|q| q.len()).unwrap_or(0)
}

#[tauri::command]
fn session_save_window(
    app: tauri::AppHandle, store: tauri::State<SessionStore>, label: String, window: session::WindowSession,
) {
    if let Ok(mut s) = store.0.lock() {
        if let Some(slot) = s.windows.iter_mut().find(|w| w.label == label) { *slot = window; }
        else { s.windows.push(window); }
    }
    persist_session(&app, &store);
}

#[tauri::command]
fn session_save_app(
    app: tauri::AppHandle, store: tauri::State<SessionStore>,
    editor_prefs: session::EditorPrefs, recent_folders: Vec<String>, recent_files: Vec<String>,
) {
    if let Ok(mut s) = store.0.lock() {
        s.editor_prefs = editor_prefs; s.recent_folders = recent_folders; s.recent_files = recent_files;
    }
    persist_session(&app, &store);
}

#[tauri::command]
fn session_forget_window(app: tauri::AppHandle, store: tauri::State<SessionStore>, label: String) {
    if let Ok(mut s) = store.0.lock() { s.windows.retain(|w| w.label != label); }
    persist_session(&app, &store);
}

#[tauri::command]
fn window_count(app: tauri::AppHandle) -> usize {
    app.webview_windows().len()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn new_window(app: tauri::AppHandle, counter: tauri::State<WindowCounter>) -> Result<String, String> {
    let label = format!("win-{}", counter.0.fetch_add(1, Ordering::SeqCst));
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("Memopad")
        .inner_size(1100.0, 720.0)
        .min_inner_size(480.0, 320.0)
        .decorations(false)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}
```

- [ ] **Step 3: Update the journal commands for `window_label`**

Replace the `journal_snapshot` and `journal_replay` commands:

```rust
#[tauri::command]
fn journal_snapshot(app: tauri::AppHandle, buffer_id: String, snapshot: journal::Snapshot) -> Result<(), String> {
    let dir = journals_dir(&app)?;
    journal::snapshot_at(&dir, &buffer_id, &snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
fn journal_replay(app: tauri::AppHandle, window_label: String) -> Result<Vec<journal::RestoredEntry>, String> {
    let dir = journals_dir(&app)?;
    journal::replay_for_label(&dir, &window_label).map_err(|e| e.to_string())
}
```

(`Snapshot` now carries `window_label`, so `journal_snapshot`'s signature is unchanged — the
label rides inside the snapshot.)

- [ ] **Step 4: Wire managed state + register commands; remove old session commands**

In `run()`'s `tauri::Builder`:

- Load + seed state at startup, before `.invoke_handler`:

```rust
    let base = /* resolve app_local_data_dir at startup — see note */;
    let app_session = session::load_app_session(&base);
    let restore_q: VecDeque<session::WindowSession> = app_session.windows.iter().cloned().collect();
    // Determine the next window-counter seed (above any restored win-N).
    let seed = app_session.windows.iter()
        .filter_map(|w| w.label.strip_prefix("win-").and_then(|n| n.parse::<u32>().ok()))
        .max().map(|m| m + 1).unwrap_or(0);
    // In-memory reset of the canonical window list (rebuilt as windows save):
    let mut canonical = app_session.clone();
    canonical.windows.clear();
```

  **Note on resolving `base` at builder time:** use `tauri::Builder::default().setup(|app| { ... })`
  to resolve `app.path().app_local_data_dir()` and `app.manage(...)` the three states inside
  `setup` (the `AppHandle` is available there). Move the load/seed code into the `setup` closure
  and `app.manage(SessionStore(Mutex::new(canonical)))`, `app.manage(RestoreQueue(Mutex::new(restore_q)))`,
  `app.manage(WindowCounter(AtomicU32::new(seed)))`.

- Remove `session_save` and `session_load` (old flat) commands and their handler entries.
- Add to `generate_handler![...]`: `session_load, session_claim_window, session_pending_count,
  session_save_window, session_save_app, session_forget_window, window_count, quit_app, new_window`
  (and keep the updated `journal_snapshot, journal_replay`).

- [ ] **Step 5: Verify it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean. Fix any remaining references to the removed flat commands.

- [ ] **Step 6: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(window): session aggregate state + window/quit commands"
```

---

## Task 4: Frontend bindings + types

**Files:** Modify `src/lib/tauri.ts`

- [ ] **Step 1: Implement**

In `src/lib/tauri.ts`, replace the `SessionState` interface usage with the new shapes and add
bindings:

```ts
export interface EditorPrefsWire {
  word_wrap?: boolean | null;
  indent_guides?: boolean | null;
  minimap?: boolean | null;
}
export interface WindowSession {
  label: string;
  tabs: TabEntry[];
  active_id: string | null;
  workspace_folder?: string | null;
  split_active?: boolean;
  secondary_id?: string | null;
  focused_pane?: 'primary' | 'secondary';
  secondary_pane_state?: PaneCursor[];
}
export interface AppSession {
  windows: WindowSession[];
  editor_prefs: EditorPrefsWire;
  recent_folders: string[];
  recent_files: string[];
}

export async function sessionLoad(): Promise<AppSession> { return invoke<AppSession>('session_load'); }
export async function sessionClaimWindow(): Promise<WindowSession | null> { return invoke<WindowSession | null>('session_claim_window'); }
export async function sessionPendingCount(): Promise<number> { return invoke<number>('session_pending_count'); }
export async function sessionSaveWindow(label: string, window: WindowSession): Promise<void> { return invoke('session_save_window', { label, window }); }
export async function sessionSaveApp(editorPrefs: EditorPrefsWire, recentFolders: string[], recentFiles: string[]): Promise<void> {
  return invoke('session_save_app', { editorPrefs, recentFolders, recentFiles });
}
export async function sessionForgetWindow(label: string): Promise<void> { return invoke('session_forget_window', { label }); }
export async function windowCount(): Promise<number> { return invoke<number>('window_count'); }
export async function quitApp(): Promise<void> { return invoke('quit_app'); }
export async function newWindow(): Promise<string> { return invoke<string>('new_window'); }
```

Update `JournalSnapshot` to include `window_label: string;` and `journalReplay` to take a label:

```ts
export interface JournalSnapshot { path: string | null; content: string; encoding: Encoding; eol: LineEnding; window_label: string; }
export async function journalReplay(windowLabel: string): Promise<RestoredEntry[]> {
  return invoke<RestoredEntry[]>('journal_replay', { windowLabel });
}
```

Remove the old `sessionSave` binding and the old flat `SessionState` interface (or keep
`SessionState` only if other code still imports it — grep and migrate those).

- [ ] **Step 2: Verify types (will surface callers to fix in later tasks)**

Run: `npx tsc --noEmit` — expect errors in `boot.ts` / `App.tsx` / `session-debounce.ts`
referencing the removed `sessionSave`/`SessionState`. Those are fixed in Tasks 5–6. (This task
just lands the bindings; commit even though tsc is red, then the next tasks green it.)

Actually: to keep each commit green, **do Tasks 4, 5, 6 as one combined change** if tsc cannot
pass independently. Recommended: implement 4→5→6, then run tsc once, then commit per the messages
below. (The reviewer/controller may collapse these commits.)

- [ ] **Step 3: Commit (after Tasks 5–6 green tsc)**

```bash
git add src/lib/tauri.ts
git commit -m "feat(tauri): multi-window session bindings"
```

---

## Task 5: Frontend — per-window boot restore + spawn

**Files:** Modify `src/lib/boot.ts`

- [ ] **Step 1: Rewrite `bootRestore` per-window**

In `src/lib/boot.ts`, restructure `bootRestore` to:

```ts
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEditorPrefs } from '../stores/editorPrefs';
import { useRecentFiles } from '../stores/recentFiles';
import {
  journalReplay, sessionLoad, sessionClaimWindow, sessionPendingCount, sessionSaveWindow, newWindow,
  openFile, type WindowSession, type AppSession,
} from './tauri';
// ... existing imports (useBuffers, useWorkspace, asEncoding, asEol) ...

function applyAppGlobal(app: AppSession): void {
  if (app.editor_prefs.word_wrap != null) useEditorPrefs.getState().setWordWrap(app.editor_prefs.word_wrap);
  if (app.editor_prefs.indent_guides != null) useEditorPrefs.getState().setIndentGuides(app.editor_prefs.indent_guides);
  if (app.editor_prefs.minimap != null) useEditorPrefs.getState().setMinimap(app.editor_prefs.minimap);
  useRecentFiles.getState().setRecent(app.recent_files ?? []);
  // recent folders restored into useWorkspace as today (see existing logic) — keep that.
}

export async function bootRestore(): Promise<void> {
  if (useBuffers.getState().buffers.length > 0) return;
  const label = getCurrentWindow().label;

  const app = await sessionLoad().catch(() => ({ windows: [], editor_prefs: {}, recent_folders: [], recent_files: [] } as AppSession));
  applyAppGlobal(app);
  useWorkspace.getState().setRecent(app.recent_folders ?? []);

  const [journalEntries, claimed] = await Promise.all([
    journalReplay(label).catch(() => []),
    sessionClaimWindow().catch(() => null),
  ]);

  await restoreWindow(claimed, journalEntries);

  if (label === 'main') {
    const pending = await sessionPendingCount().catch(() => 0);
    for (let i = 0; i < pending; i++) {
      await newWindow().catch((e) => console.warn('spawn window failed:', e));
    }
  }
}
```

Add `restoreWindow` — the existing tab/journal/split restore logic, generalized to take a
`WindowSession | null` (move the body of the old `bootRestore` here, sourcing `tabs`/
`workspace_folder`/`split_*` from `claimed` instead of the old flat `session`; if `claimed` is
null, restore only the journal entries / start empty):

```ts
async function restoreWindow(claimed: WindowSession | null, journalEntries: RestoredEntry[]): Promise<void> {
  if (claimed?.workspace_folder !== undefined) useWorkspace.getState().setFolder(claimed?.workspace_folder ?? null);
  const tabs = claimed?.tabs ?? [];
  const tabById = new Map(tabs.map((t) => [t.buffer_id, t]));
  // ... existing journal-first pass (openRestored with cursor/scroll from tabById) ...
  // ... existing second pass (open clean tabs from disk) ...
  // ... existing active-id switchTo ...
  // ... existing restoreSplitState using claimed.split_active/secondary_id/focused_pane/secondary_pane_state ...
}
```

(Preserve the exact existing journal/tab/split restore behavior — only the data source changes
from the flat `session` to `claimed`.)

- [ ] **Step 2: Commit (with Task 6 — see Task 4 Step 2 note)**

```bash
git add src/lib/boot.ts
git commit -m "feat(boot): per-window restore + main spawns saved windows"
```

---

## Task 6: Frontend — persist split, journal label, New Window / Quit, X-forget

**Files:** Modify `src/App.tsx`, `src/commands/builtins.ts`

- [ ] **Step 1: persist split + journal label in App.tsx**

In `src/App.tsx`:

- Compute the window label once: `const winLabel = getCurrentWindow().label;` (module scope or in the effect).
- Replace `persistSession()` with two routed savers:

```ts
function currentWindowSession(label: string) {
  const s = useBuffers.getState();
  return {
    label,
    tabs: s.buffers.map((b) => ({ buffer_id: b.id, path: b.path, cursor: b.cursor, scroll_top: b.scrollTop })),
    active_id: s.activeId,
    workspace_folder: useWorkspace.getState().workspaceFolder,
    split_active: s.splitActive,
    secondary_id: s.secondaryId,
    focused_pane: s.focusedPane,
    secondary_pane_state: Array.from(s.secondaryPaneState.entries()).map(([buffer_id, v]) => ({ buffer_id, cursor: v.cursor, scroll_top: v.scrollTop })),
  };
}

function persistWindow(label: string) { sessionSaveWindow(label, currentWindowSession(label)).catch(() => {}); }
function persistApp() {
  sessionSaveApp(
    { word_wrap: useEditorPrefs.getState().wordWrap, indent_guides: useEditorPrefs.getState().indentGuides, minimap: useEditorPrefs.getState().minimap },
    useWorkspace.getState().recentFolders,
    useRecentFiles.getState().recentFiles,
  ).catch(() => {});
}
```

  (Debounce both with the existing `scheduleSessionSave` mechanism if desired — simplest: call
  the existing debounce wrapper around the chosen saver. Keep the existing
  `session-debounce.ts` but point it at `sessionSaveWindow`/`sessionSaveApp`; or call directly —
  saves are cheap.)

- Re-route the boot-effect subscriptions:
  - `useBuffers.subscribe(() => { persistWindow(winLabel); recordStatsForBuffersWithoutOne().catch(()=>{}); })`
  - `useWorkspace.subscribe(() => { persistWindow(winLabel); persistApp(); })` (workspace folder is per-window; recents are app-global → both)
  - `useEditorPrefs.subscribe(() => persistApp())`
  - `useRecentFiles.subscribe(...)` → `persistApp()` (plus the existing `registerRecentFileCommands`).
- Journal writes: where `journalSnapshot` is called for a dirty buffer, include `window_label: winLabel` in the `JournalSnapshot`.

- [ ] **Step 2: New Window / Quit + X-forget**

- In the keydown handler: `Ctrl+Shift+N` → `runCommand('window.new')`; `Ctrl+Q` (`key==='q' && !shift`) → `runCommand('app.quit')`.
- Title-bar X: the close handler (currently invokes `window_close`) should first forget if not last:

```ts
async function closeThisWindow() {
  const n = await windowCount().catch(() => 1);
  if (n > 1) await sessionForgetWindow(getCurrentWindow().label).catch(() => {});
  await invoke('window_close'); // existing close
}
```

  Wire `closeThisWindow` to the title-bar X button (TitleBar.tsx currently calls the window
  close command — route it through this).

- [ ] **Step 3: Commands**

In `src/commands/builtins.ts`:

```ts
register({ id: 'window.new', title: 'New Window', shortcut: 'Ctrl+Shift+N', run: () => import('../lib/tauri').then((m) => m.newWindow().catch(() => {})) });
register({ id: 'app.quit', title: 'Quit Memopad', shortcut: 'Ctrl+Q', run: () => import('../lib/tauri').then((m) => m.quitApp().catch(() => {})) });
```

- [ ] **Step 4: Verify all of 4–6 together**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean (the binding/caller changes now reconcile); vitest — fix any existing
`boot.test.ts` / `session-debounce.test.ts` that referenced the old flat session shape (update
them to the new bindings, or mark obsolete ones). Commit Tasks 4–6 (their messages above).

---

## Task 7: Frontend unit tests

**Files:** Create `src/tests/multi-window.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { useBuffers } from '../stores/buffers';
import { useWorkspace } from '../stores/workspace';
import { currentWindowSession } from '../App'; // export it from App.tsx for testing

describe('currentWindowSession', () => {
  beforeEach(() => { useBuffers.getState().resetAll(); useWorkspace.setState({ workspaceFolder: 'C:/proj' } as never); });
  it('maps store state to a WindowSession', () => {
    const id = useBuffers.getState().openBuffer({ path: 'C:/a.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
    const ws = currentWindowSession('main');
    expect(ws.label).toBe('main');
    expect(ws.workspace_folder).toBe('C:/proj');
    expect(ws.tabs[0].buffer_id).toBe(id);
    expect(ws.active_id).toBe(id);
  });
});
```

(Export `currentWindowSession` from `App.tsx`. If exporting from `App.tsx` is awkward, extract
`currentWindowSession` + `applyAppGlobal` into a small `src/lib/window-session.ts` module and
import from there in both `App.tsx`/`boot.ts` and the test — cleaner; prefer this.)

- [ ] **Step 2: Run + commit**

Run: `npx vitest run src/tests/multi-window.test.ts` → PASS.

```bash
git add src/tests/multi-window.test.ts src/lib/window-session.ts src/App.tsx src/lib/boot.ts
git commit -m "test(window): currentWindowSession + applyAppGlobal unit tests"
```

---

## Task 8: e2e guard — New Window doesn't break the main window

**Files:** Create `tests/e2e/multi-window.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('multi-window (main-window guard)', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => { (window as unknown as { __memopadTestReset?: () => void }).__memopadTestReset?.(); });
    await sleep(150);
  });

  it('New Window command runs without breaking the main window', async () => {
    await classicExecute<void>(`window.__memopadTestRunCommand('window.new'); return undefined;`);
    await sleep(800);
    // The main window (this WebDriver session) must still be responsive.
    const id = await classicExecute<string>(`return window.__memopadTestNewBuffer();`);
    expect(id, 'main window still works after spawning a window').to.be.a('string');
  });
});
```

Note: the harness can't inspect the spawned window; this guards that `new_window` doesn't crash
the caller. A spawned window will be left open — `zz-close` closes the main session's window;
the spawned one is cleaned up on process teardown.

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/multi-window.spec.ts
git commit -m "test(e2e): New Window does not break the main window"
```

---

## Task 9: Version bump + CHANGELOG (0.12.0)

**Files:** `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump to 0.12.0** (package.json, Cargo.toml `[package]`, tauri.conf.json).
- [ ] **Step 2:** `cargo build --manifest-path src-tauri/Cargo.toml` to refresh Cargo.lock.
- [ ] **Step 3: CHANGELOG** under `## [Unreleased]`:

```markdown
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
```

- [ ] **Step 4:** `npx tsc --noEmit && npx vitest run` → clean + green.
- [ ] **Step 5: Commit**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: bump to 0.12.0 + changelog for multi-window"
```

---

## Task 10: Full verification gate

- [ ] **Step 1:** `cargo test --manifest-path src-tauri/Cargo.toml --lib` → green (session migration, journal label, etc.).
- [ ] **Step 2:** `npx tsc --noEmit && npx vitest run` → clean + green.
- [ ] **Step 3: Release build + full e2e**

```bash
rm -f src-tauri/target/release/app.exe
npm run tauri build || echo "unsigned build exit tolerated"
test -f src-tauri/target/release/app.exe
npx mocha
```
Expected: full suite green (incl. the multi-window guard). `npx mocha` may intermittently exit 1
on the `zz-close` teardown race — re-run to confirm.

- [ ] **Step 4: Manual / GUI smoke (the real multi-window verification)**

Drive the real WebView via the e2e harness; then **manually**:
1. Run `window.new` (via `__memopadTestRunCommand`) → confirm a second window opens and is
   independent (type different content in each via a `saveScreenshot` of each — note: only the
   session's window is screenshot-able; verify the second window visually on the desktop).
2. Open files/workspace in both, relaunch the app → confirm both windows return with their state.
3. Close one window with × (others remain) → relaunch → that window does NOT return.
4. `Ctrl+Q` with two windows open → relaunch → both return.
5. Verify an existing (pre-0.12.0) `session.json` still restores (migration).

Document the manual results in the final report.

- [ ] **Step 5: Final commit** (only if smoke fixups were needed).

---

## Self-Review notes

- **Spec coverage:** AppSession+migration (T1), journal label (T2), Rust state+commands (T3), bindings (T4), per-window boot+spawn (T5), persist split+New Window/Quit/X-forget (T6), unit tests (T7), e2e guard (T8), version (T9), gate+manual smoke (T10). All spec sections map.
- **Type consistency:** `AppSession`/`WindowSession`/`EditorPrefs(Wire)`; commands `session_load`/`session_claim_window`/`session_pending_count`/`session_save_window`/`session_save_app`/`session_forget_window`/`window_count`/`quit_app`/`new_window`; `journal_replay(window_label)`; frontend `currentWindowSession`/`applyAppGlobal`/`restoreWindow`. Consistent across tasks.
- **Gotchas captured:** the in-memory window-list reset at startup (not persisted) so the canonical list rebuilds from live labels; `next_window_label` seeded above restored `win-N`; window-counter/state resolved in `setup()` where the AppHandle exists; Tasks 4–6 green tsc together (binding + caller changes are interdependent); multi-window has no true e2e (manual smoke in T10); legacy journal entries default to `main`.
```
