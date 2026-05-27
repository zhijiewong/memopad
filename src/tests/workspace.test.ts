import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../stores/workspace';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: null,
    results: null,
    inFlight: false,
    lastQuery: '',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    requestId: 0,
  });
  vi.clearAllMocks();
});

describe('useWorkspace.openFolder', () => {
  it('persists the picked path into workspaceFolder', async () => {
    (openDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('C:/some/proj');
    await useWorkspace.getState().openFolder();
    expect(useWorkspace.getState().workspaceFolder).toBe('C:/some/proj');
  });

  it('leaves state unchanged if the user cancels the dialog', async () => {
    (openDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await useWorkspace.getState().openFolder();
    expect(useWorkspace.getState().workspaceFolder).toBeNull();
  });
});

describe('useWorkspace.runSearch', () => {
  function defaultOpts(): import('../lib/tauri').FindOptions {
    return { regex: false, case_sensitive: false, whole_word: false };
  }

  it('does nothing when query is whitespace', async () => {
    useWorkspace.setState({ workspaceFolder: 'C:/proj' } as never);
    await useWorkspace.getState().runSearch('   ', defaultOpts());
    expect(invoke).not.toHaveBeenCalled();
    expect(useWorkspace.getState().results).toBeNull();
  });

  it('does nothing when no workspace folder is set', async () => {
    await useWorkspace.getState().runSearch('foo', defaultOpts());
    expect(invoke).not.toHaveBeenCalled();
  });

  it('drops a stale response when a newer search has started', async () => {
    useWorkspace.setState({ workspaceFolder: 'C:/proj' } as never);
    const slow = new Promise((resolve) => setTimeout(() => resolve({
      files: [{ path: 'a', matches: [] }], truncated: false, elapsed_ms: 10,
    }), 50));
    const fast = Promise.resolve({
      files: [{ path: 'b', matches: [] }], truncated: false, elapsed_ms: 1,
    });
    (invoke as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(slow);
    (invoke as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(fast);

    const slowCall = useWorkspace.getState().runSearch('aaa', defaultOpts());
    const fastCall = useWorkspace.getState().runSearch('bbb', defaultOpts());
    await Promise.all([slowCall, fastCall]);

    const results = useWorkspace.getState().results;
    expect(results?.files[0]?.path).toBe('b');
  });
});
