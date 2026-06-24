import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';
import { pollFor, sleep } from './support/helpers';

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

  it('right-click on a tree row opens a 5-item menu', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );

    // Poll until the tree has loaded AND the contextmenu dispatch lands: the
    // tree rows arrive via async IPC + render, and a dispatch loop that finds
    // no row silently no-ops (the documented 0-items CI flake).
    const dispatched = await pollFor(() =>
      classicExecute<boolean>(
        `const rows = document.querySelectorAll('[data-testid="tree-row"][data-is-dir="false"]');
         for (const r of rows) {
           if ((r.textContent || '').includes('notes.txt')) {
             const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
             r.dispatchEvent(ev);
             return true;
           }
         }
         return false;`,
      ),
    );
    expect(dispatched, 'notes.txt row should render and receive contextmenu').to.equal(true);

    // The menu itself renders on the next React commit — poll for all 5 items.
    const menuReady = await pollFor(async () =>
      (await classicExecute<number>(
        `return document.querySelectorAll('[role="menuitem"]').length;`,
      )) === 5,
    );
    expect(menuReady, 'context menu should show 5 items').to.equal(true);

    const items = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="menuitem"]')).map(b => b.textContent || '');`,
    );
    // File row menu: Rename, Delete, Reveal in Explorer, Copy Path, Copy Relative Path.
    expect(items.length).to.equal(5);
    expect(items[0]).to.match(/Rename/);
    expect(items[1]).to.match(/Delete/);
    expect(items[2]).to.match(/Reveal in Explorer/);
    expect(items[3]).to.match(/Copy Path/);
    expect(items[4]).to.match(/Copy Relative Path/);
  });
});
