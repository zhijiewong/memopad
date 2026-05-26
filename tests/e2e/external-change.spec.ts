import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

describe('external-change banner', () => {
  beforeEach(async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestReset: () => void };
      w.__memopadTestReset();
    });
  });

  it('does not show when externalChange flag is false', async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
      };
      w.__memopadTestOpenBuffer({ path: '/tmp/x.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
    });
    const present = await classicExecute<boolean>(
      `return !!document.querySelector('[data-external-change-banner]');`,
    );
    expect(present).to.equal(false);
  });

  it('appears when externalChange is set on the active buffer', async () => {
    const id = await exec(() => {
      const w = window as unknown as {
        __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
      };
      return w.__memopadTestOpenBuffer({ path: '/tmp/x.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
    });
    await exec(() => {
      const w = window as unknown as {
        __memopadTestSetExternalChange: (id: string, flag: boolean) => void;
        __memopadTestActiveId: () => string | null;
      };
      const active = w.__memopadTestActiveId();
      if (active) w.__memopadTestSetExternalChange(active, true);
    });
    const present = await classicExecute<boolean>(
      `return !!document.querySelector('[data-external-change-banner]');`,
    );
    expect(present).to.equal(true);
    void id;
  });

  it('Keep mine clears the externalChange flag', async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
        __memopadTestSetExternalChange: (id: string, flag: boolean) => void;
        __memopadTestActiveId: () => string | null;
      };
      w.__memopadTestOpenBuffer({ path: '/tmp/x.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
      const id = w.__memopadTestActiveId();
      if (id) w.__memopadTestSetExternalChange(id, true);
    });
    await classicExecute<void>(
      `var btns = Array.from(document.querySelectorAll('[data-external-change-banner] button'));
       var keep = btns.find(b => b.textContent && b.textContent.trim() === 'Keep mine');
       if (keep) keep.click();
       return undefined;`,
    );
    await new Promise((r) => setTimeout(r, 200));
    const after = await classicExecute<boolean>(
      `return !!document.querySelector('[data-external-change-banner]');`,
    );
    expect(after).to.equal(false);
  });
});
