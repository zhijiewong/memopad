import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('recent-folders', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
    });
    await sleep(150);
  });

  it('Ctrl+R opens palette pre-filtered with recent entries', async () => {
    // Seed two recents via the test hook.
    await classicExecute<void>(
      `window.__memopadTestPushRecent('C:/tmp/proj-alpha');
       window.__memopadTestPushRecent('C:/tmp/proj-beta');
       return undefined;`,
    );
    await sleep(150);
    // Press Ctrl+R.
    await getBrowser().keys(['Control', 'r']);
    await sleep(300);
    // Palette should be open with the query pre-filled.
    const inputValue = await classicExecute<string>(
      `const i = document.querySelector('input[placeholder="Type a command…"]');
       return i ? i.value : '';`,
    );
    expect(inputValue).to.match(/^Open Recent: /);
    // At least one Open Recent entry should be visible.
    const entries = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="option"]')).map(el => el.textContent || '');`,
    );
    const recentEntries = entries.filter((t) => t.includes('Open Recent:'));
    expect(recentEntries.length).to.be.greaterThanOrEqual(1);
    // Close palette.
    await getBrowser().keys('Escape');
  });
});
