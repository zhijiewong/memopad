# Cursor Navigation: Ln/Col Indicator + Go to Line — Design

**Date:** 2026-06-01
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 0.6.0

## Problem

The status bar shows language / encoding / EOL / wrap but not the caret position, and
there is no Go to Line command. Both are baseline Notepad++ navigation affordances. This
adds:

- **Ln/Col indicator** — a live `Ln x, Col y` status-bar segment for the focused editor.
- **Go to Line** — `Ctrl+G` (and command palette) opens a dialog to jump the caret to a
  line number.

## Decisions (locked during brainstorming)

- **1-based** line and column (Notepad++ style).
- **Column counts characters**, not visual/tab-expanded width (a tab = 1 column).
- **`Ctrl+G`** opens Go to Line (also in the command palette).
- The indicator shows the **caret** position only — no selection-length ("Sel: N"),
  no "go to column", no raw offset.

## Architecture

A minimal `useCursorPos` store holds the focused editor's `{ line, col }`. `EditorPane`
writes it on every selection change (only from the focused pane). `StatusBar` renders it.
Go to Line is a small dialog that calls a focused-pane global (`__memopadGotoLine`) to
dispatch a selection to the chosen line.

```
EditorPane (focused) --onUpdate--> useCursorPos {line,col} --> StatusBar segment
GoToLineDialog --__memopadGotoLine(n)--> focused EditorPane view.dispatch(selection+scroll)
Ctrl+G / palette --__memopadOpenGotoLine--> GoToLineDialog
```

### 1. Cursor position store — `src/stores/cursorPos.ts` (new)

```ts
interface CursorPosState {
  line: number;   // 1-based, default 1
  col: number;    // 1-based, default 1
  set: (line: number, col: number) => void;
  reset: () => void;
}
```

Modeled on the other small stores (`theme`, `editorPrefs`).

### 2. Editor wiring — `src/components/EditorPane.tsx`

- In the existing `onUpdate` handler (already fires on `selectionSet`): when `props.focused`,
  compute the caret line/col from the primary selection head via CodeMirror —
  `const headLine = view.state.doc.lineAt(head); const line = headLine.number; const col = head - headLine.from + 1;` — and call `useCursorPos.getState().set(line, col)`. Immediate (no
  debounce); this is O(log n) in CM and cheap.
- Gating on `props.focused` means: single pane always reports; in split, only the focused
  pane reports (so the indicator tracks the pane the user is in). Switching panes
  (`Ctrl+1/2`) re-focuses the target view, which fires a selection update and reports.
- Register a focused-pane global in the same `useEffect` that registers
  `__memopadSearchPanel` (gated on `props.focused`):

```ts
globalThis.__memopadGotoLine = (n: number) => {
  const v = viewRef.current;
  if (!v) return;
  const total = v.state.doc.lines;
  const line = Math.max(1, Math.min(n, total));
  const pos = v.state.doc.line(line).from;
  v.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  v.focus();
};
```

Cleared to `undefined` on unmount / focus loss, exactly like `__memopadSearchPanel`.

### 3. Status bar — `src/components/StatusBar.tsx`

Add a display-only `data-status-segment="cursor"` span reading `Ln {line}, Col {col}` from
`useCursorPos`, placed left of the `language` segment (Notepad++ ordering). Rendered only
when there is an active buffer (the component already early-returns an empty bar otherwise).

### 4. Go to Line dialog — `src/components/GoToLineDialog.tsx` (new)

A small modal (pattern from `ConfirmDialog`): a numeric text input prefilled with the
current line (`useCursorPos.line`), placeholder `1–{totalLines}`. On Enter, parse via the
pure `parseGotoLine` helper; if valid, call `globalThis.__memopadGotoLine(n)` and close;
Esc/backdrop cancels. Out-of-range values are clamped (the helper returns the clamped line);
non-numeric input keeps the dialog open. `totalLines` is derived from the focused buffer's
content (`content.split('\n').length`).

### 5. Triggers — `src/App.tsx` + `src/commands/builtins.ts`

- **`src/lib/cursor.ts` (new):** the pure helper

```ts
/** Parse a Go-to-Line input; return the clamped 1-based line, or null if not a number. */
export function parseGotoLine(input: string, totalLines: number): number | null {
  const n = Number(input.trim());
  if (!Number.isInteger(n) || input.trim() === '') return null;
  return Math.max(1, Math.min(n, Math.max(1, totalLines)));
}
```

- **`App.tsx`:** a `gotoLineOpen` state + render `<GoToLineDialog>`; register
  `__memopadOpenGotoLine = () => { if (focused buffer exists) setGotoLineOpen(true); }`; add
  `Ctrl+G` (`key === 'g' && !shift`) in the keydown handler → `__memopadOpenGotoLine()`.
- **`builtins.ts`:** `register({ id: 'edit.gotoLine', title: 'Edit: Go to Line', shortcut: 'Ctrl+G', run: () => globalThis.__memopadOpenGotoLine?.() })`.

## Error handling / edge cases

| Case | Handling |
|------|----------|
| No focused buffer | Ctrl+G / command no-op (guard in `__memopadOpenGotoLine`); status bar hides the segment |
| Line > total | `__memopadGotoLine` + `parseGotoLine` clamp to the last line |
| Line < 1 / non-numeric | `parseGotoLine` clamps to 1 / returns null (dialog stays open) |
| Split view | Focused pane reports position and is the goto target |
| Caret via mouse/keyboard/search | All route through `onUpdate` → consistent indicator |

## Testing strategy

- **vitest** (`src/tests/cursor-nav.test.ts`): `useCursorPos` store (set/reset/defaults);
  `parseGotoLine` table test — valid in-range, clamp-high, clamp-low, non-numeric → null,
  empty → null, totalLines=0 guard.
- **e2e** (`tests/e2e/cursor-nav.spec.ts`, release build): open a multi-line buffer; move the
  caret (set selection) and assert the `cursor` status segment reads the expected `Ln/Col`;
  call `__memopadGotoLine(N)` (or open the dialog) and assert a new `__memopadTestCursorPos()`
  hook returns line N and the segment updates. Mind the alphabetical-order / state-leak e2e
  gotchas (reset via existing hooks in `beforeEach`).

## Scope boundaries (YAGNI — non-goals)

- No selection-length / "Sel: N" readout.
- No visual/tab-expanded column (characters only).
- No "go to column" or go-to-offset.
- No persisted last-used line.

## Release

Ships as **0.6.0**. CHANGELOG: Added — Ln/Col status-bar indicator and Go to Line
(`Ctrl+G` / palette). Version bump in `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json` per the established release procedure. (No Rust/persistence
changes — this is a frontend-only slice.)
