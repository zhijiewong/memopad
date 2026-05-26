import { useState } from 'react';
import { useBuffers, selectActive } from '../stores/buffers';
import { openFile, statFile } from '../lib/tauri';
import { DiffModal } from './DiffModal';

export function ExternalChangeBanner() {
  const active = useBuffers(selectActive);
  const [diffOpen, setDiffOpen] = useState(false);

  if (!active || !active.externalChange || !active.path) return null;

  const onReload = async () => {
    try {
      const opened = await openFile(active.path!);
      const stat = await statFile(active.path!).catch(() => null);
      useBuffers.getState().replaceBuffer(active.id, {
        path: opened.path,
        content: opened.content,
        encoding: opened.encoding,
        eol: opened.eol,
      });
      if (stat) {
        useBuffers.getState().recordStat(active.id, stat);
      }
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
    <>
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
            className="rounded border px-2 py-0.5 hover:bg-neutral-800"
            style={{ borderColor: 'var(--app-border)' }}
          >
            Keep mine
          </button>
          <button
            type="button"
            onClick={() => setDiffOpen(true)}
            className="rounded border px-2 py-0.5"
            style={{ borderColor: 'var(--app-border)', color: 'var(--app-fg)' }}
          >
            Diff
          </button>
        </div>
      </div>
      {diffOpen && (
        <DiffModal
          bufferPath={active.path}
          bufferContent={active.content}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </>
  );
}
