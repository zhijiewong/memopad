import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('code folding', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadTestResetEditorPrefs?: () => void;
        __memopadTestNewBuffer?: () => string;
        __memopadTestSetContent?: (s: string) => void;
      };
      w.__memopadTestReset?.();
      // Prefs persist in session.json across runs — reset to defaults so
      // codeFolding is on and no stale folds from prior tests remain.
      w.__memopadTestResetEditorPrefs?.();
      w.__memopadTestNewBuffer?.();
      w.__memopadTestSetContent?.('function f() {\n  one();\n  two();\n}\n');
    });
    await sleep(200);
  });

  it('foldAll folds a JS function body; unfoldAll restores it', async () => {
    await classicExecute<void>(`window.__memopadTestSetLanguage('javascript'); return undefined;`);
    await sleep(150);
    await classicExecute<void>(`window.__memopadFoldCommand('foldAll'); return undefined;`);
    await sleep(150);
    const folded = await classicExecute<number>(`return window.__memopadTestFoldedCount();`);
    expect(folded).to.be.greaterThan(0);

    await classicExecute<void>(`window.__memopadFoldCommand('unfoldAll'); return undefined;`);
    await sleep(150);
    const after = await classicExecute<number>(`return window.__memopadTestFoldedCount();`);
    expect(after).to.equal(0);
  });

  it('toggleCodeFolding hides and restores the fold gutter', async () => {
    await classicExecute<void>(`window.__memopadTestSetLanguage('javascript'); return undefined;`);
    await sleep(150);

    const gutterOn = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-foldGutter');`,
    );
    expect(gutterOn, 'fold gutter should be visible by default').to.equal(true);

    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleCodeFolding'); return undefined;`);
    await sleep(200);
    const gutterOff = await classicExecute<boolean>(
      `return !!document.querySelector('.cm-foldGutter');`,
    );
    expect(gutterOff, 'fold gutter should be hidden after toggle off').to.equal(false);

    // Restore pref ON so it doesn't leak into later specs.
    await classicExecute<void>(`window.__memopadTestRunCommand('view.toggleCodeFolding'); return undefined;`);
    await sleep(200);
  });

  it('registers the folding palette commands', async () => {
    const ids = await classicExecute<string[]>(`return window.__memopadTestCommandIds();`);
    expect(ids).to.include('view.foldAll');
    expect(ids).to.include('view.unfoldAll');
    expect(ids).to.include('view.toggleCodeFolding');
  });
});
