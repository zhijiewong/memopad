import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('minimap', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestResetEditorPrefs?: () => void;
        __memopadTestNewBuffer?: () => string;
        __memopadTestSetContent?: (s: string) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestResetEditorPrefs?.();
      w.__memopadTestNewBuffer?.();
      w.__memopadTestSetContent?.(Array.from({ length: 60 }, (_, i) => 'line ' + (i + 1)).join('\n'));
    });
    await sleep(250);
  });

  it('toggling the minimap adds/removes the .cm-minimap-gutter element', async () => {
    const before = await classicExecute<boolean>(`return !!document.querySelector('.cm-minimap-gutter');`);
    expect(before, 'minimap off by default').to.equal(false);

    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleMinimap'); return undefined;`);
    await sleep(300);
    const on = await classicExecute<boolean>(`return !!document.querySelector('.cm-minimap-gutter');`);
    expect(on, 'minimap present after toggle').to.equal(true);

    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleMinimap'); return undefined;`);
    await sleep(300);
    const off = await classicExecute<boolean>(`return !!document.querySelector('.cm-minimap-gutter');`);
    expect(off, 'minimap gone after toggling off').to.equal(false);
  });
});
