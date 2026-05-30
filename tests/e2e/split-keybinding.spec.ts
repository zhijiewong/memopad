import { expect } from 'chai';
import { classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// Ctrl+\ toggles the split view. The window keydown handler must match the
// PHYSICAL backslash key (e.code === 'Backslash'), not only the produced
// character (e.key === '\\'): on non-US keyboard layouts the backslash key
// emits a different e.key, which silently broke the shortcut. These tests drive
// a real keydown in the live WebView and assert the two-pane layout mounts.
describe('split keybinding (Ctrl+\\) — layout independence', () => {
  async function splitPresent(): Promise<boolean> {
    return classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="editor-split"]');`,
    );
  }

  async function pressCtrlBackslash(keyValue: string, codeValue: string): Promise<void> {
    await classicExecute(`
      var el = document.querySelector('.cm-content') || document.body;
      if (el.focus) el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: arguments[0], code: arguments[1],
        ctrlKey: true, bubbles: true, cancelable: true,
      }));
    `, [keyValue, codeValue]);
  }

  beforeEach(async () => {
    await classicExecute(`window.__memopadTestReset && window.__memopadTestReset();`);
    await classicExecute(
      `window.__memopadTestOpenBuffer({ path: '/tmp/kb.txt', content: 'KB', encoding: 'utf-8', eol: 'lf' });`,
    );
    await sleep(250);
  });

  afterEach(async () => {
    // resetAll on this branch does not clear split state, so collapse any open
    // split (US path always works) to keep tests independent.
    if (await splitPresent()) {
      await pressCtrlBackslash('\\', 'Backslash');
      await sleep(150);
    }
  });

  it('toggles split when e.key is a literal backslash (US layout)', async () => {
    expect(await splitPresent()).to.equal(false);
    await pressCtrlBackslash('\\', 'Backslash');
    await sleep(200);
    expect(await splitPresent()).to.equal(true);
  });

  it('toggles split via the physical Backslash key when e.key differs (non-US layout)', async () => {
    expect(await splitPresent()).to.equal(false);
    // e.key is a non-backslash character but the physical key is e.code 'Backslash'.
    await pressCtrlBackslash('ω', 'Backslash');
    await sleep(200);
    expect(await splitPresent()).to.equal(true);
  });
});
