import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { open as openDialog } from '@tauri-apps/plugin-dialog';
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
