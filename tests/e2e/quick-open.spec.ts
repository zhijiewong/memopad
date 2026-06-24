import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';
import { pollFor, sleep } from './support/helpers';

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

describe('quick open', () => {
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

  it('Ctrl+P opens the palette; typing + Enter opens the picked file', async () => {
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`,
    );
    await sleep(150);

    await getBrowser().keys(['Control', 'p']);
    // Poll for palette instead of fixed sleep — palette renders on next React commit.
    const paletteVisible = await pollFor(() =>
      classicExecute<boolean>(
        `return !!document.querySelector('[data-testid="quick-open-palette"]');`,
      ),
    );
    expect(paletteVisible).to.equal(true);

    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="quick-open-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'notes');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    // Poll until filtered rows appear — debounce + index lookup can outlast fixed sleep.
    const rowsReady = await pollFor(async () =>
      (await classicExecute<number>(
        `return document.querySelectorAll('[data-testid="quick-open-row"]').length;`,
      )) >= 1,
    );
    expect(rowsReady, 'quick-open should show at least one result row').to.equal(true);

    await getBrowser().keys(['Enter']);
    // Poll for palette to close.
    const closed = await pollFor(async () =>
      !(await classicExecute<boolean>(
        `return !!document.querySelector('[data-testid="quick-open-palette"]');`,
      )),
    );
    expect(closed, 'palette should close after Enter').to.equal(true);

    const activePath = await classicExecute<string | null>(
      `if (window.__memopadTestGetActiveBufferPath) return window.__memopadTestGetActiveBufferPath();
       return null;`,
    );
    if (activePath) {
      expect(activePath).to.match(/notes\.txt$/);
    } else {
      const hasNotes = await classicExecute<boolean>(
        `return Array.from(document.querySelectorAll('[role="tab"]')).some(t => (t.textContent || '').includes('notes.txt'));`,
      );
      expect(hasNotes).to.equal(true);
    }
  });
});
