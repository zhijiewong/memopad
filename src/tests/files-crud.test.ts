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
