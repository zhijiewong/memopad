# Split View — v2 Slice 8 Design

Date: 2026-05-29
Status: Approved (awaiting implementation plan)
Predecessors: v1 spec (Editor + TabStrip) and prior v2 slices (no direct dependencies, but Editor + TabStrip shape come from v1 phases).

## Goal

Add a horizontal two-pane split to the editor area, toggled by `Ctrl+\`. The user can view two buffers side-by-side. Clicking a pane focuses it; the tab strip targets the focused pane. Closing the split returns to single-pane.

## Non-goals (this slice)

- **More than two panes.** Maximum two. Multi-split + recursive trees deferred to a future slice.
- **Vertical splits.** Horizontal only.
- **Per-pane cursor / scroll state.** A buffer's cursor + scroll are shared across panes when the same buffer appears in both — per the locked design decision.
- **Per-pane tab strips.** The TabStrip remains global; it shows all open buffers and highlights the focused pane's buffer.
- **Drag-to-swap panes / drag buffers across panes.** Not in v1.
- **Serializing split state to `session.json`.** Re-launching resets to single pane. (Easy follow-up if users ask.)
- **Resizing the split.** 50/50 split, not user-resizable.

## Pillars

1. **Single source of truth in `useBuffers`.** Three new fields: `splitActive`, `secondaryId`, `focusedPane`. All UI derives from these.
2. **`focusedBufferId` is a derived selector.** `focusedPane === 'primary' ? activeId : secondaryId`. Every action that used to operate on `activeId` (save, close-tab, switch-to, find-strip, etc.) now operates on this derived value.
3. **Editor refactor: one `EditorPane`, mounted once or twice.** The current `Editor.tsx` becomes a thin wrapper that mounts one or two `EditorPane`s based on `splitActive`. `EditorPane` is the existing CodeMirror wrapper, parameterized by `bufferId`.
4. **Shared per-buffer state.** Cursor + scroll are stored per-buffer (existing behavior). When the same buffer shows in both panes, both reflect the same cursor / scroll. Wonky but simple.

## Architecture

### Buffers store — `src/stores/buffers.ts`

New state fields (initial values):

```ts
splitActive: boolean;          // false
secondaryId: string | null;    // null
focusedPane: 'primary' | 'secondary';  // 'primary'
```

New actions:

```ts
toggleSplit: () => void;
setFocusedPane: (p: 'primary' | 'secondary') => void;
setFocusedBuffer: (id: string) => void;
```

Behavior:
- `toggleSplit`:
  - If `splitActive` is currently false: set `splitActive = true`, `secondaryId = activeId`, `focusedPane = 'secondary'`. (The new pane mirrors the active buffer and gets focus.)
  - If `splitActive` is currently true: set `splitActive = false`, `secondaryId = null`, `focusedPane = 'primary'`.
- `setFocusedPane(p)`: set `focusedPane = p`. No-op if `!splitActive && p === 'secondary'` (defensive).
- `setFocusedBuffer(id)`: if `focusedPane === 'primary'`, set `activeId = id`. Else set `secondaryId = id`. Used by TabStrip clicks.

Modified existing actions:
- `closeBuffer(id)`:
  - If `id === activeId`: existing fallback behavior (next-most-recent) applies. If after fallback the new `activeId === secondaryId`, that's fine — both panes show the same buffer.
  - If `id === secondaryId` (and split is active): set `secondaryId = activeId` (mirror primary). If split is inactive, no special handling.
- `switchTo(id)`: legacy behavior preserved (sets `activeId`). Internal callers (e.g. boot restore, journal replay) keep using `switchTo` to set the primary pane. UI calls should prefer `setFocusedBuffer`.

### `src/components/Editor.tsx` refactor

Extract the current CodeMirror-wrapping JSX into a new `EditorPane` component:

```tsx
interface EditorPaneProps {
  bufferId: string | null;
  focused: boolean;
  onFocus: () => void;
}

function EditorPane({ bufferId, focused, onFocus }: EditorPaneProps) {
  // The existing logic that reads `useBuffers` for `activeId`, replaces
  // `activeId` with `bufferId`. The pane mounts a CodeMirror instance
  // for `bufferId`. The outer container has data-testid="editor-pane",
  // a `focused` border accent, and onMouseDown={onFocus}.
}
```

The exported `Editor` component:

```tsx
export function Editor() {
  const splitActive = useBuffers((s) => s.splitActive);
  const activeId = useBuffers((s) => s.activeId);
  const secondaryId = useBuffers((s) => s.secondaryId);
  const focusedPane = useBuffers((s) => s.focusedPane);
  const setFocusedPane = useBuffers((s) => s.setFocusedPane);

  if (!splitActive) {
    return <EditorPane bufferId={activeId} focused={true} onFocus={() => {}} />;
  }
  return (
    <div data-testid="editor-split" className="flex flex-1 overflow-hidden">
      <div className="flex-1 w-full">
        <EditorPane
          bufferId={activeId}
          focused={focusedPane === 'primary'}
          onFocus={() => setFocusedPane('primary')}
        />
      </div>
      <div className="w-px bg-neutral-700" />
      <div className="flex-1 w-full">
        <EditorPane
          bufferId={secondaryId}
          focused={focusedPane === 'secondary'}
          onFocus={() => setFocusedPane('secondary')}
        />
      </div>
    </div>
  );
}
```

Layout note: each pane gets `flex-1 w-full` to avoid the long-standing flex-collapse bug. Same invariant as the slice-1 layout fix.

### `src/components/TabStrip.tsx` changes

Currently the TabStrip highlights `activeId` and calls `switchTo(id)` on click. Update to:
- Compute `focusedBufferId = focusedPane === 'primary' ? activeId : secondaryId`. Use it for highlight.
- On tab click, call `setFocusedBuffer(id)` instead of `switchTo(id)`.

That's a ~3-line change.

### Keybinding + command

`src/commands/builtins.ts`:

```ts
register({
  id: 'view.toggleSplit',
  title: 'Toggle Split View',
  shortcut: 'Ctrl+\\',
  run: () => { useBuffers.getState().toggleSplit(); },
});
```

`src/App.tsx` — inside the existing keydown ladder, add (placed near the existing `Ctrl+B` branch):

```ts
if (key === '\\' && !e.shiftKey) {
  e.preventDefault();
  useBuffers.getState().toggleSplit();
  return;
}
```

### Commands that target the focused buffer

Audit `src/commands/builtins.ts` for commands that read `useBuffers.getState().activeId` or rely on `switchTo`. Examples likely affected:
- `file.save` → already uses the active buffer via existing helpers. Update those helpers to use `focusedBufferId` instead.
- `tab.close` → close `focusedBufferId`.
- `tab.next` / `tab.prev` → switch the focused pane to the next/prev buffer.
- `tab.reopen` → reopens; the reopened buffer becomes `focusedBufferId`.

These can be addressed minimally by adding a single helper `useFocusedBufferId(): string | null` (returns the derived value) and replacing direct `activeId` reads in the commands. Detailed task in the plan.

### Empty state for secondary pane

If `secondaryId === null` (e.g. the only buffer was closed), `EditorPane` should render the existing empty-state UI just like the primary pane does today. No new empty-state work needed — the existing `EditorPane` already handles `bufferId === null`.

## Data flow

### Toggling on
1. User presses `Ctrl+\` (or palette).
2. `toggleSplit()` sets `splitActive = true`, `secondaryId = activeId`, `focusedPane = 'secondary'`.
3. `Editor` re-renders the split layout. The secondary pane shows the same buffer as the primary, focused.

### Clicking a tab while split is active
1. User clicks tab for buffer X.
2. `TabStrip` calls `setFocusedBuffer('X')`.
3. Store: if `focusedPane === 'secondary'`, `secondaryId = 'X'`. Else `activeId = 'X'`.
4. The focused pane's `EditorPane` re-renders with the new `bufferId`.

### Clicking the unfocused pane
1. User clicks anywhere inside the secondary pane's container.
2. `onMouseDown` on the pane container fires `setFocusedPane('secondary')`.
3. CodeMirror's own click moves the cursor inside the buffer normally.
4. `focusedBufferId` derived selector now returns `secondaryId`. TabStrip highlights it.

### Toggling off
1. User presses `Ctrl+\` again.
2. `toggleSplit()` sets `splitActive = false`, `secondaryId = null`, `focusedPane = 'primary'`.
3. `Editor` re-renders single-pane.

### Closing the buffer in the secondary pane
1. User closes a tab. `closeBuffer(id)` runs.
2. If `id === secondaryId`: `secondaryId = activeId` (fallback).
3. Both panes now show the same buffer (visually they look identical). User can pick a different one via tab click or `Ctrl+\` to collapse.

### Saving / find / journal
- Save (`Ctrl+S`): saves `focusedBufferId`. Existing save command reads from active; update to read from focused.
- Find strip (`Ctrl+F`): opens the find strip targeting the focused pane's CodeMirror instance. The existing `__memopadSearchPanel` global wires to one CodeMirror; with two instances, the panel must target the focused one. Each EditorPane registers `window.__memopadSearchPanel` if focused. Last-wins; focusing a pane re-registers.
- Journal: the journal already snapshots all dirty buffers on a 250ms debounce — irrespective of which pane shows them. No change needed.
- External-change banner: shows for the buffer in the focused pane. The existing component reads from the active buffer; update to read from `focusedBufferId`.

## Error handling

| Scenario | Behavior |
| --- | --- |
| `toggleSplit` when no buffer is active (`activeId === null`) | `secondaryId = null`, `splitActive = true`. Both panes render empty-state. |
| `closeBuffer` removes the only buffer while split is active | Both `activeId` and `secondaryId` become null. Split stays active (empty panes). User can press `Ctrl+\` to collapse. |
| `setFocusedPane('secondary')` when `!splitActive` | No-op (defensive). |
| `setFocusedBuffer(id)` when `id` isn't an open buffer | No defensive check; caller is expected to pass valid ids. TabStrip only passes ids of currently-open buffers. |
| Find strip opened while focus is on the secondary pane | The pane that registers `__memopadSearchPanel` last wins. Focusing the secondary pane re-registers and Find targets the secondary CodeMirror. |
| Boot restore | `splitActive` is not persisted (session.json schema unchanged in this slice). Boot always restores to single-pane. |
| Two panes both showing the same dirty buffer | Both render the same `buffer.content`. Typing in one updates the store; the other re-renders. Cursor jumps to the location of the last edit in both. Documented wonkiness. |

## Testing

### Vitest — `src/tests/buffers.test.ts` (target 5 new cases)

- `toggleSplit_enables_split_with_secondary_mirroring_primary` — start `splitActive=false`, `activeId='b1'`. After `toggleSplit()`: `splitActive===true`, `secondaryId==='b1'`, `focusedPane==='secondary'`.
- `toggleSplit_disables_split_and_focuses_primary` — start split active. After `toggleSplit()`: `splitActive===false`, `secondaryId===null`, `focusedPane==='primary'`.
- `setFocusedBuffer_with_primary_focus_updates_activeId` — `focusedPane='primary'`, call `setFocusedBuffer('b2')` → `activeId==='b2'`, `secondaryId` unchanged.
- `setFocusedBuffer_with_secondary_focus_updates_secondaryId` — `focusedPane='secondary'`, call `setFocusedBuffer('b2')` → `secondaryId==='b2'`, `activeId` unchanged.
- `closeBuffer_secondary_falls_back_to_primary` — open 2 buffers `b1` (primary) and `b2` (secondary). Close `b2`. Assert `secondaryId === 'b1'`.

### WebdriverIO e2e — `tests/e2e/split-view.spec.ts` (target 1 test)

- `ctrl_backslash_opens_two_editor_panes` — fresh start, open a buffer with content. Press `Ctrl+\`. Assert two `[data-testid="editor-pane"]` elements present and the `[data-testid="editor-split"]` container is visible. Press `Ctrl+\` again. Assert only one pane remains.

### Gates to ship

- vitest: +5 (target ~78–82 depending on which prior slices are present in the worktree base)
- cargo test: no change
- e2e: +1
- `tsc --noEmit` clean
- Manual smoke: open two files, press `Ctrl+\`, click left pane, click a tab — confirm left pane swaps. Click right pane, click another tab — right pane swaps. `Ctrl+\` again → back to single.

## Risks and open questions

- **CodeMirror double-mount.** Mounting a second `<CodeMirror>` instance for the same buffer doubles the memory. For a few-MB editor, that's fine. If it becomes a problem, a future slice could share the EditorState across panes via CM's `Compartment` API.
- **Shared cursor wonkiness.** When both panes show the same buffer, typing in pane A makes pane B's cursor jump. Locked decision; documented in the spec.
- **Find strip targets one pane only.** The last-focused pane's CodeMirror registers `window.__memopadSearchPanel`. If the user finds in pane A, then clicks pane B, then presses Ctrl+F, pane B's CodeMirror takes over. Acceptable.
- **External-change banner.** Single banner above the editor (existing). It tracks the focused buffer. If the unfocused pane's buffer also has external changes, the banner won't show until the user focuses that pane. Document in v1; consider per-pane banners later.
- **Layout invariant.** The existing flex-collapse-when-no-w-full pitfall. The split layout uses `flex-1 w-full` on each pane wrapper — same guard as slice 1.
- **`Ctrl+\` conflict.** Tauri WebView2 captures this. No browser-default behavior to fight.
- **`switchTo` vs `setFocusedBuffer`.** Internal callers (boot restore, journal replay, etc.) keep using `switchTo` (always sets `activeId`). UI callers should use `setFocusedBuffer`. This split is deliberate — `switchTo` is the "initialize primary pane" door; `setFocusedBuffer` is the "user clicked a tab" door.
