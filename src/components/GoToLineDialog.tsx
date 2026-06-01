import { useEffect, useRef, useState } from 'react';
import { useBuffers, selectFocused } from '../stores/buffers';
import { useCursorPos } from '../stores/cursorPos';
import { parseGotoLine } from '../lib/cursor';

interface Props {
  onClose: () => void;
}

export function GoToLineDialog({ onClose }: Props) {
  const focused = useBuffers(selectFocused);
  const currentLine = useCursorPos((s) => s.line);
  const totalLines = focused ? focused.content.split('\n').length : 1;

  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(String(currentLine));

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    // Escape closes regardless of where focus is (matches ConfirmDialog). Enter
    // stays input-only so it can't double-fire commit.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function commit() {
    const line = parseGotoLine(value, totalLines);
    if (line == null) return; // keep open on invalid input
    globalThis.__memopadGotoLine?.(line);
    onClose();
  }

  return (
    <div
      data-testid="goto-line-dialog"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-24"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="min-w-[280px] rounded border border-neutral-700 bg-neutral-900 p-3 text-sm text-neutral-200 shadow-xl">
        <label className="mb-2 block text-neutral-400" htmlFor="goto-line-input">
          Go to line (1–{totalLines})
        </label>
        <input
          id="goto-line-input"
          ref={inputRef}
          data-testid="goto-line-input"
          value={value}
          inputMode="numeric"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
          }}
          className="w-full rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-neutral-100 outline-none focus:border-blue-500"
        />
      </div>
    </div>
  );
}
