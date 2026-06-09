# Column / Multi-Cursor Editing — Design

**Date:** 2026-06-09
**Status:** Approved
**Scope:** Frontend-only (no Rust / IPC / session / persistence). Notepad++-style
column mode + keyboard cursor-stacking.

## Motivation

Memopad has tabs, split view, find/replace, language support, and bracket navigation,
but lacks the power-user staple of **column (rectangular) editing** — selecting a
vertical block and editing every row at once. CodeMirror 6 provides the primitives
(`rectangularSelection`, `crosshairCursor`, multi-selection rendering), so this is a
small, contained slice that mirrors the existing bracket-nav / line-ops patterns.

## Goals

1. **Alt+drag** to make a rectangular/column selection; typing edits every row.
2. **Keyboard cursor-stacking**: add a cursor on the line above/below at the same column.
3. **Command-palette** entries for discoverability.
4. **Status-bar** indicator of the active cursor count when more than one.

## Non-goals (YAGNI)

- Select-next-occurrence (Ctrl+D is already bound to duplicate-line).
- Ctrl+click add/remove cursor (default CM behavior is acceptable as-is; not a deliverable).
- Persisting multiple cursors across restart (ephemeral; only the primary cursor persists,
  as today).

## Verified facts (CodeMirror, this repo)

- CM's `defaultKeymap` already binds **`Escape` → `simplifySelection`** (collapses a
  multi-selection to its primary range). No work needed for collapse.
- Move-line is **`Alt+↑/↓`**, copy-line is **`Shift+Alt+↑/↓`** (both via defaultKeymap),
  and `Ctrl+D` is the project's explicit duplicate-line. **`Ctrl+Alt+↑/↓` (`Mod-Alt-Arrow`)
  is free** — chosen for add-cursor-above/below (VS Code-aligned).
- **`insertCursorAbove`/`insertCursorBelow` are NOT exported by `@codemirror/commands`** —
  the keyboard cursor-stacking command must be written in this repo.
- `@uiw/react-codemirror`'s `basicSetup` enables `drawSelection` and
  `allowMultipleSelections` by default, but EditorPane passes a *custom* `basicSetup`
  object that omits them; they will be set explicitly so column rendering is unambiguous.

## Design

### Component / file changes

**`src/lib/multicursor.ts` (new) — pure logic, unit-tested**
```ts
import { EditorSelection, EditorState, SelectionRange } from '@codemirror/state';

/**
 * Return a selection that adds one cursor per existing range on the line
 * `dir` (-1 above, +1 below) at the same column, clamped to that line's length.
 * Ranges with no target line (top/bottom of doc) contribute no new cursor.
 * If nothing can be added, returns the original selection unchanged.
 */
export function addCursorVertical(state: EditorState, dir: -1 | 1): EditorSelection;
```
Implementation notes: for each range, take its `head`; find the current line via
`state.doc.lineAt(head)`; compute `col = head - line.from`; target line number
`line.number + dir`; bail for that range if out of `[1, state.doc.lines]`; new head =
`targetLine.from + Math.min(col, targetLine.length)`; collect new cursor ranges and
`EditorSelection.create([...existingRanges, ...newCursors], mainIndex)` keeping the main
range index pointing at the newest cursor (so repeated presses keep extending in `dir`).
De-duplicate so a press that lands on an existing cursor position doesn't create overlap.

**`src/components/EditorPane.tsx`**
- Import `rectangularSelection`, `crosshairCursor` from `@codemirror/view`;
  `EditorSelection` is not needed here (lives in the lib).
- Add to the `extensions` array: `rectangularSelection()`, `crosshairCursor()`.
- In the `basicSetup` object add `drawSelection: true` and `allowMultipleSelections: true`
  (explicit; currently inherited defaults).
- Two `EditorView` `Command`s, `addCursorAbove`/`addCursorBelow`, that read
  `addCursorVertical(view.state, ∓1)`, dispatch `{ selection }` if it changed, return
  `true` (so the keymap consumes the event) or `false` on no-op (key falls through).
- Extend the existing `Prec.high(keymap.of([...]))` with:
  `{ key: 'Mod-Alt-ArrowUp', run: addCursorAbove, preventDefault: true }` and
  `{ key: 'Mod-Alt-ArrowDown', run: addCursorBelow, preventDefault: true }`.
- A focused-pane window global `__memopadMultiCursorCommand(dir: 'above'|'below')`
  mirroring the existing `__memopadLineCommand` / `__memopadBracketCommand` dispatchers
  (runs the matching command on the focused pane's view).
- In the existing `onUpdate` handler (focused pane branch, where Ln/Col is set), also push
  `state.selection.ranges.length` into the cursor store.

**`src/stores/cursorPos.ts`**
- Add `cursorCount: number` (default 1) and include it in the existing setter (or a small
  dedicated setter) so it updates alongside `line`/`col`.

**`src/components/StatusBar.tsx`**
- Read `cursorCount`; when `> 1`, render a segment
  `data-status-segment="cursors"` reading e.g. `"3 cursors"`, placed next to the
  `Ln/Col` segment. Hidden when `cursorCount <= 1`.

**`src/commands/builtins.ts`**
- Register `edit.addCursorAbove` ("Edit: Add Cursor Above") and `edit.addCursorBelow`
  ("Edit: Add Cursor Below"), each invoking `window.__memopadMultiCursorCommand(...)`,
  following the existing bracket/line command registrations.

### Test hooks (`src/main.tsx`)

- `__memopadTestSelectionCount(): number` → returns `useCursorPos.getState().cursorCount`
  (kept current by EditorPane's `onUpdate`, focused-pane branch). This avoids reaching into
  the CM view from main.tsx and reuses the same value the status bar renders. Used by e2e.
  (The `__memopadMultiCursorCommand` global on `window`, set by EditorPane, is the dispatch
  hook; no separate test-only dispatcher needed.)

## Keybindings summary

| Action | Binding | Source |
|---|---|---|
| Column (rectangular) select | **Alt+drag** | `rectangularSelection()` |
| Add cursor above | **Ctrl+Alt+↑** | new command (verified free) |
| Add cursor below | **Ctrl+Alt+↓** | new command |
| Collapse to single cursor | **Escape** | CM defaultKeymap (existing) |
| Add Cursor Above / Below | command palette | `edit.addCursor*` |

## Testing

**Unit (vitest) — `src/tests/multicursor.test.ts`:**
- `addCursorVertical` down from a single cursor adds one cursor on the next line at the
  same column.
- Column clamps to a shorter target line's length.
- Stacking from N existing ranges adds N new cursors (one per range, where a target exists).
- Top-of-doc + dir −1 and bottom-of-doc + dir +1 add nothing for the boundary range
  (selection unchanged if all ranges are at the boundary).
- No duplicate cursor when the target position already holds a cursor.

**e2e (`tests/e2e/multicursor.spec.ts`):** drive via the window globals (Alt+drag is not
synthesizable reliably — manual smoke covers it):
- Open a multi-line buffer; `__memopadMultiCursorCommand('below')` once →
  `__memopadTestSelectionCount()` === 2.
- Type a character → assert it appears on both lines at the same column
  (via `__memopadTestGetContent`).
- Trigger Escape (keydown) → `__memopadTestSelectionCount()` === 1.
- Assert `edit.addCursorAbove` / `edit.addCursorBelow` are registered
  (`__memopadTestCommandIds()`).

**Manual smoke:** Alt+drag a column across several lines; type → all rows edited; Esc
collapses; status bar shows "N cursors" then hides.

## Gates / Definition of done

- `npx tsc --noEmit` clean · `npm test` (≥ current +5 new) · `cargo test` unchanged-green.
- e2e via CI (local fresh builds render blank on this machine — validate with the CI `E2E`
  workflow on the branch, per the known-e2e-failures note).
- Merge `--no-ff`, tag `v1.3.0` (new feature → minor bump), signed GitHub release.
