import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';
import { walkFiles, openFile } from '../lib/tauri';
import { rankPaths, type FuzzyMatch } from '../lib/quick-open';

interface Props {
  onClose: () => void;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(0, i) : '';
}

function relativeTo(workspace: string, p: string): string {
  if (!workspace) return p;
  const sep = workspace.includes('/') ? '/' : '\\';
  const base = workspace.endsWith(sep) ? workspace : workspace + sep;
  return p.toLowerCase().startsWith(base.toLowerCase()) ? p.slice(base.length) : p;
}

export function QuickOpenPalette({ onClose }: Props) {
  const workspaceFolder = useWorkspace((s) => s.workspaceFolder);
  const openFolder = useWorkspace((s) => s.openFolder);

  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!workspaceFolder) return;
    walkFiles(workspaceFolder)
      .then((resp) => {
        setFiles(resp.files);
        setTruncated(resp.truncated);
      })
      .catch((err) => setError((err as Error).message));
  }, [workspaceFolder]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const recentPaths = useMemo(() => {
    const open = useBuffers.getState().buffers.map((b) => b.path).filter((p): p is string => !!p);
    const closed = useBuffers.getState().recentlyClosed.map((b) => b.path).filter((p): p is string => !!p);
    return Array.from(new Set([...open, ...closed]));
  }, []);

  const matches: FuzzyMatch[] = useMemo(() => {
    if (!files) return [];
    return rankPaths(files, query, recentPaths);
  }, [files, query, recentPaths]);

  useEffect(() => { setSelected(0); }, [matches]);

  async function openPicked(path: string) {
    try {
      const existing = useBuffers.getState().buffers.find((b) => b.path === path);
      if (existing) {
        useBuffers.getState().setFocusedBuffer(existing.id);
      } else {
        const opened = await openFile(path);
        const newId = useBuffers.getState().openBuffer(opened);
        useBuffers.getState().setFocusedBuffer(newId);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(matches.length - 1, s + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const m = matches[selected];
      if (m) openPicked(m.path);
      return;
    }
  }

  return (
    <div
      data-testid="quick-open-overlay"
      className="fixed inset-0 z-40 bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyDown}
    >
      <div
        data-testid="quick-open-palette"
        className="mx-auto mt-24 w-[640px] max-w-[90vw] rounded border border-neutral-700 bg-neutral-900 shadow-xl"
      >
        {!workspaceFolder ? (
          <div className="p-4 text-sm text-neutral-300">
            <p className="mb-3">Open a folder first.</p>
            <button
              type="button"
              onClick={() => { openFolder().catch(() => {}); onClose(); }}
              className="rounded bg-neutral-700 px-3 py-1 text-neutral-100 hover:bg-neutral-600"
            >
              Open folder…
            </button>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              data-testid="quick-open-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Go to file…"
              className="w-full rounded-t bg-transparent px-4 py-3 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
            />
            {error && <div data-testid="quick-open-error" className="border-t border-neutral-700 px-4 py-2 text-xs text-red-400">{error}</div>}
            {files === null && !error && (
              <div className="border-t border-neutral-700 p-4 text-xs text-neutral-500">Loading…</div>
            )}
            {files !== null && matches.length === 0 && (
              <div className="border-t border-neutral-700 p-4 text-xs text-neutral-500">No matches.</div>
            )}
            {matches.length > 0 && (
              <ul role="listbox" className="max-h-[60vh] overflow-auto border-t border-neutral-700">
                {matches.map((m, i) => (
                  <li key={m.path}>
                    <button
                      type="button"
                      role="option"
                      data-testid="quick-open-row"
                      data-selected={i === selected}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => openPicked(m.path)}
                      className={`block w-full truncate px-4 py-1.5 text-left text-xs ${
                        i === selected ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-800'
                      }`}
                      title={m.path}
                    >
                      <span className="font-semibold">{basename(m.path)}</span>
                      <span className="ml-2 text-neutral-500">{relativeTo(workspaceFolder, dirname(m.path))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {truncated && (
              <div className="border-t border-neutral-700 px-4 py-1 text-xs text-amber-400">
                Showing first 10,000 files — refine your query.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
