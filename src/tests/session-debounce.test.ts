import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const saveSpy = vi.fn();
vi.mock('../lib/tauri', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/tauri')>();
  return {
    ...original,
    sessionSave: (state: unknown) => {
      saveSpy(state);
      return Promise.resolve();
    },
  };
});

import { scheduleSessionSave, SESSION_DEBOUNCE_MS, flushSessionSave } from '../lib/session-debounce';

describe('session-debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveSpy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a save after SESSION_DEBOUNCE_MS', () => {
    scheduleSessionSave({ tabs: [], active_id: null });
    expect(saveSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SESSION_DEBOUNCE_MS);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid calls into one save with the latest payload', () => {
    scheduleSessionSave({ tabs: [{ buffer_id: 'a', path: null }], active_id: 'a' });
    vi.advanceTimersByTime(100);
    scheduleSessionSave({ tabs: [{ buffer_id: 'a', path: null }, { buffer_id: 'b', path: null }], active_id: 'b' });
    vi.advanceTimersByTime(100);
    scheduleSessionSave({ tabs: [{ buffer_id: 'c', path: null }], active_id: 'c' });
    vi.advanceTimersByTime(SESSION_DEBOUNCE_MS);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const last = saveSpy.mock.calls[0][0] as { active_id: string };
    expect(last.active_id).to.equal('c');
  });

  it('flushSessionSave runs the pending save immediately', async () => {
    scheduleSessionSave({ tabs: [], active_id: null });
    expect(saveSpy).not.toHaveBeenCalled();
    await flushSessionSave();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('flushSessionSave is a no-op when no save is pending', async () => {
    await flushSessionSave();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
