import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// NOTE: We deliberately do NOT run `window.new` here. Spawning a real second
// window adds a WebDriver window handle that poisons the shared session for every
// later spec (and closing it via WebDriver kills the session). The actual
// window-creation is verified by the Rust unit tests, the vitest session-split
// tests, and a manual/GUI smoke. This guard catches the common regression —
// the New Window / Quit commands being unregistered.
describe('multi-window', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      (window as unknown as { __memopadTestReset?: () => void }).__memopadTestReset?.();
    });
    await sleep(150);
  });

  it('registers the New Window and Quit commands', async () => {
    const ids = await classicExecute<string[]>(`return window.__memopadTestCommandIds();`);
    expect(ids, 'New Window command registered').to.include('window.new');
    expect(ids, 'Quit command registered').to.include('app.quit');
  });
});
