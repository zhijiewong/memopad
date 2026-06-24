import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';
import { pollFor } from './support/helpers';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

function bannerPresent(): Promise<boolean> {
  return classicExecute<boolean>(
    `return !!document.querySelector('[data-external-change-banner]');`,
  );
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
    const present = await bannerPresent();
    expect(present).to.equal(false);
  });

  it('appears when externalChange is set on the active buffer', async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
        __memopadTestSetExternalChange: (id: string, flag: boolean) => void;
        __memopadTestActiveId: () => string | null;
      };
      w.__memopadTestOpenBuffer({ path: '/tmp/x.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
      const active = w.__memopadTestActiveId();
      if (active) w.__memopadTestSetExternalChange(active, true);
    });
    // The store update reaches the DOM via an async React commit — poll, don't assume.
    expect(await pollFor(bannerPresent), 'banner should appear').to.equal(true);
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
    // Poll until the click actually lands: a blind `if (btn) btn.click()` races
    // the banner's first render and silently no-ops on slow runners — the exact
    // flake this spec used to have.
    const clicked = await pollFor(() =>
      classicExecute<boolean>(
        `var btns = Array.from(document.querySelectorAll('[data-external-change-banner] button'));
         var keep = btns.find(b => b.textContent && b.textContent.trim() === 'Keep mine');
         if (keep) { keep.click(); return true; }
         return false;`,
      ),
    );
    expect(clicked, '"Keep mine" button should render and be clicked').to.equal(true);
    expect(await pollFor(async () => !(await bannerPresent())), 'banner should clear').to.equal(true);
  });
});
