import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { useWorkspace } from '../stores/workspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: null,
    results: null,
    inFlight: false,
    replaceInFlight: false,
    lastQuery: '',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    expanded: new Set<string>(),
    childrenByPath: new Map(),
    loadingByPath: new Set<string>(),
    recentFolders: [],
    watcherError: null,
  } as never);
  vi.clearAllMocks();
});

describe('useWorkspace watcherError', () => {
  it('setWatcherError sets and clears', () => {
    useWorkspace.getState().setWatcherError('uh oh');
    expect(useWorkspace.getState().watcherError).toBe('uh oh');
    useWorkspace.getState().setWatcherError(null);
    expect(useWorkspace.getState().watcherError).toBeNull();
  });

  it('setWatcherError persists across other state updates', () => {
    useWorkspace.getState().setWatcherError('still here');
    useWorkspace.getState().pushRecentFolder('C:/proj');
    expect(useWorkspace.getState().watcherError).toBe('still here');
  });
});
