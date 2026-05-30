# Split-View Pane Routing & Focus — Design

**Date:** 2026-05-30
**Status:** Approved (design), pending plan
**Branch:** `worktree-split-view-polish` (off `origin/main`, with `worktree-split-state-persistence` and `worktree-keybind-backslash` merged in)

## Problem

The split view exists but does not behave like a mature editor. The root cause:
**almost every way of opening a file ignores which pane is focused and routes the
file into the primary (left) pane.** So after splitting and trying to load a
different file into the right pane (via the file tree, Ctrl+O, or Find-in-Files),
the file lands on the left and the right pane "never opens" what the user wanted.
There is also no real focus indicator (only a faint `opacity-90`), so the user
cannot tell which pane keystrokes target.

Evidence (origin/main, `src/stores/buffers.ts`):
- `openBuffer` (buffers.ts:128, 144) — always sets `activeId`.
- `switchTo` (buffers.ts:190) — always sets `activeId`.
- `newBuffer` (buffers.ts:121) — always sets `activeId`.
- `reopenLastClosed` (buffers.ts:~280) — always sets `activeId`.
- `openFileAtLine` (buffers.ts:~380) — always sets `activeId`.
- Only `setFocusedBuffer` (buffers.ts:209) is pane-aware. Tab clicks use it; the
  file tree, Ctrl+O, Find-in-Files, new/reopen do not.

This is the reason the persistence smoke test could not be completed — the user
could not get a second file into the right pane.

## Best-practice reference (VS Code editor groups)

- The **focused/active group receives opened files** ("opening a file will open it
  on the other side" when that side is focused).
- The active group is **visually highlighted**; inactive groups are dimmed.
- `Ctrl+1`/`Ctrl+2` focus groups; splitting duplicates the active editor.

Sources: VS Code "User interface" and "Custom Layout" docs
(https://code.visualstudio.com/docs/getstarted/userinterface,
https://code.visualstudio.com/docs/configure/custom-layout).

## Scope

**In scope (approved: "Correctness + nav"):**
1. Route ALL file opens to the focused pane.
2. Clear focused-pane visual indicator.
3. `Ctrl+1` / `Ctrl+2` pane focus, with real editor DOM focus follow.
4. Edge-case fixes: pane-aware close fallback; Find/Replace strip binds to the
   focused pane.

**Out of scope (the "full editor groups" option, deferred):**
- Per-pane tab strips, drag tabs between panes, resizable divider.

## Design

### 1. One routing rule in the store (`src/stores/buffers.ts`)

Introduce a single internal rule used by every user-initiated "show this buffer"
action: **if `splitActive` and `focusedPane === 'secondary'` → set `secondaryId`,
otherwise set `activeId`.**

Apply it to: `openBuffer` (both the existing-buffer and new-buffer branches),
`switchTo`, `newBuffer`, `reopenLastClosed`, `openFileAtLine`.

`openRestored` is **not** changed — it is boot-restore machinery, not a user
action, and must keep populating the primary pane while the session loads.

This is the central fix: the file tree, Ctrl+O, and Find-in-Files all funnel
through these store actions, so they all become pane-aware at once.

### 2. Quick Open double-write fix (`src/components/QuickOpenPalette.tsx`)

The "new file" branch currently calls `openBuffer(...)` (was primary-only) then
`setFocusedBuffer(newId)`. With `openBuffer` now pane-aware, the second call is
redundant and is removed. The "already open" branch keeps `setFocusedBuffer`
(still correct).

### 3. Focused-pane indicator (`src/components/EditorPane.tsx`, `Editor.tsx`)

Replace the `opacity-90`-only distinction with a clear accent on the focused pane
(e.g. a 2px top/left accent border using the theme accent colour) and a dimmed
treatment for the inactive pane. Must read correctly in both light and dark
themes. Single-pane (non-split) view shows no indicator.

### 4. Pane navigation (`src/App.tsx`, `src/commands/builtins.ts`)

- New commands `view.focusPrimaryPane` / `view.focusSecondaryPane` calling
  `setFocusedPane('primary' | 'secondary')`. Secondary is a no-op when not split
  (already guarded in the store).
- Keybindings: `Ctrl+1` → primary, `Ctrl+2` → secondary, in the existing
  `App.tsx` keydown handler.
- When a pane becomes focused (the `focused` prop transitions to true), its
  CodeMirror view takes DOM focus (effect in `EditorPane`), so the cursor moves
  there and subsequent typing/opens target it.

### 5. Edge cases

- **Close fallback** (`closeBuffer`): when the buffer shown in a pane is closed,
  that pane advances to the next remaining buffer using the same index-based rule
  already applied to the primary pane (the buffer at the closed index, else the
  last buffer). If only one buffer remains, both panes show it. If no buffers
  remain, the split collapses (`splitActive = false`, `secondaryId = null`).
- **Search strip targets focused pane** (`Editor.tsx` / `EditorPane.tsx`): only
  the focused pane registers its search actions (`onActionsReady`), so Find/Replace
  operates on the visible focused pane instead of whichever pane mounted last.

## Testing

- **vitest (`src/tests/buffers.test.ts`)** — the routing rule: with split active and
  secondary focused, `openBuffer` / `switchTo` / `newBuffer` / `reopenLastClosed` /
  `openFileAtLine` set `secondaryId`, not `activeId`; with primary focused they set
  `activeId`; non-split always sets `activeId`. Close-fallback edge cases.
- **e2e (`tests/e2e/`) in the real WebView** — split via the toggle, focus the right
  pane (Ctrl+2), then open a file via the file tree / Ctrl+O / Quick Open and assert
  it mounts in the **secondary** pane (right `.cm-content`) while the left is
  unchanged; assert the focus indicator is present on the focused pane; assert
  Ctrl+1/Ctrl+2 move focus.
- **requesting-code-review** skill pass before finishing.
- **Manual smoke** by the user: split, put different files in each pane via the tree
  and Ctrl+O, switch focus with the mouse and Ctrl+1/2, close/reopen the app and
  confirm the split + both files + scroll/cursor restore (persistence, already built).

## Risks / notes

- `buffers.ts` is shared with the persistence work (already merged into this branch),
  so the routing change sits on top of `secondaryPaneState` cleanly.
- Routing through `focusedPane` must not regress single-pane behavior: when
  `splitActive` is false, `focusedPane` is always `'primary'`, so the rule reduces
  to today's behavior.
