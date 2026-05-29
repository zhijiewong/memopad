# Memopad v2 — FS Watcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Watch the workspace folder recursively with the `notify` crate so the file tree auto-refreshes when files appear/disappear and the external-change banner triggers without waiting for a window refocus.

**Architecture:** A new `src-tauri/src/watcher.rs` module wraps `notify-debouncer-full` with a 200ms coalescing window. Two Tauri commands (`watch_start` / `watch_stop`) manage a single `Mutex<Option<Debouncer>>` held via `tauri::State`. Events are emitted as `fs:event` Tauri events and consumed by a new `src/lib/fs-watcher.ts` orchestrator that drives tree refresh + buffer external-change flag.

**Tech Stack:** Tauri 2, Rust (`notify = "6"`, `notify-debouncer-full = "0.3"`, `crossbeam-channel` for tests), React + Zustand. No new frontend dependencies.

**Spec section reference:** `docs/superpowers/specs/2026-05-29-fs-watcher-design.md` (all sections).

---

## File Structure

```
memopad/
├── src-tauri/
│   ├── Cargo.toml                   MODIFY — add notify, notify-debouncer-full, crossbeam-channel (dev)
│   └── src/
│       ├── lib.rs                   MODIFY — mod watcher; register state + 2 commands
│       └── watcher.rs               CREATE — types, map_debounced_event, start, start_with_sender, stop, tests
├── src/
│   ├── lib/
│   │   ├── tauri.ts                 MODIFY — FsEventPayload type + watchStart/watchStop wrappers
│   │   └── fs-watcher.ts            CREATE — startFsWatcher/stopFsWatcher + handleEvent dispatcher
│   ├── stores/
│   │   └── workspace.ts             MODIFY — watcherError + setWatcherError
│   ├── components/
│   │   └── FileTreePanel.tsx        MODIFY — yellow warning row for watcherError
│   ├── App.tsx                      MODIFY — useWorkspace subscription that starts/stops watcher
│   └── tests/
│       ├── fs-watcher.test.ts       CREATE — 4 dispatcher cases
│       └── workspace-watcher.test.ts CREATE — 2 setWatcherError cases
└── tests/e2e/
    └── fs-watcher.spec.ts           CREATE — 1 e2e: write file → tree shows new row
```

Boundary intent:
- **`watcher.rs`** owns the notify lifecycle + emission. `map_debounced_event` is the pure helper that lets cargo tests skip `AppHandle`. `start_with_sender` is the test seam.
- **`fs-watcher.ts`** owns the frontend orchestrator. `handleEvent` is exported as the dispatcher seam so Vitest can drive it without a real Tauri listener.
- **`workspace.ts`** only gains the `watcherError` field + setter — keeps the store responsibilities clean.
- **`FileTreePanel.tsx`** is the single UI consumer of `watcherError`.
- **`App.tsx`** owns the subscription between `workspaceFolder` and watcher start/stop.

---

## Task 1: Add Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Append the dependencies**

In `src-tauri/Cargo.toml`, append to the existing `[dependencies]` block:

```toml
notify = "6"
notify-debouncer-full = "0.3"
crossbeam-channel = "0.5"
```

`crossbeam-channel` is used both by the test seam (`start_with_sender`) and by the cargo tests, so it's a regular dep, not a dev-dep.

- [ ] **Step 2: Verify it resolves**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: "Finished `dev` profile" with no errors. The new crates download.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps(rust): add notify + notify-debouncer-full + crossbeam-channel"
```

---

## Task 2: `watcher.rs` scaffold + types

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod watcher;`)

- [ ] **Step 1: Create `src-tauri/src/watcher.rs`**

EXACT contents:

```rust
// Recursive filesystem watcher for the workspace folder.
// Wraps notify-debouncer-full with a 200ms coalescing window.
// Emits Tauri events on the AppHandle, or pipes into a crossbeam Sender
// for unit tests.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::RecommendedWatcher;
use notify_debouncer_full::{DebouncedEvent, Debouncer, FileIdMap, new_debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub struct WatcherHandle(pub Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsEventKind {
    Create,
    Remove,
    Modify,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FsEventPayload {
    pub kind: FsEventKind,
    pub path: String,
}

const DEBOUNCE_MS: u64 = 200;

/// Pure helper: map a notify-debouncer event to our payload.
/// Returns None for events we don't surface (rename half-events,
/// attribute-only changes, access events, etc.).
pub fn map_debounced_event(_e: &DebouncedEvent) -> Option<FsEventPayload> {
    // Filled in by Task 3.
    None
}

pub fn start(
    _handle: &WatcherHandle,
    _folder: PathBuf,
    _app: AppHandle,
) -> Result<(), String> {
    // Filled in by later tasks.
    Ok(())
}

pub fn start_with_sender(
    _handle: &WatcherHandle,
    _folder: PathBuf,
    _sender: crossbeam_channel::Sender<FsEventPayload>,
) -> Result<(), String> {
    // Filled in by later tasks.
    Ok(())
}

pub fn stop(_handle: &WatcherHandle) -> Result<(), String> {
    // Filled in by Task 5.
    Ok(())
}

const _DEBOUNCE_MS_USED: u64 = DEBOUNCE_MS;
```

(The last `const _DEBOUNCE_MS_USED` line silences the unused-const warning until Task 4 references `DEBOUNCE_MS` directly. Remove it then.)

- [ ] **Step 2: Declare `mod watcher;` in `src-tauri/src/lib.rs`**

Change the top of `src-tauri/src/lib.rs` from:

```rust
mod files;
mod fs;
mod journal;
mod search;
mod session;
mod stat;
```

to:

```rust
mod files;
mod fs;
mod journal;
mod search;
mod session;
mod stat;
mod watcher;
```

- [ ] **Step 3: Verify it compiles**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: clean compile (some unused-fn warnings are OK).

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/watcher.rs src-tauri/src/lib.rs
git commit -m "watcher: scaffold module + types"
```

---

## Task 3: `map_debounced_event` mapping rules + tests

**Files:**
- Modify: `src-tauri/src/watcher.rs`

- [ ] **Step 1: Append a test module at the bottom of `src-tauri/src/watcher.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use notify::{Event, EventKind};
    use notify::event::{CreateKind, ModifyKind, RemoveKind, DataChange, MetadataKind, RenameMode};

    fn debounced(kind: EventKind, path: &str) -> DebouncedEvent {
        DebouncedEvent {
            event: Event { kind, paths: vec![std::path::PathBuf::from(path)], attrs: Default::default() },
            time: std::time::Instant::now(),
        }
    }

    #[test]
    fn maps_create_event() {
        let e = debounced(EventKind::Create(CreateKind::File), "C:/proj/new.rs");
        let mapped = map_debounced_event(&e).unwrap();
        assert_eq!(mapped.kind, FsEventKind::Create);
        assert_eq!(mapped.path, "C:/proj/new.rs");
    }

    #[test]
    fn maps_modify_data_event() {
        let e = debounced(EventKind::Modify(ModifyKind::Data(DataChange::Content)), "C:/proj/foo.rs");
        let mapped = map_debounced_event(&e).unwrap();
        assert_eq!(mapped.kind, FsEventKind::Modify);
        assert_eq!(mapped.path, "C:/proj/foo.rs");
    }

    #[test]
    fn maps_remove_event() {
        let e = debounced(EventKind::Remove(RemoveKind::File), "C:/proj/gone.rs");
        let mapped = map_debounced_event(&e).unwrap();
        assert_eq!(mapped.kind, FsEventKind::Remove);
        assert_eq!(mapped.path, "C:/proj/gone.rs");
    }

    #[test]
    fn skips_modify_metadata_event() {
        let e = debounced(EventKind::Modify(ModifyKind::Metadata(MetadataKind::Permissions)), "C:/proj/foo.rs");
        assert!(map_debounced_event(&e).is_none());
    }

    #[test]
    fn skips_modify_name_event() {
        let e = debounced(EventKind::Modify(ModifyKind::Name(RenameMode::From)), "C:/proj/foo.rs");
        assert!(map_debounced_event(&e).is_none());
    }

    #[test]
    fn skips_event_without_paths() {
        let e = DebouncedEvent {
            event: Event { kind: EventKind::Create(CreateKind::File), paths: vec![], attrs: Default::default() },
            time: std::time::Instant::now(),
        };
        assert!(map_debounced_event(&e).is_none());
    }
}
```

- [ ] **Step 2: Run them — should all FAIL**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib watcher::tests::maps_create_event
cd ..
```

Expected: FAIL — the stub returns None for every event.

- [ ] **Step 3: Replace the stub `map_debounced_event`**

Replace the body in `src-tauri/src/watcher.rs`:

```rust
pub fn map_debounced_event(e: &DebouncedEvent) -> Option<FsEventPayload> {
    use notify::event::{EventKind, ModifyKind};

    let path = e.event.paths.first()?.to_string_lossy().to_string();
    let kind = match &e.event.kind {
        EventKind::Create(_) => FsEventKind::Create,
        EventKind::Remove(_) => FsEventKind::Remove,
        EventKind::Modify(ModifyKind::Data(_)) => FsEventKind::Modify,
        // Skip name (rename half) + metadata (attribute-only) + access + other.
        _ => return None,
    };
    Some(FsEventPayload { kind, path })
}
```

- [ ] **Step 4: Run all 6 mapping tests**

```powershell
cd src-tauri
cargo test --lib watcher::tests::maps_create_event
cargo test --lib watcher::tests::maps_modify_data_event
cargo test --lib watcher::tests::maps_remove_event
cargo test --lib watcher::tests::skips_modify_metadata_event
cargo test --lib watcher::tests::skips_modify_name_event
cargo test --lib watcher::tests::skips_event_without_paths
cd ..
```

Expected: all 6 PASS.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/watcher.rs
git commit -m "watcher: map_debounced_event helper + 6 mapping tests"
```

---

## Task 4: `start_with_sender` + `start` + `stop`

**Files:**
- Modify: `src-tauri/src/watcher.rs`

- [ ] **Step 1: Add tests covering live watcher behavior**

Append inside `mod tests`:

```rust
fn tmp(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "memopad_watcher_{}_{}_{}",
        name,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(),
        std::process::id(),
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fresh_handle() -> WatcherHandle {
    WatcherHandle(Mutex::new(None))
}

#[test]
fn start_returns_err_for_nonexistent_path() {
    let h = fresh_handle();
    let (tx, _rx) = crossbeam_channel::unbounded::<FsEventPayload>();
    let missing = std::env::temp_dir().join("memopad_watcher_does_not_exist_xyz");
    let _ = std::fs::remove_dir_all(&missing);
    let result = start_with_sender(&h, missing, tx);
    assert!(result.is_err(), "expected Err for nonexistent path");
}

#[test]
fn start_then_stop_drops_watcher() {
    let h = fresh_handle();
    let dir = tmp("startstop");
    let (tx, _rx) = crossbeam_channel::unbounded::<FsEventPayload>();
    start_with_sender(&h, dir, tx).unwrap();
    assert!(h.0.lock().unwrap().is_some(), "watcher should be present after start");
    stop(&h).unwrap();
    assert!(h.0.lock().unwrap().is_none(), "watcher should be None after stop");
}

#[test]
fn emits_create_event_when_file_is_added() {
    let h = fresh_handle();
    let dir = tmp("create");
    let (tx, rx) = crossbeam_channel::unbounded::<FsEventPayload>();
    start_with_sender(&h, dir.clone(), tx).unwrap();
    // Give the debouncer a beat to wire up.
    std::thread::sleep(Duration::from_millis(50));
    std::fs::write(dir.join("new.txt"), b"hi").unwrap();
    let payload = rx.recv_timeout(Duration::from_secs(2)).expect("expected an event");
    assert_eq!(payload.kind, FsEventKind::Create);
    assert!(payload.path.ends_with("new.txt"), "got {:?}", payload.path);
    stop(&h).unwrap();
}

#[test]
fn emits_modify_event_when_file_is_written() {
    let h = fresh_handle();
    let dir = tmp("modify");
    let file = dir.join("foo.txt");
    std::fs::write(&file, b"v1").unwrap();
    let (tx, rx) = crossbeam_channel::unbounded::<FsEventPayload>();
    start_with_sender(&h, dir.clone(), tx).unwrap();
    std::thread::sleep(Duration::from_millis(50));
    std::fs::write(&file, b"v2").unwrap();
    // Drain events looking for a Modify against this path.
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut found = false;
    while std::time::Instant::now() < deadline {
        if let Ok(p) = rx.recv_timeout(Duration::from_millis(200)) {
            if p.kind == FsEventKind::Modify && p.path.ends_with("foo.txt") {
                found = true;
                break;
            }
        }
    }
    assert!(found, "expected a Modify event for foo.txt");
    stop(&h).unwrap();
}

#[test]
fn emits_remove_event_when_file_is_deleted() {
    let h = fresh_handle();
    let dir = tmp("remove");
    let file = dir.join("doomed.txt");
    std::fs::write(&file, b"bye").unwrap();
    let (tx, rx) = crossbeam_channel::unbounded::<FsEventPayload>();
    start_with_sender(&h, dir.clone(), tx).unwrap();
    std::thread::sleep(Duration::from_millis(50));
    std::fs::remove_file(&file).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    let mut found = false;
    while std::time::Instant::now() < deadline {
        if let Ok(p) = rx.recv_timeout(Duration::from_millis(200)) {
            if p.kind == FsEventKind::Remove && p.path.ends_with("doomed.txt") {
                found = true;
                break;
            }
        }
    }
    assert!(found, "expected a Remove event for doomed.txt");
    stop(&h).unwrap();
}
```

- [ ] **Step 2: Run them — they should FAIL**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib watcher::tests::start_returns_err_for_nonexistent_path
cd ..
```

Expected: FAIL — `start_with_sender` is a stub returning `Ok(())` without actually starting a watcher.

- [ ] **Step 3: Replace the stubs**

In `src-tauri/src/watcher.rs`, replace the stub `start_with_sender`, `start`, and `stop`:

```rust
pub fn start_with_sender(
    handle: &WatcherHandle,
    folder: PathBuf,
    sender: crossbeam_channel::Sender<FsEventPayload>,
) -> Result<(), String> {
    use notify::RecursiveMode;

    if !folder.exists() {
        return Err(format!("path does not exist: {}", folder.display()));
    }
    // Drop any prior watcher first.
    let mut slot = handle.0.lock().map_err(|e| e.to_string())?;
    *slot = None;

    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            if let Ok(events) = result {
                for ev in &events {
                    if let Some(payload) = map_debounced_event(ev) {
                        let _ = sender.send(payload);
                    }
                }
            }
            // Errors are intentionally dropped in the sender variant;
            // the AppHandle variant (`start`) surfaces them via fs:error.
        },
    ).map_err(|e| format!("debouncer init: {}", e))?;

    debouncer
        .watch(&folder, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {:?}: {}", folder, e))?;

    *slot = Some(debouncer);
    Ok(())
}

pub fn start(
    handle: &WatcherHandle,
    folder: PathBuf,
    app: AppHandle,
) -> Result<(), String> {
    use notify::RecursiveMode;

    if !folder.exists() {
        return Err(format!("path does not exist: {}", folder.display()));
    }
    let mut slot = handle.0.lock().map_err(|e| e.to_string())?;
    *slot = None;

    let app_for_err = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            match result {
                Ok(events) => {
                    for ev in &events {
                        if let Some(payload) = map_debounced_event(ev) {
                            let _ = app.emit("fs:event", payload);
                        }
                    }
                }
                Err(errs) => {
                    let msg = errs.iter().map(|e| e.to_string()).collect::<Vec<_>>().join("; ");
                    let _ = app_for_err.emit("fs:error", serde_json::json!({ "message": msg }));
                }
            }
        },
    ).map_err(|e| format!("debouncer init: {}", e))?;

    debouncer
        .watch(&folder, RecursiveMode::Recursive)
        .map_err(|e| format!("watch {:?}: {}", folder, e))?;

    *slot = Some(debouncer);
    Ok(())
}

pub fn stop(handle: &WatcherHandle) -> Result<(), String> {
    let mut slot = handle.0.lock().map_err(|e| e.to_string())?;
    *slot = None;
    Ok(())
}
```

Also remove the `const _DEBOUNCE_MS_USED` line added in Task 2 — `DEBOUNCE_MS` is now referenced normally.

- [ ] **Step 4: Run all watcher tests**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib watcher::
cd ..
```

Expected: 11 PASS (6 mapping + 5 lifecycle). The lifecycle tests sleep up to 2 seconds waiting on real fs events; total runtime ~4-6s.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/watcher.rs
git commit -m "watcher: notify-debouncer-full lifecycle + 5 live-fs tests"
```

---

## Task 5: Register Tauri commands + state

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command wrappers**

In `src-tauri/src/lib.rs`, after the existing `replace_in_files` `#[tauri::command]`, add:

```rust
#[tauri::command]
fn watch_start(
    folder: String,
    handle: tauri::State<watcher::WatcherHandle>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    watcher::start(&handle, std::path::PathBuf::from(&folder), app)
}

#[tauri::command]
fn watch_stop(handle: tauri::State<watcher::WatcherHandle>) -> Result<(), String> {
    watcher::stop(&handle)
}
```

- [ ] **Step 2: Register state + commands in `run()`**

In the existing `pub fn run()` body, find the `tauri::Builder::default()` chain. BEFORE the existing `.invoke_handler(...)` call, add `.manage(...)`:

```rust
        .manage(watcher::WatcherHandle(std::sync::Mutex::new(None)))
```

In the `invoke_handler!` macro list, after the existing `replace_in_files,` entry, add:

```rust
            watch_start,
            watch_stop,
        ])
```

- [ ] **Step 3: Verify it compiles**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo check
cd ..
```

Expected: clean compile.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/lib.rs
git commit -m "watcher: register WatcherHandle state + watch_start/watch_stop commands"
```

---

## Task 6: TS IPC wrapper + type

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Append types + wrappers at the bottom of `src/lib/tauri.ts`**

```ts
export interface FsEventPayload {
  kind: 'create' | 'remove' | 'modify';
  path: string;
}

export async function watchStart(folder: string): Promise<void> {
  return invoke<void>('watch_start', { folder });
}

export async function watchStop(): Promise<void> {
  return invoke<void>('watch_stop');
}
```

- [ ] **Step 2: Type-check**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/tauri.ts
git commit -m "tauri: typed watchStart/watchStop + FsEventPayload"
```

---

## Task 7: Workspace store `watcherError`

**Files:**
- Modify: `src/stores/workspace.ts`
- Create: `src/tests/workspace-watcher.test.ts`

- [ ] **Step 1: Create the failing tests at `src/tests/workspace-watcher.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { useWorkspace } from '../stores/workspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: null,
    results: null,
    inFlight: false,
    replaceInFlight: false,
    lastQuery: '',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    expanded: new Set<string>(),
    childrenByPath: new Map(),
    loadingByPath: new Set<string>(),
    recentFolders: [],
    watcherError: null,
  } as never);
  vi.clearAllMocks();
});

describe('useWorkspace watcherError', () => {
  it('setWatcherError sets and clears', () => {
    useWorkspace.getState().setWatcherError('uh oh');
    expect(useWorkspace.getState().watcherError).toBe('uh oh');
    useWorkspace.getState().setWatcherError(null);
    expect(useWorkspace.getState().watcherError).toBeNull();
  });

  it('setWatcherError persists across other state updates', () => {
    useWorkspace.getState().setWatcherError('still here');
    useWorkspace.getState().pushRecentFolder('C:/proj');
    expect(useWorkspace.getState().watcherError).toBe('still here');
  });
});
```

- [ ] **Step 2: Run to see failure**

```powershell
npm test -- workspace-watcher
```

Expected: FAIL — `setWatcherError` doesn't exist.

- [ ] **Step 3: Edit `src/stores/workspace.ts`**

3a. Extend the `WorkspaceState` interface:

```ts
watcherError: string | null;
setWatcherError: (msg: string | null) => void;
```

3b. Add the initial value inside the `create<WorkspaceState>((set, get) => ({ ... }))` block, near the existing initial values:

```ts
watcherError: null,
```

3c. Add the action inside the same block (place it near the other setters):

```ts
setWatcherError(msg) {
  set({ watcherError: msg });
},
```

- [ ] **Step 4: Run the tests**

```powershell
npm test -- workspace-watcher
```

Expected: 2 PASS.

- [ ] **Step 5: tsc + run all workspace tests for regression**

```powershell
npx tsc --noEmit
npm test -- workspace
```

Expected: tsc clean. All workspace tests pass (existing 18 + 2 new = 20).

- [ ] **Step 6: Commit**

```powershell
git add src/stores/workspace.ts src/tests/workspace-watcher.test.ts
git commit -m "workspace: watcherError + setWatcherError"
```

---

## Task 8: `fs-watcher.ts` dispatcher

**Files:**
- Create: `src/lib/fs-watcher.ts`
- Create: `src/tests/fs-watcher.test.ts`

- [ ] **Step 1: Create failing tests at `src/tests/fs-watcher.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { handleEvent } from '../lib/fs-watcher';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: 'C:/proj',
    results: null,
    inFlight: false,
    replaceInFlight: false,
    lastQuery: '',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    expanded: new Set<string>(),
    childrenByPath: new Map(),
    loadingByPath: new Set<string>(),
    recentFolders: [],
    watcherError: null,
  } as never);
  useBuffers.setState({ buffers: [], activeId: null, recentlyClosed: [] } as never);
  vi.clearAllMocks();
});

describe('fs-watcher.handleEvent', () => {
  it('modify event marks open buffer externalChange', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/proj/a.rs', content: 'orig', encoding: 'utf-8', eol: 'lf',
    });
    handleEvent({ kind: 'modify', path: 'C:/proj/a.rs' });
    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.externalChange).toBe(true);
  });

  it('modify event does not mark dirty buffer', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/proj/a.rs', content: 'orig', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().switchTo(id);
    useBuffers.getState().setActiveContent('edited');
    handleEvent({ kind: 'modify', path: 'C:/proj/a.rs' });
    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.externalChange).toBe(false);
  });

  it('create event in expanded subtree calls refreshSubtree', () => {
    useWorkspace.setState({
      expanded: new Set<string>(['C:/proj']),
      childrenByPath: new Map([['C:/proj', []]]),
    } as never);
    const spy = vi.spyOn(useWorkspace.getState(), 'refreshSubtree').mockResolvedValue();
    handleEvent({ kind: 'create', path: 'C:/proj/new.rs' });
    expect(spy).toHaveBeenCalledWith('C:/proj');
    spy.mockRestore();
  });

  it('create event in collapsed subtree does nothing', () => {
    // expanded is empty AND childrenByPath does not contain 'C:/proj/sub'.
    const spy = vi.spyOn(useWorkspace.getState(), 'refreshSubtree').mockResolvedValue();
    handleEvent({ kind: 'create', path: 'C:/proj/sub/new.rs' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to see failure**

```powershell
npm test -- fs-watcher
```

Expected: FAIL — `src/lib/fs-watcher.ts` doesn't exist (or `handleEvent` isn't exported).

- [ ] **Step 3: Create `src/lib/fs-watcher.ts`**

```ts
import { listen } from '@tauri-apps/api/event';
import { watchStart, watchStop, type FsEventPayload } from './tauri';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';

let unlistenEvent: (() => void) | null = null;
let unlistenError: (() => void) | null = null;

function dirname(p: string): string {
  const lastFwd = p.lastIndexOf('/');
  const lastBwd = p.lastIndexOf('\\');
  const idx = Math.max(lastFwd, lastBwd);
  return idx > 0 ? p.slice(0, idx) : p;
}

export function handleEvent(e: FsEventPayload) {
  const ws = useWorkspace.getState();
  const parent = dirname(e.path);
  const isRootOrExpandedAndCached =
    ws.workspaceFolder !== null &&
    (parent === ws.workspaceFolder || ws.expanded.has(parent)) &&
    ws.childrenByPath.has(parent);
  if (isRootOrExpandedAndCached) {
    ws.refreshSubtree(parent).catch(() => {});
  }
  if (e.kind === 'modify' || e.kind === 'create') {
    const buf = useBuffers.getState().buffers.find((b) => b.path === e.path);
    if (buf && !buf.dirty) {
      useBuffers.getState().setExternalChange(buf.id, true);
    }
  }
}

export async function startFsWatcher(folder: string): Promise<void> {
  await stopFsWatcher();
  await watchStart(folder);
  const u1 = await listen<FsEventPayload>('fs:event', (ev) => handleEvent(ev.payload));
  const u2 = await listen<{ message: string }>('fs:error', (ev) => {
    useWorkspace.getState().setWatcherError(ev.payload.message);
  });
  unlistenEvent = u1;
  unlistenError = u2;
  useWorkspace.getState().setWatcherError(null);
}

export async function stopFsWatcher(): Promise<void> {
  if (unlistenEvent) { unlistenEvent(); unlistenEvent = null; }
  if (unlistenError) { unlistenError(); unlistenError = null; }
  await watchStop().catch(() => {});
}
```

- [ ] **Step 4: Run the tests**

```powershell
npm test -- fs-watcher
```

Expected: 4 PASS.

- [ ] **Step 5: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/fs-watcher.ts src/tests/fs-watcher.test.ts
git commit -m "fs-watcher: orchestrator + handleEvent dispatcher + 4 vitest cases"
```

---

## Task 9: App.tsx subscription wires watcher to workspace folder

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import**

Near the existing top-of-file imports in `src/App.tsx`, add:

```ts
import { startFsWatcher, stopFsWatcher } from './lib/fs-watcher';
```

- [ ] **Step 2: Add the subscription inside the main boot useEffect**

Find the existing boot useEffect (the one that calls `bootRestore()` and registers `useBuffers.subscribe`, `useWorkspace.subscribe`, `useWorkspace.subscribe(...recentFolders...)`, etc.).

Inside it, after the existing `const stopRecentWatcher = useWorkspace.subscribe((state, prev) => { … });` line, add:

```ts
const stopWatcherSync = useWorkspace.subscribe((state, prev) => {
  if (state.workspaceFolder !== prev.workspaceFolder) {
    if (state.workspaceFolder) {
      startFsWatcher(state.workspaceFolder).catch((err) =>
        console.warn('fs watcher start failed:', err)
      );
    } else {
      stopFsWatcher().catch(() => {});
    }
  }
});
```

In the cleanup return at the end of the same useEffect, add:

```ts
stopWatcherSync();
stopFsWatcher().catch(() => {});
```

The existing cleanup return already calls `stopJournal()`, `stopSessionWatcher()`, `stopWorkspaceWatcher()`, `stopRecentWatcher()`. Add the two new lines alongside.

- [ ] **Step 3: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean (per real `npx tsc` output, ignoring LSP noise); all vitest tests green.

- [ ] **Step 4: Commit**

```powershell
git add src/App.tsx
git commit -m "app: start/stop fs watcher in sync with workspaceFolder"
```

---

## Task 10: FileTreePanel surfaces `watcherError`

**Files:**
- Modify: `src/components/FileTreePanel.tsx`

- [ ] **Step 1: Add the warning row**

In `src/components/FileTreePanel.tsx`, read the `watcherError` from the store. Inside the existing component body, alongside the other `useWorkspace((s) => …)` selectors, add:

```ts
const watcherError = useWorkspace((s) => s.watcherError);
```

Find the existing JSX that renders the top bar (the row with the folder basename + `↻` button). RIGHT AFTER that row's closing `</div>`, add the warning row:

```tsx
{watcherError && (
  <div data-testid="fs-watcher-error" className="border-b border-amber-700 bg-amber-900/40 px-3 py-1 text-xs text-amber-200">
    Live updates unavailable — refresh manually.
    <button
      type="button"
      onClick={() => useWorkspace.getState().setWatcherError(null)}
      className="ml-2 text-amber-300 hover:text-amber-100"
    >×</button>
  </div>
)}
```

(`useWorkspace` should already be imported at the top of the file. If not, add `import { useWorkspace } from '../stores/workspace';`.)

- [ ] **Step 2: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean; vitest all green.

- [ ] **Step 3: Commit**

```powershell
git add src/components/FileTreePanel.tsx
git commit -m "ui: FileTreePanel surfaces watcherError as a dismissible warning row"
```

---

## Task 11: e2e test — write file → tree refreshes

**Files:**
- Create: `tests/e2e/fs-watcher.spec.ts`

- [ ] **Step 1: Create the spec**

`tests/e2e/fs-watcher.spec.ts`:

```ts
import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const FIXTURE_SRC = path.resolve(__dirname, 'fixtures', 'workspace');

function copyFixtureToTemp(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'memopad-fsw-'));
  function cp(src: string, dst: string) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) cp(s, d);
      else fs.copyFileSync(s, d);
    }
  }
  cp(FIXTURE_SRC, dest);
  return dest;
}

describe('fs-watcher', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = copyFixtureToTemp();
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadToggleSidebar?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
      const open = !!document.querySelector('[data-testid="sidebar"]');
      if (open) w.__memopadToggleSidebar?.();
    });
    await sleep(150);
  });

  afterEach(() => {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('tree auto-refreshes when a new file is created externally', async () => {
    // Open sidebar + set workspace + wait for watcher.
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(workspace)}); return undefined;`,
    );
    await sleep(500); // root list_dir + watcher start

    // Sanity: no row named new-from-test.txt yet.
    const before = await classicExecute<number>(
      `let n = 0;
       document.querySelectorAll('[data-testid="tree-row"]').forEach((r) => {
         if ((r.textContent || '').includes('new-from-test.txt')) n++;
       });
       return n;`,
    );
    expect(before).to.equal(0);

    // Write a file externally.
    fs.writeFileSync(path.join(workspace, 'new-from-test.txt'), 'hello');

    // 200ms debounce + IPC + React.
    await sleep(900);

    const after = await classicExecute<number>(
      `let n = 0;
       document.querySelectorAll('[data-testid="tree-row"]').forEach((r) => {
         if ((r.textContent || '').includes('new-from-test.txt')) n++;
       });
       return n;`,
    );
    expect(after).to.be.greaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Type-check e2e**

```powershell
npx tsc -p tsconfig.e2e.json --noEmit 2>&1
```

Expected: same baseline `TransformReturn<T>` pattern (one new instance for this file only).

- [ ] **Step 3: DO NOT run `npm run e2e`** — defer to Task 12.

- [ ] **Step 4: Commit**

```powershell
git add tests/e2e/fs-watcher.spec.ts
git commit -m "e2e: fs-watcher tree auto-refresh on external file create"
```

---

## Task 12: Gates + results doc

**Files:**
- Create: `docs/superpowers/plans/v2-fs-watcher-results.md`

- [ ] **Step 1: tsc + vitest + cargo**

```powershell
npx tsc --noEmit
npm test
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib
cd ..
```

Capture:
- vitest total (expected ~79 = 73 baseline + 4 fs-watcher + 2 workspace-watcher)
- cargo total (expected ~86 = 75 baseline + 11 watcher: 6 mapping + 5 lifecycle)

- [ ] **Step 2: Release build**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture MSI + app.exe sizes. Slice-4 baseline: MSI ~6.43 MB, app.exe ~15.80 MB. `notify` family is small (~300 KB).

- [ ] **Step 3: Skip `npm run e2e`** — defer to manual verification.

- [ ] **Step 4: Write results doc**

Create `docs/superpowers/plans/v2-fs-watcher-results.md`:

```markdown
# v2 FS Watcher — Results

## Automated test gates

- Vitest: <N> tests passing (baseline 73; +4 fs-watcher + 2 workspace-watcher = 79 expected)
- cargo test: <N> tests passing (baseline 75; +11 watcher = 86 expected)
- e2e (WebdriverIO): spec written (1 test); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: <X.XX> MB (slice-4 baseline 6.43 MB)
- app.exe size: <X.XX> MB (slice-4 baseline 15.80 MB)

## What shipped

- `src-tauri/src/watcher.rs` — `notify-debouncer-full` wrapper, `map_debounced_event` helper, `start` / `start_with_sender` / `stop`, 11 tests
- New Tauri commands: `watch_start`, `watch_stop`; state `WatcherHandle`
- `src/lib/fs-watcher.ts` — `handleEvent` dispatcher + `startFsWatcher` / `stopFsWatcher` orchestrators
- `src/stores/workspace.ts` gained `watcherError` + `setWatcherError`
- `src/App.tsx` subscribes to `workspaceFolder` and starts/stops the watcher
- `src/components/FileTreePanel.tsx` renders a dismissible warning row when `watcherError` is set

## What is intentionally NOT in this slice

- Watching files outside the workspace folder
- Heartbeat / watcher-died detection
- Reload-on-modify auto-action (banner shows; user picks)
- Per-subfolder watcher lifecycle
- Rename event coalescing (surfaces as separate Remove + Create)
- Buffer-side flag on `remove` (Phase 4 focus rescan handles this)

## Follow-ups (next v2 slices)

1. File-tree right-click context menu
2. Backref-aware replace preview in Snippet
3. Split view
```

Fill in the actual numbers.

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/v2-fs-watcher-results.md
git commit -m "v2 fs watcher: record results"
```

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec section | Covered by |
| --- | --- |
| `notify` + `notify-debouncer-full` deps | Task 1 |
| `WatcherHandle`, `FsEventKind`, `FsEventPayload` types | Task 2 |
| `map_debounced_event` rules + tests | Task 3 |
| `start` / `start_with_sender` / `stop` impl | Task 4 |
| 5 live-fs watcher tests | Task 4 |
| Tauri command + state registration | Task 5 |
| TS IPC wrappers + payload type | Task 6 |
| Workspace store `watcherError` | Task 7 |
| `handleEvent` dispatcher (tree + buffer paths) | Task 8 |
| `startFsWatcher` / `stopFsWatcher` orchestrators | Task 8 |
| 4 dispatcher vitest cases | Task 8 |
| 2 workspace-watcher vitest cases | Task 7 |
| App.tsx subscription wiring start/stop | Task 9 |
| FileTreePanel warning row | Task 10 |
| 1 e2e test | Task 11 |
| Gates + results doc | Task 12 |

**Placeholder scan:** None.

**Type / signature consistency:**
- Rust `FsEventKind { Create, Remove, Modify }` matches TS `'create' | 'remove' | 'modify'` via `#[serde(rename_all = "lowercase")]`.
- Rust `FsEventPayload { kind, path }` matches TS `FsEventPayload { kind, path }`.
- `map_debounced_event(&DebouncedEvent) -> Option<FsEventPayload>` consistent between Task 2 stub and Task 3 impl.
- `start_with_sender(handle, folder, sender)` signature consistent between Task 2 stub, Task 4 impl, and Task 4 tests.
- `start(handle, folder, app)` signature consistent across Tasks 2/4/5.
- `stop(handle)` consistent.
- TS `handleEvent(e: FsEventPayload): void` consistent between definition (Task 8) and tests (Task 8).
- `startFsWatcher(folder: string)` / `stopFsWatcher()` consistent between definition (Task 8) and consumer (Task 9).
- Event name strings: `'fs:event'` and `'fs:error'` consistent between Rust emit sites (Task 4) and TS listeners (Task 8).

**Notes for executor:**
- `notify-debouncer-full` 0.3 with `notify` 6 is the documented combo. If `cargo check` fails after Task 1 with a version-mismatch error, the executor should consult the crate README and pick compatible versions; report back if a different pair is needed.
- The `Debouncer<RecommendedWatcher, FileIdMap>` generic parameters come from `notify-debouncer-full`'s public API. If a future crate version changes the second generic, adjust the `WatcherHandle` definition and `start`/`stop` mutex slot type to match.
- Task 4's live-fs tests have intrinsic flakiness on slow CI runners (debouncer needs ≥200ms to coalesce + filesystem sync). The 2-second per-test deadline + drain loop give 10x headroom; tighten only if tests start failing.
- The `tauri::Emitter` trait import in Task 4's `start()` (line `use tauri::{AppHandle, Emitter};` in the module preamble) is required for `app.emit(...)`. Don't drop the `Emitter` import even if the IDE flags it as unused — it's a trait whose methods are in scope only via the import.
- Task 9 adds two new lines to App.tsx's cleanup return. The current cleanup return has multiple `stop*()` calls from earlier slices. Add `stopWatcherSync();` and `stopFsWatcher().catch(() => {});` alongside, preserving the existing ones.
