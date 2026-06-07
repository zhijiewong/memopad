# Watcher-Died Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the "Live updates unavailable" banner when the fs-watcher fails to start or the workspace folder becomes inaccessible (currently both fail silently).

**Architecture:** Two frontend detectors set the existing `useWorkspace.watcherError`: `startFsWatcher` catches a `watchStart` rejection; a focus-time `checkWatcherAlive` probes the workspace folder via `statFile`. No Rust changes; reuses the existing banner + recovery.

**Tech Stack:** React 18 + TS, Zustand, Tauri events; Vitest + WebdriverIO/Mocha.

Spec: `docs/superpowers/specs/2026-06-03-watcher-died-design.md`

---

## File Structure

- **Modify** `src/lib/fs-watcher.ts` — catch start failure; add `checkWatcherAlive`.
- **Modify** `src/App.tsx` — call `checkWatcherAlive` on focus.
- **Create** `src/tests/watcher-died.test.ts` — unit tests.
- **Create** `tests/e2e/watcher-died.spec.ts` — e2e.
- **Modify** version files + `CHANGELOG.md` — 0.11.0.

---

## Task 1: fs-watcher — start-failure handling + liveness probe

**Files:**
- Modify: `src/lib/fs-watcher.ts`
- Create: `src/tests/watcher-died.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/watcher-died.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../lib/tauri', () => ({
  watchStart: vi.fn(),
  watchStop: vi.fn().mockResolvedValue(undefined),
  statFile: vi.fn(),
}));

import { watchStart, statFile } from '../lib/tauri';
import { startFsWatcher, checkWatcherAlive } from '../lib/fs-watcher';
import { useWorkspace } from '../stores/workspace';

const mWatchStart = watchStart as unknown as ReturnType<typeof vi.fn>;
const mStatFile = statFile as unknown as ReturnType<typeof vi.fn>;

describe('watcher death detection', () => {
  beforeEach(() => {
    useWorkspace.getState().setWatcherError(null);
    vi.clearAllMocks();
  });

  it('startFsWatcher sets the banner when watch_start rejects', async () => {
    mWatchStart.mockRejectedValueOnce(new Error('path does not exist'));
    await startFsWatcher('C:/nope');
    expect(useWorkspace.getState().watcherError).to.be.a('string');
  });

  it('startFsWatcher clears the banner when watch_start succeeds', async () => {
    useWorkspace.getState().setWatcherError('stale');
    mWatchStart.mockResolvedValueOnce(undefined);
    await startFsWatcher('C:/ok');
    expect(useWorkspace.getState().watcherError).toBeNull();
  });

  it('checkWatcherAlive sets the banner when statFile rejects (folder gone)', async () => {
    mStatFile.mockRejectedValueOnce(new Error('missing'));
    await checkWatcherAlive('C:/gone');
    expect(useWorkspace.getState().watcherError).to.be.a('string');
  });

  it('checkWatcherAlive leaves the banner untouched when the folder exists', async () => {
    mStatFile.mockResolvedValueOnce({ mtime_ms: 1, size: 2 });
    await checkWatcherAlive('C:/here');
    expect(useWorkspace.getState().watcherError).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/watcher-died.test.ts`
Expected: FAIL — `checkWatcherAlive` is not exported (and start-failure not handled).

- [ ] **Step 3: Implement**

In `src/lib/fs-watcher.ts`, add `statFile` to the `./tauri` import:

```ts
import { watchStart, watchStop, statFile, type FsEventPayload } from './tauri';
```

Replace `startFsWatcher` with a version that catches the start failure:

```ts
export async function startFsWatcher(folder: string): Promise<void> {
  await stopFsWatcher();
  try {
    await watchStart(folder);
  } catch {
    useWorkspace.getState().setWatcherError(
      'Live updates unavailable — couldn’t start the file watcher. Refresh manually.',
    );
    return;
  }
  const u1 = await listen<FsEventPayload>('fs:event', (ev) => handleEvent(ev.payload));
  const u2 = await listen<{ message: string }>('fs:error', (ev) => {
    useWorkspace.getState().setWatcherError(ev.payload.message);
  });
  unlistenEvent = u1;
  unlistenError = u2;
  useWorkspace.getState().setWatcherError(null);
}
```

Add the liveness probe at the end of the file:

```ts
/**
 * Focus-time liveness check: if the watched folder is no longer accessible the
 * watcher is effectively dead (notify often stops silently), so surface the banner.
 */
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

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/tests/watcher-died.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fs-watcher.ts src/tests/watcher-died.test.ts
git commit -m "feat(watcher): surface start failure + folder-liveness probe"
```

---

## Task 2: App — check liveness on window focus

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import the helper**

In `src/App.tsx`, extend the existing `./lib/fs-watcher` import to include `checkWatcherAlive`. The current import is:

```ts
import { startFsWatcher, stopFsWatcher } from './lib/fs-watcher';
```

Change it to:

```ts
import { startFsWatcher, stopFsWatcher, checkWatcherAlive } from './lib/fs-watcher';
```

- [ ] **Step 2: Probe on focus**

In the boot `useEffect`, the focus listener currently reads:

```ts
    const unlistenFocusP = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) rescanExternalChanges().catch(() => {});
    });
```

Change it to also probe the watcher when a workspace is open:

```ts
    const unlistenFocusP = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        rescanExternalChanges().catch(() => {});
        const folder = useWorkspace.getState().workspaceFolder;
        if (folder) checkWatcherAlive(folder).catch(() => {});
      }
    });
```

(`useWorkspace` is already imported in `App.tsx`.)

- [ ] **Step 3: Verify types + no regressions**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; vitest green. (Trust tsc, not the LSP.)

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): probe watcher liveness on window focus"
```

---

## Task 3: e2e — start failure shows the banner

**Files:**
- Create: `tests/e2e/watcher-died.spec.ts`

The Rust `watch_start` returns `Err` for a non-existent path, so pointing the workspace at a
bogus folder exercises the start-failure detector end-to-end.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/watcher-died.spec.ts`:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('watcher died', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadToggleSidebar?: () => void;
        __memopadShowFilesPanel?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
      if (!document.querySelector('[data-testid="sidebar"]')) w.__memopadToggleSidebar?.();
      w.__memopadShowFilesPanel?.();
    });
    await sleep(200);
  });

  it('shows the live-updates-unavailable banner when the watcher cannot start', async () => {
    // A non-existent workspace path: watch_start rejects → startFsWatcher sets the banner.
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace('C:/memopad-no-such-folder-xyz-12345'); return undefined;`,
    );
    await sleep(700);

    const hasBanner = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="fs-watcher-error"]');`,
    );
    expect(hasBanner, 'fs-watcher-error banner should appear').to.equal(true);
  });
});
```

- [ ] **Step 2: Note on running**

Run the whole suite at the end (Task 5). Single spec: `npx mocha --grep "watcher died"` (expect 1 passing).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/watcher-died.spec.ts
git commit -m "test(e2e): watcher start-failure banner"
```

---

## Task 4: Version bump + CHANGELOG (0.11.0)

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump versions to 0.11.0**

- `package.json`: `"version": "0.10.0"` → `"0.11.0"`.
- `src-tauri/Cargo.toml`: the `[package]` `version = "0.10.0"` → `"0.11.0"`.
- `src-tauri/tauri.conf.json`: `"version": "0.10.0"` → `"0.11.0"`.

- [ ] **Step 2: Sync Cargo.lock**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
(Refreshes the `app` entry in `Cargo.lock` to 0.11.0. Trailing signing-key error is benign.)

- [ ] **Step 3: Add CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add:

```markdown
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
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all green.

- [ ] **Step 5: Commit**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: bump to 0.11.0 + changelog for watcher-died detection"
```

---

## Task 5: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: all green (no Rust changes; unchanged count).

- [ ] **Step 2: TS typecheck + unit tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all green.

- [ ] **Step 3: Release build + full e2e**

Run (Bash tool):
```bash
rm -f src-tauri/target/release/app.exe
npm run tauri build || echo "unsigned build exit tolerated"
test -f src-tauri/target/release/app.exe
npx mocha
```
Expected: full suite green, including the new `watcher died` test.

- [ ] **Step 4: Manual GUI smoke**

Per the GUI-verification practice: drive the real WebView via the e2e harness + `saveScreenshot`.
Point the workspace at a bogus path, screenshot the Files panel showing the
"Live updates unavailable" banner. (Throwaway smoke spec; delete it + the PNGs after viewing.)

- [ ] **Step 5: Final commit (only if smoke fixups were needed)** — otherwise nothing to commit.

---

## Self-Review notes

- **Spec coverage:** start-failure handling (T1), `checkWatcherAlive` (T1), focus probe (T2), e2e (T3), version+changelog (T4), GUI smoke (T5). All spec sections map to tasks.
- **Type consistency:** `startFsWatcher(folder)` / `checkWatcherAlive(folder)` / `stopFsWatcher()`; `statFile` import; `setWatcherError`. Used identically across tasks.
- **Gotchas captured:** the focus probe is guarded on `workspaceFolder` being set; `checkWatcherAlive` only SETS the banner (never auto-clears — recovery is the existing restart/dismiss path); the e2e relies on Rust `watch_start` rejecting for a non-existent path; FileTreePanel renders (so the banner can show) only when a workspace folder is set, which the bogus path satisfies.
```
