# Bracket Navigation — Design

**Date:** 2026-06-07
**Ships as:** 1.2.0
**Scope:** Frontend-only. No Rust, no IPC, no `SessionState`/session changes, no persistence.

## Overview

Memopad already has bracket-matching **highlight** and **auto-close** (both enabled
by CodeMirror's `basicSetup` in `EditorPane.tsx` — `bracketMatching: true`,
`closeBrackets: true`). What's missing is **navigation**: jumping the caret to the
matching bracket, and selecting the range to it. This is Notepad++'s "Go to matching
brace" (Ctrl+B there) and VS Code's "Go to Bracket".

This feature adds two commands:

- **Go to Matching Bracket** — move the caret to the bracket that matches the one
  adjacent to the caret. Bound to **`Ctrl+Shift+\`** (VS Code's binding; free here)
  and available in the command palette.
- **Select to Matching Bracket** — extend the selection from the current anchor to
  the matching bracket. Palette-only (no default keybinding).

Both leverage CodeMirror's existing, syntax-tree-aware matcher, so they are
language-aware for free (and fall back to plain-text bracket scanning for buffers
with no language).

## Goals

- Caret-on-a-bracket → jump to its partner, with clean ping-pong on repeat invocation.
- Works in the **focused** pane only (split-view safe), like the existing line ops.
- Pure, unit-testable matching core; no view/layout coupling in the logic.

## Non-goals (YAGNI)

- No jump-to-*nearest-enclosing* bracket when the caret is not adjacent to one
  (no-op instead).
- No select-to-enclosing-bracket / expand-selection.
- No configuration or preference, no new auto-close behavior, no changes to the
  existing highlight.
- No new persisted state.

## Architecture

### 1. `src/lib/brackets.ts` (new) — pure matching core

```ts
import { EditorState } from '@codemirror/state';
import { matchBrackets } from '@codemirror/language';

/**
 * Given a caret position, return the caret destination at the matching bracket,
 * or null when the caret is not adjacent to a balanced bracket.
 *
 * Looks for a bracket immediately before the caret (dir -1) first, then
 * immediately after it (dir +1) — matching CodeMirror's own bracket-matching
 * precedence so navigation agrees with the highlight. The destination is the
 * "far side" of the partner bracket (the side pointing away from the start
 * bracket) so repeated invocations ping-pong between the pair.
 */
export function matchingBracketTarget(state: EditorState, pos: number): number | null;
```

A result is *usable* only when `m && m.matched && m.end` (a bracket was found AND it
has a balanced partner of the correct type).

Algorithm:
1. `m = matchBrackets(state, pos, -1)` (bracket immediately before the caret).
2. If `m` is not usable, try `m = matchBrackets(state, pos, 1)` (bracket immediately
   after the caret). Falling through on "found but no valid match" — not just on
   `null` — handles the sandwiched case `)(` where one side is unbalanced.
3. If `m` is still not usable, return `null` (caret not adjacent to a balanced
   bracket — command no-ops).
4. Destination = far side of `m.end` relative to `m.start`:
   - if `m.end.from > m.start.from` → `m.end.to` (partner is to the right; land after it);
   - else → `m.end.from` (partner is to the left; land before it).
5. Return the destination.

`matchBrackets` operates on `EditorState` (no `EditorView`), so this is testable
directly against a constructed state.

### 2. `EditorPane.tsx` — command wrappers + wiring

Two `Command`-shaped wrappers (built on the helper, returning `boolean` so the
keymap can fall through on a no-op):

```ts
const goToMatchingBracket = (view: EditorView): boolean => {
  const pos = view.state.selection.main.head;
  const target = matchingBracketTarget(view.state, pos);
  if (target == null) return false;
  view.dispatch({ selection: { anchor: target, head: target },
                  effects: EditorView.scrollIntoView(target) });
  return true;
};

const selectToMatchingBracket = (view: EditorView): boolean => {
  const { anchor, head } = view.state.selection.main;
  const target = matchingBracketTarget(view.state, head);
  if (target == null) return false;
  view.dispatch({ selection: { anchor, head: target },
                  effects: EditorView.scrollIntoView(target) });
  return true;
};
```

Wiring mirrors the existing line ops exactly:
- **Keymap:** add `{ key: 'Mod-Shift-\\', run: goToMatchingBracket, preventDefault: true }`
  to the existing `Prec.high(keymap.of([...]))` array (alongside `Mod-d`). Editor-scoped,
  so it only fires when an editor has focus.
- **Focused-pane window global:** `__memopadBracketCommand('goto' | 'select')`, gated
  on `props.focused`, runs the matching wrapper on `viewRef.current` then `.focus()` —
  mirrors `__memopadLineCommand`. Declared in the existing `declare global` block and
  registered/cleared in the focused-pane effect.

### 3. `src/commands/builtins.ts` — palette commands

Two commands dispatching to the window global (mirroring the existing line-op /
goto-line palette entries):

- `edit.goToMatchingBracket` — "Edit: Go to Matching Bracket" → `__memopadBracketCommand('goto')`
- `edit.selectToMatchingBracket` — "Edit: Select to Matching Bracket" → `__memopadBracketCommand('select')`

## Keybinding rationale

- `Ctrl+B` — taken (sidebar toggle).
- `Ctrl+\` — taken (split view).
- `Ctrl+Shift+\` — **free**, and is VS Code's "Go to Bracket". Chosen for go-to.
- Select-to-bracket gets no default binding (palette-only) — VS Code ships none either,
  and chord space is tight.

## Testing

**vitest — `src/tests/brackets.test.ts`** (pure helper, no view):
- caret immediately before `(` → target after the matching `)`.
- caret immediately after `)` → target before the matching `(`.
- nested pairs resolve to the correct partner (not the nearest).
- caret not adjacent to any bracket → `null`.
- mismatched/unbalanced bracket → `null`.
- plain-text buffer (no language extension) still matches `()[]{}`.
- ping-pong: applying the target twice returns to the original caret position.

**e2e — `tests/e2e/bracket-nav.spec.ts`:**
- open a buffer containing a bracketed line, place the caret next to a bracket,
  call `__memopadBracketCommand('goto')`, assert the caret moved to the partner via
  `__memopadTestCursorPos` (Ln/Col).
- assert `edit.goToMatchingBracket` and `edit.selectToMatchingBracket` are registered
  (`__memopadTestCommandIds`).

## Files touched

- `src/lib/brackets.ts` — **new** (pure helper).
- `src/components/EditorPane.tsx` — command wrappers, keymap entry, window global.
- `src/commands/builtins.ts` — two palette commands.
- `src/tests/brackets.test.ts` — **new** (unit tests).
- `tests/e2e/bracket-nav.spec.ts` — **new** (e2e).
- `CHANGELOG.md` + version bump (package.json / tauri.conf.json / Cargo.toml / Cargo.lock)
  to **1.2.0** at integration.

## Release

Ship as **1.2.0** via the established flow: gates green → version bump + CHANGELOG →
merge `--no-ff` to main → push → tag `v1.2.0` → `release.yml` builds the signed release.
