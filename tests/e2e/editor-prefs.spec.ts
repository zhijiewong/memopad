import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('editor prefs', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestResetEditorPrefs?: () => void;
        __memopadTestNewBuffer?: () => string;
        __memopadTestSetContent?: (s: string) => void;
      };
      w.__memopadTestReset?.();
      // Prefs persist in session.json and restore on boot, so a prior toggle
      // would leak across runs — reset to defaults (wrap off, guides on).
      w.__memopadTestResetEditorPrefs?.();
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

  it('indent guides toggle adds/removes the cm-indent-markers DOM', async () => {
    // Nested indentation so the extension definitely renders guide markers.
    await classicExecute<void>(
      `window.__memopadTestSetContent('function a() {\\n    if (x) {\\n        y();\\n    }\\n}'); return undefined;`,
    );
    await sleep(200);

    const before = await classicExecute<boolean>(`return window.__memopadTestEditorPrefs().indentGuides;`);
    expect(before, 'guides on by default').to.equal(true);
    const onMarkers = await classicExecute<number>(`return document.querySelectorAll('.cm-indent-markers').length;`);
    expect(onMarkers, 'markers render when guides on').to.be.greaterThan(0);

    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleIndentGuides'); return undefined;`);
    await sleep(200);
    const after = await classicExecute<boolean>(`return window.__memopadTestEditorPrefs().indentGuides;`);
    expect(after, 'guides off after toggle').to.equal(false);
    const offMarkers = await classicExecute<number>(`return document.querySelectorAll('.cm-indent-markers').length;`);
    expect(offMarkers, 'markers gone when guides off').to.equal(0);
  });
});
