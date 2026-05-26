import { sessionSave, type SessionState } from './tauri';

export const SESSION_DEBOUNCE_MS = 500;

let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let pendingState: SessionState | undefined;

function fire() {
  if (!pendingState) return;
  const state = pendingState;
  pendingState = undefined;
  pendingTimer = undefined;
  sessionSave(state).catch((err) => {
    console.error('sessionSave failed:', err);
  });
}

/** Schedule a session save after SESSION_DEBOUNCE_MS of idle. Coalesces. */
export function scheduleSessionSave(state: SessionState): void {
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
  await sessionSave(state);
}
