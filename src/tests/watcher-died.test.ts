import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('../lib/tauri', () => ({
  watchStart: vi.fn(),
  watchStop: vi.fn().mockResolvedValue(undefined),
  statFile: vi.fn(),
}));

import { watchStart, statFile } from '../lib/tauri';
import { startFsWatcher, checkWatcherAlive } from '../lib/fs-watcher';
import { useWorkspace } from '../stores/workspace';

const mWatchStart = watchStart as unknown as ReturnType<typeof vi.fn>;
const mStatFile = statFile as unknown as ReturnType<typeof vi.fn>;

describe('watcher death detection', () => {
  beforeEach(() => {
    useWorkspace.getState().setWatcherError(null);
    vi.clearAllMocks();
  });

  it('startFsWatcher sets the banner when watch_start rejects', async () => {
    mWatchStart.mockRejectedValueOnce(new Error('path does not exist'));
    await startFsWatcher('C:/nope');
    expect(useWorkspace.getState().watcherError).to.be.a('string');
  });

  it('startFsWatcher clears the banner when watch_start succeeds', async () => {
    useWorkspace.getState().setWatcherError('stale');
    mWatchStart.mockResolvedValueOnce(undefined);
    await startFsWatcher('C:/ok');
    expect(useWorkspace.getState().watcherError).toBeNull();
  });

  it('checkWatcherAlive sets the banner when statFile rejects (folder gone)', async () => {
    mStatFile.mockRejectedValueOnce(new Error('missing'));
    await checkWatcherAlive('C:/gone');
    expect(useWorkspace.getState().watcherError).to.be.a('string');
  });

  it('checkWatcherAlive leaves the banner untouched when the folder exists', async () => {
    mStatFile.mockResolvedValueOnce({ mtime_ms: 1, size: 2 });
    await checkWatcherAlive('C:/here');
    expect(useWorkspace.getState().watcherError).toBeNull();
  });
});
