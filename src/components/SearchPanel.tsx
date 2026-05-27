import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { openFile as openFileIpc } from '../lib/tauri';
import { useBuffers } from '../stores/buffers';
import type { FindOptions, FindResponse, FileMatch, LineMatch } from '../lib/tauri';

const DEBOUNCE_MS = 200;

export function SearchPanel() {
  const folder = useWorkspace((s) => s.workspaceFolder);
  const results = useWorkspace((s) => s.results);
  const inFlight = useWorkspace((s) => s.inFlight);
  const runSearch = useWorkspace((s) => s.runSearch);
  const closeFolder = useWorkspace((s) => s.closeFolder);

  const [query, setQuery] = useState('');
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
      <div className="flex items-center gap-2 border-b border-neutral-700 px-3 py-2">
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
      <ResultsBody inFlight={inFlight} results={results} />
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

function ResultsBody({ inFlight, results }: { inFlight: boolean; results: FindResponse | null }) {
  if (inFlight && !results) return <div className="p-3 text-xs text-neutral-500">Searching…</div>;
  if (!results) return <div className="p-3 text-xs text-neutral-500">Type to search.</div>;
  if (results.error) return <div data-testid="search-error" className="p-3 text-xs text-red-400">{results.error}</div>;
  if (results.files.length === 0) return <div className="p-3 text-xs text-neutral-500">No matches.</div>;

  const total = results.files.reduce((n, f) => n + f.matches.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-auto">
        {results.files.map((f) => (
          <FileGroup key={f.path} file={f} />
        ))}
      </div>
      <div
        data-testid="search-status"
        className={`border-t border-neutral-700 px-3 py-1 text-xs ${
          results.truncated ? 'text-amber-400' : 'text-neutral-500'
        }`}
      >
        {results.truncated
          ? `${total.toLocaleString()}+ matches — refine your query`
          : `${total.toLocaleString()} match${total === 1 ? '' : 'es'} in ${results.files.length} file${results.files.length === 1 ? '' : 's'}`}
      </div>
    </div>
  );
}

function FileGroup({ file }: { file: FileMatch }) {
  const short = file.path.split(/[/\\]/).pop() ?? file.path;
  return (
    <div className="border-b border-neutral-800">
      <div className="truncate px-3 py-1 text-xs text-neutral-400" title={file.path}>{short}</div>
      <ul>
        {file.matches.map((m, i) => (
          <li key={i}>
            <ResultRow path={file.path} match={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultRow({ path, match }: { path: string; match: LineMatch }) {
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
      <Snippet text={match.line_text} ranges={match.match_ranges} />
    </button>
  );
}

function Snippet({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (ranges.length === 0) return <span>{text}</span>;
  const parts: import('react').ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([s, e], i) => {
    if (s > cursor) parts.push(<span key={`p${i}`}>{text.slice(cursor, s)}</span>);
    parts.push(<mark key={`m${i}`} className="bg-amber-400/30 text-amber-200">{text.slice(s, e)}</mark>);
    cursor = e;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}
