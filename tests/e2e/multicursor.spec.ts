import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

describe('multi-cursor', () => {
  beforeEach(async () => {
    await exec(() => {
      (window as unknown as { __memopadTestReset: () => void }).__memopadTestReset();
    });
  });

  it('Add Cursor Below stacks a second cursor; Escape collapses it', async () => {
    await exec(() => {
      (window as unknown as {
        __memopadTestNewBuffer?: () => string;
        __memopadTestSetContent?: (s: string) => void;
      }).__memopadTestNewBuffer?.();
      (window as unknown as {
        __memopadTestSetContent?: (s: string) => void;
      }).__memopadTestSetContent?.('abc\ndef');
    });
    await sleep(150);
    await classicExecute<void>(`window.__memopadGotoLine(1); return undefined;`);
    await sleep(60);
    await classicExecute<void>(`window.__memopadMultiCursorCommand('below'); return undefined;`);
    await sleep(60);
    const after = await classicExecute<number>(`return window.__memopadTestSelectionCount();`);
    expect(after).to.equal(2);

    // Escape collapses to the primary cursor (CM defaultKeymap simplifySelection)
    await getBrowser().keys(['Escape']);
    await sleep(60);
    const collapsed = await classicExecute<number>(`return window.__memopadTestSelectionCount();`);
    expect(collapsed).to.equal(1);
  });

  it('typing with two cursors edits both lines at the same column', async () => {
    await exec(() => {
      (window as unknown as {
        __memopadTestNewBuffer?: () => string;
        __memopadTestSetContent?: (s: string) => void;
      }).__memopadTestNewBuffer?.();
      (window as unknown as {
        __memopadTestSetContent?: (s: string) => void;
      }).__memopadTestSetContent?.('abc\ndef');
    });
    await sleep(150);
    await classicExecute<void>(`window.__memopadGotoLine(1); return undefined;`);
    await sleep(60);
    await classicExecute<void>(`window.__memopadMultiCursorCommand('below'); return undefined;`);
    await sleep(60);
    await getBrowser().keys(['X']);
    await sleep(100);
    const content = await classicExecute<string>(`return window.__memopadTestGetContent();`);
    expect(content).to.equal('Xabc\nXdef');
  });

  it('registers the Add Cursor palette commands', async () => {
    const ids = await classicExecute<string[]>(`return window.__memopadTestCommandIds();`);
    expect(ids).to.include('edit.addCursorAbove');
    expect(ids).to.include('edit.addCursorBelow');
  });
});
