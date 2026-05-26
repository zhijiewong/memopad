import { useEffect, useRef, useState } from 'react';
import { search, type SearchMatch } from '../commands/registry';

interface Props {
  onClose: () => void;
  onRun: (id: string) => void;
}

export function CommandPalette({ onClose, onRun }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches: SearchMatch[] = search(query).slice(0, 20);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, matches.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const m = matches[selectedIdx];
      if (m) {
        onRun(m.command.id);
        onClose();
      }
      return;
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Command Palette"
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-24"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[520px] max-w-[80vw] overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Type a command…"
          className="w-full border-b border-neutral-800 bg-transparent px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
        />
        <ul className="max-h-[360px] overflow-y-auto py-1" role="listbox">
          {matches.length === 0 && (
            <li className="px-4 py-3 text-xs text-neutral-500">No matching commands</li>
          )}
          {matches.map((m, i) => {
            const isSelected = i === selectedIdx;
            return (
              <li
                key={m.command.id}
                role="option"
                aria-selected={isSelected}
                data-command-id={m.command.id}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => { onRun(m.command.id); onClose(); }}
                className={
                  'flex cursor-pointer items-center justify-between px-4 py-1.5 text-sm '
                  + (isSelected ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300')
                }
              >
                <span>{m.command.title}</span>
                {m.command.shortcut && (
                  <span className="text-xs text-neutral-500">{m.command.shortcut}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
