# Memopad v2 — File Tree Context Menu

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click context menu to file tree rows with three items — Reveal in Explorer, Copy Path, Copy Relative Path — by reusing the existing `TabContextMenu` component and the existing `reveal_in_explorer` Tauri command.

**Architecture:** A new `src/lib/path.ts` exposes one pure helper `relativeToWorkspace`. `TreeNode.tsx` gains local `menuPos` state, an `onContextMenu` handler, and mounts `<TabContextMenu />` with an inline-built items array. No store changes, no new Tauri commands, no new IPC types.

**Tech Stack:** React + Zustand. WebView's `navigator.clipboard.writeText` for clipboard. No new dependencies.

**Spec section reference:** `docs/superpowers/specs/2026-05-29-file-tree-context-menu-design.md` (all sections).

---

## File Structure

```
memopad/
├── src/
│   ├── lib/
│   │   └── path.ts                CREATE — relativeToWorkspace pure helper
│   ├── components/
│   │   └── TreeNode.tsx           MODIFY — menuPos state, onContextMenu, TabContextMenu mount
│   └── tests/
│       └── path.test.ts           CREATE — 4 vitest cases
└── tests/e2e/
    └── file-tree-context-menu.spec.ts  CREATE — 1 e2e test
```

Boundary intent:
- **`path.ts`** owns the workspace-relative path math. Pure, framework-free, easy to test.
- **`TreeNode.tsx`** owns the right-click trigger + menu wiring. The menu component itself (`TabContextMenu`) stays generic and unchanged.
- No new component file — reuse maximizes.

---

## Task 1: `relativeToWorkspace` pure helper + 4 tests

**Files:**
- Create: `src/lib/path.ts`
- Create: `src/tests/path.test.ts`

- [ ] **Step 1: Create the failing tests at `src/tests/path.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { relativeToWorkspace } from '../lib/path';

describe('relativeToWorkspace', () => {
  it('strips workspace prefix', () => {
    expect(relativeToWorkspace('C:/proj/src/a.rs', 'C:/proj')).toBe('src/a.rs');
  });

  it('handles trailing separator in workspace', () => {
    expect(relativeToWorkspace('C:/proj/src/a.rs', 'C:/proj/')).toBe('src/a.rs');
  });

  it('is case-insensitive on Windows-style paths', () => {
    expect(relativeToWorkspace('C:/PROJ/src/a.rs', 'c:/proj')).toBe('src/a.rs');
  });

  it('returns the path unchanged when outside the workspace', () => {
    expect(relativeToWorkspace('D:/other/x.txt', 'C:/proj')).toBe('D:/other/x.txt');
  });
});
```

- [ ] **Step 2: Run — should FAIL**

```powershell
npm test -- path
```

Expected: FAIL — `src/lib/path.ts` doesn't exist.

- [ ] **Step 3: Create `src/lib/path.ts`**

EXACT contents:

```ts
/**
 * Compute the workspace-relative version of `path`.
 *
 * - Detects the separator from `workspace` (forward if it contains `/`, backslash otherwise).
 * - Trailing separator on `workspace` is normalized.
 * - Prefix match is case-insensitive (Windows convention).
 * - If `path` does not start with the workspace prefix, returns `path` unchanged.
 */
export function relativeToWorkspace(path: string, workspace: string): string {
  if (workspace === '') return path;
  const usesFwd = workspace.includes('/');
  const sep = usesFwd ? '/' : '\\';
  let base = workspace;
  if (!base.endsWith(sep)) base += sep;
  if (path.toLowerCase().startsWith(base.toLowerCase())) {
    return path.slice(base.length);
  }
  return path;
}
```

- [ ] **Step 4: Run the tests**

```powershell
npm test -- path
```

Expected: 4 PASS.

- [ ] **Step 5: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/path.ts src/tests/path.test.ts
git commit -m "path: relativeToWorkspace helper + 4 tests"
```

---

## Task 2: `TreeNode.tsx` — onContextMenu + TabContextMenu mount

**Files:**
- Modify: `src/components/TreeNode.tsx`

- [ ] **Step 1: Add imports at the top of `src/components/TreeNode.tsx`**

After the existing imports, add:

```ts
import { useState } from 'react';
import { TabContextMenu, type TabContextMenuItem } from './TabContextMenu';
import { revealInExplorer } from '../lib/tauri';
import { relativeToWorkspace } from '../lib/path';
```

Note: `useState` may already be imported from React. If so, just merge into the existing react import line (e.g. `import { useState } from 'react';` or add `useState` to an existing `{ … } from 'react'`).

- [ ] **Step 2: Add local state inside the `TreeNode` component body**

Inside `export function TreeNode({ entry, depth }: Props) {`, near the existing `const expanded = useWorkspace(...)` line, add:

```ts
const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
```

- [ ] **Step 3: Add the `buildMenuItems` helper inside `TreeNode`**

Below the existing `onClick = async () => { ... }` definition but before the `return (` block, add:

```ts
function buildMenuItems(path: string): TabContextMenuItem[] {
  const workspaceFolder = useWorkspace.getState().workspaceFolder ?? '';
  return [
    {
      label: 'Reveal in Explorer',
      enabled: true,
      onClick: () => { revealInExplorer(path).catch((err) => console.error('reveal:', err)); },
    },
    {
      label: 'Copy Path',
      enabled: true,
      onClick: () => { navigator.clipboard.writeText(path).catch((err) => console.error('clipboard:', err)); },
    },
    {
      label: 'Copy Relative Path',
      enabled: workspaceFolder !== '',
      onClick: () => {
        const rel = relativeToWorkspace(path, workspaceFolder);
        navigator.clipboard.writeText(rel).catch((err) => console.error('clipboard:', err));
      },
    },
  ];
}
```

- [ ] **Step 4: Modify the existing row `<button>` to add `onContextMenu`**

Find the existing JSX:

```tsx
<button
  type="button"
  data-testid="tree-row"
  data-depth={depth}
  data-is-dir={entry.is_dir}
  onClick={onClick}
  title={entry.path}
  className="..."
  style={...}
>
```

Add the `onContextMenu` attribute right after `onClick`:

```tsx
<button
  type="button"
  data-testid="tree-row"
  data-depth={depth}
  data-is-dir={entry.is_dir}
  onClick={onClick}
  onContextMenu={(e) => { e.preventDefault(); setMenuPos({ x: e.clientX, y: e.clientY }); }}
  title={entry.path}
  className="..."
  style={...}
>
```

- [ ] **Step 5: Mount `<TabContextMenu />` conditionally**

Inside the existing return's outer `<>...</>` fragment (after the `</button>` plus any existing conditional children like the `isLoading` row and recursive `kids?.map`), add at the end (still inside the fragment):

```tsx
{menuPos && (
  <TabContextMenu
    x={menuPos.x}
    y={menuPos.y}
    items={buildMenuItems(entry.path)}
    onClose={() => setMenuPos(null)}
  />
)}
```

If `TreeNode`'s return currently looks like `return (<>… <button>…</button> {expanded children…} </>)`, the `{menuPos && …}` block becomes the final child of the fragment.

- [ ] **Step 6: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean (real output, ignoring LSP noise); all vitest tests green.

- [ ] **Step 7: Commit**

```powershell
git add src/components/TreeNode.tsx
git commit -m "ui: TreeNode context menu (Reveal / Copy Path / Copy Relative)"
```

---

## Task 3: e2e test — right-click renders 3-item menu

**Files:**
- Create: `tests/e2e/file-tree-context-menu.spec.ts`

- [ ] **Step 1: Create the spec**

`tests/e2e/file-tree-context-menu.spec.ts`:

```ts
import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

describe('file-tree context menu', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadToggleSidebar?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
      const open = !!document.querySelector('[data-testid="sidebar"]');
      if (open) w.__memopadToggleSidebar?.();
    });
    await sleep(150);
  });

  it('right-click on a tree row opens a 3-item menu', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(500);

    await classicExecute<void>(
      `const rows = document.querySelectorAll('[data-testid="tree-row"][data-is-dir="false"]');
       for (const r of rows) {
         if ((r.textContent || '').includes('notes.txt')) {
           const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
           r.dispatchEvent(ev);
           break;
         }
       }
       return undefined;`,
    );
    await sleep(150);

    const items = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="menuitem"]')).map(b => b.textContent || '');`,
    );
    expect(items.length).to.equal(3);
    expect(items[0]).to.match(/Reveal in Explorer/);
    expect(items[1]).to.match(/Copy Path/);
    expect(items[2]).to.match(/Copy Relative Path/);
  });
});
```

- [ ] **Step 2: Type-check e2e**

```powershell
npx tsc -p tsconfig.e2e.json --noEmit 2>&1
```

Expected: same baseline `TransformReturn<T>` pattern as other specs (+1 new instance for this file only).

- [ ] **Step 3: DO NOT run `npm run e2e`** — defer to Task 4.

- [ ] **Step 4: Commit**

```powershell
git add tests/e2e/file-tree-context-menu.spec.ts
git commit -m "e2e: right-click tree row opens 3-item context menu"
```

---

## Task 4: Gates + results doc

**Files:**
- Create: `docs/superpowers/plans/v2-file-tree-context-menu-results.md`

- [ ] **Step 1: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Capture vitest total (expected ~83 = 79 baseline + 4 path).

- [ ] **Step 2: cargo (sanity — no Rust changes)**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib
cd ..
```

Expected: 86 (no change from baseline).

- [ ] **Step 3: Release build**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture MSI + app.exe sizes. Baseline: MSI ~6.54 MB, app.exe ~16.13 MB. This slice adds ~0 bytes of Rust.

- [ ] **Step 4: Skip `npm run e2e`** — defer to manual verification.

- [ ] **Step 5: Write results doc**

Create `docs/superpowers/plans/v2-file-tree-context-menu-results.md`:

```markdown
# v2 File Tree Context Menu — Results

## Automated test gates

- Vitest: <N> tests passing (baseline 79; +4 path = 83 expected)
- cargo test: <N> tests passing (baseline 86; no change expected)
- e2e (WebdriverIO): spec written (1 test); full run deferred to manual verification
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: <X.XX> MB (slice-5 baseline 6.54 MB)
- app.exe size: <X.XX> MB (slice-5 baseline 16.13 MB)

## What shipped

- `src/lib/path.ts` — `relativeToWorkspace` pure helper + 4 tests
- `src/components/TreeNode.tsx` — right-click `onContextMenu` handler, `menuPos` state, mounts the existing `TabContextMenu` with three items: Reveal in Explorer, Copy Path, Copy Relative Path
- No new Rust, no new Tauri commands, no new IPC types
- Reuses existing `revealInExplorer` IPC and the existing `TabContextMenu` component

## What is intentionally NOT in this slice

- New file / delete / rename actions
- Per-row hover button
- Native OS context menu
- Toast/banner feedback on copy success
- Menu overflow handling at viewport edges
- Renaming `TabContextMenu` to a more generic name

## Follow-ups (next v2 slices)

1. Backref-aware replace preview in Snippet
2. Split view
3. Rename TabContextMenu → ContextMenu (polish)
```

Fill in actual numbers.

- [ ] **Step 6: Commit**

```powershell
git add docs/superpowers/plans/v2-file-tree-context-menu-results.md
git commit -m "v2 file tree context menu: record results"
```

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec section | Covered by |
| --- | --- |
| `relativeToWorkspace` pure helper | Task 1 |
| 4 vitest cases | Task 1 |
| `TabContextMenu` reuse (no changes) | Tasks 2 (consumer) |
| `TreeNode` `menuPos` state | Task 2 |
| `onContextMenu` handler | Task 2 |
| `buildMenuItems` with 3 items | Task 2 |
| Reveal in Explorer item → existing IPC | Task 2 |
| Copy Path item → `navigator.clipboard.writeText` | Task 2 |
| Copy Relative Path item → helper + clipboard | Task 2 |
| Right-click only trigger | Task 2 (no hover button) |
| 1 e2e test | Task 3 |
| Gates + results doc | Task 4 |

**Placeholder scan:** None.

**Type / signature consistency:**
- `relativeToWorkspace(path: string, workspace: string): string` consistent between definition (Task 1) and consumer (Task 2).
- `TabContextMenuItem { label, enabled, onClick }` reuses the existing component's interface unchanged.
- `menuPos: { x: number; y: number } | null` consistent across state declaration, handler, and `<TabContextMenu>` props.
- `TreeNode` already imports `useWorkspace` (from slice 2); Task 2 reuses that import for `useWorkspace.getState().workspaceFolder`.

**Notes for executor:**
- The existing `TreeNode.tsx` returns a fragment. Task 2's mount of `<TabContextMenu />` must go inside that fragment, not replace the existing return shape. Read the current return JSX carefully before adding the conditional.
- If `useState` is already imported from React at the top of `TreeNode.tsx`, do NOT add a second import; merge instead.
- The e2e spec dispatches a synthetic `MouseEvent('contextmenu', …)` rather than a real right-click. WebdriverIO's right-click click sequence is awkward in Tauri WebView; dispatching the event is more reliable. The React handler runs identically.
- This plan does NOT push to remote and does NOT merge to main (matches the user's standing "do not commit until I say so" boundary, with the caveat that local commits in the worktree are allowed per the established workflow).
