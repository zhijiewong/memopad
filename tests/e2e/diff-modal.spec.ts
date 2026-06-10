import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';
import { pollFor, sleep } from './support/helpers';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

function modalPresent(): Promise<boolean> {
  return classicExecute<boolean>(`return !!document.querySelector('[data-diff-modal]');`);
}

function diffRowTypes(): Promise<string[]> {
  return classicExecute<string[]>(
    `return Array.from(document.querySelectorAll('[data-diff-row-type]')).map(el => el.getAttribute('data-diff-row-type'));`,
  );
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

    // Poll until the Diff button has rendered AND the click lands — a blind
    // `if (btn) btn.click()` silently no-ops if the banner hasn't committed yet.
    const clicked = await pollFor(() =>
      classicExecute<boolean>(
        `var btns = Array.from(document.querySelectorAll('[data-external-change-banner] button'));
         var diff = btns.find(b => b.textContent && b.textContent.trim() === 'Diff');
         if (diff) { diff.click(); return true; }
         return false;`,
      ),
    );
    expect(clicked, 'Diff button should render and be clicked').to.equal(true);

    expect(await pollFor(modalPresent), 'diff modal must render').to.equal(true);

    // The modal shell renders immediately with "Loading…" while openFile() IPC +
    // lineDiff complete async; a fixed sleep raced that IPC on slow CI runners
    // (rowTypes came back []). Poll for the rows instead.
    const rowsReady = await pollFor(async () => {
      const types = await diffRowTypes();
      return types.includes('add') && types.includes('del');
    });
    expect(rowsReady, 'diff rows should include add and del').to.equal(true);

    await getBrowser().keys('Escape');
    expect(await pollFor(async () => !(await modalPresent())), 'Escape should close the modal').to.equal(true);

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});
