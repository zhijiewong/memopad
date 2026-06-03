import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { WindowSession } from '../lib/tauri';

const saveSpy = vi.fn();
vi.mock('../lib/tauri', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/tauri')>();
  return {
    ...original,
    sessionSaveWindow: (label: string, window: WindowSession) => {
      saveSpy(label, window);
      return Promise.resolve();
    },
  };
});

import { scheduleSessionSave, SESSION_DEBOUNCE_MS, flushSessionSave } from '../lib/session-debounce';

function ws(label: string, activeId: string | null): WindowSession {
  return { label, tabs: [], active_id: activeId };
}

describe('session-debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveSpy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a save after SESSION_DEBOUNCE_MS', () => {
    scheduleSessionSave(ws('main', null));
    expect(saveSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SESSION_DEBOUNCE_MS);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0][0]).to.equal('main');
  });

  it('coalesces rapid calls into one save with the latest payload', () => {
    scheduleSessionSave(ws('main', 'a'));
    vi.advanceTimersByTime(100);
    scheduleSessionSave(ws('main', 'b'));
    vi.advanceTimersByTime(100);
    scheduleSessionSave(ws('main', 'c'));
    vi.advanceTimersByTime(SESSION_DEBOUNCE_MS);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    const last = saveSpy.mock.calls[0][1] as WindowSession;
    expect(last.active_id).to.equal('c');
  });

  it('flushSessionSave runs the pending save immediately', async () => {
    scheduleSessionSave(ws('main', null));
    expect(saveSpy).not.toHaveBeenCalled();
    await flushSessionSave();
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('flushSessionSave is a no-op when no save is pending', async () => {
    await flushSessionSave();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
