import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { useBuffers } from '../stores/buffers';

function openClean(path: string, content = 'x') {
  return useBuffers.getState().openBuffer({ path, content, encoding: 'utf-8', eol: 'lf' });
}

describe('buffers.renamePath', () => {
  beforeEach(() => useBuffers.getState().resetAll());

  it('rewrites an open buffer whose path matches the renamed file', () => {
    const id = openClean('C:/proj/old.txt');
    useBuffers.getState().renamePath('C:/proj/old.txt', 'C:/proj/new.txt');
    const b = useBuffers.getState().buffers.find((x) => x.id === id);
    expect(b?.path).toBe('C:/proj/new.txt');
  });

  it('rewrites buffers under a renamed folder (prefix)', () => {
    const id = openClean('C:/proj/src/a.txt');
    useBuffers.getState().renamePath('C:/proj/src', 'C:/proj/lib');
    const b = useBuffers.getState().buffers.find((x) => x.id === id);
    expect(b?.path).toBe('C:/proj/lib/a.txt');
  });

  it('leaves unrelated buffers untouched', () => {
    const id = openClean('C:/proj/other.txt');
    useBuffers.getState().renamePath('C:/proj/old.txt', 'C:/proj/new.txt');
    const b = useBuffers.getState().buffers.find((x) => x.id === id);
    expect(b?.path).toBe('C:/proj/other.txt');
  });
});

describe('buffers.handleDeletedPath', () => {
  beforeEach(() => useBuffers.getState().resetAll());

  it('closes a clean buffer at the deleted path', () => {
    const id = openClean('C:/proj/gone.txt');
    useBuffers.getState().handleDeletedPath('C:/proj/gone.txt');
    expect(useBuffers.getState().buffers.find((x) => x.id === id)).toBeUndefined();
  });

  it('keeps a dirty buffer at the deleted path', () => {
    const id = openClean('C:/proj/dirty.txt');
    useBuffers.getState().setActiveContent('edited');
    useBuffers.getState().handleDeletedPath('C:/proj/dirty.txt');
    expect(useBuffers.getState().buffers.find((x) => x.id === id)).toBeDefined();
  });

  it('closes clean buffers under a deleted folder', () => {
    const id = openClean('C:/proj/sub/a.txt');
    useBuffers.getState().handleDeletedPath('C:/proj/sub');
    expect(useBuffers.getState().buffers.find((x) => x.id === id)).toBeUndefined();
  });
});

import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../stores/workspace';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe('useWorkspace CRUD', () => {
  beforeEach(() => {
    useWorkspace.setState({
      workspaceFolder: 'C:/proj',
      expanded: new Set<string>(),
      childrenByPath: new Map(),
      loadingByPath: new Set<string>(),
    } as never);
    useBuffers.getState().resetAll();
    vi.clearAllMocks();
  });

  it('createEntry invokes create_file and refreshes the parent', async () => {
    mockInvoke
      .mockResolvedValueOnce({ name: 'new.txt', path: 'C:/proj/new.txt', is_dir: false }) // create_file
      .mockResolvedValueOnce([{ name: 'new.txt', path: 'C:/proj/new.txt', is_dir: false }]); // list_dir
    await useWorkspace.getState().createEntry('C:/proj', 'new.txt', false);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'create_file', {
      workspaceFolder: 'C:/proj', parent: 'C:/proj', name: 'new.txt',
    });
    expect(useWorkspace.getState().childrenByPath.get('C:/proj')?.[0]?.name).toBe('new.txt');
  });

  it('renameEntry invokes rename_path and syncs buffers', async () => {
    useBuffers.getState().openBuffer({ path: 'C:/proj/old.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
    mockInvoke
      .mockResolvedValueOnce('C:/proj/new.txt') // rename_path
      .mockResolvedValueOnce([]); // list_dir refresh
    const newPath = await useWorkspace.getState().renameEntry('C:/proj/old.txt', 'new.txt');
    expect(newPath).toBe('C:/proj/new.txt');
    expect(useBuffers.getState().buffers[0].path).toBe('C:/proj/new.txt');
  });

  it('deleteEntry invokes delete_path and closes clean buffer', async () => {
    const id = useBuffers.getState().openBuffer({ path: 'C:/proj/gone.txt', content: 'x', encoding: 'utf-8', eol: 'lf' });
    mockInvoke
      .mockResolvedValueOnce(undefined) // delete_path
      .mockResolvedValueOnce([]); // list_dir refresh
    await useWorkspace.getState().deleteEntry('C:/proj/gone.txt');
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'delete_path', {
      workspaceFolder: 'C:/proj', path: 'C:/proj/gone.txt',
    });
    expect(useBuffers.getState().buffers.find((b) => b.id === id)).toBeUndefined();
  });
});
