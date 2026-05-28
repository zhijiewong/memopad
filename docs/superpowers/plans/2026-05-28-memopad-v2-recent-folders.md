# Memopad v2 — Recent Folders

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the last 10 opened workspace folders in `SessionState`, surface them as dynamic command palette entries, and add `Ctrl+R` to open the palette pre-filtered to those entries.

**Architecture:** Extends the existing `SessionState` Rust struct with `recent_folders: Vec<String>` (backward-compat via `#[serde(default)]`). The frontend `useWorkspace` store gains `recentFolders` state + push/remove/setRecent actions; `openFolder` calls `pushRecentFolder` after setting the workspace. A new `registerRecentFolderCommands` helper in `builtins.ts` reregisters `workspace.recent.*` palette entries whenever the list changes. `Ctrl+R` opens the palette with the query pre-set to `Open Recent: ` via a new `__memopadOpenPaletteWithQuery` window hook.

**Tech Stack:** Tauri 2, Rust (serde), React + Zustand. No new dependencies.

**Spec section reference:** `docs/superpowers/specs/2026-05-28-recent-folders-design.md` (all sections).

---

## File Structure

```
memopad/
├── src-tauri/
│   └── src/
│       └── session.rs               MODIFY — add recent_folders field + 2 tests
├── src/
│   ├── lib/
│   │   ├── tauri.ts                 MODIFY — extend SessionState TS interface
│   │   └── boot.ts                  MODIFY — call setRecent from session
│   ├── stores/
│   │   └── workspace.ts             MODIFY — recentFolders state + 3 actions; openFolder pushes
│   ├── commands/
│   │   └── builtins.ts              MODIFY — workspace.openRecent command + registerRecentFolderCommands helper
│   ├── components/
│   │   └── CommandPalette.tsx       MODIFY — accept initialQuery prop
│   ├── App.tsx                      MODIFY — persistSession includes recent_folders, presetQuery state, store subscription, Ctrl+R keybinding, test hook
│   └── tests/
│       ├── workspace-recent.test.ts CREATE — 4 vitest cases
│       └── commands.test.ts         MODIFY — registerRecentFolderCommands case
└── tests/e2e/
    └── recent-folders.spec.ts       CREATE — 1 e2e test
```

Boundary intent:
- **`session.rs`** owns the persisted format. One field added.
- **`workspace.ts`** owns the in-memory MRU list + dedup/move-to-front/cap logic.
- **`builtins.ts`** owns command registration (including the dynamic helper).
- **`App.tsx`** is the integration point: persist + boot + subscribe + bind shortcut + expose test hook.

---

## Task 1: `SessionState.recent_folders` field + tests

**Files:**
- Modify: `src-tauri/src/session.rs`

- [ ] **Step 1: Extend the struct + Default impl**

In `src-tauri/src/session.rs`, change the existing `SessionState`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionState {
    pub tabs: Vec<TabEntry>,
    pub active_id: Option<String>,
    #[serde(default)]
    pub workspace_folder: Option<String>,
    #[serde(default)]
    pub recent_folders: Vec<String>,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            tabs: Vec::new(),
            active_id: None,
            workspace_folder: None,
            recent_folders: Vec::new(),
        }
    }
}
```

- [ ] **Step 2: Update existing `SessionState { ... }` literals**

Search the file for `SessionState {` (excluding `SessionState::default()` calls):

```powershell
findstr /N "SessionState {" src-tauri\src\session.rs
```

Each literal needs `recent_folders: Vec::new(),` added. Likely sites are the existing tests `round_trip_via_save_then_load`, `round_trips_workspace_folder`, and `save_overwrites_previous`. Add the field.

- [ ] **Step 3: Append two new backward-compat tests inside the existing `#[cfg(test)] mod tests` block**

```rust
#[test]
fn loads_old_session_without_recent_folders() {
    let dir = tmp();
    // Legacy JSON: no recent_folders field. workspace_folder may also be absent;
    // include it to test that the new field defaults even when other defaults are present.
    let legacy = r#"{"tabs":[{"buffer_id":"b1","path":"/a.txt"}],"active_id":"b1","workspace_folder":"C:\\proj"}"#;
    std::fs::write(session_path(&dir), legacy).unwrap();
    let loaded = load_at(&dir);
    assert_eq!(loaded.recent_folders, Vec::<String>::new());
    assert_eq!(loaded.workspace_folder, Some("C:\\proj".into()));
    assert_eq!(loaded.tabs.len(), 1);
}

#[test]
fn round_trips_recent_folders() {
    let dir = tmp();
    let state = SessionState {
        tabs: vec![],
        active_id: None,
        workspace_folder: None,
        recent_folders: vec!["C:\\a".into(), "C:\\b".into()],
    };
    save_at(&dir, &state).unwrap();
    assert_eq!(load_at(&dir).recent_folders, vec!["C:\\a".to_string(), "C:\\b".to_string()]);
}
```

- [ ] **Step 4: Run session tests**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib session::
cd ..
```

Expected: all session tests PASS (6 existing + 2 new = 8).

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/session.rs
git commit -m "session: add recent_folders field (backward-compatible)"
```

---

## Task 2: Extend `SessionState` TS interface

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add the field to the interface**

In `src/lib/tauri.ts`, find the existing `SessionState` interface (it has `tabs`, `active_id`, `workspace_folder?`). Change it to:

```ts
export interface SessionState {
  tabs: TabEntry[];
  active_id: string | null;
  workspace_folder?: string | null;
  recent_folders?: string[];
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
git commit -m "tauri: SessionState TS interface gains recent_folders"
```

---

## Task 3: `useWorkspace` recent-folders state + actions

**Files:**
- Modify: `src/stores/workspace.ts`
- Create: `src/tests/workspace-recent.test.ts`

- [ ] **Step 1: Create failing tests at `src/tests/workspace-recent.test.ts`**

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
    lastQuery: '',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    expanded: new Set<string>(),
    childrenByPath: new Map(),
    loadingByPath: new Set<string>(),
    recentFolders: [],
  } as never);
  vi.clearAllMocks();
});

describe('useWorkspace recent folders', () => {
  it('pushRecentFolder dedups case-insensitively', () => {
    useWorkspace.getState().pushRecentFolder('C:/proj');
    useWorkspace.getState().pushRecentFolder('c:\\proj');
    expect(useWorkspace.getState().recentFolders).toEqual(['c:\\proj']);
  });

  it('pushRecentFolder moves an existing entry to the front', () => {
    useWorkspace.getState().pushRecentFolder('C:/a');
    useWorkspace.getState().pushRecentFolder('C:/b');
    useWorkspace.getState().pushRecentFolder('C:/a');
    expect(useWorkspace.getState().recentFolders).toEqual(['C:/a', 'C:/b']);
  });

  it('pushRecentFolder caps at 10', () => {
    for (let i = 0; i < 12; i++) useWorkspace.getState().pushRecentFolder(`C:/p${i}`);
    expect(useWorkspace.getState().recentFolders.length).toBe(10);
    expect(useWorkspace.getState().recentFolders[0]).toBe('C:/p11');
    expect(useWorkspace.getState().recentFolders[9]).toBe('C:/p2');
  });

  it('removeRecentFolder removes case-insensitively', () => {
    useWorkspace.getState().pushRecentFolder('C:/a');
    useWorkspace.getState().pushRecentFolder('C:/b');
    useWorkspace.getState().removeRecentFolder('c:\\a');
    expect(useWorkspace.getState().recentFolders).toEqual(['C:/b']);
  });
});
```

- [ ] **Step 2: Run to see failure**

```powershell
npm test -- workspace-recent
```

Expected: FAIL — `pushRecentFolder` / `removeRecentFolder` don't exist.

- [ ] **Step 3: Edit `src/stores/workspace.ts`**

3a. Extend the `WorkspaceState` interface — add inside the existing definition:

```ts
recentFolders: string[];

pushRecentFolder: (path: string) => void;
removeRecentFolder: (path: string) => void;
setRecent: (list: string[]) => void;
```

3b. Add the initial value inside the `create<WorkspaceState>((set, get) => ({ ... }))` block, near the existing initial values:

```ts
recentFolders: [],
```

3c. Add the three new action implementations inside the same block. Place them near the existing `setFolder` action (anywhere is fine; group with related):

```ts
pushRecentFolder(path) {
  const cur = get().recentFolders;
  const lower = path.toLowerCase();
  const filtered = cur.filter((p) => p.toLowerCase() !== lower);
  const next = [path, ...filtered].slice(0, 10);
  set({ recentFolders: next });
},

removeRecentFolder(path) {
  const lower = path.toLowerCase();
  set({ recentFolders: get().recentFolders.filter((p) => p.toLowerCase() !== lower) });
},

setRecent(list) {
  set({ recentFolders: list.slice(0, 10) });
},
```

3d. Modify the existing `openFolder` action to call `pushRecentFolder` after setting the folder. Find the existing implementation. Inside the `if (typeof picked === 'string') { ... }` block, after the `set({ workspaceFolder: picked, ... })` call, add:

```ts
get().pushRecentFolder(picked);
```

- [ ] **Step 4: Run the tests**

```powershell
npm test -- workspace-recent
```

Expected: all 4 PASS. Also run all workspace tests:

```powershell
npm test -- workspace
```

Expected: existing 14 + 4 new = 18 PASS.

- [ ] **Step 5: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add src/stores/workspace.ts src/tests/workspace-recent.test.ts
git commit -m "workspace: recentFolders state + push/remove/setRecent actions"
```

---

## Task 4: Boot rehydrate + persist via session

**Files:**
- Modify: `src/lib/boot.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update `boot.ts` to rehydrate recentFolders**

In `src/lib/boot.ts`, find the existing call to `useWorkspace.getState().setFolder(session.workspace_folder ?? null)`. AFTER that line, add:

```ts
useWorkspace.getState().setRecent(session.workspace_folder ? [session.workspace_folder, ...(session.recent_folders ?? [])].filter((p, i, arr) => arr.findIndex((x) => x.toLowerCase() === p.toLowerCase()) === i).slice(0, 10) : (session.recent_folders ?? []));
```

That one-liner is intentionally simple: if there's a workspace folder in the session, it gets pinned to position 0 of recents and the rest are deduped against it. If no workspace, just set the persisted list.

Actually, that's hard to read. Replace with this clearer version:

```ts
const fromSession = session.recent_folders ?? [];
const wf = session.workspace_folder;
if (wf) {
  const lower = wf.toLowerCase();
  const filtered = fromSession.filter((p) => p.toLowerCase() !== lower);
  useWorkspace.getState().setRecent([wf, ...filtered].slice(0, 10));
} else {
  useWorkspace.getState().setRecent(fromSession);
}
```

Also fix the fallback `sessionLoad().catch(...)` block. Currently it returns `{ tabs: [], active_id: null, workspace_folder: null }`. Change it to also include `recent_folders: []`:

```ts
return { tabs: [], active_id: null, workspace_folder: null, recent_folders: [] };
```

- [ ] **Step 2: Update `App.tsx` `persistSession` to include recent_folders**

In `src/App.tsx`, find the existing `persistSession` function. Modify it to also include `recent_folders`:

```ts
function persistSession() {
  const state = useBuffers.getState();
  const folder = useWorkspace.getState().workspaceFolder;
  const recent = useWorkspace.getState().recentFolders;
  scheduleSessionSave({
    tabs: state.buffers.map((b) => ({ buffer_id: b.id, path: b.path })),
    active_id: state.activeId,
    workspace_folder: folder,
    recent_folders: recent,
  });
}
```

- [ ] **Step 3: Add `useWorkspace` subscription to App.tsx so persistSession runs when recents change**

In `src/App.tsx`, find the existing `useBuffers.subscribe(() => { persistSession(); ... })` line in the main boot useEffect. Right after it, add a parallel workspace subscription:

```ts
const stopWorkspaceWatcher = useWorkspace.subscribe(() => {
  persistSession();
});
```

Update the existing cleanup return at the end of the useEffect to also stop the new subscription:

```ts
return () => {
  stopJournal();
  stopSessionWatcher();
  stopWorkspaceWatcher();
  unlistenFocusP.then((un) => un()).catch(() => {});
};
```

(If `stopWorkspaceWatcher` is named differently in your existing code, adapt — the point is to cleanly cancel the subscription on unmount.)

- [ ] **Step 4: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean (real `npx tsc` output, ignoring LSP false positives); vitest all green.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/boot.ts src/App.tsx
git commit -m "app: persist + rehydrate recent_folders via session"
```

---

## Task 5: `workspace.openRecent` command + `Ctrl+R` keybinding

**Files:**
- Modify: `src/commands/builtins.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Register the command in `registerBuiltins()`**

Append to the end of the `registerBuiltins()` function in `src/commands/builtins.ts`:

```ts
register({
  id: 'workspace.openRecent',
  title: 'Open Recent Folder…',
  shortcut: 'Ctrl+R',
  run: () => {
    (window as unknown as { __memopadOpenPaletteWithQuery?: (q: string) => void })
      .__memopadOpenPaletteWithQuery?.('Open Recent: ');
  },
});
```

- [ ] **Step 2: Wire `Ctrl+R` in `App.tsx`**

In `src/App.tsx`, find the existing keydown ladder inside the `onKey` function. Locate the `if (key === 'b' && !e.shiftKey)` branch (Ctrl+B for sidebar). Right AFTER it, add:

```ts
if (key === 'r' && !e.shiftKey) {
  e.preventDefault();
  runCommand('workspace.openRecent');
  return;
}
```

- [ ] **Step 3: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean; vitest all green.

- [ ] **Step 4: Commit**

```powershell
git add src/commands/builtins.ts src/App.tsx
git commit -m "commands: workspace.openRecent + Ctrl+R keybinding"
```

---

## Task 6: CommandPalette accepts `initialQuery`; App.tsx wires the window hook

**Files:**
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the `initialQuery` prop**

Open `src/components/CommandPalette.tsx`. Find the existing `interface Props { onClose: ...; onRun: ... }` definition and add the new optional prop:

```ts
interface Props {
  onClose: () => void;
  onRun: (id: string) => void;
  initialQuery?: string;
}
```

Find the existing `export function CommandPalette({ onClose, onRun }: Props)` and update the destructure:

```ts
export function CommandPalette({ onClose, onRun, initialQuery = '' }: Props) {
```

Find the existing `const [query, setQuery] = useState('')` and seed it with `initialQuery`:

```ts
const [query, setQuery] = useState(initialQuery);
```

- [ ] **Step 2: Add `presetQuery` state + window hook in `App.tsx`**

In `src/App.tsx`, near the existing `const [paletteOpen, setPaletteOpen] = useState(false)`, add:

```ts
const [presetQuery, setPresetQuery] = useState('');
```

Inside the existing useEffect that defines window hooks (the one with `__memopadToggleSidebar`), add:

```ts
(window as unknown as { __memopadOpenPaletteWithQuery?: (q: string) => void }).__memopadOpenPaletteWithQuery = (q: string) => {
  setPresetQuery(q);
  setPaletteOpen(true);
};
```

In the JSX, find the existing `{paletteOpen && <CommandPalette onClose={...} onRun={...} />}` line. Update to pass `initialQuery` and reset on close:

```tsx
{paletteOpen && (
  <CommandPalette
    onClose={() => { setPaletteOpen(false); setPresetQuery(''); }}
    onRun={runCommand}
    initialQuery={presetQuery}
  />
)}
```

- [ ] **Step 3: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean; vitest all green.

- [ ] **Step 4: Commit**

```powershell
git add src/components/CommandPalette.tsx src/App.tsx
git commit -m "ui: CommandPalette accepts initialQuery; App wires __memopadOpenPaletteWithQuery"
```

---

## Task 7: `registerRecentFolderCommands` helper + commands.test.ts case

**Files:**
- Modify: `src/commands/builtins.ts`
- Modify: `src/tests/commands.test.ts`

- [ ] **Step 1: Add the failing test to `src/tests/commands.test.ts`**

Append a new `describe` block at the bottom of `src/tests/commands.test.ts`:

```ts
import { registerRecentFolderCommands } from '../commands/builtins';

describe('registerRecentFolderCommands', () => {
  it('replaces previous workspace.recent.* entries', () => {
    const { register, commands: initialCommands } = useCommands.getState();
    // Pre-seed a stale recent command.
    register({ id: 'workspace.recent.0', title: 'Old', run: () => {} });
    register({ id: 'workspace.recent.1', title: 'Older', run: () => {} });

    registerRecentFolderCommands(['C:/proj/foo', 'C:/proj/bar']);

    const final = useCommands.getState().commands;
    const recents = final.filter((c) => c.id.startsWith('workspace.recent.'));
    expect(recents.length).toBe(2);
    expect(recents[0].title).toBe('Open Recent: foo');
    expect(recents[1].title).toBe('Open Recent: bar');
    // Original commands intact:
    expect(final.length).toBeGreaterThanOrEqual(initialCommands.length);
  });
});
```

If `useCommands` isn't already imported at the top of the test file, add:

```ts
import { useCommands } from '../commands/registry';
```

- [ ] **Step 2: Run to confirm failure**

```powershell
npm test -- commands
```

Expected: FAIL — `registerRecentFolderCommands` not exported.

- [ ] **Step 3: Add the helper to `src/commands/builtins.ts`**

Export the helper at the top level of the file (outside `registerBuiltins`):

```ts
export function registerRecentFolderCommands(paths: string[]) {
  const { commands, register, unregister } = useCommands.getState();
  // Unregister previous dynamic recents.
  for (const c of commands) {
    if (c.id.startsWith('workspace.recent.')) unregister(c.id);
  }
  // Register fresh ones.
  paths.forEach((p, i) => {
    const basename = p.split(/[/\\]/).filter(Boolean).pop() ?? p;
    register({
      id: `workspace.recent.${i}`,
      title: `Open Recent: ${basename}`,
      run: async () => {
        const { useWorkspace } = await import('../stores/workspace');
        const { statFile } = await import('../lib/tauri');
        try {
          await statFile(p);
        } catch {
          useWorkspace.getState().removeRecentFolder(p);
          console.warn(`Recent folder no longer exists: ${p}`);
          return;
        }
        useWorkspace.getState().setFolder(p);
        useWorkspace.getState().pushRecentFolder(p);
      },
    });
  });
}
```

- [ ] **Step 4: Run the tests**

```powershell
npm test -- commands
```

Expected: all PASS (5 existing + 1 new = 6).

- [ ] **Step 5: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add src/commands/builtins.ts src/tests/commands.test.ts
git commit -m "commands: registerRecentFolderCommands helper + test"
```

---

## Task 8: Wire `registerRecentFolderCommands` to the workspace store

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Register recents on boot + subscribe**

In `src/App.tsx`, find the existing first boot useEffect (the one with `bootRestore().then(...)`). After the existing `.then((/* recordStatsForBuffersWithoutOne */) => ...)` chain (i.e., after `bootRestore` resolves), call the helper:

Modify the existing block:

```ts
bootRestore()
  .then(() => recordStatsForBuffersWithoutOne())
  .catch((err) => console.error('boot failed:', err));
```

to:

```ts
bootRestore()
  .then(() => recordStatsForBuffersWithoutOne())
  .then(() => {
    registerRecentFolderCommands(useWorkspace.getState().recentFolders);
  })
  .catch((err) => console.error('boot failed:', err));
```

And add an import at the top of `App.tsx`:

```ts
import { registerRecentFolderCommands } from './commands/builtins';
```

- [ ] **Step 2: Subscribe to recentFolders changes**

Inside the same boot useEffect, after the existing `useBuffers.subscribe(...)` call, add:

```ts
const stopRecentWatcher = useWorkspace.subscribe((state, prev) => {
  if (state.recentFolders !== prev.recentFolders) {
    registerRecentFolderCommands(state.recentFolders);
  }
});
```

Update the cleanup return at the end of the useEffect:

```ts
return () => {
  stopJournal();
  stopSessionWatcher();
  stopRecentWatcher();
  // …existing cleanups (stopWorkspaceWatcher if present, unlistenFocusP, etc.)
};
```

(Reconcile with the cleanup added in Task 4. If both subscriptions exist, both need to be cancelled.)

- [ ] **Step 3: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean; vitest all green.

- [ ] **Step 4: Commit**

```powershell
git add src/App.tsx
git commit -m "app: register recent folder commands on boot + on recentFolders change"
```

---

## Task 9: e2e test for recent folders

**Files:**
- Create: `tests/e2e/recent-folders.spec.ts`
- Modify: `src/App.tsx` (add `__memopadTestPushRecent` test hook)

- [ ] **Step 1: Add a test hook in `App.tsx`**

Near the bottom of `src/App.tsx`, alongside the existing `__memopadTestSetWorkspace` test hook, add:

```ts
(window as unknown as { __memopadTestPushRecent?: (folder: string) => void }).__memopadTestPushRecent = (folder: string) => {
  useWorkspace.getState().pushRecentFolder(folder);
};
```

- [ ] **Step 2: Create `tests/e2e/recent-folders.spec.ts`**

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('recent-folders', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
    });
    await sleep(150);
  });

  it('Ctrl+R opens palette pre-filtered with recent entries and clicking one sets workspace', async () => {
    // Seed two recents via the test hook.
    await classicExecute<void>(
      `window.__memopadTestPushRecent('C:/tmp/proj-alpha');
       window.__memopadTestPushRecent('C:/tmp/proj-beta');
       return undefined;`,
    );
    await sleep(150);
    // Press Ctrl+R.
    await getBrowser().keys(['Control', 'r']);
    await sleep(300);
    // Palette should be open with the query pre-filtered.
    const inputValue = await classicExecute<string>(
      `const i = document.querySelector('[data-testid="command-palette-input"]');
       return i ? i.value : '';`,
    );
    expect(inputValue).to.match(/^Open Recent: /);
    // At least one Open Recent entry should be visible.
    const entryCount = await classicExecute<number>(
      `const rows = document.querySelectorAll('[data-testid^="command-row-"]');
       let n = 0;
       rows.forEach((r) => { if ((r.textContent || '').includes('Open Recent:')) n++; });
       return n;`,
    );
    expect(entryCount).to.be.greaterThanOrEqual(1);
  });
});
```

NOTE: this test depends on the palette having `data-testid="command-palette-input"` on its input and `data-testid="command-row-<id>"` on each entry. If those test IDs don't exist in `src/components/CommandPalette.tsx`, the spec will not be runnable. Two options:
1. Add those `data-testid` attributes in `src/components/CommandPalette.tsx` as a no-op UI tweak in this task.
2. Replace the selectors with whatever attributes exist (e.g., look at `tests/e2e/palette.spec.ts` for the patterns already in use).

For safest delivery, do option 2: open `tests/e2e/palette.spec.ts` and adopt the same selectors. If that file uses CSS class or text-content selectors, mirror them here.

- [ ] **Step 3: Type-check e2e**

```powershell
npx tsc -p tsconfig.e2e.json --noEmit 2>&1
```

Expected: same `TransformReturn<T>` baseline error pattern as other spec files; +1 new instance for this file only.

- [ ] **Step 4: DO NOT run `npm run e2e`** — defer to Task 10.

- [ ] **Step 5: Commit**

```powershell
git add tests/e2e/recent-folders.spec.ts src/App.tsx
git commit -m "e2e: recent folders palette filter + Ctrl+R"
```

---

## Task 10: Gates + results doc

**Files:**
- Create: `docs/superpowers/plans/v2-recent-folders-results.md`

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
- vitest total (expected: ~73 = 68 baseline + 4 workspace-recent + 1 commands)
- cargo total (expected: 75 = 73 baseline + 2 session)

- [ ] **Step 2: Release build**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture MSI + app.exe sizes from `src-tauri/target/release/bundle/msi/Memopad_*.msi` and `src-tauri/target/release/app.exe`. Slice-3 baseline: MSI 6.42 MB, app.exe 15.80 MB. Recent folders adds near-zero Rust footprint.

- [ ] **Step 3: Skip `npm run e2e`** — defer to manual verification.

- [ ] **Step 4: Write results doc**

Create `docs/superpowers/plans/v2-recent-folders-results.md`:

```markdown
# v2 Recent Folders — Results

## Automated test gates

- Vitest: <N> tests passing (baseline 68; +4 workspace-recent + 1 commands ≈ 73 expected)
- cargo test: <N> tests passing (baseline 73; +2 session = 75 expected)
- e2e (WebdriverIO): spec written (1 test); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: <X.XX> MB (slice-3 baseline 6.42 MB)
- app.exe size: <X.XX> MB (slice-3 baseline 15.80 MB)

## What shipped

- `src-tauri/src/session.rs` gained `recent_folders: Vec<String>` (backward-compat via `#[serde(default)]`) + 2 tests
- `src/stores/workspace.ts` gained `recentFolders` + `pushRecentFolder` + `removeRecentFolder` + `setRecent`
- `src/commands/builtins.ts` gained `workspace.openRecent` command + `registerRecentFolderCommands` helper
- `src/components/CommandPalette.tsx` accepts `initialQuery` prop
- `src/App.tsx` wires the boot rehydration, persistence, Ctrl+R keybinding, palette pre-filter hook, and `__memopadTestPushRecent` test hook
- New window-level hook: `__memopadOpenPaletteWithQuery(q)`

## What is intentionally NOT in this slice

- Timestamps / per-entry metadata
- Pin / favorite individual entries
- Multi-folder workspaces or workspace nicknames
- Cross-machine sync
- Boot-time stat sweep (invalid entries drop on click)

## Follow-ups (next v2 slices)

1. fs watcher (notify crate) for auto-refresh
2. File-tree right-click context menu (Reveal in Explorer, Copy path)
3. Split view
```

Fill in the actual numbers.

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/v2-recent-folders-results.md
git commit -m "v2 recent folders: record results"
```

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec section | Covered by |
| --- | --- |
| `SessionState.recent_folders` field + `#[serde(default)]` | Task 1 |
| Backward-compat tests | Task 1 |
| TS SessionState interface | Task 2 |
| `recentFolders` state + push/remove/setRecent actions | Task 3 |
| `openFolder` pushes recent | Task 3 (step 3d) |
| Boot rehydration with workspace-folder-at-front merge | Task 4 |
| Persist on workspace store changes | Task 4 |
| `workspace.openRecent` command + Ctrl+R | Task 5 |
| `CommandPalette` `initialQuery` prop + window hook | Task 6 |
| `registerRecentFolderCommands` helper | Task 7 |
| Wire helper to boot + subscription | Task 8 |
| 4 vitest tests for push/remove | Task 3 |
| 1 vitest test for command registration | Task 7 |
| 2 cargo session tests | Task 1 |
| 1 e2e test | Task 9 |
| Gates + results doc | Task 10 |

**Placeholder scan:** None.

**Type / signature consistency:**
- `recentFolders: string[]` matches TS interface in `SessionState` (`recent_folders?: string[]`) at the serde boundary; serde maps snake_case to camelCase via Tauri.
- `pushRecentFolder(path: string): void` consistent across interface, impl, tests, and consumers.
- `removeRecentFolder(path: string): void` consistent.
- `setRecent(list: string[]): void` consistent.
- `__memopadOpenPaletteWithQuery(q: string)` defined in Task 6, called by Task 5's command run handler.
- `__memopadTestPushRecent(folder: string)` defined in Task 9, called by Task 9's e2e spec.
- Command id `workspace.openRecent` consistent across registration (Task 5) and keybinding (Task 5).
- Dynamic ids `workspace.recent.${i}` consistent across registration (Task 7) and unregistration filter (Task 7).

**Notes for executor:**
- The store subscription in `App.tsx` runs on EVERY state change, not just `recentFolders`. The `state.recentFolders !== prev.recentFolders` reference check inside makes it cheap. Don't pre-optimize with `subscribeWithSelector` unless profiling shows it matters.
- `console.warn` for missing folders is acceptable for v1 (per spec). If you want a toast, the codebase doesn't have a global toast component — add one only as a follow-up, not as part of this slice.
- The `data-testid` attributes for the palette input + rows referenced in Task 9 might not exist. The spec note in Step 2 says to mirror whatever selectors `tests/e2e/palette.spec.ts` uses. Confirm before implementing the e2e selectors.
- Task 4 step 3 and Task 8 step 2 both touch the same cleanup return in `App.tsx`'s boot useEffect. Reconcile them: ensure both `stopWorkspaceWatcher` (Task 4) AND `stopRecentWatcher` (Task 8) are present. Alternatively, since Task 4's `stopWorkspaceWatcher` runs `persistSession` on every workspace change (which includes `recentFolders` change), AND Task 8's `stopRecentWatcher` runs `registerRecentFolderCommands` on `recentFolders` change, they are NOT redundant — keep both. If you choose to consolidate, ensure both effects happen on every relevant change.
