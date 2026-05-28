import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { openFile as openFileIpc } from '../lib/tauri';
import { useBuffers } from '../stores/buffers';
import type { FindOptions, FindResponse, FileMatch, LineMatch } from '../lib/tauri';
import { ReplaceConfirmDialog } from './ReplaceConfirmDialog';

const DEBOUNCE_MS = 200;

export function SearchPanel() {
  const folder = useWorkspace((s) => s.workspaceFolder);
  const results = useWorkspace((s) => s.results);
  const inFlight = useWorkspace((s) => s.inFlight);
  const runSearch = useWorkspace((s) => s.runSearch);
  const closeFolder = useWorkspace((s) => s.closeFolder);

  const [query, setQuery] = useState('');
  const [replace, setReplace] = useState('');
  const [replaceVisible, setReplaceVisible] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opts, setOpts] = useState<FindOptions>({
    regex: false, case_sensitive: false, whole_word: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      runSearch(query, opts).catch(() => {});
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query, opts, runSearch]);

  useEffect(() => {
    (window as unknown as { __memopadFocusFindInFiles?: () => void }).__memopadFocusFindInFiles = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
  }, []);

  return (
    <div data-testid="search-panel" className="flex flex-1 flex-col">
      <div className="flex flex-col gap-1 border-b border-neutral-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="replace-toggle"
            onClick={() => setReplaceVisible((v) => !v)}
            title={replaceVisible ? 'Hide replace' : 'Show replace'}
            className="rounded px-1 text-neutral-500 hover:text-neutral-200"
          >↔</button>
          <input
            ref={inputRef}
            data-testid="search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
          />
        </div>
        {replaceVisible && (
          <input
            data-testid="replace-input"
            type="text"
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            placeholder="Replace"
            className="ml-6 flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-neutral-500"
          />
        )}
      </div>
      <div className="flex items-center gap-1 border-b border-neutral-700 px-3 py-1 text-xs">
        <Toggle label="Aa" title="Case sensitive" active={opts.case_sensitive}
          onClick={() => setOpts({ ...opts, case_sensitive: !opts.case_sensitive })}
        />
        <Toggle label=".*" title="Regex" active={opts.regex}
          onClick={() => setOpts({ ...opts, regex: !opts.regex })}
        />
        <Toggle label="\b" title="Whole word" active={opts.whole_word}
          onClick={() => setOpts({ ...opts, whole_word: !opts.whole_word })}
        />
        <span className="ml-auto truncate text-neutral-500" title={folder ?? ''}>
          {folder?.split(/[/\\]/).slice(-2).join('/') ?? ''}
        </span>
        <button
          type="button"
          onClick={closeFolder}
          title="Close folder"
          className="rounded px-1 text-neutral-500 hover:text-neutral-200"
        >×</button>
      </div>
      <ResultsBody
        inFlight={inFlight}
        results={results}
        replacement={replace}
        opts={opts}
        showReplaceUI={replaceVisible}
        onReplaceClick={() => setDialogOpen(true)}
      />
      {dialogOpen && (
        <ReplaceConfirmDialog
          replacement={replace}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

function Toggle({ label, title, active, onClick }: { label: string; title: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-active={active}
      className={`rounded px-1.5 py-0.5 font-mono ${
        active
          ? 'bg-neutral-200 text-neutral-900'
          : 'text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100'
      }`}
    >
      {label}
    </button>
  );
}

function ResultsBody({
  inFlight, results, replacement, opts, showReplaceUI, onReplaceClick,
}: {
  inFlight: boolean;
  results: FindResponse | null;
  replacement: string;
  opts: FindOptions;
  showReplaceUI: boolean;
  onReplaceClick: () => void;
}) {
  if (inFlight && !results) return <div className="p-3 text-xs text-neutral-500">Searching…</div>;
  if (!results) return <div className="p-3 text-xs text-neutral-500">Type to search.</div>;
  if (results.error) return <div data-testid="search-error" className="p-3 text-xs text-red-400">{results.error}</div>;
  if (results.files.length === 0) return <div className="p-3 text-xs text-neutral-500">No matches.</div>;

  const total = results.files.reduce((n, f) => n + f.matches.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-auto">
        {results.files.map((f) => (
          <FileGroup
            key={f.path}
            file={f}
            replacement={showReplaceUI ? replacement : undefined}
            opts={opts}
          />
        ))}
      </div>
      <div
        data-testid="search-status"
        className={`flex items-center justify-between gap-2 border-t border-neutral-700 px-3 py-1 text-xs ${
          results.truncated ? 'text-amber-400' : 'text-neutral-500'
        }`}
      >
        <span>
          {results.truncated
            ? `${total.toLocaleString()}+ matches — refine your query`
            : `${total.toLocaleString()} match${total === 1 ? '' : 'es'} in ${results.files.length} file${results.files.length === 1 ? '' : 's'}`}
        </span>
        {showReplaceUI && (
          <button
            type="button"
            data-testid="replace-all"
            onClick={onReplaceClick}
            className="rounded bg-emerald-700 px-2 py-0.5 text-emerald-100 hover:bg-emerald-600"
          >
            Replace All in {results.files.length}
          </button>
        )}
      </div>
    </div>
  );
}

function FileGroup({ file, replacement, opts }: {
  file: FileMatch;
  replacement?: string;
  opts: FindOptions;
}) {
  const short = file.path.split(/[/\\]/).pop() ?? file.path;
  return (
    <div className="border-b border-neutral-800">
      <div className="truncate px-3 py-1 text-xs text-neutral-400" title={file.path}>{short}</div>
      <ul>
        {file.matches.map((m, i) => (
          <li key={i}>
            <ResultRow path={file.path} match={m} replacement={replacement} opts={opts} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultRow({ path, match, replacement, opts: _opts }: {
  path: string;
  match: LineMatch;
  replacement?: string;
  opts: FindOptions;
}) {
  return (
    <button
      type="button"
      data-testid="match-row"
      onClick={async () => {
        const existing = useBuffers.getState().buffers.find((b) => b.path === path);
        if (!existing) {
          try {
            const opened = await openFileIpc(path);
            useBuffers.getState().openBuffer(opened);
          } catch { return; }
        }
        const range: [number, number] = match.match_ranges[0] ?? [0, match.line_text.length];
        useBuffers.getState().openFileAtLine(path, match.line_number, range, match.line_text);
      }}
      className="block w-full cursor-pointer truncate px-6 py-0.5 text-left text-xs hover:bg-neutral-800"
      title={match.line_text}
    >
      <span className="mr-2 text-neutral-500">{match.line_number}:</span>
      <Snippet text={match.line_text} ranges={match.match_ranges} replacement={replacement} />
    </button>
  );
}

function Snippet({ text, ranges, replacement }: {
  text: string;
  ranges: [number, number][];
  replacement?: string;
}) {
  if (ranges.length === 0) return <span>{text}</span>;
  const parts: import('react').ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([s, e], i) => {
    if (s > cursor) parts.push(<span key={`p${i}`}>{text.slice(cursor, s)}</span>);
    const oldSpan = text.slice(s, e);
    if (typeof replacement === 'string') {
      parts.push(<s key={`o${i}`} className="text-neutral-500">{oldSpan}</s>);
      parts.push(<mark key={`n${i}`} className="bg-emerald-500/30 text-emerald-200">{replacement}</mark>);
    } else {
      parts.push(<mark key={`m${i}`} className="bg-amber-400/30 text-amber-200">{oldSpan}</mark>);
    }
    cursor = e;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}
