import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';
import { pollFor, sleep } from './support/helpers';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

describe('file-tree', () => {
  beforeEach(async () => {
    await exec(() => {
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

  it('Files tab renders workspace root entries', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    const rowCount = await pollFor(async () =>
      (await classicExecute<number>(
        `return document.querySelectorAll('[data-testid="tree-row"]').length;`,
      )) >= 2,
    );
    expect(rowCount, 'workspace root should have at least 2 rows').to.equal(true);
  });

  it('clicking a folder expands it and loads children', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    // Poll until the 'sub' folder row exists AND the click lands.
    const clicked = await pollFor(() =>
      classicExecute<boolean>(
        `const rows = document.querySelectorAll('[data-testid="tree-row"][data-is-dir="true"]');
         for (const r of rows) {
           if (r.textContent && r.textContent.indexOf('sub') !== -1) { r.click(); return true; }
         }
         return false;`,
      ),
    );
    expect(clicked, 'sub folder row should render and be clicked').to.equal(true);
    // Poll until child rows at depth-1 appear.
    const hasChildren = await pollFor(async () =>
      (await classicExecute<number>(
        `return document.querySelectorAll('[data-testid="tree-row"][data-depth="1"]').length;`,
      )) >= 1,
    );
    expect(hasChildren, 'sub folder should have at least one child row').to.equal(true);
  });

  it('clicking a file opens it as the active tab', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    // Poll until notes.txt row exists AND the click lands.
    const clicked = await pollFor(() =>
      classicExecute<boolean>(
        `const rows = document.querySelectorAll('[data-testid="tree-row"][data-is-dir="false"]');
         for (const r of rows) {
           if (r.textContent && r.textContent.indexOf('notes.txt') !== -1) { r.click(); return true; }
         }
         return false;`,
      ),
    );
    expect(clicked, 'notes.txt row should render and be clicked').to.equal(true);
    // Poll until the active buffer path reflects notes.txt.
    const opened = await pollFor(async () => {
      const p = await classicExecute<string | null>(
        `if (window.__memopadTestGetActiveBufferPath) return window.__memopadTestGetActiveBufferPath();
         const titleEl = document.querySelector('.drag-region');
         return titleEl ? titleEl.textContent : null;`,
      );
      return p != null && /notes\.txt/.test(p);
    });
    expect(opened, 'notes.txt should become the active buffer').to.equal(true);
  });
});
