import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { handleEvent } from '../lib/fs-watcher';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';

beforeEach(() => {
  useWorkspace.setState({
    workspaceFolder: 'C:/proj',
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
  useBuffers.setState({ buffers: [], activeId: null, recentlyClosed: [] } as never);
  vi.clearAllMocks();
});

describe('fs-watcher.handleEvent', () => {
  it('modify event marks open buffer externalChange', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/proj/a.rs', content: 'orig', encoding: 'utf-8', eol: 'lf',
    });
    handleEvent({ kind: 'modify', path: 'C:/proj/a.rs' });
    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.externalChange).toBe(true);
  });

  it('modify event does not mark dirty buffer', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/proj/a.rs', content: 'orig', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().switchTo(id);
    useBuffers.getState().setActiveContent('edited');
    handleEvent({ kind: 'modify', path: 'C:/proj/a.rs' });
    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.externalChange).toBe(false);
  });

  it('create event in expanded subtree calls refreshSubtree', () => {
    useWorkspace.setState({
      expanded: new Set<string>(['C:/proj']),
      childrenByPath: new Map([['C:/proj', []]]),
    } as never);
    const spy = vi.spyOn(useWorkspace.getState(), 'refreshSubtree').mockResolvedValue();
    handleEvent({ kind: 'create', path: 'C:/proj/new.rs' });
    expect(spy).toHaveBeenCalledWith('C:/proj');
    spy.mockRestore();
  });

  it('create event in collapsed subtree does nothing', () => {
    const spy = vi.spyOn(useWorkspace.getState(), 'refreshSubtree').mockResolvedValue();
    handleEvent({ kind: 'create', path: 'C:/proj/sub/new.rs' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
