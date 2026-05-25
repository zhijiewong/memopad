import { getBrowser, classicExecute } from './driver';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

const FIXTURE_SOURCE = path.resolve(__dirname, '..', '..', 'smoke', 'fixtures');

/**
 * Invoke a Tauri command directly from the WebView context.
 * Bypasses native dialogs that the test runner cannot drive.
 */
export async function invokeTauri<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const browser = getBrowser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (browser.executeAsync as (...a: any[]) => Promise<unknown>)(
    (command: string, payload: Record<string, unknown> | undefined, done: (v: unknown) => void) => {
      const w = window as unknown as {
        __TAURI_INTERNALS__?: { invoke: (c: string, a?: unknown) => Promise<unknown> };
        __TAURI__?: { core?: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
      };
      const invoke =
        w.__TAURI__?.core?.invoke
        ?? w.__TAURI_INTERNALS__?.invoke;
      if (!invoke) {
        done({ __memopadError: 'no tauri invoke on window' });
        return;
      }
      invoke(command, payload)
        .then((v) => done(v))
        .catch((err) => done({ __memopadError: String(err) }));
    },
    cmd,
    args,
  ) as T;
  if (result && typeof result === 'object' && '__memopadError' in result) {
    throw new Error(
      `invoke(${cmd}) failed: ${(result as { __memopadError: string }).__memopadError}`,
    );
  }
  return result;
}

export interface OpenedFile {
  path: string;
  content: string;
  encoding: 'utf-8' | 'utf-8-bom' | 'utf-16-le' | 'utf-16-be';
  eol: 'lf' | 'crlf' | 'cr';
}

export const openFile = (filePath: string) =>
  invokeTauri<OpenedFile>('open_file', { path: filePath });

export const saveFile = (
  filePath: string,
  content: string,
  encoding: OpenedFile['encoding'],
  eol: OpenedFile['eol'],
) =>
  invokeTauri<void>('save_file', {
    path: filePath,
    content,
    encoding,
    eol,
  });

/** Load a fixture file into a freshly-created temp workspace and return its absolute path. */
export function prepareFixture(name: string): string {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memopad-e2e-'));
  const src = path.join(FIXTURE_SOURCE, name);
  const dest = path.join(workDir, name);
  fs.copyFileSync(src, dest);
  return dest;
}

/** Read raw bytes of a file (used for byte-level assertions). */
export function readBytes(filePath: string): Buffer {
  return fs.readFileSync(filePath);
}

export function md5(bytes: Buffer): string {
  return crypto.createHash('md5').update(bytes).digest('hex');
}

/** Read the title bar's centered text — used to assert which file is open + dirty state. */
export async function readTitleBarText(): Promise<{ name: string; dirty: boolean }> {
  // Use classicExecute() (raw HTTP /execute/sync) instead of browser.execute(),
  // because WebdriverIO v9 routes execute() through WebDriver BiDi which targets
  // a stale "about:blank" context in the wry/msedgedriver integration.
  let text = '';
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    text = await classicExecute<string>(
      `var r = document.querySelector('.drag-region .pointer-events-none');
       return r ? r.textContent : '';`,
    );
    if (text && text.trim().length > 0) break;
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  if (!text || !text.trim()) {
    throw new Error('Title bar text did not appear within 10 s');
  }
  const name = text.replace(/●/g, '').trim();
  const dirty = text.includes('●');
  return { name, dirty };
}

/** Set the editor's value via the buffer store directly (bypasses CodeMirror keyboard timing). */
export async function setEditorContent(content: string): Promise<void> {
  const browser = getBrowser();
  await browser.execute((c: string) => {
    const win = window as unknown as { __memopadTestSetContent?: (s: string) => void };
    if (win.__memopadTestSetContent) {
      win.__memopadTestSetContent(c);
    } else {
      throw new Error('Test hook __memopadTestSetContent missing — main.tsx may need to expose it.');
    }
  }, content);
}

/** Read the current buffer content from the Zustand store. */
export async function getEditorContent(): Promise<string> {
  const browser = getBrowser();
  return browser.execute(() => {
    const win = window as unknown as { __memopadTestGetContent?: () => string };
    if (!win.__memopadTestGetContent) {
      throw new Error('Test hook __memopadTestGetContent missing.');
    }
    return win.__memopadTestGetContent();
  });
}

/** Reset buffer to empty (mirrors Ctrl+N). */
export async function resetBuffer(): Promise<void> {
  const browser = getBrowser();
  await browser.execute(() => {
    const win = window as unknown as { __memopadTestReset?: () => void };
    if (!win.__memopadTestReset) {
      throw new Error('Test hook __memopadTestReset missing.');
    }
    win.__memopadTestReset();
  });
}
