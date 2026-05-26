import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('diff modal', () => {
  it('opens when Diff is clicked and shows added/removed lines', async () => {
    // Prepare a real on-disk file so DiffModal can openFile() it.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memopad-diff-'));
    const filePath = path.join(tmpDir, 'diff-target.txt');
    fs.writeFileSync(filePath, 'alpha\nbeta\ngamma\n', { encoding: 'utf8' });

    await exec(() => {
      const w = window as unknown as { __memopadTestReset: () => void };
      w.__memopadTestReset();
    });
    await sleep(150);

    await getBrowser().execute(
      (p: string) => {
        const w = window as unknown as {
          __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
          __memopadTestSetContent: (s: string) => void;
          __memopadTestActiveId: () => string | null;
          __memopadTestSetExternalChange: (id: string, flag: boolean) => void;
        };
        w.__memopadTestOpenBuffer({ path: p, content: 'alpha\nBETA\ngamma\n', encoding: 'utf-8', eol: 'lf' });
        const id = w.__memopadTestActiveId();
        if (id) w.__memopadTestSetExternalChange(id, true);
      },
      filePath,
    );
    await sleep(200);

    await classicExecute<void>(
      `var btns = Array.from(document.querySelectorAll('[data-external-change-banner] button'));
       var diff = btns.find(b => b.textContent && b.textContent.trim() === 'Diff');
       if (diff) diff.click();
       return undefined;`,
    );
    await sleep(700);

    const modalPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-diff-modal]');`,
    );
    expect(modalPresent, 'diff modal must render').to.equal(true);

    const rowTypes = await classicExecute<string[]>(
      `return Array.from(document.querySelectorAll('[data-diff-row-type]')).map(el => el.getAttribute('data-diff-row-type'));`,
    );
    expect(rowTypes).to.include('add');
    expect(rowTypes).to.include('del');

    await getBrowser().keys('Escape');
    await sleep(200);
    const stillPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-diff-modal]');`,
    );
    expect(stillPresent).to.equal(false);

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});
