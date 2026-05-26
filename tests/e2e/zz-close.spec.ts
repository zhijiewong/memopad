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
    // Wait for the close to propagate.
    await new Promise((r) => setTimeout(r, 1500));

    // Now try to interact with the session. If the window closed, this should throw.
    let stillAlive = false;
    try {
      await getBrowser().getTitle();
      stillAlive = true;
    } catch {
      stillAlive = false;
    }
    expect(stillAlive, 'window should have closed').to.equal(false);
  });
});
