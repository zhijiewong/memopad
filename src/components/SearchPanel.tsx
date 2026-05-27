import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import type { FindOptions } from '../lib/tauri';

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

function ResultsBody({ inFlight, results }: { inFlight: boolean; results: import('../lib/tauri').FindResponse | null }) {
  if (inFlight && !results) return <div className="p-3 text-xs text-neutral-500">Searching…</div>;
  if (!results) return <div className="p-3 text-xs text-neutral-500">Type to search.</div>;
  return <div className="p-3 text-xs text-neutral-500">{results.files.length} files</div>;
}
