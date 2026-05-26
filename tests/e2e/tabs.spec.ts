import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

type Win = typeof window & {
  __memopadTestReset: () => void;
  __memopadTestNewBuffer: () => string;
  __memopadTestOpenBuffer: (file: { path: string; content: string; encoding: string; eol: string }) => string;
  __memopadTestCloseBuffer: (id: string) => void;
  __memopadTestSwitchTo: (id: string) => void;
  __memopadTestActiveId: () => string | null;
  __memopadTestTabIds: () => string[];
  __memopadTestRunCommand: (id: string) => void;
};

describe('tabs', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      (window as unknown as Win).__memopadTestReset();
    });
  });

  it('opening two files yields two tabs; activeId is the second', async () => {
    const ids = await getBrowser().execute(() => {
      const w = window as unknown as Win;
      return [
        w.__memopadTestOpenBuffer({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
        w.__memopadTestOpenBuffer({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
      ];
    });
    const active = await getBrowser().execute(() => (window as unknown as Win).__memopadTestActiveId());
    expect(active).to.equal(ids[1]);
    const all = await getBrowser().execute(() => (window as unknown as Win).__memopadTestTabIds());
    expect(all).to.deep.equal(ids);
  });

  it('switchTo changes active without closing others', async () => {
    const [a, b] = await getBrowser().execute(() => {
      const w = window as unknown as Win;
      return [
        w.__memopadTestOpenBuffer({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
        w.__memopadTestOpenBuffer({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
      ];
    });
    await getBrowser().execute((id: string) => {
      (window as unknown as Win).__memopadTestSwitchTo(id);
    }, a);
    expect(await getBrowser().execute(() => (window as unknown as Win).__memopadTestActiveId())).to.equal(a);
    expect(await getBrowser().execute(() => (window as unknown as Win).__memopadTestTabIds())).to.deep.equal([a, b]);
  });

  it('closing active tab focuses the next tab', async () => {
    const [a, b, c] = await getBrowser().execute(() => {
      const w = window as unknown as Win;
      return [
        w.__memopadTestOpenBuffer({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
        w.__memopadTestOpenBuffer({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
        w.__memopadTestOpenBuffer({ path: '/tmp/c.txt', content: 'C', encoding: 'utf-8', eol: 'lf' }),
      ];
    });
    // c is active; close it
    await getBrowser().execute((id: string) => {
      (window as unknown as Win).__memopadTestCloseBuffer(id);
    }, c);
    expect(await getBrowser().execute(() => (window as unknown as Win).__memopadTestActiveId())).to.equal(b);
    expect(await getBrowser().execute(() => (window as unknown as Win).__memopadTestTabIds())).to.deep.equal([a, b]);
  });

  it('Tab DOM reflects buffer order', async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as Win;
      w.__memopadTestOpenBuffer({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' });
      w.__memopadTestOpenBuffer({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' });
    });
    const tabNames = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[role="tab"]')).map(el => el.textContent.replace(/●/g,'').trim());`,
    );
    expect(tabNames).to.deep.equal(['a.txt', 'b.txt']);
  });

  it('Ctrl+W (via command) closes the active tab', async () => {
    const [a, b] = await getBrowser().execute(() => {
      const w = window as unknown as Win;
      return [
        w.__memopadTestOpenBuffer({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
        w.__memopadTestOpenBuffer({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
      ];
    });
    await getBrowser().execute(() => {
      (window as unknown as Win).__memopadTestRunCommand('tab.close');
    });
    expect(await getBrowser().execute(() => (window as unknown as Win).__memopadTestTabIds())).to.deep.equal([a]);
    expect(await getBrowser().execute(() => (window as unknown as Win).__memopadTestActiveId())).to.equal(a);
    void b;
  });

  it('Ctrl+Shift+T (via command) reopens the most recently closed tab', async () => {
    const [a, b] = await getBrowser().execute(() => {
      const w = window as unknown as Win;
      return [
        w.__memopadTestOpenBuffer({ path: '/tmp/a.txt', content: 'A', encoding: 'utf-8', eol: 'lf' }),
        w.__memopadTestOpenBuffer({ path: '/tmp/b.txt', content: 'B', encoding: 'utf-8', eol: 'lf' }),
      ];
    });
    await getBrowser().execute((id: string) => {
      (window as unknown as Win).__memopadTestCloseBuffer(id);
    }, b);
    expect(await getBrowser().execute(() => (window as unknown as Win).__memopadTestTabIds())).to.deep.equal([a]);
    await getBrowser().execute(() => {
      (window as unknown as Win).__memopadTestRunCommand('tab.reopen');
    });
    expect((await getBrowser().execute(() => (window as unknown as Win).__memopadTestTabIds())).length).to.equal(2);
  });
});
