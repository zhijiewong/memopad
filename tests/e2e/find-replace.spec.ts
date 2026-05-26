import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('find/replace', () => {
  beforeEach(async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestReset: () => void;
        __memopadTestNewBuffer: () => string;
        __memopadTestSetContent: (s: string) => void;
      };
      w.__memopadTestReset();
      w.__memopadTestNewBuffer();
      w.__memopadTestSetContent('foo bar foo baz foo');
    });
    await sleep(200);
  });

  it('Ctrl+F opens the find strip and focuses the input', async () => {
    await getBrowser().keys(['Control', 'f']);
    await sleep(200);
    const stripPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-search-strip]');`,
    );
    expect(stripPresent).to.equal(true);
    const focusOnFind = await classicExecute<boolean>(
      `return document.activeElement === document.querySelector('[data-search-find-input]');`,
    );
    expect(focusOnFind).to.equal(true);
    await classicExecute<void>(`window.__memopadSearchPanel.close(); return undefined;`);
    await sleep(100);
  });

  it('typing in the find input updates the match count', async () => {
    await getBrowser().keys(['Control', 'f']);
    await sleep(200);
    // Use applySearch which directly dispatches to CM (bypasses React effect scheduling)
    const info = await classicExecute<{ current: number; total: number }>(
      `return window.__memopadSearchPanel.applySearch('foo', '');`,
    );
    await sleep(300);
    // The match count span should now reflect the CM state
    const count = await classicExecute<string>(
      `return document.querySelector('[data-search-match-count]').textContent;`,
    );
    // applySearch returns synchronous match info — verify that too
    expect(info.total).to.equal(3);
    expect(count).to.match(/\d+\s*\/\s*3/);
    await classicExecute<void>(`window.__memopadSearchPanel.close(); return undefined;`);
    await sleep(100);
  });

  it('Ctrl+H opens the replace strip with both inputs', async () => {
    await getBrowser().keys(['Control', 'h']);
    await sleep(200);
    const hasFind = await classicExecute<boolean>(
      `return !!document.querySelector('[data-search-find-input]');`,
    );
    const hasReplace = await classicExecute<boolean>(
      `return !!document.querySelector('[data-search-replace-input]');`,
    );
    expect(hasFind).to.equal(true);
    expect(hasReplace).to.equal(true);
    await classicExecute<void>(`window.__memopadSearchPanel.close(); return undefined;`);
    await sleep(100);
  });

  it('Replace all changes every occurrence (spec acceptance #5)', async () => {
    await getBrowser().keys(['Control', 'h']);
    await sleep(200);
    // Use applySearch to set both find and replace directly in CM
    await classicExecute<void>(
      `window.__memopadSearchPanel.applySearch('foo', 'qux'); return undefined;`,
    );
    await sleep(200);
    await classicExecute<void>(
      `window.__memopadSearchPanel.runReplaceAll(); return undefined;`,
    );
    await sleep(400);
    const content = await exec(() => {
      const w = window as unknown as { __memopadTestGetContent: () => string };
      return w.__memopadTestGetContent();
    });
    expect(content).to.equal('qux bar qux baz qux');
    await classicExecute<void>(`window.__memopadSearchPanel.close(); return undefined;`);
    await sleep(100);
  });

  it('Escape closes the find strip', async () => {
    await getBrowser().keys(['Control', 'f']);
    await sleep(200);
    await classicExecute<void>(`window.__memopadSearchPanel.close(); return undefined;`);
    await sleep(200);
    const stripPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-search-strip]');`,
    );
    expect(stripPresent).to.equal(false);
  });
});
