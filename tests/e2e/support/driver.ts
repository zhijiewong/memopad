import { spawn, type ChildProcess } from 'node:child_process';
import { remote, type Browser } from 'webdriverio';
import { start as startEdgedriver } from 'edgedriver';
import treeKill from 'tree-kill';
import { setTimeout as sleep } from 'node:timers/promises';
import * as path from 'node:path';
import * as fs from 'node:fs';
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
// Fixed port for msedgedriver; tauri-driver proxies to it.
const EDGE_DRIVER_PORT = 9515;
// Path where the edgedriver npm package caches the msedgedriver binary (os.tmpdir() by default).
const MSEDGEDRIVER_BIN = process.env.EDGEDRIVER_PATH
  ?? path.join(os.tmpdir(), process.platform === 'win32' ? 'msedgedriver.exe' : 'msedgedriver');

let tauriDriver: ChildProcess | undefined;
let edgedriverProc: ChildProcess | undefined;

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

export async function startDriverAndSession(): Promise<Browser> {
  if (!fs.existsSync(RELEASE_BIN)) {
    throw new Error(
      `Release binary not found at ${RELEASE_BIN}. Run \`npm run tauri build\` first.`,
    );
  }
  if (!fs.existsSync(TAURI_DRIVER)) {
    throw new Error(`tauri-driver not found at ${TAURI_DRIVER}.`);
  }

  // Start msedgedriver via the npm edgedriver package on a fixed port.
  // edgedriver.start() returns a raw ChildProcess (not { port, stop }).
  edgedriverProc = await startEdgedriver({ port: EDGE_DRIVER_PORT });

  // Spawn tauri-driver and have it proxy to the running msedgedriver.
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
  tauriDriver.stderr?.on('data', (b) => process.stderr.write(`[tauri-driver] ${b}`));

  // Wait for tauri-driver to be listening.
  await sleep(1500);

  // Create a webdriverio session pointing at the Memopad binary.
  const browser = await remote({
    hostname: '127.0.0.1',
    port: TAURI_DRIVER_PORT,
    capabilities: {
      browserName: 'wry',
      'tauri:options': { application: RELEASE_BIN },
    } as unknown as WebdriverIO.Capabilities,
    logLevel: 'warn',
  });

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
