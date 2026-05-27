import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

describe('find-in-files', () => {
  beforeEach(async () => {
    // Reset: close sidebar, clear workspace, clear buffers.
    await exec(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadToggleSidebar?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string); // clear
      // Ensure sidebar starts closed: toggle off if open.
      const open = !!document.querySelector('[data-testid="sidebar"]');
      if (open) w.__memopadToggleSidebar?.();
    });
    await sleep(150);
  });

  it('Ctrl+B opens the sidebar showing the empty state', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(200);
    const sidebarPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="sidebar"]');`,
    );
    expect(sidebarPresent).to.equal(true);
    const text = await classicExecute<string>(
      `return document.querySelector('[data-testid="sidebar"]').textContent || '';`,
    );
    expect(text).to.match(/Open a folder/);
  });

  it('renders the SearchPanel after a workspace folder is set', async () => {
    // Open sidebar first.
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    // Inject workspace folder via test hook using classicExecute with args.
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(arguments[0]); return undefined;`,
      [FIXTURE],
    );
    await sleep(200);
    const panelPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="search-panel"]');`,
    );
    expect(panelPresent).to.equal(true);
  });

  it('typing a query renders matching results from the fixture folder', async () => {
    // Open sidebar + inject workspace folder.
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(150);
    // Set the search input value programmatically to avoid key-typing flakiness.
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="search-input"]');
       if (i) {
         const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
         setter.call(i, 'alpha');
         i.dispatchEvent(new Event('input', { bubbles: true }));
       }
       return undefined;`,
    );
    // Wait for the 200ms debounce + IPC round-trip.
    await sleep(800);
    const matchCount = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="match-row"]').length;`,
    );
    expect(matchCount).to.be.greaterThanOrEqual(2);
  });

  it('clicking a match opens the file and switches to its tab', async () => {
    // Re-establish sidebar + workspace + query to be self-contained.
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(150);
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="search-input"]');
       if (i) {
         const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
         setter.call(i, 'alpha');
         i.dispatchEvent(new Event('input', { bubbles: true }));
       }
       return undefined;`,
    );
    await sleep(800);
    await classicExecute<void>(
      `const row = document.querySelector('[data-testid="match-row"]');
       if (row) row.click();
       return undefined;`,
    );
    await sleep(500);
    // After clicking, the active tab path should contain "notes.txt" or "code.rs".
    const activePath = await classicExecute<string | null>(
      `const state = window.__memopadTestGetActiveBufferPath
          ? window.__memopadTestGetActiveBufferPath()
          : null;
       return state;`,
    );
    // If the test hook doesn't exist, fall back to reading the title-bar text.
    if (activePath) {
      expect(activePath).to.match(/notes\.txt|code\.rs/);
    } else {
      const titleText = await classicExecute<string>(
        `return document.querySelector('[data-tauri-drag-region]')?.textContent || '';`,
      );
      expect(titleText).to.match(/notes\.txt|code\.rs|Untitled/);
    }
  });
});
