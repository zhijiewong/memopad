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
});
