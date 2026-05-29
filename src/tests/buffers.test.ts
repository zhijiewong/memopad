import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBuffers, selectPaneState } from '../stores/buffers';

describe('buffers store', () => {
  beforeEach(() => {
    useBuffers.getState().resetAll();
  });

  it('starts with no buffers and null active', () => {
    const s = useBuffers.getState();
    expect(s.buffers).to.deep.equal([]);
    expect(s.activeId).to.equal(null);
    expect(s.recentlyClosed).to.deep.equal([]);
  });

  it('newBuffer creates an Untitled buffer, makes it active, and returns its id', () => {
    const id = useBuffers.getState().newBuffer();
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.activeId).to.equal(id);
    expect(s.buffers[0].path).to.equal(null);
    expect(s.buffers[0].content).to.equal('');
    expect(s.buffers[0].dirty).to.equal(false);
    expect(s.buffers[0].encoding).to.equal('utf-8');
    expect(s.buffers[0].eol).to.equal('lf');
  });

  it('openBuffer adds a buffer with file content + makes it active', () => {
    const id = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.activeId).to.equal(id);
    expect(s.buffers[0].content).to.equal('hi');
    expect(s.buffers[0].dirty).to.equal(false);
  });

  it('opening the same path twice switches to the existing buffer (no duplicate)', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().newBuffer(); // create a second tab
    const b = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'hi',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const s = useBuffers.getState();
    expect(b).to.equal(a);
    expect(s.buffers).to.have.length(2); // original + the Untitled, not 3
    expect(s.activeId).to.equal(a);
  });

  it('setActiveContent dirties the active buffer only', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer(); // now active
    useBuffers.getState().setActiveContent('typed');
    const s = useBuffers.getState();
    expect(s.buffers.find((x) => x.id === b)!.dirty).to.equal(true);
    expect(s.buffers.find((x) => x.id === a)!.dirty).to.equal(false);
  });

  it('switchTo changes active without touching other state', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('on b');
    useBuffers.getState().switchTo(a);
    expect(useBuffers.getState().activeId).to.equal(a);
    expect(useBuffers.getState().buffers.find((x) => x.id === b)!.content).to.equal('on b');
  });

  it('closeBuffer removes the buffer and pushes onto recentlyClosed', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'X',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const b = useBuffers.getState().newBuffer();
    useBuffers.getState().closeBuffer(a);
    const s = useBuffers.getState();
    expect(s.buffers.map((x) => x.id)).to.deep.equal([b]);
    expect(s.activeId).to.equal(b);
    expect(s.recentlyClosed.map((x) => x.path)).to.deep.equal(['/tmp/x.txt']);
  });

  it('closing the active buffer focuses the next tab (or previous at end)', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer();
    const c = useBuffers.getState().newBuffer();
    // c is active. Closing c should focus b.
    useBuffers.getState().closeBuffer(c);
    expect(useBuffers.getState().activeId).to.equal(b);
    // Now b is active and at end (a, b). Closing b focuses a.
    useBuffers.getState().closeBuffer(b);
    expect(useBuffers.getState().activeId).to.equal(a);
    // Closing last buffer leaves activeId null.
    useBuffers.getState().closeBuffer(a);
    expect(useBuffers.getState().activeId).to.equal(null);
    expect(useBuffers.getState().buffers).to.deep.equal([]);
  });

  it('reopenLastClosed restores the most recently closed buffer', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'X',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().closeBuffer(a);
    const restored = useBuffers.getState().reopenLastClosed();
    expect(restored).to.not.equal(null);
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.buffers[0].path).to.equal('/tmp/x.txt');
    expect(s.activeId).to.equal(restored);
    expect(s.recentlyClosed).to.deep.equal([]);
  });

  it('reopenLastClosed returns null when stack is empty', () => {
    expect(useBuffers.getState().reopenLastClosed()).to.equal(null);
  });

  it('recentlyClosed is capped at 10', () => {
    for (let i = 0; i < 15; i++) {
      const id = useBuffers.getState().newBuffer();
      useBuffers.getState().closeBuffer(id);
    }
    expect(useBuffers.getState().recentlyClosed).to.have.length(10);
  });

  it('reorderBuffer moves a buffer to a new index', () => {
    const a = useBuffers.getState().newBuffer();
    const b = useBuffers.getState().newBuffer();
    const c = useBuffers.getState().newBuffer();
    useBuffers.getState().reorderBuffer(a, 2);
    expect(useBuffers.getState().buffers.map((x) => x.id)).to.deep.equal([b, c, a]);
  });

  it('markSaved clears dirty + updates path on the named buffer', () => {
    const a = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('hello');
    expect(useBuffers.getState().buffers[0].dirty).to.equal(true);
    useBuffers.getState().markSaved(a, '/tmp/saved.txt');
    const s = useBuffers.getState();
    expect(s.buffers[0].path).to.equal('/tmp/saved.txt');
    expect(s.buffers[0].dirty).to.equal(false);
    expect(s.buffers[0].content).to.equal('hello');
  });

  it('openRestored creates a buffer with the supplied id (preserves journal correlation)', () => {
    const buf = useBuffers.getState().openRestored({
      bufferId: 'preserved-id',
      path: '/tmp/x.txt',
      content: 'restored body',
      encoding: 'utf-8',
      eol: 'lf',
      dirty: true,
    });
    expect(buf).to.equal('preserved-id');
    const s = useBuffers.getState();
    expect(s.buffers).to.have.length(1);
    expect(s.buffers[0].id).to.equal('preserved-id');
    expect(s.buffers[0].dirty).to.equal(true);
    expect(s.buffers[0].content).to.equal('restored body');
  });

  it('recordStat stores the mtime+size for the named buffer', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/r.txt',
      content: 'r',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().recordStat(a, { mtime_ms: 1700000000000, size: 42 });
    const s = useBuffers.getState();
    expect(s.buffers[0].recordedStat).to.deep.equal({ mtime_ms: 1700000000000, size: 42 });
    expect(s.buffers[0].externalChange).to.equal(false);
  });

  it('setExternalChange flags the buffer (used by focus-time detection)', () => {
    const a = useBuffers.getState().openBuffer({
      path: '/tmp/e.txt',
      content: 'e',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().setExternalChange(a, true);
    expect(useBuffers.getState().buffers[0].externalChange).to.equal(true);
    useBuffers.getState().setExternalChange(a, false);
    expect(useBuffers.getState().buffers[0].externalChange).to.equal(false);
  });

  it('replaceBuffer updates content+path on the existing buffer (single occurrence preserved)', () => {
    const id = useBuffers.getState().openBuffer({
      path: '/tmp/x.txt',
      content: 'original',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().setActiveContent('dirty edits');
    useBuffers.getState().replaceBuffer(id, {
      path: '/tmp/x.txt',
      content: 'fresh from disk',
      encoding: 'utf-8',
      eol: 'lf',
    });
    const s = useBuffers.getState();
    // Exactly one buffer with this id remains.
    expect(s.buffers.filter((b) => b.id === id)).to.have.length(1);
    const b = s.buffers.find((x) => x.id === id)!;
    expect(b.content).to.equal('fresh from disk');
    expect(b.originalContent).to.equal('fresh from disk');
    expect(b.dirty).to.equal(false);
    expect(b.externalChange).to.equal(false);
    expect(s.activeId).to.equal(id);
  });

  it('setCursor stores cursor offset without marking dirty', () => {
    const id = useBuffers.getState().openBuffer({
      path: '/tmp/c.txt',
      content: 'hello world',
      encoding: 'utf-8',
      eol: 'lf',
    });
    expect(useBuffers.getState().buffers[0].dirty).to.equal(false);
    useBuffers.getState().setCursor(id, 6);
    const s = useBuffers.getState();
    expect(s.buffers[0].cursor).to.equal(6);
    expect(s.buffers[0].dirty).to.equal(false);
  });

  it('setScrollTop stores scroll position without marking dirty', () => {
    const id = useBuffers.getState().openBuffer({
      path: '/tmp/s.txt',
      content: 'long file',
      encoding: 'utf-8',
      eol: 'lf',
    });
    useBuffers.getState().setScrollTop(id, 240);
    const s = useBuffers.getState();
    expect(s.buffers[0].scrollTop).to.equal(240);
    expect(s.buffers[0].dirty).to.equal(false);
  });
});

describe('openFileAtLine', () => {
  it('reuses an existing tab when the path is already open', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'line1\nline2\n', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().newBuffer();
    expect(useBuffers.getState().activeId).not.toBe(id);

    useBuffers.getState().openFileAtLine('C:/a.txt', 2, [0, 4], 'line2');

    expect(useBuffers.getState().activeId).toBe(id);
  });
});

describe('split view', () => {
  beforeEach(() => {
    useBuffers.setState(useBuffers.getInitialState(), true);
  });

  it('toggleSplit enables split with secondary mirroring primary and focuses secondary', () => {
    useBuffers.setState({
      buffers: [],
      activeId: null,
      recentlyClosed: [],
      splitActive: false,
      secondaryId: null,
      focusedPane: 'primary',
    } as never);
    const id = useBuffers.getState().newBuffer();
    useBuffers.getState().toggleSplit();
    expect(useBuffers.getState().splitActive).toBe(true);
    expect(useBuffers.getState().secondaryId).toBe(id);
    expect(useBuffers.getState().focusedPane).toBe('secondary');
  });

  it('toggleSplit disables split and focuses primary', () => {
    useBuffers.setState({
      buffers: [],
      activeId: 'b1',
      recentlyClosed: [],
      splitActive: true,
      secondaryId: 'b1',
      focusedPane: 'secondary',
    } as never);
    useBuffers.getState().toggleSplit();
    expect(useBuffers.getState().splitActive).toBe(false);
    expect(useBuffers.getState().secondaryId).toBeNull();
    expect(useBuffers.getState().focusedPane).toBe('primary');
  });

  it('setFocusedBuffer with primary focus updates activeId', () => {
    useBuffers.setState({
      buffers: [],
      activeId: 'b1',
      recentlyClosed: [],
      splitActive: true,
      secondaryId: 'b2',
      focusedPane: 'primary',
    } as never);
    useBuffers.getState().setFocusedBuffer('b3');
    expect(useBuffers.getState().activeId).toBe('b3');
    expect(useBuffers.getState().secondaryId).toBe('b2');
  });

  it('setFocusedBuffer with secondary focus updates secondaryId', () => {
    useBuffers.setState({
      buffers: [],
      activeId: 'b1',
      recentlyClosed: [],
      splitActive: true,
      secondaryId: 'b2',
      focusedPane: 'secondary',
    } as never);
    useBuffers.getState().setFocusedBuffer('b3');
    expect(useBuffers.getState().activeId).toBe('b1');
    expect(useBuffers.getState().secondaryId).toBe('b3');
  });

  it('closeBuffer secondary falls back to primary', () => {
    const aId = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: '', encoding: 'utf-8', eol: 'lf',
    });
    const bId = useBuffers.getState().openBuffer({
      path: 'C:/b.txt', content: '', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.setState({
      activeId: aId,
      splitActive: true,
      secondaryId: bId,
      focusedPane: 'secondary',
    } as never);
    useBuffers.getState().closeBuffer(bId);
    expect(useBuffers.getState().secondaryId).toBe(aId);
  });

  it('resetAll clears split state', () => {
    useBuffers.getState().openRestored({
      bufferId: 'b1', path: 'C:/a.txt', content: '', encoding: 'utf-8', eol: 'lf', dirty: false,
    });
    useBuffers.getState().openRestored({
      bufferId: 'b2', path: 'C:/b.txt', content: '', encoding: 'utf-8', eol: 'lf', dirty: false,
    });
    useBuffers.getState().restoreSplitState({
      splitActive: true,
      secondaryId: 'b2',
      focusedPane: 'secondary',
      secondaryPaneState: [{ bufferId: 'b2', cursor: 1, scrollTop: 2 }],
    });
    useBuffers.getState().resetAll();
    const s = useBuffers.getState();
    expect(s.splitActive).toBe(false);
    expect(s.secondaryId).toBeNull();
    expect(s.focusedPane).toBe('primary');
    expect(s.secondaryPaneState.size).toBe(0);
  });
});

describe('reloadIfOpen', () => {
  it('replaces content and preserves id', async () => {
    vi.resetModules();
    const tauri = await import('../lib/tauri');
    const spy = vi.spyOn(tauri, 'openFile').mockResolvedValue({
      path: 'C:/r.txt', content: 'NEW', encoding: 'utf-8', eol: 'lf',
    });

    const id = useBuffers.getState().openBuffer({
      path: 'C:/r.txt', content: 'OLD', encoding: 'utf-8', eol: 'lf',
    });
    await useBuffers.getState().reloadIfOpen('C:/r.txt');

    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.content).toBe('NEW');
    expect(buf?.id).toBe(id);
    spy.mockRestore();
  });

  it('does nothing for unknown path', async () => {
    await useBuffers.getState().reloadIfOpen('C:/never-opened.txt');
    expect(useBuffers.getState().buffers.find((b) => b.path === 'C:/never-opened.txt')).toBeUndefined();
  });

  it('skips dirty buffers', async () => {
    vi.resetModules();
    const tauri = await import('../lib/tauri');
    const spy = vi.spyOn(tauri, 'openFile');

    const id = useBuffers.getState().openBuffer({
      path: 'C:/d.txt', content: 'OLD', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().switchTo(id);
    useBuffers.getState().setActiveContent('EDITED');
    await useBuffers.getState().reloadIfOpen('C:/d.txt');

    expect(spy).not.toHaveBeenCalled();
    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.content).toBe('EDITED');
    spy.mockRestore();
  });
});

describe('per-pane cursor + scroll', () => {
  beforeEach(() => {
    useBuffers.setState(useBuffers.getInitialState(), true);
  });

  it('setSecondaryCursor isolates secondary from primary', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'hello\nworld', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().setCursor(id, 10);
    useBuffers.getState().setSecondaryCursor(id, 50);

    expect(selectPaneState(useBuffers.getState(), 'primary', id).cursor).toBe(10);
    expect(selectPaneState(useBuffers.getState(), 'secondary', id).cursor).toBe(50);
  });

  it('setSecondaryScrollTop isolates secondary from primary', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'hi', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().setScrollTop(id, 100);
    useBuffers.getState().setSecondaryScrollTop(id, 300);

    expect(selectPaneState(useBuffers.getState(), 'primary', id).scrollTop).toBe(100);
    expect(selectPaneState(useBuffers.getState(), 'secondary', id).scrollTop).toBe(300);
  });

  it('selectPaneState secondary falls back to primary when no entry exists', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'x', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().setCursor(id, 20);
    expect(selectPaneState(useBuffers.getState(), 'secondary', id).cursor).toBe(20);
  });

  it('closeBuffer clears secondary pane state for the closed buffer', () => {
    const id = useBuffers.getState().openBuffer({
      path: 'C:/a.txt', content: 'x', encoding: 'utf-8', eol: 'lf',
    });
    useBuffers.getState().setSecondaryCursor(id, 42);
    expect(useBuffers.getState().secondaryPaneState.has(id)).toBe(true);

    useBuffers.getState().closeBuffer(id);
    expect(useBuffers.getState().secondaryPaneState.has(id)).toBe(false);
  });
});

describe('openRestored cursor/scroll', () => {
  beforeEach(() => {
    useBuffers.setState(useBuffers.getInitialState(), true);
  });

  it('openRestored applies cursor and scrollTop from input', () => {
    const id = useBuffers.getState().openRestored({
      bufferId: 'b1',
      path: 'C:/a.txt',
      content: 'hello',
      encoding: 'utf-8',
      eol: 'lf',
      dirty: false,
      cursor: 5,
      scrollTop: 120,
    });
    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.cursor).toBe(5);
    expect(buf?.scrollTop).toBe(120);
  });

  it('openRestored defaults cursor/scrollTop to null when omitted', () => {
    const id = useBuffers.getState().openRestored({
      bufferId: 'b2',
      path: 'C:/b.txt',
      content: '',
      encoding: 'utf-8',
      eol: 'lf',
      dirty: false,
    });
    const buf = useBuffers.getState().buffers.find((b) => b.id === id);
    expect(buf?.cursor).toBeNull();
    expect(buf?.scrollTop).toBeNull();
  });
});

describe('restoreSplitState', () => {
  beforeEach(() => {
    useBuffers.setState(useBuffers.getInitialState(), true);
  });

  it('opens the split when secondaryId resolves to a live buffer', () => {
    useBuffers.getState().openRestored({
      bufferId: 'b1', path: 'C:/a.txt', content: '', encoding: 'utf-8', eol: 'lf', dirty: false,
    });
    useBuffers.getState().openRestored({
      bufferId: 'b2', path: 'C:/b.txt', content: '', encoding: 'utf-8', eol: 'lf', dirty: false,
    });
    useBuffers.getState().restoreSplitState({
      splitActive: true,
      secondaryId: 'b2',
      focusedPane: 'secondary',
      secondaryPaneState: [{ bufferId: 'b2', cursor: 3, scrollTop: 50 }],
    });
    const s = useBuffers.getState();
    expect(s.splitActive).toBe(true);
    expect(s.secondaryId).toBe('b2');
    expect(s.focusedPane).toBe('secondary');
    expect(s.secondaryPaneState.get('b2')).toEqual({ cursor: 3, scrollTop: 50 });
  });

  it('collapses when secondaryId does not resolve to a buffer', () => {
    useBuffers.getState().openRestored({
      bufferId: 'b1', path: 'C:/a.txt', content: '', encoding: 'utf-8', eol: 'lf', dirty: false,
    });
    useBuffers.getState().restoreSplitState({
      splitActive: true,
      secondaryId: 'gone',
      focusedPane: 'secondary',
      secondaryPaneState: [],
    });
    const s = useBuffers.getState();
    expect(s.splitActive).toBe(false);
    expect(s.secondaryId).toBeNull();
    expect(s.focusedPane).toBe('primary');
  });

  it('forces focusedPane to primary when collapsing', () => {
    useBuffers.getState().restoreSplitState({
      splitActive: false,
      secondaryId: null,
      focusedPane: 'secondary',
      secondaryPaneState: [],
    });
    expect(useBuffers.getState().focusedPane).toBe('primary');
  });

  it('filters secondaryPaneState to buffers that exist', () => {
    useBuffers.getState().openRestored({
      bufferId: 'b1', path: 'C:/a.txt', content: '', encoding: 'utf-8', eol: 'lf', dirty: false,
    });
    useBuffers.getState().openRestored({
      bufferId: 'b2', path: 'C:/b.txt', content: '', encoding: 'utf-8', eol: 'lf', dirty: false,
    });
    useBuffers.getState().restoreSplitState({
      splitActive: true,
      secondaryId: 'b2',
      focusedPane: 'secondary',
      secondaryPaneState: [
        { bufferId: 'b2', cursor: 1, scrollTop: 2 },
        { bufferId: 'ghost', cursor: 9, scrollTop: 9 },
      ],
    });
    const map = useBuffers.getState().secondaryPaneState;
    expect(map.has('b2')).toBe(true);
    expect(map.has('ghost')).toBe(false);
  });
});
