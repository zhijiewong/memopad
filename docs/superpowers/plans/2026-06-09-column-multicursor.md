# Column / Multi-Cursor Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Notepad++-style column (rectangular) selection plus keyboard cursor-stacking and a status-bar cursor count to the CodeMirror editor.

**Architecture:** Frontend-only. A pure helper (`src/lib/multicursor.ts`) computes the "add a cursor above/below" selection; `EditorPane` wires CM6's `rectangularSelection`/`crosshairCursor` extensions, two keymap commands (Ctrl+Alt+↑/↓), and a focused-pane window global mirroring the existing `__memopadLineCommand`/`__memopadBracketCommand`. The cursor store gains a `cursorCount` the status bar renders when `> 1`. No Rust/IPC/session changes.

**Tech Stack:** React + TypeScript + Zustand + CodeMirror 6 (`@uiw/react-codemirror`); vitest; e2e via WebdriverIO + Mocha (validated in CI).

**Spec:** `docs/superpowers/specs/2026-06-09-column-multicursor-design.md`

**Gates:** `npx tsc --noEmit` clean · `npm test` (adds ~5) · `cargo test` unchanged-green. e2e via CI (local fresh builds render blank — see known-e2e-failures). Stage explicit paths only; trust `npx tsc --noEmit` over the LSP.

---

## Task 1: `addCursorVertical` pure helper + unit tests

**Files:**
- Create: `src/lib/multicursor.ts`
- Create: `src/tests/multicursor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/multicursor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { addCursorVertical } from '../lib/multicursor';

function stateWith(doc: string, sel: EditorSelection): EditorState {
  return EditorState.create({
    doc,
    selection: sel,
    extensions: EditorState.allowMultipleSelections.of(true),
  });
}

describe('addCursorVertical', () => {
  it('adds a cursor on the line below at the same column', () => {
    // "abc\ndef": cursor at col 2 on line 1 (pos 2)
    const s = stateWith('abc\ndef', EditorSelection.cursor(2));
    const sel = addCursorVertical(s, 1);
    expect(sel.ranges.map((r) => r.head)).toEqual([2, 6]); // line2 from=4, +2
    expect(sel.main.head).toBe(6); // newest cursor is primary
  });

  it('adds a cursor on the line above at the same column', () => {
    const s = stateWith('abc\ndef', EditorSelection.cursor(6)); // line2 col2
    const sel = addCursorVertical(s, -1);
    expect(sel.ranges.map((r) => r.head)).toEqual([2, 6]);
    expect(sel.main.head).toBe(2);
  });

  it('clamps the column to a shorter target line', () => {
    // "abcde\nxy": cursor at col 4 (pos 4) on line1; line2 length 2
    const s = stateWith('abcde\nxy', EditorSelection.cursor(4));
    const sel = addCursorVertical(s, 1);
    // line2 from=6, min(4,2)=2 => 8
    expect(sel.ranges.map((r) => r.head)).toEqual([4, 8]);
  });

  it('stacks one new cursor per existing range', () => {
    // two cursors at col1 on lines 1 and 2 of a 3-line doc
    const s = stateWith('aaa\nbbb\nccc', EditorSelection.create([
      EditorSelection.cursor(1), // line1 col1
      EditorSelection.cursor(5), // line2 col1
    ]));
    const sel = addCursorVertical(s, 1);
    // adds line2 col1 (pos5 — already present, deduped) and line3 col1 (pos9)
    expect(sel.ranges.map((r) => r.head).sort((a, b) => a - b)).toEqual([1, 5, 9]);
  });

  it('returns the same selection unchanged at the document boundary', () => {
    const s = stateWith('abc\ndef', EditorSelection.cursor(1)); // line1
    const sel = addCursorVertical(s, -1); // nothing above line 1
    expect(sel).toBe(s.selection);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- multicursor`
Expected: FAIL — `addCursorVertical` is not defined / module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/multicursor.ts`:

```ts
import { EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state';

/**
 * Build a selection that adds one cursor per existing range on the line `dir`
 * (-1 = above, +1 = below) at the same column, clamped to the target line's
 * length. Ranges whose target line is outside the document contribute nothing,
 * and a target position that already holds a cursor is skipped (no duplicate).
 * If nothing can be added, the original `state.selection` is returned (same
 * reference) so callers can treat that as a no-op.
 */
export function addCursorVertical(state: EditorState, dir: -1 | 1): EditorSelection {
  const { doc } = state;
  const existing = state.selection.ranges;
  const seen = new Set<number>();
  for (const r of existing) if (r.empty) seen.add(r.head);
  const added: SelectionRange[] = [];

  for (const r of existing) {
    const line = doc.lineAt(r.head);
    const col = r.head - line.from;
    const targetNum = line.number + dir;
    if (targetNum < 1 || targetNum > doc.lines) continue;
    const target = doc.line(targetNum);
    const pos = target.from + Math.min(col, target.length);
    if (seen.has(pos)) continue;
    seen.add(pos);
    added.push(EditorSelection.cursor(pos));
  }

  if (added.length === 0) return state.selection;
  const ranges = [...existing, ...added];
  // Keep the newest cursor primary so repeated presses keep extending in `dir`.
  return EditorSelection.create(ranges, ranges.length - 1);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- multicursor`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/multicursor.ts src/tests/multicursor.test.ts
git commit -m "feat: addCursorVertical helper for column/multi-cursor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `cursorCount` in the cursor store

**Files:**
- Modify: `src/stores/cursorPos.ts`

`set` gains an optional third arg so existing callers (if any pass only line/col) keep working.

- [ ] **Step 1: Update the store**

Replace the entire contents of `src/stores/cursorPos.ts` with:

```ts
import { create } from 'zustand';

interface CursorPosState {
  line: number; // 1-based
  col: number;  // 1-based
  cursorCount: number; // number of active selection ranges (>=1)
  set: (line: number, col: number, cursorCount?: number) => void;
  reset: () => void;
}

export const useCursorPos = create<CursorPosState>((set) => ({
  line: 1,
  col: 1,
  cursorCount: 1,
  set: (line, col, cursorCount = 1) => set({ line, col, cursorCount }),
  reset: () => set({ line: 1, col: 1, cursorCount: 1 }),
}));
```

- [ ] **Step 2: Find any other `set(` callers and confirm they still typecheck**

Run: `git grep -n "useCursorPos.getState().set(" -- src`
Expected: the EditorPane call (updated in Task 3) and any others. Because `cursorCount` is optional, two-arg calls remain valid. No other edits needed here.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/stores/cursorPos.ts
git commit -m "feat: cursorCount in cursor store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire EditorPane — extensions, commands, keymap, global, cursorCount

**Files:**
- Modify: `src/components/EditorPane.tsx`

- [ ] **Step 1: Add imports**

In `src/components/EditorPane.tsx`, line 3 is:
```ts
import { EditorView, keymap } from '@codemirror/view';
```
Change it to:
```ts
import { EditorView, keymap, rectangularSelection, crosshairCursor } from '@codemirror/view';
```
And add after the existing lib imports (after line 21 `import { matchingBracketTarget } from '../lib/brackets';`):
```ts
import { addCursorVertical } from '../lib/multicursor';
```

- [ ] **Step 2: Declare the new window global**

In the `declare global` block, after line 57 (`var __memopadBracketCommand: ((cmd: 'goto' | 'select') => void) | undefined;`), add:
```ts
  // eslint-disable-next-line no-var
  var __memopadMultiCursorCommand: ((dir: 'above' | 'below') => void) | undefined;
```

- [ ] **Step 3: Add the two commands**

After the `selectToMatchingBracket` function (ends line 80), add:
```ts
function addCursorAbove(view: EditorView): boolean {
  const selection = addCursorVertical(view.state, -1);
  if (selection === view.state.selection) return false;
  view.dispatch({ selection, scrollIntoView: true });
  return true;
}

function addCursorBelow(view: EditorView): boolean {
  const selection = addCursorVertical(view.state, 1);
  if (selection === view.state.selection) return false;
  view.dispatch({ selection, scrollIntoView: true });
  return true;
}
```

- [ ] **Step 4: Add the column-selection extensions**

In the `extensions={[ ... ]}` array (starts line 334), after `search(),` (line 337) add two lines:
```ts
            rectangularSelection(),
            crosshairCursor(),
```

- [ ] **Step 5: Add the keymap entries**

In the `Prec.high(keymap.of([ ... ]))` block (lines 338-341), after the `Mod-Shift-\\` entry add:
```ts
              { key: 'Mod-Alt-ArrowUp', run: addCursorAbove, preventDefault: true },
              { key: 'Mod-Alt-ArrowDown', run: addCursorBelow, preventDefault: true },
```

- [ ] **Step 6: Make multi-selection explicit in basicSetup**

In the `basicSetup={{ ... }}` object (lines 375-383), add two keys (e.g. after `lineNumbers: true,`):
```ts
            drawSelection: true,
            allowMultipleSelections: true,
```

- [ ] **Step 7: Register the focused-pane global + cleanup**

In the dispatcher effect, after the `__memopadBracketCommand` assignment (ends line 279), add:
```ts
    globalThis.__memopadMultiCursorCommand = (dir) => {
      const v = viewRef.current;
      if (!v) return;
      (dir === 'above' ? addCursorAbove : addCursorBelow)(v);
      v.focus();
    };
```
And in that effect's cleanup `return () => { ... }` (lines 280-285), after `globalThis.__memopadBracketCommand = undefined;` add:
```ts
      globalThis.__memopadMultiCursorCommand = undefined;
```

- [ ] **Step 8: Report cursorCount in onUpdate**

In the `onUpdate` handler, the focused branch currently reads:
```ts
            if (props.focused) {
              const headLine = viewUpdate.state.doc.lineAt(head);
              useCursorPos.getState().set(headLine.number, head - headLine.from + 1);
            }
```
Change the `set(...)` call to pass the range count:
```ts
            if (props.focused) {
              const headLine = viewUpdate.state.doc.lineAt(head);
              useCursorPos.getState().set(
                headLine.number,
                head - headLine.from + 1,
                viewUpdate.state.selection.ranges.length,
              );
            }
```

- [ ] **Step 9: Typecheck + existing tests**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all existing tests still pass (the multicursor unit tests from Task 1 included).

- [ ] **Step 10: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "feat: column selection + add-cursor commands in EditorPane

rectangularSelection/crosshairCursor (Alt+drag), Ctrl+Alt+Up/Down add
cursor above/below, __memopadMultiCursorCommand global, cursorCount in onUpdate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Status-bar cursor-count segment

**Files:**
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Read cursorCount**

In `src/components/StatusBar.tsx`, after line 30 (`const col = useCursorPos((s) => s.col);`) add:
```ts
  const cursorCount = useCursorPos((s) => s.cursorCount);
```

- [ ] **Step 2: Render the segment**

Immediately after the cursor `<span>` (line 56, `<span data-status-segment="cursor">Ln {line}, Col {col}</span>`), add:
```tsx
      {cursorCount > 1 && (
        <span data-status-segment="cursors">{cursorCount} cursors</span>
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/StatusBar.tsx
git commit -m "feat: status-bar cursor-count segment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Command-palette entries

**Files:**
- Modify: `src/commands/builtins.ts`

- [ ] **Step 1: Register the two commands**

In `src/commands/builtins.ts`, after the `edit.deleteLine` registration (ends line 243), add:
```ts
  register({
    id: 'edit.addCursorAbove',
    title: 'Edit: Add Cursor Above',
    shortcut: 'Ctrl+Alt+Up',
    run: () => globalThis.__memopadMultiCursorCommand?.('above'),
  });
  register({
    id: 'edit.addCursorBelow',
    title: 'Edit: Add Cursor Below',
    shortcut: 'Ctrl+Alt+Down',
    run: () => globalThis.__memopadMultiCursorCommand?.('below'),
  });
```
(`globalThis.__memopadMultiCursorCommand` is typed via the `declare global` block in EditorPane.tsx added in Task 3, so this typechecks.)

- [ ] **Step 2: Typecheck + command test**

Run: `npx tsc --noEmit && npm test -- commands`
Expected: tsc clean; command-registry tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/commands/builtins.ts
git commit -m "feat: Add Cursor Above/Below palette commands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `__memopadTestSelectionCount` test hook

**Files:**
- Modify: `src/main.tsx`

`useCursorPos` is already imported in `main.tsx` (used by `__memopadTestCursorPos`).

- [ ] **Step 1: Declare the hook type**

In `src/main.tsx`, in the `const w = window as unknown as { ... }` type block, after line 45 (`__memopadTestCursorPos?: () => { line: number; col: number };`) add:
```ts
  __memopadTestSelectionCount?: () => number;
```

- [ ] **Step 2: Assign the hook**

After the `w.__memopadTestCursorPos = ...` assignment (lines 81-84), add:
```ts
w.__memopadTestSelectionCount = () => useCursorPos.getState().cursorCount;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx
git commit -m "test: __memopadTestSelectionCount hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: e2e spec

**Files:**
- Create: `tests/e2e/multicursor.spec.ts`

Mirror the boilerplate of an existing spec — open `tests/e2e/bracket-nav.spec.ts` and copy its import block, `getBrowser`/`classicExecute` usage, and `beforeEach` reset (it calls `__memopadTestReset` and seeds content). Use the same helpers (`setEditorContent`/`getEditorContent`/`resetBuffer` from `support/helpers.ts`). Alt+drag is NOT synthesized (manual smoke covers it); drive via globals.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/multicursor.spec.ts` following the sibling spec's structure, with these tests:

```ts
// (imports + getBrowser/classicExecute + beforeEach reset copied from bracket-nav.spec.ts)

describe('multi-cursor', () => {
  it('Add Cursor Below stacks a second cursor; Escape collapses it', async () => {
    await setEditorContent('abc\ndef');
    // place caret at start (line 1, col 1)
    await classicExecute(`window.__memopadGotoLine(1);`);
    await classicExecute(`window.__memopadMultiCursorCommand('below');`);
    const after = await classicExecute<number>(`return window.__memopadTestSelectionCount();`);
    expect(after).to.equal(2);

    // Escape collapses to the primary cursor (CM defaultKeymap simplifySelection)
    await getBrowser().keys(['Escape']);
    const collapsed = await classicExecute<number>(`return window.__memopadTestSelectionCount();`);
    expect(collapsed).to.equal(1);
  });

  it('typing with two cursors edits both lines at the same column', async () => {
    await setEditorContent('abc\ndef');
    await classicExecute(`window.__memopadGotoLine(1);`); // caret at line1 col1
    await classicExecute(`window.__memopadMultiCursorCommand('below');`); // + line2 col1
    await getBrowser().keys(['X']);
    const content = await getEditorContent();
    expect(content).to.equal('Xabc\nXdef');
  });

  it('registers the Add Cursor palette commands', async () => {
    const ids = await classicExecute<string[]>(`return window.__memopadTestCommandIds();`);
    expect(ids).to.include('edit.addCursorAbove');
    expect(ids).to.include('edit.addCursorBelow');
  });
});
```

Notes for the implementer:
- Match the actual signatures of `classicExecute`, `setEditorContent`, `getEditorContent`, and `getBrowser` as used in `bracket-nav.spec.ts` (adjust `return`/arg style to the real helper). `__memopadGotoLine`, `__memopadMultiCursorCommand`, `__memopadTestSelectionCount`, `__memopadTestCommandIds` are all `window` globals.
- If the typing test proves timing-flaky under WebDriver, keep the count/Escape and command-registration tests (the editing semantics are CM-native and unit-covered via Task 1); note any drop in the commit message rather than leaving a flaky test.

- [ ] **Step 2: (Local) typecheck the spec**

Run: `npx tsc --noEmit`
Expected: clean. (Do NOT attempt to run mocha locally — fresh builds render blank on this machine; e2e runs in CI.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/multicursor.spec.ts
git commit -m "test: e2e for column/multi-cursor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Verify, review, ship

- [ ] **Step 1: Full local gates**

Run: `npx tsc --noEmit && npm test` and `cd src-tauri && cargo test`
Expected: tsc clean; vitest all pass (≈ +5 from Task 1); cargo unchanged-green.

- [ ] **Step 2: Code review**

Invoke `superpowers:requesting-code-review` on `main..HEAD`. Address high-confidence findings.

- [ ] **Step 3: CI e2e validation (recovers the blocked local gate)**

Push the feature branch, then: `gh workflow run e2e.yml --ref <branch>` and `gh run watch <id> --exit-status`. Confirm the suite (existing 87 + new spec) is green in CI's clean environment. (Per known-e2e-failures: a single non-reproducing spec failing is the documented flake — rerun; a deterministic failure of the new spec is real.)

- [ ] **Step 4: Release (confirm with user before the outward push/release)**

Bump version to **1.3.0** (minor — new feature) in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (`app` entry); add a `## [1.3.0]` CHANGELOG entry (column/multi-cursor editing). Commit `chore: 1.3.0 — column/multi-cursor editing`. Merge `--no-ff` to `main`, push, tag `v1.3.0`, push tag → `release.yml` publishes the signed release. **Confirm with the user before pushing/releasing.**

- [ ] **Step 5: Manual smoke (GUI, when a working local build is available)**

Alt+drag a column across several lines → type → all rows edited; Ctrl+Alt+↓ stacks a cursor; Esc collapses; status bar shows "N cursors" then hides. (Needs a non-blank local build — `cargo clean` + rebuild if the local blank-render persists.)

---

## Self-review notes

- **Spec coverage:** column Alt+drag ✓(T3 S4) · keyboard stack ✓(T1+T3) · palette ✓(T5) · status bar ✓(T2+T4) · Escape collapse = CM default (noted, no task) · test hook ✓(T6) · unit tests ✓(T1) · e2e ✓(T7). All spec goals mapped.
- **Type consistency:** `addCursorVertical(state, dir: -1|1): EditorSelection` defined T1, used T3; no-op contract is "returns `state.selection` by reference," checked via `=== view.state.selection` in T3 S3. `cursorCount` optional-3rd-arg `set` defined T2, called T3 S8, read T4/T6. `__memopadMultiCursorCommand('above'|'below')` declared T3 S2, assigned T3 S7, called T5. `__memopadTestSelectionCount` declared+assigned T6.
- **No placeholders:** every code step shows full code; e2e boilerplate references a concrete sibling (`bracket-nav.spec.ts`) to copy rather than inventing helper signatures.
