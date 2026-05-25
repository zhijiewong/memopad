import { spawn, type ChildProcess } from 'node:child_process';
import { attach, type Browser } from 'webdriverio';
import { start as startEdgedriver } from 'edgedriver';
import treeKill from 'tree-kill';
import { setTimeout as sleep } from 'node:timers/promises';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const RELEASE_BIN = path.join(
  PROJECT_ROOT,
  'src-tauri',
  'target',
  'release',
  'app.exe',
);
const TAURI_DRIVER = process.env.TAURI_DRIVER_PATH
  ?? path.join(process.env.USERPROFILE ?? '', '.cargo', 'bin', 'tauri-driver.exe');
const TAURI_DRIVER_PORT = 4444;
// Fixed port for msedgedriver; we pre-start it so tauri-driver falls back to it.
const EDGE_DRIVER_PORT = 9515;
// Path where the edgedriver npm package caches the msedgedriver binary.
const MSEDGEDRIVER_BIN = process.env.EDGEDRIVER_PATH
  ?? path.join(os.tmpdir(), process.platform === 'win32' ? 'msedgedriver.exe' : 'msedgedriver');

let tauriDriver: ChildProcess | undefined;
let edgedriverProc: ChildProcess | undefined;
let sessionId: string | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __memopadBrowser: Browser | undefined;
}

export function getBrowser(): Browser {
  if (!global.__memopadBrowser) {
    throw new Error('Browser not initialised — did the before() hook run?');
  }
  return global.__memopadBrowser;
}

/**
 * Execute a JS script via the classic WebDriver HTTP /execute/sync endpoint.
 *
 * WebdriverIO v9 routes browser.execute() through WebDriver BiDi
 * (script.callFunction), which targets a stale "about:blank" context in the
 * wry/msedgedriver integration. Using the raw HTTP endpoint directly always
 * reaches the correct WebView window.
 *
 * We create the WebDriver session manually (without webSocketUrl in the request)
 * to avoid BiDi being negotiated, then attach WebdriverIO to that session.
 * classicExecute() uses the session ID from the manual session.
 */
export async function classicExecute<T = unknown>(script: string, args: unknown[] = []): Promise<T> {
  if (!sessionId) throw new Error('No active session — call startDriverAndSession() first.');
  return new Promise<T>((resolve, reject) => {
    const body = JSON.stringify({ script, args });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TAURI_DRIVER_PORT,
        path: `/session/${sessionId}/execute/sync`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.value as T);
          } catch (e) {
            reject(new Error(`Failed to parse execute response: ${data}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Raw HTTP request helper for the WebDriver endpoint. */
function wdRequest<T = unknown>(method: string, path: string, body?: unknown): Promise<{ value: T }> {
  return new Promise<{ value: T }>((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TAURI_DRIVER_PORT,
        path,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(d) as { value: T });
          } catch (e) {
            reject(new Error(`Failed to parse response: ${d}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export async function startDriverAndSession(): Promise<Browser> {
  if (!fs.existsSync(RELEASE_BIN)) {
    throw new Error(
      `Release binary not found at ${RELEASE_BIN}. Run \`npm run tauri build\` first.`,
    );
  }
  if (!fs.existsSync(TAURI_DRIVER)) {
    throw new Error(`tauri-driver not found at ${TAURI_DRIVER}.`);
  }

  // Pre-start msedgedriver BEFORE tauri-driver.
  // When tauri-driver starts, it tries to spawn its own msedgedriver instance.
  // If the port is already occupied, it falls back to the running one.
  // Crucially, this fallback path correctly navigates the WebView to tauri.localhost,
  // whereas tauri-driver's own-spawned msedgedriver leaves it at about:blank.
  edgedriverProc = await startEdgedriver({ port: EDGE_DRIVER_PORT });
  await sleep(1000);

  tauriDriver = spawn(
    TAURI_DRIVER,
    [
      '--port', String(TAURI_DRIVER_PORT),
      '--native-port', String(EDGE_DRIVER_PORT),
      '--native-driver', MSEDGEDRIVER_BIN,
    ],
    { stdio: 'pipe' },
  );
  tauriDriver.stdout?.on('data', (b) => process.stdout.write(`[tauri-driver] ${b}`));
  // Suppress the benign "bind() returned an error" messages from tauri-driver
  // failing to spawn a second msedgedriver (port already taken by ours).
  tauriDriver.stderr?.on('data', (b) => {
    const s = String(b);
    if (!s.includes('SEVERE') && !s.includes('bind()')) {
      process.stderr.write(`[tauri-driver] ${b}`);
    }
  });

  await sleep(2000);

  // Create the WebDriver session via raw HTTP, WITHOUT webSocketUrl in the
  // capabilities. WebdriverIO v9's remote() adds "webSocketUrl: true" which
  // causes msedgedriver to negotiate BiDi; the BiDi context gets stuck at
  // about:blank instead of navigating to tauri.localhost. Using attach()
  // on a manually-created session avoids this issue entirely.
  const sessRes = await wdRequest<{ sessionId: string; capabilities: Record<string, unknown> }>(
    'POST',
    '/session',
    {
      capabilities: {
        alwaysMatch: {
          browserName: 'wry',
          'tauri:options': { application: RELEASE_BIN },
        },
      },
    },
  );

  const rawSession = sessRes.value as unknown as { sessionId: string; capabilities: Record<string, unknown> };
  sessionId = rawSession.sessionId;

  // Wrap the existing session with WebdriverIO (for deleteSession, etc.).
  const browser = await attach({
    sessionId,
    capabilities: rawSession.capabilities as WebdriverIO.Capabilities,
    hostname: '127.0.0.1',
    port: TAURI_DRIVER_PORT,
    logLevel: 'warn',
  });

  // Give the app window / WebView time to render the initial UI.
  await sleep(2000);

  global.__memopadBrowser = browser;
  return browser;
}

export async function stopDriverAndSession(): Promise<void> {
  try {
    await global.__memopadBrowser?.deleteSession();
  } catch {
    // Session may already be dead; ignore.
  }
  global.__memopadBrowser = undefined;
  sessionId = undefined;

  if (tauriDriver?.pid) {
    await new Promise<void>((resolve) =>
      treeKill(tauriDriver!.pid!, 'SIGTERM', () => resolve()),
    );
    tauriDriver = undefined;
  }
  if (edgedriverProc?.pid) {
    await new Promise<void>((resolve) =>
      treeKill(edgedriverProc!.pid!, 'SIGTERM', () => resolve()),
    );
    edgedriverProc = undefined;
  }
}
