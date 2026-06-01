import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('cursor navigation', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestNewBuffer?: () => string;
        __memopadTestSetContent?: (s: string) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestNewBuffer?.();
      // 10 lines.
      w.__memopadTestSetContent?.(Array.from({ length: 10 }, (_, i) => 'line ' + (i + 1)).join('\n'));
    });
    await sleep(250);
  });

  it('Go to Line moves the caret and updates the Ln/Col indicator', async () => {
    await classicExecute<void>(`window.__memopadGotoLine(5); return undefined;`);
    await sleep(200);

    const pos = await classicExecute<{ line: number; col: number }>(
      `return window.__memopadTestCursorPos();`,
    );
    expect(pos.line, 'caret should be on line 5').to.equal(5);
    expect(pos.col, 'caret at column 1').to.equal(1);

    const segText = await classicExecute<string>(
      `return (document.querySelector('[data-status-segment="cursor"]') || {}).textContent || '';`,
    );
    expect(segText).to.match(/Ln\s*5,\s*Col\s*1/);
  });

  it('clamps an out-of-range line to the last line', async () => {
    await classicExecute<void>(`window.__memopadGotoLine(999); return undefined;`);
    await sleep(200);
    const pos = await classicExecute<{ line: number; col: number }>(
      `return window.__memopadTestCursorPos();`,
    );
    expect(pos.line, 'caret clamps to line 10').to.equal(10);
  });
});
