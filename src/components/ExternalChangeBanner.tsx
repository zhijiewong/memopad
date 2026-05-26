import { useBuffers, selectActive } from '../stores/buffers';
import { openFile, statFile } from '../lib/tauri';

export function ExternalChangeBanner() {
  const active = useBuffers(selectActive);
  if (!active || !active.externalChange || !active.path) return null;

  const onReload = async () => {
    try {
      const opened = await openFile(active.path!);
      const stat = await statFile(active.path!).catch(() => null);
      // Replace the buffer's content while keeping the same id.
      useBuffers.getState().openRestored({
        bufferId: active.id,
        path: opened.path,
        content: opened.content,
        encoding: opened.encoding,
        eol: opened.eol,
        dirty: false,
      });
      // openRestored appended a SECOND buffer with the same id; remove the original.
      // closeBuffer matches by id and removes the FIRST match (which is the stale one we want gone).
      useBuffers.getState().closeBuffer(active.id);
      if (stat) {
        useBuffers.getState().recordStat(active.id, stat);
      }
      useBuffers.getState().setExternalChange(active.id, false);
    } catch (err) {
      console.error('reload failed:', err);
    }
  };

  const onKeepMine = async () => {
    if (!active.path) return;
    try {
      const stat = await statFile(active.path);
      useBuffers.getState().recordStat(active.id, stat);
    } catch { /* ignore */ }
    useBuffers.getState().setExternalChange(active.id, false);
  };

  return (
    <div
      role="status"
      data-external-change-banner
      className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200"
    >
      <span>This file changed on disk since you opened it.</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReload}
          className="rounded border border-amber-500/50 px-2 py-0.5 hover:bg-amber-500/20"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          className="rounded border border-neutral-600 px-2 py-0.5 hover:bg-neutral-800"
        >
          Keep mine
        </button>
        <button
          type="button"
          disabled
          title="Diff view ships in Phase 5"
          className="cursor-not-allowed rounded border border-neutral-700 px-2 py-0.5 text-neutral-500"
        >
          Diff
        </button>
      </div>
    </div>
  );
}
