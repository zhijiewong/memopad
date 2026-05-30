import { expect } from 'chai';
import { classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// Unit tests (vitest) cover the session-JSON <-> store round-trip and the
// restoreSplitState action in isolation. These e2e tests cover the piece the
// unit tests can't: driving restoreSplitState in the REAL WebView and asserting
// the EditorPane components actually mount into the restored two-pane layout
// with the correct buffer in the secondary pane. A true process-restart is not
// possible in this harness (it never relaunches the app), so we exercise the
// store -> DOM mount path that boot restoration ultimately drives.

describe('split state restore (store -> DOM mount)', () => {
  beforeEach(async () => {
    // resetAll now also clears split state, so this gives a clean single pane.
    await classicExecute(`window.__memopadTestReset && window.__memopadTestReset();`);
    await sleep(150);
  });

  it('restoreSplitState with a live secondary buffer mounts two panes', async () => {
    const ids = await classicExecute<string[]>(`
      var w = window;
      var a = w.__memopadTestOpenBuffer({ path: '/tmp/left.txt', content: 'LEFT-PANE-CONTENT', encoding: 'utf-8', eol: 'lf' });
      var b = w.__memopadTestOpenBuffer({ path: '/tmp/right.txt', content: 'RIGHT-PANE-CONTENT', encoding: 'utf-8', eol: 'lf' });
      return [a, b];
    `);
    expect(ids).to.have.length(2);
    await sleep(100);

    await classicExecute(`
      var w = window;
      w.__memopadTestSwitchTo(arguments[0]);
      w.__memopadTestRestoreSplit({
        splitActive: true,
        secondaryId: arguments[1],
        focusedPane: 'secondary',
        secondaryPaneState: [{ bufferId: arguments[1], cursor: 0, scrollTop: 0 }],
      });
    `, [ids[0], ids[1]]);
    await sleep(300);

    const splitPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="editor-split"]');`,
    );
    expect(splitPresent).to.equal(true);

    const paneCount = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="editor-pane"]').length;`,
    );
    expect(paneCount).to.equal(2);

    const state = await classicExecute<{ splitActive: boolean; secondaryId: string | null; focusedPane: string }>(
      `return window.__memopadTestSplitState();`,
    );
    expect(state.splitActive).to.equal(true);
    expect(state.secondaryId).to.equal(ids[1]);
    expect(state.focusedPane).to.equal('secondary');

    // The secondary (right) pane must render the secondary buffer's content,
    // proving the EditorPane actually mounted against the restored secondaryId.
    const secondaryText = await classicExecute<string>(`
      var panes = document.querySelectorAll('[data-testid="editor-pane"]');
      var cm = panes[1].querySelector('.cm-content');
      return cm ? cm.textContent : '';
    `);
    expect(secondaryText).to.contain('RIGHT-PANE-CONTENT');
  });

  it('restoreSplitState collapses to one pane when the secondary id is missing', async () => {
    await classicExecute(`
      var w = window;
      w.__memopadTestOpenBuffer({ path: '/tmp/only.txt', content: 'ONLY-PANE', encoding: 'utf-8', eol: 'lf' });
      w.__memopadTestRestoreSplit({
        splitActive: true,
        secondaryId: 'does-not-exist',
        focusedPane: 'secondary',
        secondaryPaneState: [],
      });
    `);
    await sleep(300);

    const splitPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="editor-split"]');`,
    );
    expect(splitPresent).to.equal(false);

    const paneCount = await classicExecute<number>(
      `return document.querySelectorAll('[data-testid="editor-pane"]').length;`,
    );
    expect(paneCount).to.equal(1);

    const state = await classicExecute<{ splitActive: boolean; focusedPane: string }>(
      `return window.__memopadTestSplitState();`,
    );
    expect(state.splitActive).to.equal(false);
    expect(state.focusedPane).to.equal('primary');
  });
});
