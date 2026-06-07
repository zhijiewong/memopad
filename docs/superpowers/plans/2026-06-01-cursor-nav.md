# Cursor Navigation (Ln/Col + Go to Line) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live `Ln x, Col y` status-bar indicator for the focused editor and a Go to Line dialog (`Ctrl+G` / command palette).

**Architecture:** A tiny `useCursorPos` store holds the focused editor's `{line, col}`; `EditorPane` updates it from its `onUpdate` (focused pane only) and exposes a `__memopadGotoLine` focused-pane global; `StatusBar` renders the position; a `GoToLineDialog` calls the global. Frontend-only — no Rust/persistence changes.

**Tech Stack:** React 18 + TS, Zustand, CodeMirror 6 (`@uiw/react-codemirror`); Vitest + WebdriverIO/Mocha.

Spec: `docs/superpowers/specs/2026-06-01-cursor-nav-design.md`

---

## File Structure

- **Create** `src/lib/cursor.ts` — pure `parseGotoLine` helper.
- **Create** `src/stores/cursorPos.ts` — `{line, col, set, reset}` store.
- **Create** `src/components/GoToLineDialog.tsx` — the jump dialog.
- **Create** `src/tests/cursor-nav.test.ts` — store + helper vitest.
- **Create** `tests/e2e/cursor-nav.spec.ts` — e2e.
- **Modify** `src/main.tsx` — `__memopadTestCursorPos` hook.
- **Modify** `src/components/EditorPane.tsx` — report line/col; `__memopadGotoLine` global + type decl.
- **Modify** `src/components/StatusBar.tsx` — `cursor` segment.
- **Modify** `src/App.tsx` — `gotoLineOpen` state, render dialog, `__memopadOpenGotoLine` hook, `Ctrl+G`.
- **Modify** `src/commands/builtins.ts` — `edit.gotoLine` command.
- **Modify** `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` / `CHANGELOG.md` — 0.6.0.

---

## Task 1: parseGotoLine pure helper

**Files:**
- Create: `src/lib/cursor.ts`
- Create: `src/tests/cursor-nav.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/cursor-nav.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseGotoLine } from '../lib/cursor';

describe('parseGotoLine', () => {
  it('returns an in-range line as-is', () => {
    expect(parseGotoLine('5', 10)).toBe(5);
  });
  it('clamps above total to the last line', () => {
    expect(parseGotoLine('99', 10)).toBe(10);
  });
  it('clamps below 1 to 1', () => {
    expect(parseGotoLine('0', 10)).toBe(1);
    expect(parseGotoLine('-3', 10)).toBe(1);
  });
  it('rejects non-numeric and empty input', () => {
    expect(parseGotoLine('abc', 10)).toBeNull();
    expect(parseGotoLine('', 10)).toBeNull();
    expect(parseGotoLine('  ', 10)).toBeNull();
    expect(parseGotoLine('3.5', 10)).toBeNull();
  });
  it('guards totalLines of 0', () => {
    expect(parseGotoLine('5', 0)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/cursor-nav.test.ts`
Expected: FAIL — cannot resolve `../lib/cursor`.

- [ ] **Step 3: Implement**

Create `src/lib/cursor.ts`:

```ts
/** Parse a Go-to-Line input; return the clamped 1-based line, or null if not an integer. */
export function parseGotoLine(input: string, totalLines: number): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return null;
  return Math.max(1, Math.min(n, Math.max(1, totalLines)));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/tests/cursor-nav.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cursor.ts src/tests/cursor-nav.test.ts
git commit -m "feat(cursor): parseGotoLine helper"
```

---

## Task 2: Cursor position store + test hook

**Files:**
- Create: `src/stores/cursorPos.ts`
- Modify: `src/tests/cursor-nav.test.ts`
- Modify: `src/main.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/tests/cursor-nav.test.ts`:

```ts
import { useCursorPos } from '../stores/cursorPos';

describe('useCursorPos', () => {
  it('defaults to 1,1', () => {
    useCursorPos.getState().reset();
    expect(useCursorPos.getState().line).toBe(1);
    expect(useCursorPos.getState().col).toBe(1);
  });
  it('set updates line and col', () => {
    useCursorPos.getState().set(7, 3);
    expect(useCursorPos.getState().line).toBe(7);
    expect(useCursorPos.getState().col).toBe(3);
  });
  it('reset returns to 1,1', () => {
    useCursorPos.getState().set(9, 9);
    useCursorPos.getState().reset();
    expect(useCursorPos.getState().line).toBe(1);
    expect(useCursorPos.getState().col).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/tests/cursor-nav.test.ts`
Expected: FAIL — cannot resolve `../stores/cursorPos`.

- [ ] **Step 3: Implement the store**

Create `src/stores/cursorPos.ts`:

```ts
import { create } from 'zustand';

interface CursorPosState {
  line: number; // 1-based
  col: number;  // 1-based
  set: (line: number, col: number) => void;
  reset: () => void;
}

export const useCursorPos = create<CursorPosState>((set) => ({
  line: 1,
  col: 1,
  set: (line, col) => set({ line, col }),
  reset: () => set({ line: 1, col: 1 }),
}));
```

- [ ] **Step 4: Add the e2e read hook**

In `src/main.tsx`, add the import at the top:

```ts
import { useCursorPos } from './stores/cursorPos';
```

Add to the `w` type declaration object:

```ts
  __memopadTestCursorPos?: () => { line: number; col: number };
```

Add the assignment alongside the other `w.__memopad*` lines (before `ReactDOM.createRoot`):

```ts
w.__memopadTestCursorPos = () => ({
  line: useCursorPos.getState().line,
  col: useCursorPos.getState().col,
});
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/tests/cursor-nav.test.ts && npx tsc --noEmit`
Expected: PASS (8 tests) + tsc clean. (Trust tsc, not the LSP.)

- [ ] **Step 6: Commit**

```bash
git add src/stores/cursorPos.ts src/tests/cursor-nav.test.ts src/main.tsx
git commit -m "feat(cursor): cursorPos store + test hook"
```

---

## Task 3: EditorPane reports line/col + exposes __memopadGotoLine

**Files:**
- Modify: `src/components/EditorPane.tsx`

- [ ] **Step 1: Add the import**

In `src/components/EditorPane.tsx`, add to the store imports (near the `useTheme` import):

```ts
import { useCursorPos } from '../stores/cursorPos';
```

- [ ] **Step 2: Declare the global type**

In the `declare global { ... }` block (the one declaring `var __memopadSearchPanel`), add another declaration inside the same block:

```ts
  // eslint-disable-next-line no-var
  var __memopadGotoLine: ((n: number) => void) | undefined;
```

- [ ] **Step 3: Report line/col from onUpdate**

In the `<CodeMirror onUpdate={...}>` handler, which currently reads:

```tsx
          onUpdate={(viewUpdate) => {
            if (!viewUpdate.selectionSet && !viewUpdate.geometryChanged) return;
            const head = viewUpdate.state.selection.main.head;
            const scrollTop = viewUpdate.view.scrollDOM.scrollTop;
            persistCursor(head, scrollTop);
          }}
```

change it to also report the caret line/col when this pane is focused:

```tsx
          onUpdate={(viewUpdate) => {
            if (!viewUpdate.selectionSet && !viewUpdate.geometryChanged) return;
            const head = viewUpdate.state.selection.main.head;
            const scrollTop = viewUpdate.view.scrollDOM.scrollTop;
            persistCursor(head, scrollTop);
            if (props.focused) {
              const headLine = viewUpdate.state.doc.lineAt(head);
              useCursorPos.getState().set(headLine.number, head - headLine.from + 1);
            }
          }}
```

- [ ] **Step 4: Register the goto-line global (focused pane)**

In the `useEffect` that registers `globalThis.__memopadSearchPanel` (gated on `props.focused`), add the goto-line global. Inside that effect body, after the `__memopadSearchPanel = {...}` assignment, add:

```ts
    globalThis.__memopadGotoLine = (n: number) => {
      const v = viewRef.current;
      if (!v) return;
      const total = v.state.doc.lines;
      const line = Math.max(1, Math.min(n, total));
      const pos = v.state.doc.line(line).from;
      v.dispatch({
        selection: { anchor: pos, head: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      });
      v.focus();
    };
```

And in that effect's cleanup `return () => { ... }` (which sets `__memopadSearchPanel = undefined`), add:

```ts
      globalThis.__memopadGotoLine = undefined;
```

(`EditorView` and `viewRef` are already in scope in this file.)

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "feat(editor): report caret line/col + __memopadGotoLine"
```

---

## Task 4: Status-bar Ln/Col segment

**Files:**
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Implement the segment**

In `src/components/StatusBar.tsx`, add the import:

```ts
import { useCursorPos } from '../stores/cursorPos';
```

Inside the `StatusBar` component, add the subscriptions (next to the other store reads):

```ts
  const line = useCursorPos((s) => s.line);
  const col = useCursorPos((s) => s.col);
```

Add a display-only segment as the FIRST child inside the returned status-bar `<div>` (before the `language` segment span):

```tsx
      <span data-status-segment="cursor">Ln {line}, Col {col}</span>
```

- [ ] **Step 2: Verify types + no regressions**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; vitest green.

- [ ] **Step 3: Commit**

```bash
git add src/components/StatusBar.tsx
git commit -m "feat(statusbar): Ln/Col cursor segment"
```

---

## Task 5: Go to Line dialog

**Files:**
- Create: `src/components/GoToLineDialog.tsx`

- [ ] **Step 1: Implement**

Create `src/components/GoToLineDialog.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useBuffers, selectFocused } from '../stores/buffers';
import { useCursorPos } from '../stores/cursorPos';
import { parseGotoLine } from '../lib/cursor';

interface Props {
  onClose: () => void;
}

export function GoToLineDialog({ onClose }: Props) {
  const focused = useBuffers(selectFocused);
  const currentLine = useCursorPos((s) => s.line);
  const totalLines = focused ? focused.content.split('\n').length : 1;

  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(String(currentLine));

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function commit() {
    const line = parseGotoLine(value, totalLines);
    if (line == null) return; // keep open on invalid input
    globalThis.__memopadGotoLine?.(line);
    onClose();
  }

  return (
    <div
      data-testid="goto-line-dialog"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-24"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="min-w-[280px] rounded border border-neutral-700 bg-neutral-900 p-3 text-sm text-neutral-200 shadow-xl">
        <label className="mb-2 block text-neutral-400" htmlFor="goto-line-input">
          Go to line (1–{totalLines})
        </label>
        <input
          id="goto-line-input"
          ref={inputRef}
          data-testid="goto-line-input"
          value={value}
          inputMode="numeric"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          className="w-full rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-neutral-100 outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/GoToLineDialog.tsx
git commit -m "feat(ui): Go to Line dialog"
```

---

## Task 6: App wiring — state, render, hook, Ctrl+G

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import + state**

In `src/App.tsx`, add the import (with the other component imports):

```ts
import { GoToLineDialog } from './components/GoToLineDialog';
```

In the `App` component, add state next to the other dialog states (`paletteOpen`, etc.):

```ts
  const [gotoLineOpen, setGotoLineOpen] = useState(false);
```

- [ ] **Step 2: Register the open hook**

In the `useEffect` that registers `__memopadToggleSidebar` / `__memopadShowQuickOpen` (the window-hooks effect), add:

```ts
    (window as unknown as { __memopadOpenGotoLine?: () => void }).__memopadOpenGotoLine = () => {
      if (selectFocused(useBuffers.getState())) setGotoLineOpen(true);
    };
```

(`selectFocused` and `useBuffers` are already imported in App.tsx.)

- [ ] **Step 3: Add the Ctrl+G shortcut**

In the keydown handler (after the `mod` guard, with the other `Ctrl+<key>` branches), add:

```ts
      if (key === 'g' && !e.shiftKey) {
        e.preventDefault();
        (window as unknown as { __memopadOpenGotoLine?: () => void }).__memopadOpenGotoLine?.();
        return;
      }
```

- [ ] **Step 4: Render the dialog**

After the `{quickOpenShown && (...)}` block in the returned JSX, add:

```tsx
      {gotoLineOpen && (
        <GoToLineDialog onClose={() => setGotoLineOpen(false)} />
      )}
```

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): Ctrl+G opens Go to Line"
```

---

## Task 7: Command palette entry

**Files:**
- Modify: `src/commands/builtins.ts`

- [ ] **Step 1: Implement**

In `src/commands/builtins.ts`, add the command registration after the `edit.replace` registration (near the other `edit.*` commands):

```ts
  register({
    id: 'edit.gotoLine',
    title: 'Edit: Go to Line',
    shortcut: 'Ctrl+G',
    run: () => (window as unknown as { __memopadOpenGotoLine?: () => void }).__memopadOpenGotoLine?.(),
  });
```

- [ ] **Step 2: Verify types + no regressions**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; vitest green (the `commands` test uses `toBeGreaterThanOrEqual`, so no count update needed).

- [ ] **Step 3: Commit**

```bash
git add src/commands/builtins.ts
git commit -m "feat(commands): Edit: Go to Line"
```

---

## Task 8: e2e — Ln/Col indicator + Go to Line

**Files:**
- Create: `tests/e2e/cursor-nav.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/cursor-nav.spec.ts`:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('cursor navigation', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestNewBuffer?: () => string;
        __memopadTestSetContent?: (s: string) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestNewBuffer?.();
      // 10 lines.
      w.__memopadTestSetContent?.(Array.from({ length: 10 }, (_, i) => 'line ' + (i + 1)).join('\n'));
    });
    await sleep(250);
  });

  it('Go to Line moves the caret and updates the Ln/Col indicator', async () => {
    await classicExecute<void>(`window.__memopadGotoLine(5); return undefined;`);
    await sleep(200);

    const pos = await classicExecute<{ line: number; col: number }>(
      `return window.__memopadTestCursorPos();`,
    );
    expect(pos.line, 'caret should be on line 5').to.equal(5);
    expect(pos.col, 'caret at column 1').to.equal(1);

    const segText = await classicExecute<string>(
      `return (document.querySelector('[data-status-segment="cursor"]') || {}).textContent || '';`,
    );
    expect(segText).to.match(/Ln\s*5,\s*Col\s*1/);
  });

  it('clamps an out-of-range line to the last line', async () => {
    await classicExecute<void>(`window.__memopadGotoLine(999); return undefined;`);
    await sleep(200);
    const pos = await classicExecute<{ line: number; col: number }>(
      `return window.__memopadTestCursorPos();`,
    );
    expect(pos.line, 'caret clamps to line 10').to.equal(10);
  });
});
```

- [ ] **Step 2: Note on running**

Run the whole suite at the end (Task 10). To run just this spec after a release build exists:
`npx mocha --grep "cursor navigation"`
Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/cursor-nav.spec.ts
git commit -m "test(e2e): Go to Line + Ln/Col indicator"
```

---

## Task 9: Version bump + CHANGELOG (0.6.0)

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump versions to 0.6.0**

- `package.json`: `"version": "0.5.0"` → `"0.6.0"`.
- `src-tauri/Cargo.toml`: the `[package]` `version = "0.5.0"` → `"0.6.0"`.
- `src-tauri/tauri.conf.json`: `"version": "0.5.0"` → `"0.6.0"`.

- [ ] **Step 2: Sync Cargo.lock**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
(Refreshes the `app` package entry in `Cargo.lock` to 0.6.0. A trailing signing-key error after artifacts are produced is benign.)

- [ ] **Step 3: Add CHANGELOG entry**

In `CHANGELOG.md`, under `## [Unreleased]`, add:

```markdown
## [0.6.0] — 2026-06-01

Cursor navigation: always know where the caret is, and jump anywhere by line number.

### Added

- **Ln/Col indicator** — the status bar shows the focused editor's caret position
  (`Ln x, Col y`, 1-based).
- **Go to Line** — `Ctrl+G` (or the command palette, "Edit: Go to Line") opens a dialog
  to jump the caret to a line number; out-of-range values clamp to the nearest line.

### Known limitations

- Windows only
- Unsigned MSI — SmartScreen warning on first install
- Column counts characters (a tab is one column), not visual width
- Split view is two panes max, horizontal only
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all green.

- [ ] **Step 5: Commit**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: bump to 0.6.0 + changelog for cursor navigation"
```

---

## Task 10: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: all green (no Rust changes in this feature, so unchanged count).

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
Expected: full suite green, including the 2 new `cursor navigation` tests. (Note: `npx mocha` can intermittently exit 1 on the post-suite `zz-close` session-teardown race even with all tests passing — re-run to confirm.)

- [ ] **Step 4: Manual GUI smoke**

Per the GUI-verification practice: drive the real WebView via the e2e harness + `saveScreenshot`, then `Read` the PNG. Open a multi-line buffer, confirm the `Ln x, Col y` segment tracks the caret, open Go to Line (`Ctrl+G` path via the `__memopadOpenGotoLine` hook), jump to a line, and confirm the caret + indicator move. (Throwaway smoke spec; delete it + the PNGs after viewing.)

- [ ] **Step 5: Final commit (only if smoke fixups were needed)** — otherwise nothing to commit.

---

## Self-Review notes

- **Spec coverage:** `parseGotoLine` (T1), `useCursorPos` + hook (T2), EditorPane report + `__memopadGotoLine` (T3), status-bar segment (T4), dialog (T5), App state/hook/Ctrl+G (T6), command (T7), e2e (T8), version+changelog (T9), GUI smoke (T10). All spec sections map to tasks.
- **Type consistency:** `useCursorPos` (`line`/`col`/`set`/`reset`); `parseGotoLine(input, totalLines)`; globals `__memopadGotoLine(n)`, `__memopadOpenGotoLine()`, `__memopadTestCursorPos()`; command id `edit.gotoLine`. Used identically across tasks.
- **Gotchas captured:** the goto-line global is gated on `props.focused` (single pane → always registered, used by e2e); the `commands` vitest uses `toBeGreaterThanOrEqual` (no count update); intermittent `zz-close` teardown exit-1 noted in T10.
```
