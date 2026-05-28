import { expect } from 'chai';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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
    await sleep(800);
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
    await sleep(200);
    await classicExecute<void>(
      `document.querySelector('[data-testid="replace-confirm-btn"]').click(); return undefined;`,
    );
    await sleep(2000);
    const notesPath = path.join(workspace, 'notes.txt');
    const after = fs.readFileSync(notesPath, 'utf-8');
    expect(after).to.match(/ALPHA/);
    expect(after).to.not.match(/alpha/);
  });

  it('dirty buffer blocks replace with a warning dialog', async () => {
    await getBrowser().keys(['Control', 'b']);
    await sleep(150);
    await classicExecute<void>(
      `window.__memopadTestSetWorkspace(${JSON.stringify(workspace)}); return undefined;`,
    );
    await sleep(150);
    const notesPath = path.join(workspace, 'notes.txt').replace(/\\/g, '/');
    await classicExecute<void>(
      `(async () => {
         const tauri = await import('@tauri-apps/api/core');
         const opened = await tauri.invoke('open_file', { path: ${JSON.stringify(notesPath)} });
         const buffersMod = await import('/src/stores/buffers');
         const id = buffersMod.useBuffers.getState().openBuffer(opened);
         buffersMod.useBuffers.getState().switchTo(id);
         buffersMod.useBuffers.getState().setActiveContent('dirty edit');
       })(); return undefined;`,
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
