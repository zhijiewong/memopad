import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function openPy() {
  const w = window as unknown as {
    __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
  };
  w.__memopadTestOpenBuffer({ path: '/tmp/script.py', content: 'print(1)', encoding: 'utf-8', eol: 'lf' });
}

describe('language support', () => {
  beforeEach(async () => {
    await exec(() => {
      (window as unknown as { __memopadTestReset: () => void }).__memopadTestReset();
    });
  });

  it('auto-detects language from the file extension', async () => {
    await exec(openPy);
    const label = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="language"]').textContent;`,
    );
    expect(label).to.equal('Python');
  });

  it('manual override changes the language and Auto-detect reverts it', async () => {
    await exec(openPy);
    await exec(() => {
      (window as unknown as { __memopadTestSetLanguage: (id: string | null) => void }).__memopadTestSetLanguage('javascript');
    });
    let label = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="language"]').textContent;`,
    );
    expect(label).to.equal('JavaScript');

    await exec(() => {
      (window as unknown as { __memopadTestSetLanguage: (id: string | null) => void }).__memopadTestSetLanguage(null);
    });
    label = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="language"]').textContent;`,
    );
    expect(label).to.equal('Python');
  });

  it('clicking the language segment opens (and click-away closes) the picker', async () => {
    await exec(openPy);
    await exec(() => {
      (document.querySelector('[data-status-segment="language"]') as HTMLButtonElement)?.click();
    });
    await sleep(100);
    const open = await classicExecute<boolean>(`return !!document.querySelector('[role="menu"]');`);
    expect(open, 'menu opens on click').to.equal(true);

    // Close via click-away so no stale popover leaks into later specs.
    await exec(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await sleep(60);
    const closed = await classicExecute<boolean>(`return !document.querySelector('[role="menu"]');`);
    expect(closed, 'menu closes on click-away').to.equal(true);
  });

  it('registers the Set Language command', async () => {
    const ids = await classicExecute<string[]>(`return window.__memopadTestCommandIds();`);
    expect(ids).to.include('view.setLanguage');
  });
});
