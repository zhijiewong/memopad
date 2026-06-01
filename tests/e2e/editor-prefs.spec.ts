import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('editor prefs', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestNewBuffer?: () => string;
        __memopadTestSetContent?: (s: string) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestNewBuffer?.();
      // A long line so wrap has a visible effect, plus indentation.
      w.__memopadTestSetContent?.('    indented line\n' + 'x'.repeat(400));
    });
    await sleep(200);
  });

  it('word wrap toggles the cm-lineWrapping class', async () => {
    const before = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-content.cm-lineWrapping');`,
    );
    expect(before, 'wrap should be off by default').to.equal(false);

    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleWordWrap'); return undefined;`);
    await sleep(200);
    const after = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-content.cm-lineWrapping');`,
    );
    expect(after, 'wrap should be on after toggle').to.equal(true);

    // Toggle back off.
    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleWordWrap'); return undefined;`);
    await sleep(200);
    const off = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-content.cm-lineWrapping');`,
    );
    expect(off, 'wrap should be off again').to.equal(false);
  });

  it('indent guides command flips the prefs store', async () => {
    const before = await classicExecute<boolean>(`return window.__memopadTestEditorPrefs().indentGuides;`);
    expect(before, 'guides on by default').to.equal(true);

    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleIndentGuides'); return undefined;`);
    await sleep(150);
    const after = await classicExecute<boolean>(`return window.__memopadTestEditorPrefs().indentGuides;`);
    expect(after, 'guides off after toggle').to.equal(false);
  });
});
