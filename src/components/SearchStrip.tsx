import { useEffect, useRef, useState } from 'react';

export interface SearchStripActions {
  /** Find next match. Returns true if a match exists. */
  findNext: () => boolean;
  /** Find previous match. Returns true if a match exists. */
  findPrev: () => boolean;
  /** Replace current match with replacement. Returns true if a match was replaced. */
  replaceCurrent: () => boolean;
  /** Replace all matches. Returns the number of replacements. */
  replaceAll: () => number;
  /** Update the underlying search query/options. */
  setQuery: (query: string, opts: { regex: boolean; caseSensitive: boolean; replace: string }) => void;
  /** Return current match info: { current: 1-based index or 0, total } */
  matchInfo: () => { current: number; total: number };
  /** Clear all match highlights. */
  clear: () => void;
}

interface Props {
  open: boolean;
  mode: 'find' | 'replace';
  onClose: () => void;
  actions: SearchStripActions | null;
  /** Controlled find query text (lifted to parent for test hooks). */
  query: string;
  onQueryChange: (q: string) => void;
  /** Controlled replace text (lifted to parent for test hooks). */
  replaceText: string;
  onReplaceChange: (r: string) => void;
}

export function SearchStrip({ open, mode, onClose, actions, query, onQueryChange, replaceText, onReplaceChange }: Props) {
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const findInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!actions || !open) return;
    actions.setQuery(query, { regex, caseSensitive, replace: replaceText });
    setMatches(actions.matchInfo());
  }, [query, replaceText, regex, caseSensitive, actions, open]);

  useEffect(() => {
    if (open) findInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open && actions) actions.clear();
  }, [open, actions]);

  if (!open) return null;

  const onFindKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) actions?.findPrev(); else actions?.findNext();
      if (actions) setMatches(actions.matchInfo());
      return;
    }
  };

  const onReplaceKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      actions?.replaceCurrent();
      if (actions) setMatches(actions.matchInfo());
    }
  };

  return (
    <div
      data-search-strip
      className="flex items-center gap-2 border-b px-2 py-1 text-xs"
      style={{ background: 'var(--app-bg-elevated)', borderColor: 'var(--app-border)', color: 'var(--app-fg)' }}
    >
      <input
        ref={findInputRef}
        data-search-find-input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onFindKey}
        placeholder="Find"
        className="flex-1 rounded px-2 py-1 focus:outline-none"
        style={{ background: 'var(--app-bg)', color: 'var(--app-fg)', border: '1px solid var(--app-border)' }}
      />
      {mode === 'replace' && (
        <input
          data-search-replace-input
          value={replaceText}
          onChange={(e) => onReplaceChange(e.target.value)}
          onKeyDown={onReplaceKey}
          placeholder="Replace"
          className="flex-1 rounded px-2 py-1 focus:outline-none"
          style={{ background: 'var(--app-bg)', color: 'var(--app-fg)', border: '1px solid var(--app-border)' }}
        />
      )}
      <span
        data-search-match-count
        className="min-w-[60px] text-right"
        style={{ color: matches.total ? 'var(--app-fg-muted)' : 'var(--app-fg-dim)' }}
      >
        {matches.total === 0 ? 'No matches' : `${matches.current} / ${matches.total}`}
      </span>
      <button
        type="button"
        aria-label="Toggle regex"
        aria-pressed={regex}
        onClick={() => setRegex((v) => !v)}
        className="rounded px-2 py-0.5"
        style={{
          border: '1px solid var(--app-border)',
          background: regex ? 'var(--app-accent)' : 'transparent',
          color: regex ? 'var(--app-accent-text)' : 'var(--app-fg-muted)',
        }}
        title="Regex"
      >
        .*
      </button>
      <button
        type="button"
        aria-label="Toggle case sensitive"
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive((v) => !v)}
        className="rounded px-2 py-0.5"
        style={{
          border: '1px solid var(--app-border)',
          background: caseSensitive ? 'var(--app-accent)' : 'transparent',
          color: caseSensitive ? 'var(--app-accent-text)' : 'var(--app-fg-muted)',
        }}
        title="Case sensitive"
      >
        Aa
      </button>
      {mode === 'replace' && (
        <button
          type="button"
          aria-label="Replace all"
          onClick={() => {
            actions?.replaceAll();
            if (actions) setMatches(actions.matchInfo());
          }}
          className="rounded px-2 py-0.5"
          style={{ border: '1px solid var(--app-border)', color: 'var(--app-fg)' }}
        >
          Replace all
        </button>
      )}
      <button
        type="button"
        aria-label="Close find"
        onClick={onClose}
        className="rounded px-2 py-0.5"
        style={{ color: 'var(--app-fg-muted)' }}
      >
        &times;
      </button>
    </div>
  );
}
