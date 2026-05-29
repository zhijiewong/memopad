# FS Watcher — v2 Slice 5 Design

Date: 2026-05-29
Status: Approved (awaiting implementation plan)
Predecessors:
- `2026-05-27-find-in-files-design.md` (slice 1)
- `2026-05-28-file-tree-design.md` (slice 2; FileTreePanel + tree state)
- `2026-05-28-replace-in-files-design.md` (slice 3)
- `2026-05-28-recent-folders-design.md` (slice 4)

## Goal

Watch the workspace folder recursively with the `notify` crate so the file tree auto-refreshes when files appear/disappear and the external-change banner triggers without waiting for a window refocus. The existing Phase-4 focus-based stat rescan stays as a fallback.

## Non-goals (this slice)

- **Watching files outside the workspace.** Open buffers from other locations rely on Phase 4's focus rescan.
- **Heartbeat / watcher-died detection.** If notify silently dies, focus rescan still catches changes on refocus.
- **Reload-on-modify auto-action.** Banner shows; user picks Reload / Keep / Diff manually.
- **Per-subfolder watcher lifecycle.** One recursive watcher on the workspace root.
- **Rename event coalescing.** Renames surface as separate `remove` + `create` events; the dispatcher handles them as two ordinary events.
- **Buffer-side flag on `remove`.** Phase-4 focus rescan flags deletions; this slice covers `create` and `modify` only on the buffer side.

## Pillars

1. **`notify-debouncer-full` for cross-platform.** Wraps `notify` with a 200ms event coalescing window. Handles ReadDirectoryChangesW on Windows.
2. **One watcher per workspace.** `WatcherHandle` is a `Mutex<Option<Debouncer>>` held by `tauri::State`. Any new `watch_start` drops the prior one.
3. **Event split.** Each event drives two consumers on the frontend: tree refresh (per parent path) + buffer external-change flag (per matching open buffer that isn't dirty).
4. **Pure helper for testability.** `map_debounced_event(&DebouncedEvent) -> Option<FsEventPayload>` is a pure function so cargo tests don't need an `AppHandle`.

## Architecture

### Rust — new `src-tauri/src/watcher.rs` (~120 LOC + tests)

New deps in `src-tauri/Cargo.toml`:

```toml
notify = "6"
notify-debouncer-full = "0.3"
```

Public surface:

```rust
use std::path::PathBuf;
use std::sync::Mutex;

use notify::RecommendedWatcher;
use notify_debouncer_full::{Debouncer, DebouncedEvent, FileIdMap};
use serde::Serialize;
use tauri::AppHandle;

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

/// Pure helper: map a notify-debouncer event to our payload. Returns None
/// for events we don't surface (e.g. attribute-only changes, access events).
pub fn map_debounced_event(e: &DebouncedEvent) -> Option<FsEventPayload>;

/// Start a recursive watcher on `folder`. Drops any prior watcher.
/// Emits `fs:event` and `fs:error` Tauri events.
pub fn start(
    handle: &WatcherHandle,
    folder: PathBuf,
    app: AppHandle,
) -> Result<(), String>;

/// Test seam: start a watcher whose events go into the provided sender
/// instead of being emitted through the AppHandle. `start` is a thin wrapper.
pub fn start_with_sender(
    handle: &WatcherHandle,
    folder: PathBuf,
    sender: crossbeam_channel::Sender<FsEventPayload>,
) -> Result<(), String>;

/// Drop the current watcher (no-op if none).
pub fn stop(handle: &WatcherHandle) -> Result<(), String>;
```

`map_debounced_event` rules:
- `EventKind::Create(_)` → `FsEventKind::Create`
- `EventKind::Modify(ModifyKind::Data(_))` → `FsEventKind::Modify`
- `EventKind::Modify(ModifyKind::Name(_))` → emit nothing (rename pair handled via separate Create/Remove events from notify)
- `EventKind::Modify(ModifyKind::Metadata(_))` → emit nothing (attribute-only)
- `EventKind::Remove(_)` → `FsEventKind::Remove`
- Other kinds → None
- `event.paths.first()` is used as the path. If multiple paths (rare, e.g. rename's `From`/`To`), only the first is emitted; the rename pair fires separately via notify.

Tauri command wrappers in `lib.rs`:

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

State registration in `run()`:

```rust
.manage(watcher::WatcherHandle(std::sync::Mutex::new(None)))
```

And both commands appended to the `invoke_handler!` list.

### Frontend IPC + orchestrator

**`src/lib/tauri.ts`** additions:

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

**`src/lib/fs-watcher.ts`** (new, ~80 LOC):

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
  // Tree side
  const isRootOrExpandedAndCached =
    ws.workspaceFolder &&
    (parent === ws.workspaceFolder || ws.expanded.has(parent)) &&
    ws.childrenByPath.has(parent);
  if (isRootOrExpandedAndCached) {
    ws.refreshSubtree(parent).catch(() => {});
  }
  // Buffer side — only for create / modify
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

`handleEvent` is exported so tests can import and call it directly without registering a fake listener.

### Workspace store addition

`src/stores/workspace.ts`:

```ts
watcherError: string | null;
setWatcherError: (msg: string | null) => void;
```

Initial state `watcherError: null`. Action body:

```ts
setWatcherError(msg) {
  set({ watcherError: msg });
},
```

### App integration

`src/App.tsx` — inside the main boot useEffect, add:

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

And in cleanup:

```ts
stopWatcherSync();
stopFsWatcher().catch(() => {});
```

Also: when boot rehydrates a non-null `workspaceFolder` (via slice 1's `setFolder` call inside `bootRestore`), the subscription above will fire automatically because the state transitions from `null` (initial) to the rehydrated value. No special boot-time call needed.

### UI surfacing of watcher errors

`src/components/FileTreePanel.tsx` (small addition): above the existing tree list, render a yellow warning row when `watcherError` is non-null:

```tsx
{watcherError && (
  <div data-testid="fs-watcher-error" className="border-b border-amber-700 bg-amber-900/40 px-3 py-1 text-xs text-amber-200">
    Live updates unavailable — refresh manually.{' '}
    <button
      type="button"
      onClick={() => useWorkspace.getState().setWatcherError(null)}
      className="ml-2 text-amber-300 hover:text-amber-100"
    >×</button>
  </div>
)}
```

## Data flow

### Workspace folder opens
1. `useWorkspace.openFolder()` resolves → `workspaceFolder` transitions to `X`.
2. App.tsx subscription → `startFsWatcher(X)`.
3. `startFsWatcher` calls `watchStart(X)` IPC; on success registers `fs:event` and `fs:error` listeners and clears `watcherError`.
4. Rust `start()` locks the mutex, drops any prior `Debouncer`, builds a new one with 200ms timeout on `X` recursively, stores it.

### External file change while workspace is open
1. User saves `X/notes.txt` in another editor.
2. notify → debouncer → callback fires after ≤200ms with `Vec<DebouncedEvent>`.
3. Rust thread: for each event, `map_debounced_event` produces `FsEventPayload` (or `None`, which is skipped). Emits one `fs:event` per payload via `app.emit("fs:event", payload)`.
4. Frontend listener calls `handleEvent`:
   - Tree side: `parent = dirname(path)`. If parent is the workspace root OR in `expanded`, AND its children are cached, call `refreshSubtree(parent)`.
   - Buffer side (`create`/`modify` only): find buffer with matching path. If found and not dirty, set `externalChange: true`. ExternalChangeBanner reads this and renders.

### Watcher error mid-stream
1. notify emits an error.
2. Rust callback emits `fs:error { message }`.
3. Frontend `fs:error` listener calls `setWatcherError(msg)`.
4. FileTreePanel renders the yellow warning row.

### Workspace folder closes
1. `closeFolder()` → `workspaceFolder: null`.
2. App.tsx subscription → `stopFsWatcher()`.
3. Frontend listeners unregistered. `watchStop()` IPC. Rust drops the debouncer.

### App shutdown
1. App.tsx useEffect cleanup → `stopWatcherSync()` + `stopFsWatcher()`.
2. Process exit → state drops.

## Error handling

| Scenario | Behavior |
| --- | --- |
| `watch_start` on a nonexistent folder | `debouncer.watch()` returns Err → `start()` returns `Err(String)` → `startFsWatcher` catches → `setWatcherError(msg)` shown in FileTreePanel. |
| Workspace folder deleted while watching | notify emits an error → `fs:error` event → `watcherError` set. Tree continues with cached children; manual refresh surfaces folder-missing via slice 2's existing path. |
| Permission denied on a subfolder | Per-path error from notify → surfaced via `fs:error`. Watcher continues for other paths. |
| Watcher backend silently dies | No detection in this slice. Phase 4 focus rescan catches updates on refocus. Future heartbeat as follow-up. |
| Rapid repeated `watch_start` calls | Mutex serializes; each `start()` drops the prior debouncer. No leak. |
| Event for path outside workspace (symlink escape) | `dirname(path)` won't match any expanded parent and won't match any buffer. Quietly dropped. |
| Non-UTF-8 path bytes (Windows) | Lossy conversion at the emit boundary. Buffer match fails for such files; tree refresh still fires for the parent. Acceptable. |
| Dirty buffer + external modify | Skipped on the buffer side. Save flow handles conflict. |
| `remove` event on an open buffer | Buffer side skipped. Phase 4 focus rescan catches deletions on refocus and flags externalChange. |
| Coalesced burst (git checkout) | Debouncer batches into ≤200ms windows. Tree may refresh several times for distinct parents; idempotent. |
| `closeFolder` during in-flight `refreshSubtree` | Async result writes to a workspace that's already closed → React renders nothing or empty state. Harmless. |
| Listener registration race | Microsecond window between `watchStart` IPC return and `listen()` registration. Events in that window are missed but they correspond to actions that just happened (e.g., user just opened the folder) and re-fire naturally on next change. |

## Testing

### Rust — `src-tauri/src/watcher.rs` (target 5 tests)

Tests use `crossbeam_channel` to capture events without an `AppHandle`.

- `start_returns_err_for_nonexistent_path` — `start(...).is_err()`.
- `start_then_stop_drops_watcher` — `start`, assert mutex is `Some`; `stop`, assert mutex is `None`.
- `emits_create_event_when_file_is_added` — start with sender; write a file; recv within 1s; assert `kind: Create` and matching path.
- `emits_modify_event_when_file_is_written` — same setup; pre-create file; rewrite contents; recv `Modify`.
- `emits_remove_event_when_file_is_deleted` — same setup; pre-create file; delete; recv `Remove`.

Each test uses a fresh tempdir and uses `start_with_sender` to avoid the AppHandle dependency. A small `sleep(Duration::from_millis(400))` between the fs action and the `recv_timeout` gives the debouncer time to coalesce.

### Vitest — `src/tests/fs-watcher.test.ts` (target 4 cases)

Mocks `@tauri-apps/api/event`'s `listen` (returns a no-op unlisten) and `@tauri-apps/api/core` `invoke`. Tests call `handleEvent` directly with synthetic payloads.

- `modify_event_marks_open_buffer_externalChange`
- `modify_event_does_not_mark_dirty_buffer`
- `create_event_in_expanded_subtree_calls_refreshSubtree` (spy on `useWorkspace.getState().refreshSubtree`)
- `create_event_in_collapsed_subtree_does_nothing` (assert spy NOT called)

### Vitest — `src/tests/workspace-watcher.test.ts` (target 2 cases)

- `setWatcherError_sets_and_clears`
- `setWatcherError_persists_across_other_state_updates`

### WebdriverIO e2e — `tests/e2e/fs-watcher.spec.ts` (target 1 test)

Copies the slice-1 fixture to a temp dir, sets it as the workspace via `__memopadTestSetWorkspace`, waits 500ms for the watcher to start, writes `<tempdir>/new-from-test.txt` from the Node side, waits 600ms (200ms debounce + IPC + React), asserts a `[data-testid="tree-row"]` with text `new-from-test.txt` is visible.

### Gates to ship

- vitest: 73 → ~79 (+4 fs-watcher + 2 workspace-watcher)
- cargo test: 75 → 80 (+5 watcher)
- e2e: 10 → 11 (+1 fs-watcher)
- `tsc --noEmit` clean
- Manual smoke: open Memopad's source folder, edit a file in another editor, observe the external-change banner appear without refocusing Memopad. Also: create a new file in a subfolder while it's expanded, observe it appear in the tree.

## Risks and open questions

- **`notify-debouncer-full` API stability.** Version 0.3 ships with notify 6. If the API has shifted between releases, the `Debouncer<RecommendedWatcher, FileIdMap>` generic instantiation may differ. The plan will pin both versions; if the executor finds the types don't match, they should consult the crate's README and adjust.
- **Test seam via `start_with_sender`.** Adds a tiny bit of public surface area solely for tests. Acceptable; the alternative (mocking `AppHandle`) is far worse.
- **Tree refresh granularity.** We re-fetch the parent's whole listing on every event. For a folder with 10k entries, that's wasteful — but the existing slice-2 file tree caps practical use to small/medium folders anyway. Optimize only if profiling shows it matters.
- **Heartbeat / liveness.** Deferred. If users report missed changes, add a periodic `watch_ping` Tauri command that asks Rust whether the debouncer is still alive.
- **Rename surfacing.** notify reports renames as a pair of Remove + Create. The dispatcher handles each ordinarily. Downsides: if the user renames `foo.txt` → `bar.txt`, the open buffer for `foo.txt` won't be auto-rerouted to `bar.txt` (existing buffer keeps its old path). Acceptable for v1 — Memopad doesn't currently auto-track renames on its own buffers either.
