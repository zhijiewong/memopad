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
