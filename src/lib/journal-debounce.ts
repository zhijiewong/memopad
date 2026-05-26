import { useBuffers, type Buffer } from '../stores/buffers';
import { journalSnapshot, journalClear, type JournalSnapshot } from './tauri';

export const JOURNAL_DEBOUNCE_MS = 250;

function snapshotOf(b: Buffer): JournalSnapshot {
  return {
    path: b.path,
    content: b.content,
    encoding: b.encoding,
    eol: b.eol,
  };
}

/**
 * Start subscribing to the buffer store. For each buffer:
 *   - When `dirty` becomes true (or content changes while dirty), schedule a
 *     snapshot after JOURNAL_DEBOUNCE_MS of idle. Coalesce with any pending
 *     timer for the same buffer.
 *   - When `dirty` becomes false (markSaved), cancel any pending timer and
 *     fire journalClear.
 *   - When a buffer disappears (closeBuffer / resetAll), cancel any pending
 *     timer and fire journalClear.
 *
 * Returns an unsubscribe function.
 */
export function startJournalDebounce(): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastSeen = new Map<string, Buffer>();

  function schedule(b: Buffer) {
    const existing = timers.get(b.id);
    if (existing) clearTimeout(existing);
    timers.set(
      b.id,
      setTimeout(() => {
        timers.delete(b.id);
        journalSnapshot(b.id, snapshotOf(b)).catch((err) => {
          console.error('journalSnapshot failed:', err);
        });
      }, JOURNAL_DEBOUNCE_MS),
    );
  }

  function clearTimerAndJournal(id: string) {
    const existing = timers.get(id);
    if (existing) {
      clearTimeout(existing);
      timers.delete(id);
    }
    journalClear(id).catch((err) => {
      console.error('journalClear failed:', err);
    });
  }

  const unsubscribe = useBuffers.subscribe((state) => {
    const seenNow = new Map<string, Buffer>();

    for (const b of state.buffers) {
      seenNow.set(b.id, b);
      const prev = lastSeen.get(b.id);

      if (!prev) {
        // newly tracked buffer — only schedule if it appeared already-dirty
        if (b.dirty) schedule(b);
        continue;
      }

      if (b.dirty && (b.content !== prev.content || !prev.dirty)) {
        schedule(b);
      } else if (!b.dirty && prev.dirty) {
        // dirty → clean transition (e.g. markSaved)
        clearTimerAndJournal(b.id);
      }
    }

    // Buffers that disappeared since last tick
    for (const id of lastSeen.keys()) {
      if (!seenNow.has(id)) clearTimerAndJournal(id);
    }

    lastSeen.clear();
    for (const [id, b] of seenNow) lastSeen.set(id, b);
  });

  return () => {
    unsubscribe();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    lastSeen.clear();
  };
}
