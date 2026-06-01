import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** Reset to a 3-line buffer with the caret on line 2. */
async function freshThreeLines() {
  await getBrowser().execute(() => {
    const w = window as unknown as {
      __memopadTestReset?: () => void;
      __memopadTestNewBuffer?: () => string;
      __memopadTestSetContent?: (s: string) => void;
    };
    w.__memopadTestReset?.();
    w.__memopadTestNewBuffer?.();
    w.__memopadTestSetContent?.('a\nb\nc');
  });
  await sleep(150);
  await classicExecute<void>(`window.__memopadGotoLine(2); return undefined;`);
  await sleep(150);
}

describe('line operations', () => {
  beforeEach(freshThreeLines);

  it('duplicate (dispatcher) copies the caret line', async () => {
    await classicExecute<void>(`window.__memopadLineCommand('duplicate'); return undefined;`);
    await sleep(150);
    const content = await classicExecute<string>(`return window.__memopadTestGetContent();`);
    expect(content).to.equal('a\nb\nb\nc');
  });

  it('move up reorders the caret line', async () => {
    await classicExecute<void>(`window.__memopadLineCommand('moveUp'); return undefined;`);
    await sleep(150);
    const content = await classicExecute<string>(`return window.__memopadTestGetContent();`);
    expect(content).to.equal('b\na\nc');
  });

  it('delete removes the caret line', async () => {
    await classicExecute<void>(`window.__memopadLineCommand('delete'); return undefined;`);
    await sleep(150);
    const content = await classicExecute<string>(`return window.__memopadTestGetContent();`);
    expect(content).to.equal('a\nc');
  });

  it('Ctrl+D keypress duplicates the caret line', async () => {
    // Caret is on line 2 (from beforeEach). Send the real chord.
    await getBrowser().keys(['Control', 'd']);
    await sleep(150);
    const content = await classicExecute<string>(`return window.__memopadTestGetContent();`);
    expect(content).to.equal('a\nb\nb\nc');
  });
});
