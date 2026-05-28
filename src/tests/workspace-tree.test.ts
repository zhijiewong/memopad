import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../stores/workspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: 'C:/proj',
    results: null,
    inFlight: false,
    lastQuery: '',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    expanded: new Set<string>(),
    childrenByPath: new Map(),
    loadingByPath: new Set<string>(),
  } as never);
  vi.clearAllMocks();
});

describe('useWorkspace tree', () => {
  it('toggleExpand adds path and fetches children', async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: 'a.txt', path: 'C:/proj/a.txt', is_dir: false },
    ]);
    await useWorkspace.getState().toggleExpand('C:/proj');
    expect(useWorkspace.getState().expanded.has('C:/proj')).toBe(true);
    expect(useWorkspace.getState().childrenByPath.get('C:/proj')?.length).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('toggleExpand on expanded path collapses without re-fetching', async () => {
    useWorkspace.setState({
      expanded: new Set(['C:/proj']),
      childrenByPath: new Map([['C:/proj', [{ name: 'a.txt', path: 'C:/proj/a.txt', is_dir: false }]]]),
    } as never);
    await useWorkspace.getState().toggleExpand('C:/proj');
    expect(useWorkspace.getState().expanded.has('C:/proj')).toBe(false);
    expect(useWorkspace.getState().childrenByPath.get('C:/proj')?.length).toBe(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refreshSubtree replaces cached children', async () => {
    useWorkspace.setState({
      childrenByPath: new Map([['C:/proj', [{ name: 'old.txt', path: 'C:/proj/old.txt', is_dir: false }]]]),
    } as never);
    (invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: 'new.txt', path: 'C:/proj/new.txt', is_dir: false },
    ]);
    await useWorkspace.getState().refreshSubtree('C:/proj');
    const kids = useWorkspace.getState().childrenByPath.get('C:/proj');
    expect(kids?.[0]?.name).toBe('new.txt');
  });

  it('clearTreeCache resets all three fields', () => {
    useWorkspace.setState({
      expanded: new Set(['C:/proj']),
      childrenByPath: new Map([['C:/proj', []]]),
      loadingByPath: new Set(['C:/proj']),
    } as never);
    useWorkspace.getState().clearTreeCache();
    expect(useWorkspace.getState().expanded.size).toBe(0);
    expect(useWorkspace.getState().childrenByPath.size).toBe(0);
    expect(useWorkspace.getState().loadingByPath.size).toBe(0);
  });

  it('closeFolder clears tree cache', () => {
    useWorkspace.setState({
      expanded: new Set(['C:/proj']),
      childrenByPath: new Map([['C:/proj', []]]),
    } as never);
    useWorkspace.getState().closeFolder();
    expect(useWorkspace.getState().expanded.size).toBe(0);
    expect(useWorkspace.getState().childrenByPath.size).toBe(0);
    expect(useWorkspace.getState().workspaceFolder).toBeNull();
  });
});
