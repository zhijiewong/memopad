import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: 'C:/proj',
    results: {
      files: [
        { path: 'C:/proj/a.rs', matches: [{ line_number: 1, line_text: 'foo', match_ranges: [[0, 3]] }] },
      ],
      truncated: false,
      elapsed_ms: 1,
    },
    inFlight: false,
    replaceInFlight: false,
    lastQuery: 'foo',
    lastOpts: { regex: false, case_sensitive: false, whole_word: false },
    expanded: new Set<string>(),
    childrenByPath: new Map(),
    loadingByPath: new Set<string>(),
  } as never);
  useBuffers.setState({ buffers: [], activeId: null, recentlyClosed: [] } as never);
  vi.clearAllMocks();
});

describe('useWorkspace.replaceInFiles', () => {
  function defaultOpts() { return { regex: false, case_sensitive: false, whole_word: false }; }

  it('uses lastQuery, lastOpts, and current target_paths', async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === 'replace_in_files') return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
      if (cmd === 'find_in_folder') return { files: [], truncated: false, elapsed_ms: 1 };
      return null;
    });
    await useWorkspace.getState().replaceInFiles('bar');
    expect(invoke).toHaveBeenCalledWith('replace_in_files', expect.objectContaining({
      folder: 'C:/proj',
      query: 'foo',
      replacement: 'bar',
      opts: defaultOpts(),
      targetPaths: ['C:/proj/a.rs'],
    }));
  });

  it('skips when there are no results', async () => {
    useWorkspace.setState({ results: null } as never);
    await useWorkspace.getState().replaceInFiles('bar');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reloads open buffers for successfully replaced files', async () => {
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === 'replace_in_files') return {
        results: [{ path: 'C:/proj/a.rs', matches_replaced: 1, error: null }],
        total_files_replaced: 1,
        total_matches_replaced: 1,
      };
      if (cmd === 'find_in_folder') return { files: [], truncated: false, elapsed_ms: 1 };
      if (cmd === 'open_file') return { path: 'C:/proj/a.rs', content: 'bar', encoding: 'utf-8', eol: 'lf' };
      return null;
    });
    useBuffers.getState().openBuffer({
      path: 'C:/proj/a.rs', content: 'foo', encoding: 'utf-8', eol: 'lf',
    });
    const spy = vi.spyOn(useBuffers.getState(), 'reloadIfOpen');
    await useWorkspace.getState().replaceInFiles('bar');
    expect(spy).toHaveBeenCalledWith('C:/proj/a.rs');
    spy.mockRestore();
  });

  it('re-runs the search after completion', async () => {
    const callOrder: string[] = [];
    (invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      callOrder.push(cmd);
      if (cmd === 'replace_in_files') return { results: [], total_files_replaced: 0, total_matches_replaced: 0 };
      if (cmd === 'find_in_folder') return { files: [], truncated: false, elapsed_ms: 1 };
      return null;
    });
    await useWorkspace.getState().replaceInFiles('bar');
    expect(callOrder).toEqual(['replace_in_files', 'find_in_folder']);
  });
});
