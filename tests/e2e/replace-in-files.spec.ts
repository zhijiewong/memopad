import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { getBrowser, classicExecute } from './support/driver';
import { pollFor, sleep } from './support/helpers';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

const FIXTURE_SRC = path.resolve(__dirname, 'fixtures', 'workspace');

function copyFixtureToTemp(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'memopad-rep-'));
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

describe('replace-in-files', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = copyFixtureToTemp();
    await exec(() => {
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

  it('Replace All rewrites matches and refreshes results', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(workspace)}); return undefined;`,
    );
    await sleep(150);
    await getBrowser().keys(['Control', 'Shift', 'f']);
    await sleep(200);
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="search-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'alpha');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    // Poll for search results before clicking replace-toggle — debounce + IPC can
    // outlast a fixed sleep on a slow runner.
    const resultsReady = await pollFor(() =>
      classicExecute<boolean>(
        `return document.querySelectorAll('[data-testid="match-row"]').length > 0;`,
      ),
    );
    expect(resultsReady, 'search results should appear before replacing').to.equal(true);

    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-toggle"]').click(); return undefined;`,
    );
    await sleep(150);
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="replace-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'ALPHA');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(200);
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-all"]').click(); return undefined;`,
    );
    // Poll for confirm dialog — it renders on next React commit after replace-all click.
    const confirmReady = await pollFor(() =>
      classicExecute<boolean>(
        `return !!document.querySelector('[data-testid="replace-confirm-btn"]');`,
      ),
    );
    expect(confirmReady, 'confirm button should appear').to.equal(true);
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-confirm-btn"]').click(); return undefined;`,
    );
    // Poll the file on disk — the replace IPC is async and can outlast sleep(2000)
    // on a slow CI runner.
    const notesPath = path.join(workspace, 'notes.txt');
    const written = await pollFor(() => {
      try {
        return Promise.resolve(/ALPHA/.test(fs.readFileSync(notesPath, 'utf-8')));
      } catch {
        return Promise.resolve(false);
      }
    });
    expect(written, 'notes.txt should contain ALPHA after replace').to.equal(true);
    const after = fs.readFileSync(notesPath, 'utf-8');
    expect(after).to.not.match(/alpha/);
  });

  it('dirty buffer blocks replace with a warning dialog', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(workspace)}); return undefined;`,
    );
    await sleep(150);
    const notesPath = path.join(workspace, 'notes.txt');
    await classicExecute<void>(
      `var id = window.__memopadTestOpenBuffer({ path: ${JSON.stringify(notesPath)}, content: 'alpha', encoding: 'utf-8', eol: 'crlf' });
       window.__memopadTestSwitchTo(id);
       window.__memopadTestSetContent('dirty edit');
       return undefined;`,
    );
    await sleep(400);
    await getBrowser().keys(['Control', 'Shift', 'f']);
    await sleep(200);
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="search-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'alpha');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(800);
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-toggle"]').click(); return undefined;`,
    );
    await sleep(150);
    await classicExecute<void>(
      `const i = document.querySelector('[data-testid="replace-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(i, 'X');
       i.dispatchEvent(new Event('input', { bubbles: true }));
       return undefined;`,
    );
    await sleep(200);
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-all"]').click(); return undefined;`,
    );
    await sleep(300);
    const dirtyListPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="replace-dirty-list"]');`,
    );
    expect(dirtyListPresent).to.equal(true);
    const confirmPresent = await classicExecute<boolean>(
      `return !!document.querySelector('[data-testid="replace-confirm-btn"]');`,
    );
    expect(confirmPresent).to.equal(false);
  });
});
