import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace');

describe('tree move', () => {
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

  it('moves a file into a subfolder; buffer path follows', async () => {
    for (const p of [path.join(FIXTURE, 'mv-tmp.txt'), path.join(FIXTURE, 'sub', 'mv-tmp.txt')]) {
      try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
    }
    await classicExecute<void>(`window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`);
    await sleep(400);

    // Create at root, then open it as a buffer.
    await classicExecute<unknown>(`return window.__memopadTreeCreate(${JSON.stringify(FIXTURE)}, 'mv-tmp.txt', false);`);
    await sleep(250);
    const createdPath = path.join(FIXTURE, 'mv-tmp.txt');
    await classicExecute<unknown>(`return window.__memopadTestOpenBuffer
      ? window.__memopadTestOpenBuffer({ path: ${JSON.stringify(createdPath)}, content: '', encoding: 'utf-8', eol: 'lf' })
      : null;`).catch(() => undefined);

    // Move into sub/.
    await classicExecute<unknown>(`return window.__memopadTreeMove(${JSON.stringify(createdPath)}, ${JSON.stringify(path.join(FIXTURE, 'sub'))});`);
    await sleep(400);

    expect(fs.existsSync(path.join(FIXTURE, 'sub', 'mv-tmp.txt')), 'file should be under sub/').to.equal(true);
    expect(fs.existsSync(createdPath), 'file should be gone from root').to.equal(false);

    const bufPath = await classicExecute<string | null>(
      `return (window.__memopadTestTabIds && window.__memopadTestTabIds().length)
         ? window.__memopadTestGetActiveBufferPath() : null;`,
    ).catch(() => null);
    if (bufPath) {
      // Normalize separators (the moved path is canonicalized, e.g. \\?\E:\...\sub\mv-tmp.txt).
      expect(bufPath.replace(/\\/g, '/').toLowerCase()).to.contain('sub/mv-tmp.txt');
    }

    // Cleanup.
    try { fs.rmSync(path.join(FIXTURE, 'sub', 'mv-tmp.txt'), { force: true }); } catch { /* ignore */ }
  });

  it('rejects moving a folder into itself (tree unchanged)', async () => {
    await classicExecute<void>(`window.__memopadTestSetWorkspace(${JSON.stringify(FIXTURE)}); return undefined;`);
    await sleep(400);
    const subDir = path.join(FIXTURE, 'sub');
    const threw = await classicExecute<boolean>(
      `return window.__memopadTreeMove(${JSON.stringify(subDir)}, ${JSON.stringify(subDir)})
         .then(() => false).catch(() => true);`,
    );
    expect(threw, 'into-self move should reject').to.equal(true);
    expect(fs.existsSync(subDir), 'sub/ still exists').to.equal(true);
  });
});
