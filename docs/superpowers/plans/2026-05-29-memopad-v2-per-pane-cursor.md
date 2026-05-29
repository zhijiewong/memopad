# Memopad v2 — Per-Pane Cursor & Scroll

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each pane its own cursor and scroll position so two panes showing the same buffer don't fight over the viewport. Primary pane keeps using the existing per-buffer fields; secondary state lives in a new `Map` on `useBuffers`. Backward compatible — no migration.

**Architecture:** `useBuffers` gains `secondaryPaneState: Map<bufferId, {cursor, scrollTop}>` plus two writers and one selector. `closeBuffer` removes Map entries on close. `EditorPane` takes a new `pane: 'primary' | 'secondary'` prop and reads/writes through the selector + branching writers. `Editor.tsx` passes the correct pane to each mount.

**Tech Stack:** React + Zustand + CodeMirror 6. No new dependencies.

**Spec section reference:** `docs/superpowers/specs/2026-05-29-per-pane-cursor-design.md` (all sections).

---

## File Structure

```
memopad/
├── src/
│   ├── stores/
│   │   └── buffers.ts                MODIFY — secondaryPaneState + 2 actions + selectPaneState + closeBuffer cleanup
│   ├── components/
│   │   ├── EditorPane.tsx            MODIFY — pane prop; reads via selectPaneState; writes branch on pane
│   │   └── Editor.tsx                MODIFY — pass pane="primary" / pane="secondary" to each EditorPane
│   └── tests/
│       └── buffers.test.ts           MODIFY — 4 new vitest cases
```

Boundary intent:
- **`buffers.ts`** owns the data. `selectPaneState` is the single read seam; `setCursor` / `setSecondaryCursor` (and the scrollTop equivalents) are the write seams.
- **`EditorPane.tsx`** is the only consumer that needs to know about the pane distinction.
- **`Editor.tsx`** changes are mechanical — one new prop on each EditorPane mount.

---

## Task 1: Store fields + actions + `selectPaneState` + `closeBuffer` cleanup + 4 tests

**Files:**
- Modify: `src/stores/buffers.ts`
- Modify: `src/tests/buffers.test.ts`

- [ ] **Step 1: Append 4 failing tests at the bottom of `src/tests/buffers.test.ts`**

Add as a new `describe` block:

```ts
describe('per-pane cursor + scroll', () => {
  beforeEach(() => {
    useBuffers.setState(useBuffers.getInitialState(), true);
  });

  it('setSecondaryCursor isolates secondary from primary', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'hello\nworld', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().setCursor(id, 10);
    useBuffers.getState().setSecondaryCursor(id, 50);

    expect(selectPaneState(useBuffers.getState(), 'primary', id).cursor).toBe(10);
    expect(selectPaneState(useBuffers.getState(), 'secondary', id).cursor).toBe(50);
  });

  it('setSecondaryScrollTop isolates secondary from primary', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'hi', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().setScrollTop(id, 100);
    useBuffers.getState().setSecondaryScrollTop(id, 300);

    expect(selectPaneState(useBuffers.getState(), 'primary', id).scrollTop).toBe(100);
    expect(selectPaneState(useBuffers.getState(), 'secondary', id).scrollTop).toBe(300);
  });

  it('selectPaneState secondary falls back to primary when no entry exists', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'x', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().setCursor(id, 20);
    // Do NOT set secondary state.
    expect(selectPaneState(useBuffers.getState(), 'secondary', id).cursor).toBe(20);
  });

  it('closeBuffer clears secondary pane state for the closed buffer', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'x', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().setSecondaryCursor(id, 42);
    expect(useBuffers.getState().secondaryPaneState.has(id)).toBe(true);

    useBuffers.getState().closeBuffer(id);
    expect(useBuffers.getState().secondaryPaneState.has(id)).toBe(false);
  });
});
```

At the top of the test file, add `selectPaneState` to the import. Find the existing line:

```ts
import { useBuffers } from '../stores/buffers';
```

Change to:

```ts
import { useBuffers, selectPaneState } from '../stores/buffers';
```

- [ ] **Step 2: Run — should FAIL on the first test (`setSecondaryCursor` doesn't exist)**

```powershell
npm test -- buffers
```

Expected: FAIL.

- [ ] **Step 3: Extend `BuffersState` interface in `src/stores/buffers.ts`**

Find the existing `interface BuffersState { … }` definition. Add the new field and action signatures (place near the existing cursor/scrollTop-related actions):

```ts
secondaryPaneState: Map<string, { cursor: number | null; scrollTop: number | null }>;

setSecondaryCursor: (bufferId: string, cursor: number | null) => void;
setSecondaryScrollTop: (bufferId: string, scrollTop: number | null) => void;
```

- [ ] **Step 4: Add initial state value inside the `create<BuffersState>((set, get) => ({ ... }))` block**

Near the existing initial values (e.g. `splitActive: false`):

```ts
secondaryPaneState: new Map<string, { cursor: number | null; scrollTop: number | null }>(),
```

- [ ] **Step 5: Add the two new actions inside the same block**

Place them near the existing `setCursor` / `setScrollTop` actions:

```ts
setSecondaryCursor: (bufferId, cursor) => {
  set((s) => {
    const next = new Map(s.secondaryPaneState);
    const existing = next.get(bufferId) ?? { cursor: null, scrollTop: null };
    next.set(bufferId, { ...existing, cursor });
    return { secondaryPaneState: next };
  });
},

setSecondaryScrollTop: (bufferId, scrollTop) => {
  set((s) => {
    const next = new Map(s.secondaryPaneState);
    const existing = next.get(bufferId) ?? { cursor: null, scrollTop: null };
    next.set(bufferId, { ...existing, scrollTop });
    return { secondaryPaneState: next };
  });
},
```

- [ ] **Step 6: Modify the existing `closeBuffer` action to clear the Map entry**

Find the existing `closeBuffer` body. After the existing `nextSecondary` fallback logic (from slice 8) and BEFORE the return statement, compute the cleaned Map:

```ts
const nextPaneState = new Map(s.secondaryPaneState);
nextPaneState.delete(id);
```

Then change the return statement to include `secondaryPaneState: nextPaneState`:

```ts
return {
  buffers: next,
  activeId: nextActive,
  secondaryId: nextSecondary,
  recentlyClosed: recent,
  secondaryPaneState: nextPaneState,
};
```

If the existing return statement has different field names or order, adapt — the only addition is the `secondaryPaneState: nextPaneState` field.

- [ ] **Step 7: Add `selectPaneState` selector at the bottom of `src/stores/buffers.ts`**

Below the existing `selectFocused` / `selectFocusedId` exports:

```ts
/**
 * Pure selector: read cursor + scrollTop for a (pane, buffer) pair.
 * - Primary always reads from the buffer's own fields.
 * - Secondary reads from the Map; if absent, falls back to primary's state
 *   (copy-on-first-mount semantics — visually identical until the user
 *   diverges by clicking or scrolling in the secondary).
 */
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
  const entry = state.secondaryPaneState.get(bufferId);
  if (entry) return entry;
  return { cursor: buf?.cursor ?? null, scrollTop: buf?.scrollTop ?? null };
}
```

- [ ] **Step 8: Run the tests**

```powershell
npm test -- buffers
```

Expected: 4 new tests PASS + all existing buffer tests still PASS.

- [ ] **Step 9: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 10: Commit**

```powershell
git add src/stores/buffers.ts src/tests/buffers.test.ts
git commit -m "buffers: secondaryPaneState + selectPaneState + closeBuffer cleanup"
```

---

## Task 2: `EditorPane` accepts `pane` prop; reads + writes route accordingly

**Files:**
- Modify: `src/components/EditorPane.tsx`

- [ ] **Step 1: Add the `pane` prop to `EditorPaneProps`**

In `src/components/EditorPane.tsx`, find the existing `EditorPaneProps` interface (added by slice 8). Add the new prop:

```ts
interface EditorPaneProps {
  bufferId: string | null;
  focused: boolean;
  pane: 'primary' | 'secondary';   // NEW
  onFocus: () => void;
  onActionsReady: (actions: SearchStripActions | null) => void;
  // …existing props…
}
```

Update the destructure at the top of the component body to include `pane`:

```ts
export function EditorPane(props: EditorPaneProps) {
  const { bufferId, focused, pane, onFocus, onActionsReady /* …existing… */ } = props;
  // …
}
```

(If the existing component uses `props.bufferId` style access throughout instead of destructuring, leave that alone — just ensure `pane` is reachable as `props.pane`.)

- [ ] **Step 2: Add the `selectPaneState` import**

Find the existing import line:

```ts
import { useBuffers /* …existing… */ } from '../stores/buffers';
```

Add `selectPaneState`:

```ts
import { useBuffers, selectPaneState /* …existing… */ } from '../stores/buffers';
```

- [ ] **Step 3: Replace cursor + scrollTop reads with primitive selectors**

Find the existing code that reads `buffer.cursor` and `buffer.scrollTop` (used in the restore-on-mount logic and elsewhere). Replace with two primitive selectors so re-renders only fire on the actual value change:

```ts
const cursor = useBuffers((s) => selectPaneState(s, pane, bufferId).cursor);
const scrollTop = useBuffers((s) => selectPaneState(s, pane, bufferId).scrollTop);
```

Use `cursor` and `scrollTop` wherever the old code read `buffer.cursor` / `buffer.scrollTop`.

- [ ] **Step 4: Branch cursor + scrollTop writes on `pane`**

Find the existing write sites in the component (typically inside an `onUpdate` callback or a debounced viewupdate handler that persists cursor/scroll back to the store). They currently look something like:

```ts
useBuffers.getState().setCursor(bufferId, newCursor);
```

and

```ts
useBuffers.getState().setScrollTop(bufferId, newScrollTop);
```

Wrap each in a pane branch. For cursor writes:

```ts
if (pane === 'primary') {
  useBuffers.getState().setCursor(bufferId, newCursor);
} else {
  useBuffers.getState().setSecondaryCursor(bufferId, newCursor);
}
```

For scrollTop writes:

```ts
if (pane === 'primary') {
  useBuffers.getState().setScrollTop(bufferId, newScrollTop);
} else {
  useBuffers.getState().setSecondaryScrollTop(bufferId, newScrollTop);
}
```

If the writes happen inside a `useCallback` or a debounced helper, make sure `pane` is in the dependency array so the closure picks up the right branch when the prop changes.

- [ ] **Step 5: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean (real `npx tsc` output — ignore LSP false positives); all vitest tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/components/EditorPane.tsx
git commit -m "editor: EditorPane reads/writes pane-aware cursor + scrollTop"
```

---

## Task 3: `Editor.tsx` passes `pane` to each `EditorPane` mount

**Files:**
- Modify: `src/components/Editor.tsx`

- [ ] **Step 1: Add `pane="primary"` to the single-pane mount**

In `src/components/Editor.tsx`, find the existing single-pane fallback (the JSX rendered when `!splitActive`). It currently looks like:

```tsx
<EditorPane
  bufferId={activeId}
  focused={true}
  onFocus={() => {}}
  onActionsReady={setActions}
  /* …existing search-panel props… */
/>
```

Add `pane="primary"`:

```tsx
<EditorPane
  bufferId={activeId}
  focused={true}
  pane="primary"
  onFocus={() => {}}
  onActionsReady={setActions}
  /* …existing search-panel props… */
/>
```

- [ ] **Step 2: Add `pane="primary"` and `pane="secondary"` to the split-mode mounts**

Find the existing split-mode JSX. It has two `<EditorPane>` elements wrapped in `<div className="flex flex-1 w-full">` siblings separated by a divider. Add `pane` to each:

Primary side:

```tsx
<EditorPane
  bufferId={activeId}
  focused={focusedPane === 'primary'}
  pane="primary"
  onFocus={() => setFocusedPane('primary')}
  onActionsReady={setActions}
  /* …existing search-panel props… */
/>
```

Secondary side:

```tsx
<EditorPane
  bufferId={secondaryId}
  focused={focusedPane === 'secondary'}
  pane="secondary"
  onFocus={() => setFocusedPane('secondary')}
  onActionsReady={setActions}
  /* …existing search-panel props… */
/>
```

- [ ] **Step 3: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean; all vitest tests pass.

- [ ] **Step 4: Commit**

```powershell
git add src/components/Editor.tsx
git commit -m "editor: pass pane prop to each EditorPane mount"
```

---

## Task 4: Gates + results doc

**Files:**
- Create: `docs/superpowers/plans/v2-per-pane-cursor-results.md`

- [ ] **Step 1: tsc + vitest + cargo**

```powershell
npx tsc --noEmit
npm test
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib
cd ..
```

Capture:
- vitest total (expected +4 from per-pane cursor tests)
- cargo total (no change — no Rust changes)

- [ ] **Step 2: Release build**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture MSI + app.exe sizes. Expected: no measurable change from slice 8.

- [ ] **Step 3: Skip `npm run e2e`** — no new e2e tests; deferred to manual verification.

- [ ] **Step 4: Write results doc**

Create `docs/superpowers/plans/v2-per-pane-cursor-results.md`:

```markdown
# v2 Per-Pane Cursor & Scroll — Results

## Automated test gates

- Vitest: <N> tests passing (+4 per-pane cursor tests)
- cargo test: <N> tests passing (no Rust changes)
- e2e (WebdriverIO): no new tests
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: <X.XX> MB
- app.exe size: <X.XX> MB

## What shipped

- `src/stores/buffers.ts` — `secondaryPaneState: Map<bufferId, {cursor, scrollTop}>` + `setSecondaryCursor` / `setSecondaryScrollTop` actions + `selectPaneState` selector. `closeBuffer` clears the Map entry on close.
- `src/components/EditorPane.tsx` — new `pane: 'primary' | 'secondary'` prop. Reads cursor + scrollTop via `selectPaneState`. Writes branch on pane: primary writes to existing per-buffer fields; secondary writes to the new Map.
- `src/components/Editor.tsx` — passes `pane="primary"` (single-pane and primary side) or `pane="secondary"` to each EditorPane mount.

## What is intentionally NOT in this slice

- Persisting secondary pane state to session.json
- Migrating buffer.cursor/scrollTop to a different shape
- Per-pane folding / wrap settings

## Follow-ups

1. Session-persisted secondary state (paired with session-persisted split state)
2. Rename TabContextMenu → ContextMenu (polish from slice 6)
3. Multi-pane / recursive tree split
```

Fill in actual numbers.

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/v2-per-pane-cursor-results.md
git commit -m "v2 per-pane cursor: record results"
```

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec section | Covered by |
| --- | --- |
| `secondaryPaneState` field + initial value | Task 1 |
| `setSecondaryCursor` / `setSecondaryScrollTop` actions | Task 1 |
| `selectPaneState` selector with primary fallback | Task 1 |
| `closeBuffer` clears the Map entry | Task 1 |
| 4 vitest cases | Task 1 |
| `EditorPane` `pane` prop | Task 2 |
| `EditorPane` cursor + scrollTop reads via selector | Task 2 |
| `EditorPane` writes branch on pane | Task 2 |
| `Editor.tsx` passes pane to each mount | Task 3 |
| Primitive-selector pattern to avoid stale-object re-renders | Task 2 step 3 |
| Gates + results doc | Task 4 |

**Placeholder scan:** None.

**Type / signature consistency:**
- `secondaryPaneState: Map<string, { cursor: number | null; scrollTop: number | null }>` consistent across interface, initial state, action bodies, selector, and tests.
- `setSecondaryCursor(bufferId: string, cursor: number | null): void` matches between interface, impl, and test calls.
- `setSecondaryScrollTop(bufferId: string, scrollTop: number | null): void` matches.
- `selectPaneState(state, pane: 'primary' | 'secondary', bufferId: string | null): { cursor: number | null; scrollTop: number | null }` matches between definition, EditorPane consumer (Task 2), and tests (Task 1).
- `pane: 'primary' | 'secondary'` literal type matches across EditorPane prop, Editor.tsx prop sites, and selector signature.

**Notes for executor:**
- The primitive-selector pattern in Task 2 step 3 is important: returning the object literal `{ cursor, scrollTop }` directly from the selector causes Zustand to see a new reference on every state change and re-render unnecessarily. Selecting `cursor` and `scrollTop` as primitives means re-renders only happen when the actual values change.
- The existing `EditorPane` already has a debounced viewupdate handler that persists cursor/scroll. The branch in Task 2 step 4 wraps the existing writes; do NOT duplicate the debounce. The debounce timer can stay as-is.
- This plan does NOT push to remote and does NOT merge to main (matches the user's standing "do not commit until I say so" boundary; local commits in the worktree are allowed per the established workflow).
- The existing `closeBuffer` implementation from slice 8 already has the `nextSecondary` fallback. Task 1 step 6 ADDS the Map-entry deletion alongside that — do not remove the slice-8 fallback.
