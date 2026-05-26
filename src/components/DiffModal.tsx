import { useEffect, useState } from 'react';
import { openFile } from '../lib/tauri';
import { lineDiff, type DiffRow } from '../lib/diff';

interface Props {
  bufferPath: string;
  bufferContent: string;
  onClose: () => void;
}

export function DiffModal({ bufferPath, bufferContent, onClose }: Props) {
  const [rows, setRows] = useState<DiffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const diskFile = await openFile(bufferPath);
        if (cancelled) return;
        setRows(lineDiff(bufferContent, diskFile.content));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [bufferPath, bufferContent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Diff"
      data-diff-modal
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-8"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex max-h-[80vh] w-[900px] max-w-[90vw] flex-col rounded-md border shadow-2xl"
        style={{ background: 'var(--app-bg)', borderColor: 'var(--app-border)', color: 'var(--app-fg)' }}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-2 text-xs"
          style={{ borderColor: 'var(--app-border)', color: 'var(--app-fg-muted)' }}
        >
          <span>Diff: in-memory (yours) vs on-disk</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-sm"
            style={{ color: 'var(--app-fg-muted)' }}
          >
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2 text-xs">
          {error && <div className="px-2 py-1 text-amber-400">{error}</div>}
          {!rows && !error && <div className="px-2 py-1" style={{ color: 'var(--app-fg-dim)' }}>Loading…</div>}
          {rows && (
            <pre className="m-0 font-mono" style={{ fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
              {rows.map((r, i) => {
                const prefix = r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  ';
                const color =
                  r.type === 'add'
                    ? '#a3c08c'
                    : r.type === 'del'
                    ? '#d97a6c'
                    : 'var(--app-fg-muted)';
                return (
                  <div
                    key={i}
                    data-diff-row-type={r.type}
                    style={{ color }}
                  >
                    {prefix}
                    {r.value || ' '}
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
