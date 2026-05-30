import { expect } from 'chai';
import { classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function dispatchCtrl(keyValue: string, codeValue: string) {
  await classicExecute(`
    var el = document.querySelector('.cm-content') || document.body;
    if (el.focus) el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: arguments[0], code: arguments[1], ctrlKey: true, bubbles: true, cancelable: true,
    }));
  `, [keyValue, codeValue]);
}

describe('split-view pane routing & focus', () => {
  beforeEach(async () => {
    await classicExecute(`window.__memopadTestReset && window.__memopadTestReset();`);
    await sleep(150);
  });

  it('opens a file into the focused (right) pane and leaves the left pane unchanged', async () => {
    await classicExecute(`
      var w = window;
      var a = w.__memopadTestOpenBuffer({ path: '/tmp/left.txt', content: 'LEFT-CONTENT', encoding: 'utf-8', eol: 'lf' });
      w.__memopadTestOpenBuffer({ path: '/tmp/mid.txt', content: 'MID-CONTENT', encoding: 'utf-8', eol: 'lf' });
      w.__memopadTestSwitchTo(a);
    `);
    await sleep(150);

    // Split (Ctrl+\): secondary mirrors the active buffer (a), focus goes right.
    await dispatchCtrl('\\', 'Backslash');
    await sleep(250);

    // Open a NEW file while the right pane is focused — must land on the right.
    await classicExecute(`
      window.__memopadTestOpenBuffer({ path: '/tmp/right.txt', content: 'RIGHT-CONTENT', encoding: 'utf-8', eol: 'lf' });
    `);
    await sleep(250);

    const panes = await classicExecute<{ left: string; right: string }>(`
      var p = document.querySelectorAll('[data-testid="editor-pane"]');
      return {
        left: p[0].querySelector('.cm-content') ? p[0].querySelector('.cm-content').textContent : '',
        right: p[1].querySelector('.cm-content') ? p[1].querySelector('.cm-content').textContent : '',
      };
    `);
    expect(panes.left).to.contain('LEFT-CONTENT');   // unchanged
    expect(panes.right).to.contain('RIGHT-CONTENT');  // new file landed on the right
  });

  it('Ctrl+1 / Ctrl+2 move the focused pane and the focus indicator', async () => {
    await classicExecute(`
      var w = window;
      w.__memopadTestOpenBuffer({ path: '/tmp/a.txt', content: 'AAA', encoding: 'utf-8', eol: 'lf' });
    `);
    await sleep(150);
    await dispatchCtrl('\\', 'Backslash'); // split; focus right
    await sleep(250);

    let state = await classicExecute<{ focusedPane: string }>(`return window.__memopadTestSplitState();`);
    expect(state.focusedPane).to.equal('secondary');

    await dispatchCtrl('1', 'Digit1');
    await sleep(150);
    state = await classicExecute<{ focusedPane: string }>(`return window.__memopadTestSplitState();`);
    expect(state.focusedPane).to.equal('primary');

    // The focused pane carries data-focused="true".
    const focusedIdx = await classicExecute<number>(`
      var p = document.querySelectorAll('[data-testid="editor-pane"]');
      for (var i = 0; i < p.length; i++) { if (p[i].getAttribute('data-focused') === 'true') return i; }
      return -1;
    `);
    expect(focusedIdx).to.equal(0); // left pane is focused

    await dispatchCtrl('2', 'Digit2');
    await sleep(150);
    state = await classicExecute<{ focusedPane: string }>(`return window.__memopadTestSplitState();`);
    expect(state.focusedPane).to.equal('secondary');
  });
});
