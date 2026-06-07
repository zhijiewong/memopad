# Line Operations Polish: Ctrl+D + Palette Entries — Design

**Date:** 2026-06-01
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 0.7.0

## Problem

CodeMirror's `defaultKeymap` (active in Memopad) already binds the core line
operations, but two gaps remain:

- **No `Ctrl+D` = Duplicate Line.** CM binds copy-line to `Ctrl+Alt+↓`; the
  Notepad++/common muscle-memory `Ctrl+D` is unbound.
- **No discoverability.** None of the line ops appear in the command palette, so a
  user who doesn't know the keys can't find them.

This is a small polish slice: add `Ctrl+D` and command-palette entries. It does **not**
re-implement move/copy/delete — those already work.

## Already works (do not touch)

| Operation | Key | Source |
|-----------|-----|--------|
| Move line up / down | `Alt+↑` / `Alt+↓` | CM `defaultKeymap` |
| Copy (duplicate) line up / down | `Ctrl+Alt+↑` / `Ctrl+Alt+↓` | CM `defaultKeymap` |
| Delete line | `Ctrl+Shift+K` | CM `defaultKeymap` |

These reach the editor because Memopad's global keydown handler only intercepts its
own `Ctrl`/`Cmd` shortcuts and lets everything else fall through.

## Decisions (locked during brainstorming)

- `Ctrl+D` duplicates the current line (via `copyLineDown`); CM's `Ctrl+Alt+↓` stays
  bound too.
- Command palette gets four entries (Move Up, Move Down, Duplicate, Delete), each
  showing the real shortcut.
- No new clipboard behavior, no multi-cursor-specific handling (CM handles selections).

## Architecture

`@codemirror/commands` (already a direct dependency) provides `moveLineUp`,
`moveLineDown`, `copyLineDown`, `deleteLine`. `EditorPane` adds a high-precedence
`Ctrl+D` keymap and exposes a focused-pane global dispatcher; the command palette calls
the dispatcher.

### 1. `Ctrl+D` keymap — `src/components/EditorPane.tsx`

Add to the `extensions` array (import `Prec` from `@codemirror/state`, `keymap` from
`@codemirror/view`, and `copyLineDown` from `@codemirror/commands`):

```ts
Prec.high(keymap.of([{ key: 'Mod-d', run: copyLineDown, preventDefault: true }])),
```

`Prec.high` ensures it wins over any lower-precedence binding. `Mod-d` = `Ctrl+D`
(Win/Linux) / `Cmd+D` (mac). It is not claimed by the App keydown handler, so it reaches
the focused editor; if focus is outside the editor it simply does nothing.

### 2. Palette dispatcher — `src/components/EditorPane.tsx`

In the same `useEffect` that registers `globalThis.__memopadGotoLine` (gated on
`props.focused`), register:

```ts
globalThis.__memopadLineCommand = (cmd: 'moveUp' | 'moveDown' | 'duplicate' | 'delete') => {
  const v = viewRef.current;
  if (!v) return;
  const fn = cmd === 'moveUp' ? moveLineUp
    : cmd === 'moveDown' ? moveLineDown
    : cmd === 'duplicate' ? copyLineDown
    : deleteLine;
  fn(v);
  v.focus();
};
```

Cleared to `undefined` in the effect's cleanup (alongside `__memopadGotoLine`). Declared
in the file's `declare global` block:

```ts
var __memopadLineCommand: ((cmd: 'moveUp' | 'moveDown' | 'duplicate' | 'delete') => void) | undefined;
```

### 3. Command palette — `src/commands/builtins.ts`

Four registrations (after the `edit.gotoLine` command):

| id | title | shortcut | dispatch |
|----|-------|----------|----------|
| `edit.moveLineUp` | Edit: Move Line Up | `Alt+Up` | `'moveUp'` |
| `edit.moveLineDown` | Edit: Move Line Down | `Alt+Down` | `'moveDown'` |
| `edit.duplicateLine` | Edit: Duplicate Line | `Ctrl+D` | `'duplicate'` |
| `edit.deleteLine` | Edit: Delete Line | `Ctrl+Shift+K` | `'delete'` |

Each `run: () => globalThis.__memopadLineCommand?.('<cmd>')`.

## Error handling / edge cases

| Case | Handling |
|------|----------|
| No focused editor view | dispatcher / keymap no-op (viewRef null guard) |
| Multi-line selection | CM commands operate on the selected block natively |
| `Ctrl+D` precedence | `Prec.high` keymap wins; CM's `Ctrl+Alt+↓` copy stays available |
| First/last line moves | CM `moveLineUp`/`Down` no-op at the boundary |

## Testing strategy

- **e2e** (`tests/e2e/line-ops.spec.ts`, release build): on a buffer `"a\nb\nc"` with the
  caret on line 2 (set via the existing `__memopadGotoLine`):
  - `__memopadLineCommand('duplicate')` → content `"a\nb\nb\nc"`.
  - (fresh content) `__memopadLineCommand('moveUp')` → `"b\na\nc"`.
  - (fresh content) `__memopadLineCommand('delete')` → `"a\nc"`.
  - a real `Ctrl+D` keypress (via `getBrowser().keys`) duplicates the caret line — verifies
    the keymap binding, not just the dispatcher.
  Reads content via the existing `__memopadTestGetContent` hook. Mind the alphabetical /
  state-leak e2e gotchas (reset via existing hooks in `beforeEach`).
- No vitest: the dispatcher is a thin pass-through to CM commands that require a live
  `EditorView`; the e2e against the real build is the meaningful coverage.

## Scope boundaries (YAGNI — non-goals)

- No re-implementation of move/copy/delete (already in `defaultKeymap`).
- No "delete to clipboard" / cut-line, no join-lines, no sort-lines.
- No configurable keybindings.

## Release

Ships as **0.7.0**. CHANGELOG: Added — `Ctrl+D` duplicate line; command-palette entries
for Move/Duplicate/Delete Line (noting the existing `Alt+↑/↓`, `Ctrl+Alt+↑/↓`,
`Ctrl+Shift+K`). Version bump in `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`. Frontend-only (no Rust/persistence changes).
