# Per-Pane Cursor & Scroll — v2 Slice 9 Design

Date: 2026-05-29
Status: Approved (awaiting implementation plan)
Predecessor: `2026-05-29-split-view-design.md` (slice 8; introduced split panes with shared per-buffer cursor)

## Goal

Give each pane its own cursor + scroll position for the buffer it shows, so two panes displaying the same buffer don't fight each other. Removes the slice-8 shared-cursor wonkiness without touching session.json or the primary pane's storage shape.

## Non-goals (this slice)

- **Persist secondary pane state to session.json.** Relaunch still resets to single pane (per slice 8), so the secondary's per-buffer state goes with it.
- **Migrate `buffer.cursor` / `buffer.scrollTop` to a new shape.** Backward-compatible: primary pane keeps using existing per-buffer fields.
- **More than two panes.** Maximum two (locked by slice 8).
- **Per-pane folding / wrap settings.** Future polish if asked.

## Pillars

1. **Backward compatible.** `buffer.cursor` and `buffer.scrollTop` continue to represent the primary pane's state. No migration. Existing tests keep passing.
2. **Secondary state lives in a `Map`.** `secondaryPaneState: Map<bufferId, { cursor, scrollTop }>` on `useBuffers`.
3. **Copy-on-first-mount.** When the secondary pane mounts a buffer that has no entry yet, the selector returns the primary's state. After the user clicks or scrolls in the secondary, an entry is created and the two panes diverge.

## Architecture

### Buffers store — `src/stores/buffers.ts`

New state field:

```ts
secondaryPaneState: Map<string, { cursor: number | null; scrollTop: number | null }>;
```

Initial value: `new Map()`.

New actions:

```ts
setSecondaryCursor: (bufferId: string, cursor: number | null) => void;
setSecondaryScrollTop: (bufferId: string, scrollTop: number | null) => void;
```

Behavior:

```ts
setSecondaryCursor(bufferId, cursor) {
  set((s) => {
    const next = new Map(s.secondaryPaneState);
    const existing = next.get(bufferId) ?? { cursor: null, scrollTop: null };
    next.set(bufferId, { ...existing, cursor });
    return { secondaryPaneState: next };
  });
},

setSecondaryScrollTop(bufferId, scrollTop) {
  set((s) => {
    const next = new Map(s.secondaryPaneState);
    const existing = next.get(bufferId) ?? { cursor: null, scrollTop: null };
    next.set(bufferId, { ...existing, scrollTop });
    return { secondaryPaneState: next };
  });
},
```

New selector:

```ts
export function selectPaneState(
  state: BuffersState,
  pane: 'primary' | 'secondary',
  bufferId: string | null,
): { cursor: number | null; scrollTop: number | null } {
  if (bufferId == null) return { cursor: null, scrollTop: null };
  const buf = state.buffers.find((b) => b.id === bufferId);
  if (pane === 'primary') {
    return { cursor: buf?.cursor ?? null, scrollTop: buf?.scrollTop ?? null };
  }
  // pane === 'secondary'
  const entry = state.secondaryPaneState.get(bufferId);
  if (entry) return entry;
  // Fallback to primary's state — copy-on-first-mount semantics.
  return { cursor: buf?.cursor ?? null, scrollTop: buf?.scrollTop ?? null };
}
```

Modified `closeBuffer`: when a buffer is closed, also remove its entry from `secondaryPaneState`. Inside the existing implementation, alongside the existing buffer-list / activeId / secondaryId updates:

```ts
const nextPaneState = new Map(s.secondaryPaneState);
nextPaneState.delete(id);
return { /* …existing fields…, */ secondaryPaneState: nextPaneState };
```

### `src/components/EditorPane.tsx`

New prop:

```ts
interface EditorPaneProps {
  bufferId: string | null;
  focused: boolean;
  pane: 'primary' | 'secondary';   // NEW
  onFocus: () => void;
  onActionsReady: (actions: SearchStripActions | null) => void;
  // …existing search-panel prop bridge…
}
```

Replace existing cursor / scroll reads. Where the current code reads `buffer.cursor` and `buffer.scrollTop` (for the restore-on-mount logic), use:

```ts
const { cursor, scrollTop } = useBuffers((s) => selectPaneState(s, props.pane, props.bufferId));
```

Replace existing cursor / scroll writes. Where the current code calls `useBuffers.getState().setCursor(bufferId, cursor)` (in the debounced viewupdate handler), branch on `props.pane`:

```ts
if (props.pane === 'primary') {
  useBuffers.getState().setCursor(bufferId, c);
} else {
  useBuffers.getState().setSecondaryCursor(bufferId, c);
}
```

Same pattern for `setScrollTop`.

### `src/components/Editor.tsx` orchestrator

Pass `pane` to each `<EditorPane>`:

```tsx
{splitActive ? (
  <div data-testid="editor-split" className="flex flex-1 overflow-hidden">
    <div className="flex flex-1 w-full">
      <EditorPane
        bufferId={activeId}
        focused={focusedPane === 'primary'}
        pane="primary"
        onFocus={() => setFocusedPane('primary')}
        onActionsReady={setActions}
      />
    </div>
    <div className="w-px bg-neutral-700" />
    <div className="flex flex-1 w-full">
      <EditorPane
        bufferId={secondaryId}
        focused={focusedPane === 'secondary'}
        pane="secondary"
        onFocus={() => setFocusedPane('secondary')}
        onActionsReady={setActions}
      />
    </div>
  </div>
) : (
  <EditorPane
    bufferId={activeId}
    focused={true}
    pane="primary"
    onFocus={() => {}}
    onActionsReady={setActions}
  />
)}
```

Single-pane mode always uses `pane="primary"` — preserves the existing per-buffer cursor/scrollTop behavior 1:1.

## Data flow

### Entering split mode
1. User presses `Ctrl+\`. `toggleSplit()` sets `splitActive=true`, `secondaryId=activeId`, `focusedPane='secondary'`.
2. `Editor` re-renders the split. Secondary `EditorPane` mounts with `pane="secondary"`, `bufferId=activeId`.
3. `selectPaneState(state, 'secondary', activeId)` returns the fallback (primary's state) since the Map has no entry. Both panes show identical viewport — visually the secondary appears to "mirror" the primary at the moment of split.

### Diverging
1. User clicks somewhere in the secondary pane. CodeMirror moves the cursor; viewupdate fires.
2. EditorPane's update handler calls `setSecondaryCursor(bufferId, newCursor)`.
3. The store creates a new Map entry for `bufferId`. From now on, `selectPaneState('secondary', bufferId)` returns that entry, not the primary's.
4. The two panes now have independent cursors and scroll positions for that buffer.

### Switching buffer in the secondary pane
1. User clicks a tab while focused on secondary. `setFocusedBuffer(newId)` updates `secondaryId`.
2. Secondary `EditorPane` re-renders with the new `bufferId`. `selectPaneState('secondary', newId)` returns either an existing entry or the primary's state for that buffer (whichever applies).

### Closing a buffer
1. `closeBuffer(id)` runs.
2. The entry for `id` in `secondaryPaneState` is removed.
3. If the secondary pane was showing that buffer, slice-8's existing fallback to `secondaryId = activeId` kicks in. The new buffer's pane state is whatever applied (Map entry if exists, else primary's fallback).

### Exiting split mode
1. `toggleSplit()` sets `splitActive=false`, `secondaryId=null`. `secondaryPaneState` is NOT cleared — entries linger until their buffers are closed.
2. Editor renders single pane (primary). User sees primary's state, as before.
3. If the user re-enters split mode with the same buffer in the secondary, `selectPaneState` returns the cached entry from the Map — preserving where they were in the secondary previously.

## Error handling

| Scenario | Behavior |
| --- | --- |
| `setSecondaryCursor` called with a bufferId that doesn't exist in `buffers` | Entry is created anyway. Harmless; cleared the next time `closeBuffer` runs or when the buffer is genuinely closed. (Practically, EditorPane only emits writes when it has a real buffer mounted, so this is defensive.) |
| `selectPaneState` called with `bufferId === null` | Returns `{ cursor: null, scrollTop: null }`. EditorPane's restore-on-mount path already handles null state. |
| Memory growth | Bounded by the number of buffers ever opened. Cleared on `closeBuffer`. Trivial for any realistic session. |
| Two panes write to secondary state simultaneously | Zustand's `set` is synchronous, so writes serialize. No race. |
| Boot restores buffers with `cursor`/`scrollTop` set | Existing slice-4 behavior preserved (those are now treated as primary state). Secondary Map starts empty. First split open shows primary's state until user diverges. |

## Testing

### Vitest — `src/tests/buffers.test.ts` (target 4 cases)

- `setSecondaryCursor_isolates_from_primary` — open a buffer, set primary cursor to 10 via `setCursor`, set secondary cursor to 50 via `setSecondaryCursor`. Assert `selectPaneState('primary', id).cursor === 10` and `selectPaneState('secondary', id).cursor === 50`.
- `setSecondaryScrollTop_isolates_from_primary` — analogous for scrollTop.
- `selectPaneState_secondary_falls_back_to_primary_when_no_entry` — open a buffer with `buffer.cursor=20`, do NOT set secondary state, assert `selectPaneState('secondary', id).cursor === 20`.
- `closeBuffer_clears_secondary_pane_state` — open a buffer, set secondary state for it, close it, then re-create a buffer with the same id (or just check `state.secondaryPaneState.has(id) === false`).

### Gates to ship

- vitest: +4
- cargo test: unchanged
- e2e: unchanged
- `tsc --noEmit` clean
- Manual smoke: open Memopad's source folder, open a file in single-pane mode, scroll to line 200. Press `Ctrl+\` — both panes show line 200. Click secondary pane, scroll to line 400. Click primary pane → still at line 200. Click secondary pane → still at line 400.

## Risks and open questions

- **No persistence.** Re-launch loses secondary state because split itself isn't persisted. If session-persisted split lands in a future slice, that follow-up should also persist `secondaryPaneState` (as a serialized array of `[bufferId, entry]` tuples).
- **Visible mismatch when both panes show the same buffer with diverged cursors.** Typing in one pane updates `buffer.content` for both; the other pane's CodeMirror may scroll its own viewport to the change point even if its own cursor was elsewhere. This is a CodeMirror behavior question — if it scrolls aggressively, this slice produces unexpected jumps. Mitigation if discovered: gate the "scroll to change" behavior in EditorPane via a `cm.dispatch({ effects: EditorView.scrollIntoView(...) })` only when this pane is focused. Defer unless real users hit it.
- **Selector mem-isn't-trivial.** `selectPaneState` allocates a new object on every call. Zustand subscribes via shallow equality on the returned object — this would cause unnecessary re-renders. Mitigation: have EditorPane select cursor and scrollTop separately via primitive selectors:
  ```ts
  const cursor = useBuffers((s) => selectPaneState(s, pane, bufferId).cursor);
  const scrollTop = useBuffers((s) => selectPaneState(s, pane, bufferId).scrollTop);
  ```
  Each returns a primitive, so re-renders only happen when the actual values change. Document in plan.
