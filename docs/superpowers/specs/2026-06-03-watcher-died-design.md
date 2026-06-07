# Watcher-Died Detection — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 0.11.0

## Problem

The fs-watcher keeps the file tree live. Runtime watcher errors already surface (the Rust
`watcher::start` catches notify errors → emits `fs:error` → `fs-watcher.ts` sets
`watcherError` → the "Live updates unavailable" banner shows). But two **silent** deaths
bypass that path:

1. **Start failure** — `startFsWatcher` rejection is swallowed by `App.tsx`'s
   `.catch(console.warn)`. The watcher never started, but no banner shows, so the user
   believes live updates work.
2. **Watched folder vanishes after start** (deleted / renamed / drive unmounted). notify
   often stops delivering events without emitting an error; nothing detects it.

This closes both gaps, feeding the **existing** banner. Frontend-only, no Rust changes.

## Decisions (locked during brainstorming)

- Detect via **start-failure** + **focus-time folder-liveness** (no Rust heartbeat/health-ping).
- On detection, **surface the existing banner** + manual refresh; **no auto-restart**.
- **Reuse `statFile`** for the liveness probe (no new Rust command).

## Architecture

Two detectors set the existing `useWorkspace.watcherError`; the existing `FileTreePanel`
banner renders it; the existing `startFsWatcher` clears it on a (re)start.

### 1. Surface start failure — `src/lib/fs-watcher.ts`

`startFsWatcher(folder)` currently does `await watchStart(folder)` then sets up the
`fs:event` / `fs:error` listeners. Change it so a `watchStart` rejection is caught locally:

```ts
export async function startFsWatcher(folder: string): Promise<void> {
  // ... existing stop-previous logic ...
  try {
    await watchStart(folder);
  } catch {
    useWorkspace.getState().setWatcherError(
      'Live updates unavailable — couldn’t start the file watcher. Refresh manually.',
    );
    return; // do not register listeners; there's no watcher
  }
  // existing: clear watcherError, register fs:event / fs:error listeners
}
```

`App.tsx`'s existing `.catch((err) => console.warn(...))` on the `startFsWatcher` call stays
as a backstop (it now rarely fires, since the rejection is handled inside).

### 2. Liveness probe on focus — `src/lib/fs-watcher.ts` + `src/App.tsx`

New exported helper:

```ts
export async function checkWatcherAlive(folder: string): Promise<void> {
  try {
    await statFile(folder);
  } catch {
    useWorkspace.getState().setWatcherError(
      'Live updates unavailable — the workspace folder is no longer accessible. Refresh manually.',
    );
  }
}
```

Call it from the **existing** `onFocusChanged` handler in `App.tsx` (which already calls
`rescanExternalChanges` on focus). When the window regains focus and a workspace is open:

```ts
const unlistenFocusP = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (focused) {
    rescanExternalChanges().catch(() => {});
    const folder = useWorkspace.getState().workspaceFolder;
    if (folder) checkWatcherAlive(folder).catch(() => {});
  }
});
```

`statFile` resolves for an existing directory and rejects for a missing path, so a vanished
workspace root sets the banner. (It does not auto-clear when alive — the banner is cleared by
the watcher restart path or the user's × / refresh.)

### 3. Recovery (unchanged)

- `startFsWatcher` already calls `setWatcherError(null)` on a successful (re)start.
- The banner's × dismiss + the tree's refresh button already exist.
- Re-opening the folder (or any `workspaceFolder` change) restarts the watcher via the existing
  `useWorkspace.subscribe` → `startFsWatcher`, clearing the banner.

## Error handling / edge cases

| Case | Handling |
|------|----------|
| `watch_start` rejects (bad/inaccessible folder) | `startFsWatcher` sets the banner, skips listeners |
| Watched folder deleted/unmounted after start | Focus-time `checkWatcherAlive` → `statFile` rejects → banner |
| Folder returns, watcher not restarted | Banner persists (watcher really is dead) until folder re-opened |
| No workspace open | No probe (guarded on `workspaceFolder`); banner not shown (FileTreePanel returns null) |
| Genuine notify runtime error | Existing `fs:error` path still sets the banner (unchanged) |

## Testing strategy

- **vitest** (`src/tests/fs-watcher.test.ts`, extend): with `watchStart` mocked to reject,
  `startFsWatcher` sets `watcherError`; with `statFile` mocked to reject, `checkWatcherAlive`
  sets `watcherError`; with `statFile` resolving, `checkWatcherAlive` leaves it unchanged.
  (Mock `@tauri-apps/api/event` `listen` and the tauri bindings as the existing fs-watcher test
  does.)
- **e2e** (`tests/e2e/watcher-died.spec.ts`): set the workspace to a non-existent path via
  `__memopadTestSetWorkspace` (which triggers the `startFsWatcher` subscription) → assert the
  `[data-testid="fs-watcher-error"]` banner appears in the Files panel. Reset sidebar/tab state
  in `beforeEach`.

## Scope boundaries (YAGNI — non-goals)

- No Rust-side heartbeat / liveness-ping (won't detect the rare "handle died but folder still
  exists" case; folder removal is the dominant real silent death).
- No periodic interval polling (focus-time only).
- No auto-restart of the watcher.
- No new Rust command (reuses `statFile`).

## Release

Ships as **0.11.0**. CHANGELOG: Added/Fixed — the file tree now shows "Live updates
unavailable" when the watcher fails to start or the workspace folder becomes inaccessible
(previously these failed silently). Frontend-only. Version bump in `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
