import { describe, it, expect } from 'vitest';
import { isInvalidMove } from '../lib/path';
import { beforeEach, vi } from 'vitest';
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe('isInvalidMove', () => {
  it('rejects moving into itself', () => {
    expect(isInvalidMove('C:/proj/d', 'C:/proj/d')).toBe(true);
  });
  it('rejects moving into a descendant', () => {
    expect(isInvalidMove('C:/proj/d', 'C:/proj/d/child')).toBe(true);
  });
  it('rejects moving into the current parent (no-op)', () => {
    expect(isInvalidMove('C:/proj/a.txt', 'C:/proj')).toBe(true);
  });
  it('allows moving into a sibling folder', () => {
    expect(isInvalidMove('C:/proj/a.txt', 'C:/proj/sub')).toBe(false);
  });
  it('is separator- and case-insensitive', () => {
    expect(isInvalidMove('C:\\proj\\a.txt', 'c:/PROJ')).toBe(true);
  });
});

describe('useWorkspace.moveEntry', () => {
  beforeEach(() => {
    useWorkspace.setState({
      workspaceFolder: 'C:/proj',
      expanded: new Set<string>(),
      childrenByPath: new Map(),
      loadingByPath: new Set<string>(),
      dragPath: null,
      moveError: null,
    } as never);
    useBuffers.getState().resetAll();
    vi.clearAllMocks();
  });

  it('invokes move_path, refreshes both parents, and syncs buffers', async () => {
    useBuffers.getState().openBuffer({ path: 'C:/proj/a.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
    mockInvoke
      .mockResolvedValueOnce('C:/proj/sub/a.txt') // move_path
      .mockResolvedValueOnce([])                  // refresh parentOf(src) = C:/proj
      .mockResolvedValueOnce([]);                 // refresh destDir = C:/proj/sub
    const newPath = await useWorkspace.getState().moveEntry('C:/proj/a.txt', 'C:/proj/sub');
    expect(newPath).toBe('C:/proj/sub/a.txt');
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'move_path', {
      workspaceFolder: 'C:/proj', src: 'C:/proj/a.txt', destDir: 'C:/proj/sub',
    });
    expect(useBuffers.getState().buffers[0].path).toBe('C:/proj/sub/a.txt');
  });

  it('setDragPath / setMoveError update state', () => {
    useWorkspace.getState().setDragPath('C:/proj/a.txt');
    expect(useWorkspace.getState().dragPath).toBe('C:/proj/a.txt');
    useWorkspace.getState().setMoveError('boom');
    expect(useWorkspace.getState().moveError).toBe('boom');
  });
});
