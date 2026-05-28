import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { useWorkspace } from '../stores/workspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: null,
    results: null,
    inFlight: false,
    lastQuery: '',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    expanded: new Set<string>(),
    childrenByPath: new Map(),
    loadingByPath: new Set<string>(),
    recentFolders: [],
  } as never);
  vi.clearAllMocks();
});

describe('useWorkspace recent folders', () => {
  it('pushRecentFolder dedups case-insensitively', () => {
    useWorkspace.getState().pushRecentFolder('C:/proj');
    useWorkspace.getState().pushRecentFolder('c:\\proj');
    expect(useWorkspace.getState().recentFolders).toEqual(['c:\\proj']);
  });

  it('pushRecentFolder moves an existing entry to the front', () => {
    useWorkspace.getState().pushRecentFolder('C:/a');
    useWorkspace.getState().pushRecentFolder('C:/b');
    useWorkspace.getState().pushRecentFolder('C:/a');
    expect(useWorkspace.getState().recentFolders).toEqual(['C:/a', 'C:/b']);
  });

  it('pushRecentFolder caps at 10', () => {
    for (let i = 0; i < 12; i++) useWorkspace.getState().pushRecentFolder(`C:/p${i}`);
    expect(useWorkspace.getState().recentFolders.length).toBe(10);
    expect(useWorkspace.getState().recentFolders[0]).toBe('C:/p11');
    expect(useWorkspace.getState().recentFolders[9]).toBe('C:/p2');
  });

  it('removeRecentFolder removes case-insensitively', () => {
    useWorkspace.getState().pushRecentFolder('C:/a');
    useWorkspace.getState().pushRecentFolder('C:/b');
    useWorkspace.getState().removeRecentFolder('c:\\a');
    expect(useWorkspace.getState().recentFolders).toEqual(['C:/b']);
  });
});
