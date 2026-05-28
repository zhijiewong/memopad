import { useEffect, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';
import type { ReplaceResponse } from '../lib/tauri';

interface Props {
  replacement: string;
  onClose: () => void;
}

type Phase = 'idle' | 'inFlight' | 'done';

export function ReplaceConfirmDialog({ replacement, onClose }: Props) {
  const results = useWorkspace((s) => s.results);
  const replaceInFiles = useWorkspace((s) => s.replaceInFiles);
  const [phase, setPhase] = useState<Phase>('idle');
  const [response, setResponse] = useState<ReplaceResponse | null>(null);

  const targetPaths = (results?.files ?? []).map((f) => f.path);
  const totalMatches = (results?.files ?? []).reduce((n, f) => n + f.matches.length, 0);
  const totalFiles = results?.files.length ?? 0;

  const dirtyConflicts = useBuffers.getState().buffers.filter(
    (b) => b.dirty && b.path && targetPaths.includes(b.path),
  );

  useEffect(() => {
    if (phase !== 'done' || !response) return;
    const hasErrors = response.results.some((r) => r.error != null);
    if (hasErrors) return;
    const handle = setTimeout(onClose, 1500);
    return () => clearTimeout(handle);
  }, [phase, response, onClose]);

  return (
    <div
      data-testid="replace-confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[420px] rounded border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-200 shadow-xl">
        {dirtyConflicts.length > 0 && phase === 'idle' && (
          <DirtyBlocked dirty={dirtyConflicts} onClose={onClose} />
        )}
        {dirtyConflicts.length === 0 && phase === 'idle' && (
          <ConfirmBody
            totalMatches={totalMatches}
            totalFiles={totalFiles}
            replacement={replacement}
            onCancel={onClose}
            onConfirm={async () => {
              setPhase('inFlight');
              try {
                const resp = await replaceInFiles(replacement);
                setResponse(resp);
                setPhase('done');
              } catch (err) {
                setResponse({
                  results: [{ path: '', matches_replaced: 0, error: (err as Error).message }],
                  total_files_replaced: 0,
                  total_matches_replaced: 0,
                });
                setPhase('done');
              }
            }}
          />
        )}
        {phase === 'inFlight' && (
          <div data-testid="replace-in-flight" className="text-neutral-400">Replacing…</div>
        )}
        {phase === 'done' && response && <SummaryBody response={response} onClose={onClose} />}
      </div>
    </div>
  );
}

function ConfirmBody({
  totalMatches, totalFiles, replacement, onCancel, onConfirm,
}: {
  totalMatches: number;
  totalFiles: number;
  replacement: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const verb = replacement === '' ? 'Delete' : 'Replace';
  return (
    <>
      <p className="mb-4">
        {verb} {totalMatches} {totalMatches === 1 ? 'match' : 'matches'} in {totalFiles} {totalFiles === 1 ? 'file' : 'files'}?
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1 text-neutral-400 hover:bg-neutral-800"
        >Cancel</button>
        <button
          type="button"
          data-testid="replace-confirm-btn"
          onClick={onConfirm}
          className="rounded bg-emerald-700 px-3 py-1 text-emerald-100 hover:bg-emerald-600"
        >{verb}</button>
      </div>
    </>
  );
}

function DirtyBlocked({
  dirty, onClose,
}: {
  dirty: { id: string; path: string | null }[];
  onClose: () => void;
}) {
  return (
    <>
      <p className="mb-2 font-medium">Unsaved changes in:</p>
      <ul data-testid="replace-dirty-list" className="mb-4 ml-4 list-disc text-neutral-300">
        {dirty.map((b) => (
          <li key={b.id}>{(b.path ?? '').split(/[/\\]/).pop()}</li>
        ))}
      </ul>
      <p className="mb-4 text-neutral-400">Save or revert these files first.</p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-neutral-700 px-3 py-1 text-neutral-100 hover:bg-neutral-600"
        >Close</button>
      </div>
    </>
  );
}

function SummaryBody({ response, onClose }: { response: ReplaceResponse; onClose: () => void }) {
  const failures = response.results.filter((r) => r.error != null);
  if (failures.length === 0) {
    return (
      <div data-testid="replace-summary-success" className="text-emerald-300">
        Replaced {response.total_matches_replaced} {response.total_matches_replaced === 1 ? 'match' : 'matches'} in {response.total_files_replaced} {response.total_files_replaced === 1 ? 'file' : 'files'}.
      </div>
    );
  }
  return (
    <>
      <p data-testid="replace-summary-partial" className="mb-2">
        Replaced {response.total_files_replaced}/{response.results.length} files.
      </p>
      <p className="mb-2 text-amber-400">Failed:</p>
      <ul className="mb-4 ml-4 max-h-40 list-disc overflow-auto text-neutral-300">
        {failures.map((r, i) => {
          const name = (r.path || '').split(/[/\\]/).pop() || '(unknown)';
          return <li key={i}>{name}{r.error ? ` (${r.error})` : ''}</li>;
        })}
      </ul>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded bg-neutral-700 px-3 py-1 text-neutral-100 hover:bg-neutral-600"
        >OK</button>
      </div>
    </>
  );
}
