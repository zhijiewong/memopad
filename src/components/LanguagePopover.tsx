import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGES, PLAIN_ID } from '../lib/language';

interface Props {
  /** The effective language id (override-or-detected) to highlight. */
  currentEffectiveId: string;
  /** True when the buffer has an explicit override (so Auto-detect is not active). */
  hasOverride: boolean;
  anchorRect: DOMRect;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}

export function LanguagePopover({ currentEffectiveId, hasOverride, anchorRect, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const items = LANGUAGES.filter((l) => l.id !== PLAIN_ID);
    if (!q) return items;
    return items.filter((l) => l.label.toLowerCase().includes(q) || l.id.includes(q));
  }, [filter]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = matches[0];
      if (first) { onSelect(first.id); onClose(); }
      return;
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: anchorRect.left, bottom: window.innerHeight - anchorRect.top + 4 }}
      className="fixed z-50 flex max-h-[340px] w-[200px] flex-col rounded border border-neutral-700 bg-neutral-900 text-xs text-neutral-200 shadow-lg"
    >
      <input
        ref={inputRef}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={onKey}
        placeholder="Filter languages…"
        className="m-1 rounded border border-neutral-800 bg-transparent px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
      />
      <div className="overflow-y-auto py-1">
        <button
          onClick={() => { onSelect(null); onClose(); }}
          className={'block w-full px-3 py-1.5 text-left hover:bg-neutral-800 ' + (!hasOverride ? 'text-amber-400' : '')}
        >
          Auto-detect
        </button>
        {matches.map((l) => (
          <button
            key={l.id}
            data-lang-id={l.id}
            onClick={() => { onSelect(l.id); onClose(); }}
            className={'block w-full px-3 py-1.5 text-left hover:bg-neutral-800 ' + (l.id === currentEffectiveId ? 'text-amber-400' : '')}
          >
            {l.label}
          </button>
        ))}
        {matches.length === 0 && (
          <div className="px-3 py-1.5 text-neutral-500">No matches</div>
        )}
      </div>
    </div>
  );
}
