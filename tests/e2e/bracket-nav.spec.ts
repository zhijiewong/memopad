import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('bracket navigation', () => {
  beforeEach(async () => {
    await exec(() => {
      (window as unknown as { __memopadTestReset: () => void }).__memopadTestReset();
    });
  });

  it('Go to Matching Bracket jumps the caret to the partner', async () => {
    await exec(() => {
      (window as unknown as {
        __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
      }).__memopadTestOpenBuffer({ path: '/tmp/brk.js', content: '(foo)', encoding: 'utf-8', eol: 'lf' });
    });
    await sleep(120);
    // Deterministically place the caret at offset 0 (before '(') and focus the pane.
    await exec(() => {
      (window as unknown as { __memopadGotoLine?: (n: number) => void }).__memopadGotoLine?.(1);
    });
    await sleep(40);
    await exec(() => {
      (window as unknown as { __memopadBracketCommand?: (c: 'goto' | 'select') => void }).__memopadBracketCommand?.('goto');
    });
    await sleep(60);
    const pos = await classicExecute<{ line: number; col: number }>(
      `return window.__memopadTestCursorPos();`,
    );
    // After ')' in "(foo)" → Ln 1, Col 6 (1-based column).
    expect(pos.line).to.equal(1);
    expect(pos.col).to.equal(6);
  });

  it('registers the bracket-navigation commands', async () => {
    const ids = await classicExecute<string[]>(`return window.__memopadTestCommandIds();`);
    expect(ids).to.include('edit.goToMatchingBracket');
    expect(ids).to.include('edit.selectToMatchingBracket');
  });
});
