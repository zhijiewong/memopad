// NOTE: This file is named "zz-close" so Mocha runs it LAST (alphabetical order).
// It closes the app window, killing the WebDriver session. No tests may run after this.

import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

describe('window close', () => {
  // NOTE: This test must run LAST because it closes the WebDriver session.
  // After it runs, no further tests can use getBrowser().
  it('clicking the X button closes the window', async () => {
    await classicExecute<string>(
      `document.querySelector('button[aria-label="Close"]').click(); return 'clicked';`,
    );

    // Poll for the window to tear down instead of assuming a fixed delay:
    // window.destroy() teardown timing varies and is slow on loaded CI runners,
    // so a single check after 1500ms was flaky. The session dies once the window
    // is gone, so getTitle() throwing is our "closed" signal.
    let stillAlive = true;
    const deadlineMs = 10_000;
    const start = Date.now();
    while (Date.now() - start < deadlineMs) {
      try {
        await getBrowser().getTitle();
        await new Promise((r) => setTimeout(r, 250));
      } catch {
        stillAlive = false;
        break;
      }
    }
    expect(stillAlive, 'window should have closed').to.equal(false);
  });
});
