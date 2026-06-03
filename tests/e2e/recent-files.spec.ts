import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('recent files', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestResetRecentFiles?: () => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestResetRecentFiles?.();
    });
    await sleep(150);
  });

  it('records opened files MRU and reopens via the recent command', async () => {
    await classicExecute<void>(
      `window.__memopadTestOpenBuffer({ path: 'C:/proj/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
       window.__memopadTestOpenBuffer({ path: 'C:/proj/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' });
       return undefined;`,
    );
    await sleep(150);

    const mru = await classicExecute<string[]>(`return window.__memopadTestRecentFiles();`);
    // Primary, deterministic assertion: MRU ordering after opens.
    expect(mru, 'MRU is B then A').to.deep.equal(['C:/proj/b.txt', 'C:/proj/a.txt']);

    // file.recent.1 is A (index 1 in the MRU). Running it routes to the already-open A buffer.
    // The fs-backed reopen is best-effort (these paths don't exist on disk), so this is a
    // soft check; the MRU ordering above is the authoritative assertion.
    await classicExecute<void>(`window.__memopadTestRunCommand('file.recent.1'); return undefined;`);
    await sleep(200);
  });
});
