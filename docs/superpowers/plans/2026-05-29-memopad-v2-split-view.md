# Memopad v2 — Split View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a horizontal two-pane split to the editor area, toggled by `Ctrl+\`. The focused pane is the target of all buffer-related commands (save, close, next/prev, find). Tab strip clicks update the focused pane. Same-buffer-in-both-panes shares cursor and scroll.

**Architecture:** Three new fields on `useBuffers` (`splitActive`, `secondaryId`, `focusedPane`) plus three new actions (`toggleSplit`, `setFocusedPane`, `setFocusedBuffer`) and a `focusedBufferId` derived selector. `Editor.tsx` is refactored into an orchestrator that mounts one or two `<EditorPane>`s side-by-side. Existing call sites that read `activeId` are audited and migrated to `focusedBufferId` where they reflect "current user-targeted buffer."

**Tech Stack:** React + Zustand + CodeMirror 6. No new dependencies.

**Spec section reference:** `docs/superpowers/specs/2026-05-29-split-view-design.md` (all sections).

---

## File Structure

```
memopad/
├── src/
│   ├── stores/
│   │   └── buffers.ts                MODIFY — state + actions + closeBuffer fallback + selectFocused selector
│   ├── components/
│   │   ├── Editor.tsx                MODIFY — orchestrator that mounts 1 or 2 EditorPanes
│   │   ├── EditorPane.tsx            CREATE — extracted CodeMirror + search-panel + jump glue, parameterized by bufferId
│   │   ├── TabStrip.tsx              MODIFY — highlight focusedBufferId, click calls setFocusedBuffer
│   │   ├── ExternalChangeBanner.tsx  MODIFY — reads focused buffer instead of active
│   │   └── StatusBar.tsx             MODIFY — reads focused buffer for cursor/encoding/eol display
│   ├── commands/
│   │   └── builtins.ts               MODIFY — tab.next/prev + tab.close + file.save target focused; new view.toggleSplit
│   ├── App.tsx                       MODIFY — Ctrl+\ keybinding
│   └── tests/
│       └── buffers.test.ts           MODIFY — 5 new vitest cases
└── tests/e2e/
    └── split-view.spec.ts            CREATE — 1 e2e: Ctrl+\ shows two panes
```

Boundary intent:
- **`buffers.ts`** owns the state shape + actions. `selectFocused(state)` is the derived selector all consumers use.
- **`EditorPane.tsx`** owns one CodeMirror instance + the search-panel + the `__memopadJumpEditor` window hook, all gated by `focused`. Multiple instances can coexist.
- **`Editor.tsx`** is a thin orchestrator: ExternalChangeBanner (once, for focused buffer) + SearchStrip (once, targeting focused pane) + one or two `<EditorPane>`s + a divider when split.
- **`TabStrip` / `StatusBar` / `ExternalChangeBanner`** are dumb consumers of the focused buffer.

---

## Task 1: Store fields + initial values + `selectFocused` selector + 5 vitest cases

**Files:**
- Modify: `src/stores/buffers.ts`
- Modify: `src/tests/buffers.test.ts`

- [ ] **Step 1: Append the 5 failing tests at the bottom of `src/tests/buffers.test.ts`**

```ts
describe('split view', () => {
  it('toggleSplit enables split with secondary mirroring primary and focuses secondary', () => {
    useBuffers.setState({
      buffers: [],
      activeId: null,
      recentlyClosed: [],
      splitActive: false,
      secondaryId: null,
      focusedPane: 'primary',
    } as never, true);
    const id = useBuffers.getState().newBuffer();
    useBuffers.getState().toggleSplit();
    expect(useBuffers.getState().splitActive).toBe(true);
    expect(useBuffers.getState().secondaryId).toBe(id);
    expect(useBuffers.getState().focusedPane).toBe('secondary');
  });

  it('toggleSplit disables split and focuses primary', () => {
    useBuffers.setState({
      buffers: [],
      activeId: 'b1',
      recentlyClosed: [],
      splitActive: true,
      secondaryId: 'b1',
      focusedPane: 'secondary',
    } as never, true);
    useBuffers.getState().toggleSplit();
    expect(useBuffers.getState().splitActive).toBe(false);
    expect(useBuffers.getState().secondaryId).toBeNull();
    expect(useBuffers.getState().focusedPane).toBe('primary');
  });

  it('setFocusedBuffer with primary focus updates activeId', () => {
    useBuffers.setState({
      buffers: [],
      activeId: 'b1',
      recentlyClosed: [],
      splitActive: true,
      secondaryId: 'b2',
      focusedPane: 'primary',
    } as never, true);
    useBuffers.getState().setFocusedBuffer('b3');
    expect(useBuffers.getState().activeId).toBe('b3');
    expect(useBuffers.getState().secondaryId).toBe('b2');
  });

  it('setFocusedBuffer with secondary focus updates secondaryId', () => {
    useBuffers.setState({
      buffers: [],
      activeId: 'b1',
      recentlyClosed: [],
      splitActive: true,
      secondaryId: 'b2',
      focusedPane: 'secondary',
    } as never, true);
    useBuffers.getState().setFocusedBuffer('b3');
    expect(useBuffers.getState().activeId).toBe('b1');
    expect(useBuffers.getState().secondaryId).toBe('b3');
  });

  it('closeBuffer secondary falls back to primary', () => {
    const aId = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: '', encoding: 'utf-8', eol: 'lf',
    });
    const bId = useBuffers.getState().openBuffer({
      path: 'C:/b.txt', content: '', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.setState({
      activeId: aId,
      splitActive: true,
      secondaryId: bId,
      focusedPane: 'secondary',
    } as never);
    useBuffers.getState().closeBuffer(bId);
    expect(useBuffers.getState().secondaryId).toBe(aId);
  });
});
```

- [ ] **Step 2: Run — should FAIL on the first test (`splitActive` doesn't exist)**

```powershell
npm test -- buffers
```

Expected: FAIL.

- [ ] **Step 3: Extend `BuffersState` interface in `src/stores/buffers.ts`**

Find the existing `interface BuffersState { … }` definition. Add the new fields and actions (place near the existing `activeId` field and `switchTo` action):

```ts
splitActive: boolean;
secondaryId: string | null;
focusedPane: 'primary' | 'secondary';

toggleSplit: () => void;
setFocusedPane: (p: 'primary' | 'secondary') => void;
setFocusedBuffer: (id: string) => void;
```

- [ ] **Step 4: Add the initial state values inside the `create<BuffersState>((set, get) => ({ ... }))` block**

Near the existing `activeId: null,` line, add:

```ts
splitActive: false,
secondaryId: null,
focusedPane: 'primary',
```

- [ ] **Step 5: Add the three new actions inside the same block**

Place them near the existing `switchTo` action:

```ts
toggleSplit: () => {
  set((s) => {
    if (!s.splitActive) {
      return { splitActive: true, secondaryId: s.activeId, focusedPane: 'secondary' };
    }
    return { splitActive: false, secondaryId: null, focusedPane: 'primary' };
  });
},

setFocusedPane: (p) => {
  set((s) => {
    if (!s.splitActive && p === 'secondary') return s; // defensive
    return { focusedPane: p };
  });
},

setFocusedBuffer: (id) => {
  set((s) => {
    if (s.focusedPane === 'primary') return { activeId: id };
    return { secondaryId: id };
  });
},
```

- [ ] **Step 6: Modify `closeBuffer` to handle secondaryId fallback**

Find the existing `closeBuffer` action. After the existing logic that sets `activeId` to a fallback when the closed buffer was active, add a parallel fallback for `secondaryId`. Replace the current implementation's body with:

```ts
closeBuffer: (id) => {
  set((s) => {
    const next = s.buffers.filter((b) => b.id !== id);
    const closed = s.buffers.find((b) => b.id === id);
    const recent = closed
      ? [closed, ...s.recentlyClosed].slice(0, RECENT_CAP)
      : s.recentlyClosed;
    let nextActive: string | null = s.activeId;
    if (s.activeId === id) {
      nextActive = next[0]?.id ?? null;
    }
    let nextSecondary: string | null = s.secondaryId;
    if (s.secondaryId === id) {
      // Fallback to whatever primary is now (after primary's own fallback).
      nextSecondary = nextActive;
    }
    return { buffers: next, activeId: nextActive, secondaryId: nextSecondary, recentlyClosed: recent };
  });
},
```

If the existing closeBuffer impl differs (e.g. uses different variable names or has a different fallback policy), preserve its semantics for `activeId` and ONLY add the `nextSecondary` fallback alongside.

- [ ] **Step 7: Add the `selectFocused` selector at the bottom of `src/stores/buffers.ts`**

Below the existing `selectActive` export:

```ts
/** Convenience selector for the focused buffer (the one user actions target). */
export function selectFocused(state: BuffersState): Buffer | null {
  const id = state.focusedPane === 'primary' ? state.activeId : state.secondaryId;
  if (id == null) return null;
  return state.buffers.find((b) => b.id === id) ?? null;
}

/** Convenience selector for the focused buffer ID. */
export function selectFocusedId(state: BuffersState): string | null {
  return state.focusedPane === 'primary' ? state.activeId : state.secondaryId;
}
```

- [ ] **Step 8: Run the tests**

```powershell
npm test -- buffers
```

Expected: all 5 new tests PASS + existing buffer tests still PASS.

- [ ] **Step 9: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 10: Commit**

```powershell
git add src/stores/buffers.ts src/tests/buffers.test.ts
git commit -m "buffers: split view state + actions + selectFocused"
```

---

## Task 2: Extract `EditorPane.tsx` from `Editor.tsx`

**Files:**
- Create: `src/components/EditorPane.tsx`
- Modify: `src/components/Editor.tsx`

This is a refactor that DOES NOT change behavior. The result is a single-pane editor that takes a `bufferId` prop instead of reading `activeId` directly. Tests should still pass identically.

- [ ] **Step 1: Read the current `src/components/Editor.tsx` fully**

Read all of `src/components/Editor.tsx` so you understand the existing component. It currently:
- Reads `selectActive(state)` from `useBuffers` to get the active buffer
- Mounts a CodeMirror instance for that buffer
- Renders `<ExternalChangeBanner />`
- Renders `<SearchStrip />`
- Registers `window.__memopadSearchPanel` and `window.__memopadJumpEditor`

- [ ] **Step 2: Create `src/components/EditorPane.tsx`**

Move the CodeMirror + search-panel + jump-editor logic into `EditorPane`. The pane takes:
- `bufferId: string | null` (which buffer to render — replaces the `selectActive` lookup)
- `focused: boolean` (controls whether this pane registers the `__memopadSearchPanel` / `__memopadJumpEditor` window hooks)
- `onFocus: () => void` (called on mouse-down anywhere inside the pane)

The exact code is a copy of the current `Editor` component with three changes:

1. Replace `const active = useBuffers((s) => selectActive(s));` with reading the buffer for `bufferId`:
   ```ts
   const bufferId = props.bufferId;
   const buffer = useBuffers((s) => bufferId == null ? null : s.buffers.find((b) => b.id === bufferId) ?? null);
   ```
   Use `buffer` throughout the rest of the component instead of `active`.

2. Wrap the registration of `window.__memopadSearchPanel` and `window.__memopadJumpEditor` in `if (props.focused)` — only the focused pane should register these hooks. Use the existing `useEffect` cleanup to unregister when this pane loses focus.

3. Wrap the outermost JSX container in:
   ```tsx
   <div
     data-testid="editor-pane"
     onMouseDown={props.onFocus}
     className={`flex flex-1 flex-col w-full ${props.focused ? '' : 'opacity-90'}`}
   >
     {/* existing JSX */}
   </div>
   ```

The `<ExternalChangeBanner />` and `<SearchStrip />` are NOT rendered inside `EditorPane` — those belong to the orchestrator in Editor.tsx (single instance each).

- [ ] **Step 3: Slim `Editor.tsx` down to the orchestrator**

Replace the contents of `src/components/Editor.tsx` with:

```tsx
import { useState } from 'react';
import { useBuffers, selectFocused } from '../stores/buffers';
import { EditorPane } from './EditorPane';
import { ExternalChangeBanner } from './ExternalChangeBanner';
import { SearchStrip, type SearchStripActions } from './SearchStrip';

interface SearchPanelState {
  open: boolean;
  mode: 'find' | 'replace';
}

declare global {
  // eslint-disable-next-line no-var
  var __memopadSearchPanel: {
    open: (mode: 'find' | 'replace') => void;
    close: () => void;
    setFindQuery: (q: string) => void;
    setReplaceQuery: (q: string) => void;
    applySearch: (find: string, replace: string) => { current: number; total: number };
    runReplaceAll: () => number;
  } | undefined;
}

export function Editor() {
  const splitActive = useBuffers((s) => s.splitActive);
  const activeId = useBuffers((s) => s.activeId);
  const secondaryId = useBuffers((s) => s.secondaryId);
  const focusedPane = useBuffers((s) => s.focusedPane);
  const setFocusedPane = useBuffers((s) => s.setFocusedPane);

  const focused = useBuffers((s) => selectFocused(s));

  // SearchStrip state lives at this level — single instance regardless of split.
  const [searchPanel, setSearchPanel] = useState<SearchPanelState>({ open: false, mode: 'find' });
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [actions, setActions] = useState<SearchStripActions | null>(null);

  // Bridge between EditorPane (which exposes actions when focused) and the
  // SearchStrip rendered here. EditorPane will set the global window helpers;
  // we read `actions` from a window helper registered by the focused pane.
  // The orchestrator just needs to render the SearchStrip; the actions
  // reference is updated by EditorPane via a setter we pass down.

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {focused && focused.externalChange && (
        <ExternalChangeBanner />
      )}
      <SearchStrip
        open={searchPanel.open}
        mode={searchPanel.mode}
        actions={actions}
        onClose={() => setSearchPanel((s) => ({ ...s, open: false }))}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        replaceText={replaceText}
        onReplaceChange={setReplaceText}
      />
      {splitActive ? (
        <div data-testid="editor-split" className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 w-full">
            <EditorPane
              bufferId={activeId}
              focused={focusedPane === 'primary'}
              onFocus={() => setFocusedPane('primary')}
              setSearchActions={setActions}
              searchPanelState={searchPanel}
              setSearchPanelState={setSearchPanel}
              searchQuery={searchQuery}
              replaceText={replaceText}
            />
          </div>
          <div className="w-px bg-neutral-700" />
          <div className="flex flex-1 w-full">
            <EditorPane
              bufferId={secondaryId}
              focused={focusedPane === 'secondary'}
              onFocus={() => setFocusedPane('secondary')}
              setSearchActions={setActions}
              searchPanelState={searchPanel}
              setSearchPanelState={setSearchPanel}
              searchQuery={searchQuery}
              replaceText={replaceText}
            />
          </div>
        </div>
      ) : (
        <EditorPane
          bufferId={activeId}
          focused={true}
          onFocus={() => {}}
          setSearchActions={setActions}
          searchPanelState={searchPanel}
          setSearchPanelState={setSearchPanel}
          searchQuery={searchQuery}
          replaceText={replaceText}
        />
      )}
    </div>
  );
}
```

NOTE: this orchestrator pulls the SearchStrip state up out of the per-pane component. The `EditorPane` props include `setSearchActions` (a setter the focused pane calls when its CM mount provides `SearchStripActions`) and the panel state setters (so EditorPane can open the strip from inside its CM keybindings if needed).

If the existing `Editor.tsx` uses different prop names or has a more complex SearchStrip wiring, ADAPT — but the principle is the same: SearchStrip is a single instance that drives the focused pane.

- [ ] **Step 4: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean (real output; ignore LSP noise); all vitest tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/Editor.tsx src/components/EditorPane.tsx
git commit -m "editor: extract EditorPane; orchestrator renders 1 or 2 panes"
```

---

## Task 3: `TabStrip.tsx` highlights and updates focused buffer

**Files:**
- Modify: `src/components/TabStrip.tsx`

- [ ] **Step 1: Add the `selectFocusedId` import**

In `src/components/TabStrip.tsx`, change the existing import:

```ts
import { useBuffers } from '../stores/buffers';
```

to:

```ts
import { useBuffers, selectFocusedId } from '../stores/buffers';
```

- [ ] **Step 2: Replace `activeId` and `switchTo` reads**

Find the existing lines (around line 14-15):

```ts
const activeId = useBuffers((s) => s.activeId);
const switchTo = useBuffers((s) => s.switchTo);
```

Change to:

```ts
const focusedId = useBuffers((s) => selectFocusedId(s));
const setFocusedBuffer = useBuffers((s) => s.setFocusedBuffer);
```

- [ ] **Step 3: Update the `isActive` check and the click handler**

Find the existing `const isActive = b.id === activeId;` line. Change to:

```ts
const isActive = b.id === focusedId;
```

Find the existing `onClick={() => switchTo(b.id)}` attribute. Change to:

```ts
onClick={() => setFocusedBuffer(b.id)}
```

- [ ] **Step 4: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean; all vitest tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/components/TabStrip.tsx
git commit -m "ui: TabStrip targets focused buffer instead of activeId"
```

---

## Task 4: `ExternalChangeBanner` and `StatusBar` read focused buffer

**Files:**
- Modify: `src/components/ExternalChangeBanner.tsx`
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Update `ExternalChangeBanner.tsx`**

Open `src/components/ExternalChangeBanner.tsx`. Find the existing import that pulls `selectActive`:

```ts
import { useBuffers, selectActive } from '../stores/buffers';
```

Change to:

```ts
import { useBuffers, selectFocused } from '../stores/buffers';
```

Inside the component body, change every reference to `selectActive` → `selectFocused`. Example:

```ts
const active = useBuffers((s) => selectActive(s));
```

becomes:

```ts
const active = useBuffers((s) => selectFocused(s));
```

(Leave the local variable name `active` unchanged — that's just the local identifier.)

- [ ] **Step 2: Update `StatusBar.tsx`**

Open `src/components/StatusBar.tsx`. Apply the same rename: any `selectActive` → `selectFocused`, and any `useBuffers((s) => s.activeId)` → `useBuffers((s) => selectFocusedId(s))` if the file uses `activeId` directly. Add `selectFocusedId` to the import if needed.

- [ ] **Step 3: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean; all vitest tests pass.

- [ ] **Step 4: Commit**

```powershell
git add src/components/ExternalChangeBanner.tsx src/components/StatusBar.tsx
git commit -m "ui: ExternalChangeBanner + StatusBar read focused buffer"
```

---

## Task 5: Update built-in commands to target focused buffer

**Files:**
- Modify: `src/commands/builtins.ts`

- [ ] **Step 1: Replace `activeId` reads with `selectFocusedId`**

In `src/commands/builtins.ts`, find every occurrence of:

```ts
const id = useBuffers.getState().activeId;
```

Replace with:

```ts
const id = selectFocusedId(useBuffers.getState());
```

And update the existing tab.next / tab.prev commands. Find the existing implementations:

```ts
register({
  id: 'tab.next',
  title: 'Tab: Next',
  shortcut: 'Ctrl+Tab',
  run: () => {
    const { buffers, activeId } = useBuffers.getState();
    if (buffers.length === 0) return;
    const idx = buffers.findIndex((b) => b.id === activeId);
    const next = (idx + 1) % buffers.length;
    useBuffers.getState().switchTo(buffers[next].id);
  },
});

register({
  id: 'tab.prev',
  title: 'Tab: Previous',
  shortcut: 'Ctrl+Shift+Tab',
  run: () => {
    const { buffers, activeId } = useBuffers.getState();
    if (buffers.length === 0) return;
    const idx = buffers.findIndex((b) => b.id === activeId);
    const prev = (idx - 1 + buffers.length) % buffers.length;
    useBuffers.getState().switchTo(buffers[prev].id);
  },
});
```

Replace BOTH with:

```ts
register({
  id: 'tab.next',
  title: 'Tab: Next',
  shortcut: 'Ctrl+Tab',
  run: () => {
    const state = useBuffers.getState();
    const focusedId = selectFocusedId(state);
    if (state.buffers.length === 0) return;
    const idx = state.buffers.findIndex((b) => b.id === focusedId);
    const next = (idx + 1) % state.buffers.length;
    useBuffers.getState().setFocusedBuffer(state.buffers[next].id);
  },
});

register({
  id: 'tab.prev',
  title: 'Tab: Previous',
  shortcut: 'Ctrl+Shift+Tab',
  run: () => {
    const state = useBuffers.getState();
    const focusedId = selectFocusedId(state);
    if (state.buffers.length === 0) return;
    const idx = state.buffers.findIndex((b) => b.id === focusedId);
    const prev = (idx - 1 + state.buffers.length) % state.buffers.length;
    useBuffers.getState().setFocusedBuffer(state.buffers[prev].id);
  },
});
```

- [ ] **Step 2: Update the import**

At the top of `src/commands/builtins.ts`, change:

```ts
import { useBuffers } from '../stores/buffers';
```

to:

```ts
import { useBuffers, selectFocusedId } from '../stores/buffers';
```

- [ ] **Step 3: Add the `view.toggleSplit` command**

Append at the end of `registerBuiltins()`:

```ts
register({
  id: 'view.toggleSplit',
  title: 'Toggle Split View',
  shortcut: 'Ctrl+\\',
  run: () => { useBuffers.getState().toggleSplit(); },
});
```

- [ ] **Step 4: Audit any other `activeId` reads in `builtins.ts`**

Search the file:

```powershell
findstr /N "activeId" src\commands\builtins.ts
```

For every remaining hit (e.g. `tab.close`, `file.save`, `file.saveAs`), replace `useBuffers.getState().activeId` with `selectFocusedId(useBuffers.getState())`. If the command needs the buffer (not just the id), use `selectFocused(useBuffers.getState())` instead. Import `selectFocused` if needed.

- [ ] **Step 5: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean; all vitest tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/commands/builtins.ts
git commit -m "commands: target focused buffer; add view.toggleSplit"
```

---

## Task 6: `Ctrl+\` keybinding in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the keydown branch**

In `src/App.tsx`, find the existing keydown ladder inside the `onKey` function. Locate the `Ctrl+B` branch (`if (key === 'b' && !e.shiftKey)`). Right AFTER it (and the existing Ctrl+R / Ctrl+Shift+E branches if present), add:

```ts
if (key === '\\' && !e.shiftKey) {
  e.preventDefault();
  runCommand('view.toggleSplit');
  return;
}
```

- [ ] **Step 2: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean; all vitest tests pass.

- [ ] **Step 3: Commit**

```powershell
git add src/App.tsx
git commit -m "app: Ctrl+\\ toggles split view"
```

---

## Task 7: e2e — `Ctrl+\` shows two panes

**Files:**
- Create: `tests/e2e/split-view.spec.ts`

- [ ] **Step 1: Create the spec**

`tests/e2e/split-view.spec.ts`:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('split view', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as { __memopadTestReset?: () => void };
      w.__memopadTestReset?.();
    });
    await sleep(150);
  });

  it('Ctrl+\\\\ opens two editor panes; pressing it again returns to one', async () => {
    // Sanity: in single-pane mode there is one editor-pane.
    await sleep(150);
    const before = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="editor-pane"]').length;`,
    );
    expect(before).to.equal(1);

    // Press Ctrl+\\
    await getBrowser().keys(['Control', '\\']);
    await sleep(200);

    const splitPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="editor-split"]');`,
    );
    expect(splitPresent).to.equal(true);
    const afterSplit = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="editor-pane"]').length;`,
    );
    expect(afterSplit).to.equal(2);

    // Press Ctrl+\\ again — back to single pane.
    await getBrowser().keys(['Control', '\\']);
    await sleep(200);
    const afterCollapse = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="editor-pane"]').length;`,
    );
    expect(afterCollapse).to.equal(1);
  });
});
```

- [ ] **Step 2: Type-check e2e**

```powershell
npx tsc -p tsconfig.e2e.json --noEmit 2>&1
```

Expected: same baseline `TransformReturn<T>` pattern as other specs (+1 new instance for this file only).

- [ ] **Step 3: DO NOT run `npm run e2e`** — defer to Task 8.

- [ ] **Step 4: Commit**

```powershell
git add tests/e2e/split-view.spec.ts
git commit -m "e2e: Ctrl+\\\\ toggles split view"
```

---

## Task 8: Gates + results doc

**Files:**
- Create: `docs/superpowers/plans/v2-split-view-results.md`

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
- vitest total (expected +5 from buffers split tests)
- cargo total (no change, since no Rust changes)

- [ ] **Step 2: Release build**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture MSI + app.exe sizes. Expected: ~0 byte change.

- [ ] **Step 3: Skip `npm run e2e`** — defer to manual verification.

- [ ] **Step 4: Write results doc**

Create `docs/superpowers/plans/v2-split-view-results.md`:

```markdown
# v2 Split View — Results

## Automated test gates

- Vitest: <N> tests passing (+5 from split view tests)
- cargo test: <N> tests passing (no Rust changes)
- e2e (WebdriverIO): spec written (1 test); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: <X.XX> MB
- app.exe size: <X.XX> MB

## What shipped

- `src/stores/buffers.ts` — `splitActive`, `secondaryId`, `focusedPane` state + `toggleSplit` / `setFocusedPane` / `setFocusedBuffer` actions + `selectFocused` / `selectFocusedId` selectors. `closeBuffer` falls back secondary to primary.
- `src/components/EditorPane.tsx` — new, extracted from Editor. Owns one CodeMirror instance.
- `src/components/Editor.tsx` — orchestrator. Renders 1 or 2 EditorPanes based on `splitActive`. ExternalChangeBanner + SearchStrip remain single-instance.
- `src/components/TabStrip.tsx` — highlights + clicks target focused buffer.
- `src/components/ExternalChangeBanner.tsx`, `src/components/StatusBar.tsx` — read focused buffer instead of active.
- `src/commands/builtins.ts` — tab.next / tab.prev / file.save / etc. target focused buffer. New `view.toggleSplit` command.
- `src/App.tsx` — Ctrl+\ keybinding.

## What is intentionally NOT in this slice

- More than two panes
- Vertical splits
- Per-pane cursor / scroll state
- Per-pane tab strips
- Drag-to-swap / drag buffers across panes
- Serializing split state to session.json
- Resizing the split (50/50 fixed)

## Follow-ups

1. Per-pane cursor/scroll state
2. Rename TabContextMenu → ContextMenu (polish from slice 6)
3. Multi-pane / recursive tree split
4. Session-persisted split state
```

Fill in actual numbers.

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/v2-split-view-results.md
git commit -m "v2 split view: record results"
```

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec section | Covered by |
| --- | --- |
| `splitActive`, `secondaryId`, `focusedPane` state | Task 1 |
| `toggleSplit`, `setFocusedPane`, `setFocusedBuffer` actions | Task 1 |
| `selectFocused` / `selectFocusedId` derived selectors | Task 1 |
| `closeBuffer` secondary fallback | Task 1 |
| 5 vitest split-view cases | Task 1 |
| `EditorPane` extraction (bufferId + focused + onFocus props) | Task 2 |
| `Editor` orchestrator renders 1 or 2 panes | Task 2 |
| `flex-1 w-full` layout invariant on each pane | Task 2 |
| `data-testid="editor-pane"` and `data-testid="editor-split"` | Task 2 + Task 7 |
| ExternalChangeBanner + SearchStrip single instance, focused-targeted | Task 2 (single mount in orchestrator) + Task 4 (ExternalChangeBanner reads focused) |
| TabStrip targets focused | Task 3 |
| StatusBar reads focused | Task 4 |
| tab.next / tab.prev / etc. use focused | Task 5 |
| view.toggleSplit command + Ctrl+\ keybinding | Tasks 5, 6 |
| 1 e2e test | Task 7 |
| Gates + results doc | Task 8 |

**Placeholder scan:** None.

**Type / signature consistency:**
- `splitActive: boolean`, `secondaryId: string | null`, `focusedPane: 'primary' | 'secondary'` consistent across interface, initial state, actions, and selectors.
- `toggleSplit(): void`, `setFocusedPane(p): void`, `setFocusedBuffer(id): void` signatures consistent across interface and impl.
- `selectFocused(state): Buffer | null` and `selectFocusedId(state): string | null` — both exported from `buffers.ts`, both imported by consumers in Tasks 3 / 4 / 5.
- `EditorPane` props: `{ bufferId, focused, onFocus, setSearchActions, searchPanelState, setSearchPanelState, searchQuery, replaceText }` — the SearchStrip-related props are the tricky part. Task 2 documents this; the implementer needs to read the current Editor.tsx and ensure the props are wired identically to the original.
- `data-testid="editor-pane"` and `data-testid="editor-split"` are referenced in both Task 2 (rendering) and Task 7 (assertions).

**Notes for executor:**
- Task 2 is the biggest and most error-prone. The current `Editor.tsx` mixes CodeMirror setup, SearchStrip state, the external-change banner, and the global window hooks. The extraction needs to be done carefully so behavior is preserved in single-pane mode. Run the full vitest suite + a manual smoke (single pane) after Task 2 before moving on.
- The `window.__memopadSearchPanel` and `window.__memopadJumpEditor` hooks are gated by `focused` in EditorPane. In split mode, the focused pane wins. When the user clicks the other pane, that pane re-registers via its useEffect.
- This plan does NOT push to remote and does NOT merge to main (matches the user's standing "do not commit until I say so" boundary; local commits in the worktree are allowed per the established workflow).
- If the current Editor.tsx has tightly-coupled state that resists the extraction (e.g. some intricate ref-passing between CM and SearchStrip), the executor may need to keep some state at the orchestrator level and pass it down as props rather than fully isolating in EditorPane. The spec's principle: SearchStrip is single-instance and targets the focused pane. The exact mechanism is implementation detail.
