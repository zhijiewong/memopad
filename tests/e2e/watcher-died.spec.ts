import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('watcher died', () => {
  beforeEach(async () => {
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadToggleSidebar?: () => void;
        __memopadShowFilesPanel?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
      if (!document.querySelector('[data-testid="sidebar"]')) w.__memopadToggleSidebar?.();
      w.__memopadShowFilesPanel?.();
    });
    await sleep(200);
  });

  it('shows the live-updates-unavailable banner when the watcher cannot start', async () => {
    // A non-existent workspace path: watch_start rejects → startFsWatcher sets the banner.
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace('C:/memopad-no-such-folder-xyz-12345'); return undefined;`,
    );
    await sleep(700);

    const hasBanner = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="fs-watcher-error"]');`,
    );
    expect(hasBanner, 'fs-watcher-error banner should appear').to.equal(true);
  });
});
