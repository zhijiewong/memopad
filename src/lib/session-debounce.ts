import { sessionSaveWindow, type WindowSession } from './tauri';

export const SESSION_DEBOUNCE_MS = 500;

let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let pendingState: WindowSession | undefined;

function fire() {
  if (!pendingState) return;
  const state = pendingState;
  pendingState = undefined;
  pendingTimer = undefined;
  sessionSaveWindow(state.label, state).catch((err) => {
    console.error('sessionSaveWindow failed:', err);
  });
}

/**
 * Schedule a per-window session save after SESSION_DEBOUNCE_MS of idle.
 * Coalesces rapid calls into a single save with the latest WindowSession.
 */
export function scheduleSessionSave(state: WindowSession): void {
  pendingState = state;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(fire, SESSION_DEBOUNCE_MS);
}

/** Run any pending save right now. Resolves once the save IPC completes. */
export async function flushSessionSave(): Promise<void> {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  if (!pendingState) return;
  const state = pendingState;
  pendingState = undefined;
  await sessionSaveWindow(state.label, state);
}
