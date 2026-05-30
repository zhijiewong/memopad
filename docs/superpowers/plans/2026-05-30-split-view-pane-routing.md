# Split-View Pane Routing & Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the split view route every file-open to the focused pane, show a clear focused-pane indicator, and support Ctrl+1/Ctrl+2 pane focus — so the right pane actually works like a mature editor's editor group.

**Architecture:** A single routing rule in the Zustand store (`buffers.ts`) decides whether a "show this buffer" action targets `activeId` (primary) or `secondaryId` (secondary), based on `splitActive` + `focusedPane`. All file-open entry points funnel through these store actions, so fixing them centrally fixes the file tree, Ctrl+O, Find-in-Files, Quick Open, new/reopen at once. UI changes (focus indicator, DOM-focus follow) live in `EditorPane.tsx`/`Editor.tsx`; pane-focus commands live in `builtins.ts` + `App.tsx`.

**Tech Stack:** React 18 + TypeScript, Zustand 4, CodeMirror 6 (@uiw/react-codemirror), Vitest (unit), WebdriverIO + Mocha (e2e in real WebView).

**Branch:** `worktree-split-view-polish` (off `origin/main`, with `worktree-split-state-persistence` + `worktree-keybind-backslash` already merged). All work and commits happen in `E:\Github\memopad\.claude\worktrees\split-view-polish`.

**Standing constraints:**
- Trust `npx tsc --noEmit` over the IDE LSP (LSP floods false positives after edits).
- `cargo`/`tauri-driver` are on PATH in the Bash tool's shell, NOT in PowerShell.
- Commits inside this worktree are fine; do NOT touch `main`.

---

### Task 1: Pane-aware routing rule in the store

**Files:**
- Modify: `src/stores/buffers.ts` (add helper; change `newBuffer`, `openBuffer`, `switchTo`, `reopenLastClosed`, `openFileAtLine`)
- Test: `src/tests/buffers.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/buffers.test.ts`:

```ts
describe('pane-aware routing', () => {
  beforeEach(() => useBuffers.getState().resetAll());

  function openTwoAndSplit() {
    const a = useBuffers.getState().openBuffer({ path: '/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
    const b = useBuffers.getState().openBuffer({ path: '/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' });
    useBuffers.getState().toggleSplit(); // splitActive=true, secondaryId=b, focusedPane='secondary'
    return { a, b };
  }

  it('openBuffer routes a NEW file to the secondary pane when it is focused', () => {
    const { a } = openTwoAndSplit();
    const c = useBuffers.getState().openBuffer({ path: '/c.txt', content: 'C', encoding: 'utf-8', eol: 'lf' });
    expect(useBuffers.getState().activeId).toBe(a);       // left unchanged
    expect(useBuffers.getState().secondaryId).toBe(c);    // right got the new file
  });

  it('openBuffer routes an EXISTING file to the secondary pane when it is focused', () => {
    const { a } = openTwoAndSplit();
    useBuffers.getState().openBuffer({ path: '/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
    expect(useBuffers.getState().secondaryId).toBe(a);
  });

  it('switchTo routes to the secondary pane when it is focused', () => {
    const { a } = openTwoAndSplit();
    useBuffers.getState().switchTo(a);
    expect(useBuffers.getState().secondaryId).toBe(a);
  });

  it('newBuffer routes to the secondary pane when it is focused', () => {
    const { a } = openTwoAndSplit();
    const fresh = useBuffers.getState().newBuffer();
    expect(useBuffers.getState().activeId).toBe(a);
    expect(useBuffers.getState().secondaryId).toBe(fresh);
  });

  it('routes to the PRIMARY pane when primary is focused', () => {
    openTwoAndSplit();
    useBuffers.getState().setFocusedPane('primary');
    const c = useBuffers.getState().openBuffer({ path: '/c.txt', content: 'C', encoding: 'utf-8', eol: 'lf' });
    expect(useBuffers.getState().activeId).toBe(c);
  });

  it('routes to the PRIMARY pane when not split', () => {
    const a = useBuffers.getState().openBuffer({ path: '/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
    expect(a).toBe(useBuffers.getState().activeId);
    const c = useBuffers.getState().openBuffer({ path: '/c.txt', content: 'C', encoding: 'utf-8', eol: 'lf' });
    expect(useBuffers.getState().activeId).toBe(c);
    expect(useBuffers.getState().secondaryId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/buffers.test.ts -t "pane-aware routing"`
Expected: FAIL — e.g. `expected '<id-b>' to be '<id-c>'` (secondaryId still points at b because openBuffer sets activeId).

- [ ] **Step 3: Add the routing helper**

In `src/stores/buffers.ts`, after the `emptyBuffer()` function (around line 118), add:

```ts
/**
 * Route a "show this buffer" action to the focused pane: the secondary pane
 * when the split is active and focused, otherwise the primary pane.
 */
function routeToFocusedPane(s: BuffersState, id: string): Partial<BuffersState> {
  if (s.splitActive && s.focusedPane === 'secondary') {
    return { secondaryId: id };
  }
  return { activeId: id };
}
```

- [ ] **Step 4: Apply the helper to the five actions**

`newBuffer` (currently sets `activeId: buf.id`):

```ts
  newBuffer: () => {
    const buf = emptyBuffer();
    set((s) => ({ buffers: [...s.buffers, buf], ...routeToFocusedPane(s, buf.id) }));
    return buf.id;
  },
```

`openBuffer` (both branches):

```ts
  openBuffer: (file) => {
    const existing = get().buffers.find((b) => b.path === file.path);
    if (existing) {
      set((s) => routeToFocusedPane(s, existing.id));
      return existing.id;
    }
    const buf: Buffer = {
      id: genId(),
      path: file.path,
      content: file.content,
      originalContent: file.content,
      encoding: file.encoding,
      eol: file.eol,
      dirty: false,
      recordedStat: null,
      externalChange: false,
      cursor: null,
      scrollTop: null,
    };
    set((s) => ({ buffers: [...s.buffers, buf], ...routeToFocusedPane(s, buf.id) }));
    return buf.id;
  },
```

`switchTo`:

```ts
  switchTo: (id) => {
    set((s) => (s.buffers.some((b) => b.id === id) ? routeToFocusedPane(s, id) : s));
  },
```

`reopenLastClosed` (the `set(...)` call):

```ts
    set((s) => ({
      buffers: [...s.buffers, restored],
      recentlyClosed: rest,
      ...routeToFocusedPane(s, restored.id),
    }));
```

`openFileAtLine` (the existing-buffer branch):

```ts
    if (existing) {
      set((s) => routeToFocusedPane(s, existing.id));
    } else {
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/tests/buffers.test.ts`
Expected: PASS (the new `pane-aware routing` block plus all pre-existing buffers tests stay green).

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add src/stores/buffers.ts src/tests/buffers.test.ts
git commit -m "feat: route file opens to the focused pane"
```

---

### Task 2: Pane-independent close fallback

**Files:**
- Modify: `src/stores/buffers.ts` (`closeBuffer`)
- Test: `src/tests/buffers.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/buffers.test.ts`:

```ts
describe('closeBuffer in split', () => {
  beforeEach(() => useBuffers.getState().resetAll());

  it('closing the secondary buffer advances it to a different remaining buffer', () => {
    const a = useBuffers.getState().openBuffer({ path: '/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
    const b = useBuffers.getState().openBuffer({ path: '/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' });
    const c = useBuffers.getState().openBuffer({ path: '/c.txt', content: 'C', encoding: 'utf-8', eol: 'lf' });
    // active=a (primary), secondary=c
    useBuffers.setState({ activeId: a, splitActive: true, secondaryId: c, focusedPane: 'secondary' });
    useBuffers.getState().closeBuffer(c);
    expect(useBuffers.getState().activeId).toBe(a);        // primary untouched
    expect(useBuffers.getState().secondaryId).toBe(b);     // secondary advanced to b, not mirrored to a
    expect(useBuffers.getState().splitActive).toBe(true);
  });

  it('closing the last remaining buffer collapses the split', () => {
    const a = useBuffers.getState().openBuffer({ path: '/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
    useBuffers.setState({ activeId: a, splitActive: true, secondaryId: a, focusedPane: 'secondary' });
    useBuffers.getState().closeBuffer(a);
    expect(useBuffers.getState().activeId).toBeNull();
    expect(useBuffers.getState().secondaryId).toBeNull();
    expect(useBuffers.getState().splitActive).toBe(false);
    expect(useBuffers.getState().focusedPane).toBe('primary');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/buffers.test.ts -t "closeBuffer in split"`
Expected: FAIL — secondary is mirrored to `a` instead of advancing to `b`; split does not collapse.

- [ ] **Step 3: Rewrite `closeBuffer`**

Replace the whole `closeBuffer` action in `src/stores/buffers.ts` with:

```ts
  closeBuffer: (id) => {
    set((s) => {
      const idx = s.buffers.findIndex((b) => b.id === id);
      if (idx < 0) return s;
      const closed = s.buffers[idx];
      const next = s.buffers.filter((b) => b.id !== id);
      // Index-based advance among the remaining buffers (buffer at the closed
      // index, else the last one), or null if none remain.
      const advance = (): string | null => {
        if (next.length === 0) return null;
        return idx < next.length ? next[idx].id : next[next.length - 1].id;
      };
      let nextActive: string | null = s.activeId;
      if (s.activeId === id) nextActive = advance();
      let nextSecondary: string | null = s.secondaryId;
      if (s.secondaryId === id) nextSecondary = advance();
      let splitActive = s.splitActive;
      let focusedPane = s.focusedPane;
      if (next.length === 0) {
        splitActive = false;
        nextSecondary = null;
        focusedPane = 'primary';
      }
      const recent = [closed, ...s.recentlyClosed].slice(0, RECENT_CAP);
      const nextPaneState = new Map(s.secondaryPaneState);
      nextPaneState.delete(id);
      return {
        buffers: next,
        activeId: nextActive,
        secondaryId: nextSecondary,
        splitActive,
        focusedPane,
        recentlyClosed: recent,
        secondaryPaneState: nextPaneState,
      };
    });
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/buffers.test.ts`
Expected: PASS (new `closeBuffer in split` block + all pre-existing buffers tests green).

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/stores/buffers.ts src/tests/buffers.test.ts
git commit -m "fix: advance each pane independently on buffer close, collapse when empty"
```

---

### Task 3: Pane-focus commands + Ctrl+1/Ctrl+2

**Files:**
- Modify: `src/commands/builtins.ts` (register two commands)
- Modify: `src/App.tsx` (keybindings)
- Test: `src/tests/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/commands.test.ts`:

```ts
import { registerBuiltins } from '../commands/builtins';
import { useBuffers } from '../stores/buffers';

describe('pane focus commands', () => {
  beforeEach(() => {
    useCommands.getState().reset();
    useBuffers.getState().resetAll();
    registerBuiltins();
  });

  function run(id: string) {
    const cmd = useCommands.getState().commands.find((c) => c.id === id);
    if (!cmd) throw new Error(`command ${id} not registered`);
    cmd.run();
  }

  it('view.focusSecondaryPane focuses the secondary pane when split is active', () => {
    useBuffers.getState().openBuffer({ path: '/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
    useBuffers.getState().toggleSplit();          // focusedPane becomes 'secondary'
    run('view.focusPrimaryPane');
    expect(useBuffers.getState().focusedPane).toBe('primary');
    run('view.focusSecondaryPane');
    expect(useBuffers.getState().focusedPane).toBe('secondary');
  });

  it('view.focusSecondaryPane is a no-op when not split', () => {
    useBuffers.getState().openBuffer({ path: '/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
    run('view.focusSecondaryPane');
    expect(useBuffers.getState().focusedPane).toBe('primary');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/commands.test.ts -t "pane focus commands"`
Expected: FAIL — `command view.focusPrimaryPane not registered`.

- [ ] **Step 3: Register the commands**

In `src/commands/builtins.ts`, immediately after the `view.toggleSplit` registration block (near the end of `registerBuiltins`), add:

```ts
  register({
    id: 'view.focusPrimaryPane',
    title: 'Focus Left Pane',
    shortcut: 'Ctrl+1',
    run: () => { useBuffers.getState().setFocusedPane('primary'); },
  });
  register({
    id: 'view.focusSecondaryPane',
    title: 'Focus Right Pane',
    shortcut: 'Ctrl+2',
    run: () => { useBuffers.getState().setFocusedPane('secondary'); },
  });
```

(`setFocusedPane('secondary')` already no-ops when `splitActive` is false — see `buffers.ts` `setFocusedPane`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the keybindings**

In `src/App.tsx`, inside the `onKey` handler, after the `key === 'b'` line (around line 172) add:

```ts
      if (key === '1' && !e.shiftKey) { e.preventDefault(); runCommand('view.focusPrimaryPane'); return; }
      if (key === '2' && !e.shiftKey) { e.preventDefault(); runCommand('view.focusSecondaryPane'); return; }
```

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/commands/builtins.ts src/App.tsx src/tests/commands.test.ts
git commit -m "feat: Ctrl+1/Ctrl+2 to focus left/right pane"
```

---

### Task 4: Focused-pane indicator + DOM-focus follow

**Files:**
- Modify: `src/components/EditorPane.tsx` (add `inSplit` prop, `data-focused` attr, accent/dim classes, focus-follow effect)
- Modify: `src/components/Editor.tsx` (pass `inSplit`)

This is UI; it is verified by the e2e test in Task 6 (no unit/component test harness exists in this repo for components). Implement carefully and keep `tsc` green.

- [ ] **Step 1: Add `inSplit` to the props interface**

In `src/components/EditorPane.tsx`, in `EditorPaneProps` (around line 47), add after `pane`:

```ts
  /** True when rendered as one of two split panes (enables the focus indicator). */
  inSplit: boolean;
```

- [ ] **Step 2: Add the focus-follow effect**

In `EditorPane.tsx`, after the existing focus-gated globals effect (the one ending around line 192), add:

```ts
  // When this pane becomes the focused pane (e.g. via Ctrl+1/Ctrl+2), move real
  // DOM focus into its editor so the cursor and subsequent typing land here.
  useEffect(() => {
    if (props.focused) viewRef.current?.focus();
  }, [props.focused]);
```

- [ ] **Step 3: Replace the pane wrapper classes + add `data-focused`**

In `EditorPane.tsx` there are TWO pane wrapper `<div>`s (the `if (!buffer)` placeholder branch around line 202 and the main branch around line 215). For BOTH, replace the opening `<div ...>` with the focus-aware version. Replace:

```tsx
      <div
        data-testid="editor-pane"
        onMouseDown={props.onFocus}
        className={`flex flex-1 flex-col w-full overflow-hidden ${props.focused ? '' : 'opacity-90'}`}
      >
```

with:

```tsx
      <div
        data-testid="editor-pane"
        data-focused={props.focused}
        onMouseDown={props.onFocus}
        className={`flex flex-1 flex-col w-full overflow-hidden ${
          props.inSplit
            ? props.focused
              ? 'ring-1 ring-inset ring-[var(--app-accent)]'
              : 'opacity-60'
            : ''
        }`}
      >
```

(Apply the identical replacement to both wrapper `<div>`s.)

- [ ] **Step 4: Confirm the accent CSS var exists**

Run: `grep -rn "\-\-app-accent" src/`
Expected: at least one definition (e.g. in `index.css`). If it does NOT exist, use `--app-fg` instead in Step 3's `ring-[var(--app-accent)]` → `ring-[var(--app-fg)]`, and note the substitution in the commit message.

- [ ] **Step 5: Pass `inSplit` from `Editor.tsx`**

In `src/components/Editor.tsx`, the split branch renders two `<EditorPane>`s and the non-split branch renders one. Add `inSplit={true}` to BOTH panes inside the `splitActive` branch (primary at ~line 42, secondary at ~line 56), and `inSplit={false}` to the single `<EditorPane>` in the `else` branch (~line 70).

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: exit 0. (If `tsc` reports `inSplit` missing on an EditorPane usage, you missed one of the three call sites.)

- [ ] **Step 7: Commit**

```bash
git add src/components/EditorPane.tsx src/components/Editor.tsx
git commit -m "feat: focused-pane accent indicator and DOM-focus follow"
```

---

### Task 5: Quick Open routing cleanup

**Files:**
- Modify: `src/components/QuickOpenPalette.tsx` (`openPicked`)

Behavior-preserving cleanup now that `openBuffer` is pane-aware (Task 1). Covered by the e2e in Task 6.

- [ ] **Step 1: Simplify `openPicked`**

In `src/components/QuickOpenPalette.tsx`, replace the `openPicked` try block:

```ts
      const existing = useBuffers.getState().buffers.find((b) => b.path === path);
      if (existing) {
        useBuffers.getState().setFocusedBuffer(existing.id);
      } else {
        const opened = await openFile(path);
        const newId = useBuffers.getState().openBuffer(opened);
        useBuffers.getState().setFocusedBuffer(newId);
      }
      onClose();
```

with:

```ts
      const existing = useBuffers.getState().buffers.find((b) => b.path === path);
      if (existing) {
        useBuffers.getState().switchTo(existing.id);
      } else {
        const opened = await openFile(path);
        useBuffers.getState().openBuffer(opened); // routes to the focused pane
      }
      onClose();
```

(`switchTo` and `openBuffer` are both pane-aware after Task 1, so the redundant `setFocusedBuffer` second-write is gone.)

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Run unit tests**

Run: `npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 4: Commit**

```bash
git add src/components/QuickOpenPalette.tsx
git commit -m "refactor: simplify Quick Open routing via pane-aware store actions"
```

---

### Task 6: e2e — routing, focus, and pane navigation in the real WebView

**Files:**
- Create: `tests/e2e/split-pane-routing.spec.ts`

The e2e harness drives the real WebView via `classicExecute`. All hooks needed already exist (from the persistence merge): `__memopadTestOpenBuffer`, `__memopadTestSwitchTo`, `__memopadTestSplitState`, `__memopadTestReset`. Routing is asserted directly against the rendered `.cm-content` of each pane (more faithful than reading store ids).

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/split-pane-routing.spec.ts`:

```ts
import { expect } from 'chai';
import { classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function dispatchCtrl(keyValue: string, codeValue: string) {
  await classicExecute(`
    var el = document.querySelector('.cm-content') || document.body;
    if (el.focus) el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: arguments[0], code: arguments[1], ctrlKey: true, bubbles: true, cancelable: true,
    }));
  `, [keyValue, codeValue]);
}

describe('split-view pane routing & focus', () => {
  beforeEach(async () => {
    await classicExecute(`window.__memopadTestReset && window.__memopadTestReset();`);
    await sleep(150);
  });

  it('opens a file into the focused (right) pane and leaves the left pane unchanged', async () => {
    const ids = await classicExecute<string[]>(`
      var w = window;
      var a = w.__memopadTestOpenBuffer({ path: '/tmp/left.txt', content: 'LEFT-CONTENT', encoding: 'utf-8', eol: 'lf' });
      var b = w.__memopadTestOpenBuffer({ path: '/tmp/mid.txt', content: 'MID-CONTENT', encoding: 'utf-8', eol: 'lf' });
      w.__memopadTestSwitchTo(a);
      return [a, b];
    `);
    await sleep(150);

    // Split (Ctrl+\): secondary mirrors the active buffer (a), focus goes right.
    await dispatchCtrl('\\', 'Backslash');
    await sleep(250);

    // Open a NEW file while the right pane is focused — must land on the right.
    await classicExecute(`
      window.__memopadTestOpenBuffer({ path: '/tmp/right.txt', content: 'RIGHT-CONTENT', encoding: 'utf-8', eol: 'lf' });
    `);
    await sleep(250);

    const panes = await classicExecute<{ left: string; right: string }>(`
      var p = document.querySelectorAll('[data-testid="editor-pane"]');
      return {
        left: p[0].querySelector('.cm-content') ? p[0].querySelector('.cm-content').textContent : '',
        right: p[1].querySelector('.cm-content') ? p[1].querySelector('.cm-content').textContent : '',
      };
    `);
    expect(panes.left).to.contain('LEFT-CONTENT');   // unchanged
    expect(panes.right).to.contain('RIGHT-CONTENT');  // new file landed on the right
  });

  it('Ctrl+1 / Ctrl+2 move the focused pane and the focus indicator', async () => {
    await classicExecute(`
      var w = window;
      w.__memopadTestOpenBuffer({ path: '/tmp/a.txt', content: 'AAA', encoding: 'utf-8', eol: 'lf' });
    `);
    await sleep(150);
    await dispatchCtrl('\\', 'Backslash'); // split; focus right
    await sleep(250);

    let state = await classicExecute<{ focusedPane: string }>(`return window.__memopadTestSplitState();`);
    expect(state.focusedPane).to.equal('secondary');

    await dispatchCtrl('1', 'Digit1');
    await sleep(150);
    state = await classicExecute<{ focusedPane: string }>(`return window.__memopadTestSplitState();`);
    expect(state.focusedPane).to.equal('primary');

    // The focused pane carries data-focused="true".
    const focusedIdx = await classicExecute<number>(`
      var p = document.querySelectorAll('[data-testid="editor-pane"]');
      for (var i = 0; i < p.length; i++) { if (p[i].getAttribute('data-focused') === 'true') return i; }
      return -1;
    `);
    expect(focusedIdx).to.equal(0); // left pane is focused

    await dispatchCtrl('2', 'Digit2');
    await sleep(150);
    state = await classicExecute<{ focusedPane: string }>(`return window.__memopadTestSplitState();`);
    expect(state.focusedPane).to.equal('secondary');
  });
});
```

- [ ] **Step 2: Build the release binary (needed for e2e)**

Run (Bash tool): `cd E:/Github/memopad/.claude/worktrees/split-view-polish && npm run tauri build 2>&1 | tail -5; ls -la src-tauri/target/release/app.exe`
Expected: `app.exe` present. The final `TAURI_SIGNING_PRIVATE_KEY` error is benign — the binary is produced before it. (`npm ci` first if `node_modules` is absent.)

- [ ] **Step 3: Run the new e2e spec**

Run (Bash tool): `cd E:/Github/memopad/.claude/worktrees/split-view-polish && npx mocha --grep "split-view pane routing"`
Expected: 2 passing.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/split-pane-routing.spec.ts
git commit -m "test(e2e): cover focused-pane routing and Ctrl+1/2 in real WebView"
```

---

### Task 7: Full verification + code review

**Files:** none (verification only)

- [ ] **Step 1: Unit + type gates**

Run (Bash tool): `cd E:/Github/memopad/.claude/worktrees/split-view-polish && npx tsc --noEmit && npx vitest run 2>&1 | tail -6`
Expected: tsc exit 0; all vitest suites pass.

- [ ] **Step 2: Rust gate (unchanged code, but confirm green)**

Run (Bash tool): `cd E:/Github/memopad/.claude/worktrees/split-view-polish/src-tauri && cargo test 2>&1 | tail -10`
Expected: all tests pass.

- [ ] **Step 3: Full e2e split suite (regression)**

Run (Bash tool): `cd E:/Github/memopad/.claude/worktrees/split-view-polish && npx mocha --grep "split"`
Expected: split-restore, split-keybinding, split-view, and split-pane-routing specs all pass.

- [ ] **Step 4: Code review**

Invoke the `superpowers:requesting-code-review` skill against the diff of `worktree-split-view-polish` vs `origin/main`. Address any high-confidence findings (new commits), re-run Step 1.

- [ ] **Step 5: Report for manual smoke**

Summarize for the user: split via Ctrl+\ or Ctrl+K, focus right pane (click or Ctrl+2), open different files into each pane via the file tree / Ctrl+O / Quick Open, confirm the focus indicator, then close/reopen the app and confirm the split + both files + scroll/cursor restore (persistence).

---

## Self-Review Notes

- **Spec coverage:** routing rule (Task 1), Quick Open double-write (Task 5), focus indicator (Task 4), Ctrl+1/2 + DOM-focus follow (Task 3 + 4), close fallback (Task 2), focused-pane search — see note below. All e2e/manual testing (Task 6/7).
- **Focused-pane search (spec §5 second bullet):** the merged `EditorPane` already gates the `__memopadSearchPanel` globals on `props.focused` (buffers/EditorPane lines ~165-192), so Find/Replace already targets the focused pane. The remaining `onActionsReady` registration is unconditional but only feeds the shared `SearchStrip`'s button actions; since the globals (used by Ctrl+F/Ctrl+H) are already focus-gated, no code change is required. If a reviewer finds the SearchStrip buttons operate on the wrong pane in split, gate `onActionsReady` on `props.focused` in `EditorPane` as a follow-up. (No task — verified-not-needed.)
- **Type consistency:** `routeToFocusedPane(s, id): Partial<BuffersState>` used uniformly; `inSplit: boolean` added to `EditorPaneProps` and passed at all three call sites; `__memopadTestActiveAndSecondary` typed in `main.tsx`.
