import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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
    await sleep(800);
    const rowCount = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="tree-row"]').length;`,
    );
    expect(rowCount).to.be.greaterThanOrEqual(2);
  });

  it('clicking a folder expands it and loads children', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(800);
    await classicExecute<void>(
      `const rows = document.querySelectorAll('[data-testid="tree-row"][data-is-dir="true"]');
       for (const r of rows) {
         if (r.textContent && r.textContent.indexOf('sub') !== -1) { r.click(); break; }
       }
       return undefined;`,
    );
    await sleep(600);
    const childCount = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="tree-row"][data-depth="1"]').length;`,
    );
    expect(childCount).to.be.greaterThanOrEqual(1);
  });

  it('clicking a file opens it as the active tab', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(800);
    await classicExecute<void>(
      `const rows = document.querySelectorAll('[data-testid="tree-row"][data-is-dir="false"]');
       for (const r of rows) {
         if (r.textContent && r.textContent.indexOf('notes.txt') !== -1) { r.click(); break; }
       }
       return undefined;`,
    );
    await sleep(500);
    const activePath = await classicExecute<string | null>(
      `if (window.__memopadTestGetActiveBufferPath) return window.__memopadTestGetActiveBufferPath();
       const titleEl = document.querySelector('[data-tauri-drag-region]');
       return titleEl ? titleEl.textContent : null;`,
    );
    expect(activePath ?? '').to.match(/notes\.txt/);
  });
});
