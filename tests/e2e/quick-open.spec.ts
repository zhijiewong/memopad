import { expect } from 'chai';
import * as path from 'node:path';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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
    await sleep(300);

    const paletteVisible = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="quick-open-palette"]');`,
    );
    expect(paletteVisible).to.equal(true);

    await sleep(500);

    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="quick-open-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'notes');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(300);

    const rowCount = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="quick-open-row"]').length;`,
    );
    expect(rowCount).to.be.greaterThanOrEqual(1);

    await getBrowser().keys(['Enter']);
    await sleep(400);

    const stillOpen = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="quick-open-palette"]');`,
    );
    expect(stillOpen).to.equal(false);

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
