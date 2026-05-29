import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { getBrowser, classicExecute } from './support/driver';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

const FIXTURE_SRC = path.resolve(__dirname, 'fixtures', 'workspace');

function copyFixtureToTemp(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'memopad-fsw-'));
  function cp(src: string, dst: string) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) cp(s, d);
      else fs.copyFileSync(s, d);
    }
  }
  cp(FIXTURE_SRC, dest);
  return dest;
}

describe('fs-watcher', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = copyFixtureToTemp();
    await getBrowser().execute(() => {
      const w = window as unknown as {
        __memopadTestReset?: () => void;
        __memopadToggleSidebar?: () => void;
        __memopadTestSetWorkspace?: (folder: string | null) => void;
      };
      w.__memopadTestReset?.();
      w.__memopadTestSetWorkspace?.(null as unknown as string);
      const open = !!document.querySelector('[data-testid="sidebar"]');
      if (open) w.__memopadToggleSidebar?.();
    });
    await sleep(150);
  });

  afterEach(() => {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('tree auto-refreshes when a new file is created externally', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(workspace)}); return undefined;`,
    );
    await sleep(500); // root list_dir + watcher start

    const before = await classicExecute<number>(
      `let n = 0;
       document.querySelectorAll('[data-testid="tree-row"]').forEach((r) => {
         if ((r.textContent || '').includes('new-from-test.txt')) n++;
       });
       return n;`,
    );
    expect(before).to.equal(0);

    fs.writeFileSync(path.join(workspace, 'new-from-test.txt'), 'hello');

    await sleep(900);

    const after = await classicExecute<number>(
      `let n = 0;
       document.querySelectorAll('[data-testid="tree-row"]').forEach((r) => {
         if ((r.textContent || '').includes('new-from-test.txt')) n++;
       });
       return n;`,
    );
    expect(after).to.be.greaterThanOrEqual(1);
  });
});
