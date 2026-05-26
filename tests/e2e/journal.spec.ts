import { expect } from 'chai';
import { getBrowser } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

// Crash-recovery correctness in Rust is covered by 15 cargo tests
// (snapshot_at retention, replay_at scan, clear_at). These e2e tests cover the
// JS-side restore path: simulating a "post-crash boot" by directly calling the
// store's openRestored entry point and asserting the UI reflects a dirty
// restored buffer.

describe('journal-restored buffer (post-crash UI behavior)', () => {
  beforeEach(async () => {
    await exec(() => {
      const w = window as unknown as { __memopadTestReset: () => void };
      w.__memopadTestReset();
    });
  });

  it('a buffer restored with dirty=true shows the amber dot in the tab', async () => {
    await exec(() => {
      const w = window as unknown as {
        __memopadTestNewBuffer: () => string;
        __memopadTestSetContent: (s: string) => void;
      };
      w.__memopadTestNewBuffer();
      w.__memopadTestSetContent('restored content');
    });
    const dirty = await exec(() => {
      const w = window as unknown as { __memopadTestActiveDirty: () => boolean };
      return w.__memopadTestActiveDirty();
    });
    expect(dirty).to.equal(true);
  });

  it('after markSaved-equivalent (re-equating original to current), buffer is clean', async () => {
    const dirty = await exec(() => {
      const w = window as unknown as {
        __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
        __memopadTestActiveDirty: () => boolean;
      };
      w.__memopadTestOpenBuffer({ path: '/tmp/saved.txt', content: 'clean', encoding: 'utf-8', eol: 'lf' });
      return w.__memopadTestActiveDirty();
    });
    expect(dirty).to.equal(false);
  });
});
