import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));

import { useBuffers } from '../stores/buffers';
import { useWorkspace } from '../stores/workspace';
import { bootRestore } from '../lib/boot';
import * as tauri from '../lib/tauri';
import type { AppSession, WindowSession } from '../lib/tauri';

function emptyApp(): AppSession {
  return { windows: [], editor_prefs: {}, recent_folders: [], recent_files: [] };
}

describe('bootRestore split round-trip', () => {
  beforeEach(() => {
    useBuffers.setState(useBuffers.getInitialState(), true);
    useWorkspace.setState(useWorkspace.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores split layout from the claimed window session', async () => {
    vi.spyOn(tauri, 'journalReplay').mockResolvedValue([]);
    vi.spyOn(tauri, 'sessionLoad').mockResolvedValue(emptyApp());
    vi.spyOn(tauri, 'sessionPendingCount').mockResolvedValue(0);
    const claimed: WindowSession = {
      label: 'main',
      tabs: [
        { buffer_id: 'b1', path: 'C:/a.txt', cursor: 3, scroll_top: 11 },
        { buffer_id: 'b2', path: 'C:/b.txt', cursor: 5, scroll_top: 22 },
      ],
      active_id: 'b1',
      split_active: true,
      secondary_id: 'b2',
      focused_pane: 'secondary',
      secondary_pane_state: [{ buffer_id: 'b2', cursor: 7, scroll_top: 99 }],
    };
    vi.spyOn(tauri, 'sessionClaimWindow').mockResolvedValue(claimed);
    vi.spyOn(tauri, 'openFile').mockImplementation(async (path: string) => ({
      path,
      content: `content of ${path}`,
      encoding: 'utf-8' as const,
      eol: 'lf' as const,
    }));

    await bootRestore();

    const s = useBuffers.getState();
    expect(s.splitActive).toBe(true);
    expect(s.secondaryId).toBe('b2');
    expect(s.focusedPane).toBe('secondary');

    const b1 = s.buffers.find((b) => b.id === 'b1');
    expect(b1?.cursor).toBe(3);
    expect(b1?.scrollTop).toBe(11);

    expect(s.secondaryPaneState.get('b2')).toEqual({ cursor: 7, scrollTop: 99 });
  });

  it('claimed window without split fields restores single pane', async () => {
    vi.spyOn(tauri, 'journalReplay').mockResolvedValue([]);
    vi.spyOn(tauri, 'sessionLoad').mockResolvedValue(emptyApp());
    vi.spyOn(tauri, 'sessionPendingCount').mockResolvedValue(0);
    vi.spyOn(tauri, 'sessionClaimWindow').mockResolvedValue({
      label: 'main',
      tabs: [{ buffer_id: 'b1', path: 'C:/a.txt', cursor: 0, scroll_top: 0 }],
      active_id: 'b1',
    });
    vi.spyOn(tauri, 'openFile').mockImplementation(async (path: string) => ({
      path,
      content: `content of ${path}`,
      encoding: 'utf-8' as const,
      eol: 'lf' as const,
    }));

    await bootRestore();

    const s = useBuffers.getState();
    expect(s.splitActive).toBe(false);
    expect(s.secondaryId).toBeNull();
  });
});
