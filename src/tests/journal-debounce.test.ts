import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useBuffers } from '../stores/buffers';

// Mock the IPC wrappers — we are testing the debounce logic, not real Tauri calls.
const snapshotSpy = vi.fn();
const clearSpy = vi.fn();
vi.mock('../lib/tauri', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/tauri')>();
  return {
    ...original,
    journalSnapshot: (id: string, snap: unknown) => {
      snapshotSpy(id, snap);
      return Promise.resolve();
    },
    journalClear: (id: string) => {
      clearSpy(id);
      return Promise.resolve();
    },
  };
});

import { startJournalDebounce, JOURNAL_DEBOUNCE_MS } from '../lib/journal-debounce';

describe('journal-debounce', () => {
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    useBuffers.getState().resetAll();
    snapshotSpy.mockReset();
    clearSpy.mockReset();
    stop = startJournalDebounce();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('writes a snapshot after JOURNAL_DEBOUNCE_MS of idle following content change', () => {
    const id = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('first');
    expect(snapshotSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(JOURNAL_DEBOUNCE_MS);
    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    expect(snapshotSpy.mock.calls[0][0]).toBe(id);
    expect(snapshotSpy.mock.calls[0][1].content).toBe('first');
  });

  it('coalesces rapid changes into a single snapshot', () => {
    useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('a');
    vi.advanceTimersByTime(100);
    useBuffers.getState().setActiveContent('ab');
    vi.advanceTimersByTime(100);
    useBuffers.getState().setActiveContent('abc');
    vi.advanceTimersByTime(JOURNAL_DEBOUNCE_MS);
    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    expect(snapshotSpy.mock.calls[0][1].content).toBe('abc');
  });

  it('does not snapshot a clean buffer', () => {
    useBuffers.getState().newBuffer();
    vi.advanceTimersByTime(JOURNAL_DEBOUNCE_MS * 2);
    expect(snapshotSpy).not.toHaveBeenCalled();
  });

  it('markSaved cancels pending snapshot and clears the journal', () => {
    const id = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('hello');
    useBuffers.getState().markSaved(id, '/tmp/saved.txt');
    vi.advanceTimersByTime(JOURNAL_DEBOUNCE_MS);
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalledWith(id);
  });

  it('closeBuffer cancels pending snapshot and clears the journal', () => {
    const id = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('hello');
    useBuffers.getState().closeBuffer(id);
    vi.advanceTimersByTime(JOURNAL_DEBOUNCE_MS);
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalledWith(id);
  });

  it('two buffers debounce independently', () => {
    const a = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('A');
    const b = useBuffers.getState().newBuffer();
    useBuffers.getState().setActiveContent('B');
    vi.advanceTimersByTime(JOURNAL_DEBOUNCE_MS);
    expect(snapshotSpy).toHaveBeenCalledTimes(2);
    const ids = snapshotSpy.mock.calls.map((c) => c[0]);
    expect(ids).to.include.members([a, b]);
  });
});
