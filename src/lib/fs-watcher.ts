import { listen } from '@tauri-apps/api/event';
import { watchStart, watchStop, type FsEventPayload } from './tauri';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';

let unlistenEvent: (() => void) | null = null;
let unlistenError: (() => void) | null = null;

function dirname(p: string): string {
  const lastFwd = p.lastIndexOf('/');
  const lastBwd = p.lastIndexOf('\\');
  const idx = Math.max(lastFwd, lastBwd);
  return idx > 0 ? p.slice(0, idx) : p;
}

export function handleEvent(e: FsEventPayload) {
  const ws = useWorkspace.getState();
  const parent = dirname(e.path);
  const isRootOrExpandedAndCached =
    ws.workspaceFolder !== null &&
    (parent === ws.workspaceFolder || ws.expanded.has(parent)) &&
    ws.childrenByPath.has(parent);
  if (isRootOrExpandedAndCached) {
    ws.refreshSubtree(parent).catch(() => {});
  }
  if (e.kind === 'modify' || e.kind === 'create') {
    const buf = useBuffers.getState().buffers.find((b) => b.path === e.path);
    if (buf && !buf.dirty) {
      useBuffers.getState().setExternalChange(buf.id, true);
    }
  }
}

export async function startFsWatcher(folder: string): Promise<void> {
  await stopFsWatcher();
  await watchStart(folder);
  const u1 = await listen<FsEventPayload>('fs:event', (ev) => handleEvent(ev.payload));
  const u2 = await listen<{ message: string }>('fs:error', (ev) => {
    useWorkspace.getState().setWatcherError(ev.payload.message);
  });
  unlistenEvent = u1;
  unlistenError = u2;
  useWorkspace.getState().setWatcherError(null);
}

export async function stopFsWatcher(): Promise<void> {
  if (unlistenEvent) { unlistenEvent(); unlistenEvent = null; }
  if (unlistenError) { unlistenError(); unlistenError = null; }
  await watchStop().catch(() => {});
}
