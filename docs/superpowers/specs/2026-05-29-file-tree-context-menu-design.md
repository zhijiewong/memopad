# File Tree Context Menu — v2 Slice 6 Design

Date: 2026-05-29
Status: Approved (awaiting implementation plan)
Predecessor: `2026-05-28-file-tree-design.md` (slice 2; introduced TreeNode)

## Goal

Right-click on any row in the file tree to get a three-item context menu: **Reveal in Explorer**, **Copy Path**, **Copy Relative Path**. Reuses the existing `TabContextMenu` component and the existing `reveal_in_explorer` Tauri command. Smallest v2 slice yet.

## Non-goals

- **New file / delete / rename actions.** Stays in line with slice 2's "read-only tree" pillar.
- **Per-row hover button.** Right-click only.
- **Native OS context menu.** Custom HTML menu (matches the existing TabContextMenu approach).
- **Toast/banner feedback on copy success.** Quiet — copy either works or logs to console.
- **Open containing folder.** Reveal in Explorer already opens the parent with the item selected; a separate "open containing folder" would be redundant.

## Architecture

### Reuse `TabContextMenu`

`src/components/TabContextMenu.tsx` already exposes a generic interface:

```ts
export interface TabContextMenuItem {
  label: string;
  enabled: boolean;
  onClick: () => void;
}
```

It accepts an `(x, y)` position, a list of items, and an `onClose` callback. No changes to this component.

### Pure helper — `src/lib/path.ts` (new, ~15 LOC)

```ts
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

Behavior:
- Separator detected from the workspace path (forward if it contains `/`, backslash otherwise).
- Trailing separator on workspace is normalized.
- Case-insensitive prefix match (Windows convention).
- If path doesn't start with workspace, return path unchanged.

### `src/components/TreeNode.tsx` modifications

Add:

```ts
import { useState } from 'react';
import { TabContextMenu, type TabContextMenuItem } from './TabContextMenu';
import { revealInExplorer } from '../lib/tauri';
import { relativeToWorkspace } from '../lib/path';
```

Inside the existing `TreeNode` component body:

```ts
const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
```

Modify the existing row `<button onClick={onClick}>` element to also accept `onContextMenu`:

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
>
  …
</button>
```

After the existing `</button>` (and any conditional children rendering), append:

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

Define `buildMenuItems` inside `TreeNode` (closure-captures `useWorkspace`):

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

No store changes. No new Tauri commands. No new IPC types.

## Data flow

1. User right-clicks a tree row.
2. `onContextMenu` handler fires: `e.preventDefault()` (suppress the WebView's default menu), `setMenuPos({x, y})` with viewport coords.
3. React re-renders; `<TabContextMenu />` mounts at `position: fixed; left: x; top: y;` (the existing component handles outside-click and Escape).
4. User clicks a menu item:
   - **Reveal in Explorer** → existing `revealInExplorer(path)` IPC → Rust `Command::new("explorer.exe").arg("/select,").arg(path)`. Closes menu.
   - **Copy Path** → `navigator.clipboard.writeText(path)`. Closes menu.
   - **Copy Relative Path** → `navigator.clipboard.writeText(relativeToWorkspace(path, workspaceFolder))`. Closes menu.
5. User presses Escape or clicks outside → menu closes (existing TabContextMenu behavior).

## Error handling

| Scenario | Behavior |
| --- | --- |
| `revealInExplorer` rejects (e.g. path got deleted between menu open and click) | `console.error` only. No toast in v1. |
| `navigator.clipboard.writeText` rejects (rare; permission denied in some webview configurations) | `console.error` only. |
| `workspaceFolder` is null (e.g. user closed workspace between right-click and clicking Copy Relative) | "Copy Relative Path" is disabled when `workspaceFolder === ''`. If it somehow becomes null between click and execution, `relativeToWorkspace(path, '')` returns `path` unchanged — degrades to Copy Path. Acceptable. |
| Path is outside workspace (symlink or some edge case) | `relativeToWorkspace` returns the absolute path unchanged. Clipboard receives the absolute path. Acceptable — relative-path-with-no-base doesn't exist. |
| Menu overflows the viewport when right-clicking near the bottom edge | Existing TabContextMenu doesn't handle this. Out of scope; address in a polish slice if users hit it. |

## Testing

### Vitest — `src/tests/path.test.ts` (target 4 cases)

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

### WebdriverIO e2e — `tests/e2e/file-tree-context-menu.spec.ts` (target 1 test)

Reuses the slice-1 fixture.

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

    // Find the notes.txt row and dispatch a contextmenu event at (100, 100).
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

### Gates to ship

- vitest: 79 → 83 (+4 path)
- cargo test: 86 → 86 (no Rust changes)
- e2e: 11 → 12 (+1)
- `tsc --noEmit` clean
- Manual smoke: open a folder, right-click a file, verify the menu, copy a relative path, paste somewhere to confirm.

## Risks and open questions

- **Clipboard write may need a user gesture.** The menu-item click IS a user gesture, so Chromium's clipboard API permits it. If WebView2's gesture-tracking differs, the write may still fail silently. Acceptable for v1; surface a toast in a polish slice if reports come in.
- **Menu overflow at viewport edges.** Pre-existing TabContextMenu limitation. Not addressed here.
- **Right-click on a folder row.** Same menu shows; behaviors:
  - "Reveal in Explorer" — Rust's `explorer.exe /select,<folder>` opens the parent with the folder selected (works).
  - "Copy Path" / "Copy Relative Path" — copies the folder's path (works).
  All three are useful for folders too — no need to differentiate.
- **Reuse of `TabContextMenu` name.** The component name now misleads (it's used by both tabs and tree). Renaming to `ContextMenu` would touch TabStrip's import. Out of scope for this tiny slice; address in a polish slice if it bothers anyone.
