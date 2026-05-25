import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Tauri invoke before importing tauri.ts so the import binds to our spy.
const invokeSpy = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeSpy(cmd, args),
}));

import { openFile, saveFile } from '../lib/tauri';

beforeEach(() => {
  invokeSpy.mockReset();
});

describe('tauri ipc wrappers', () => {
  it('openFile invokes open_file with the path arg', async () => {
    invokeSpy.mockResolvedValue({
      path: '/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const result = await openFile('/x.txt');
    expect(invokeSpy).toHaveBeenCalledWith('open_file', { path: '/x.txt' });
    expect(result.content).toBe('hi');
  });

  it('saveFile invokes save_file with all four args', async () => {
    invokeSpy.mockResolvedValue(undefined);
    await saveFile('/x.txt', 'body', 'utf-8', 'lf');
    expect(invokeSpy).toHaveBeenCalledWith('save_file', {
      path: '/x.txt',
      content: 'body',
      encoding: 'utf-8',
      eol: 'lf',
    });
  });

  it('openFile surfaces invoke errors as thrown Errors', async () => {
    invokeSpy.mockRejectedValue('disk on fire');
    await expect(openFile('/nope')).rejects.toThrow('disk on fire');
  });
});
