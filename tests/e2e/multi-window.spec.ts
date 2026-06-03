import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('multi-window (main-window guard)', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => { (window as unknown as { __memopadTestReset?: () => void }).__memopadTestReset?.(); });
    await sleep(150);
  });

  it('New Window command runs without breaking the main window', async () => {
    await classicExecute<void>(`window.__memopadTestRunCommand('window.new'); return undefined;`);
    await sleep(800);
    // The main window (this WebDriver session) must still be responsive.
    const id = await classicExecute<string>(`return window.__memopadTestNewBuffer();`);
    expect(id, 'main window still works after spawning a window').to.be.a('string');
  });
});
