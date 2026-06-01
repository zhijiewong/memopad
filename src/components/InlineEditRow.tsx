import { useEffect, useRef, useState } from 'react';

interface Props {
  depth: number;
  isDir: boolean;
  initialValue: string;
  /** Resolve to commit + close; reject with an Error to keep the row open and show the message. */
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}

export function InlineEditRow({ depth, isDir, initialValue, onCommit, onCancel }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  async function commit() {
    const name = value.trim();
    if (name === '') { onCancel(); return; }
    setBusy(true);
    try {
      await onCommit(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div style={{ paddingLeft: `${depth * 12 + 6}px` }} className="py-0.5">
      <input
        ref={ref}
        data-testid="inline-edit-input"
        value={value}
        disabled={busy}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => { if (!busy) onCancel(); }}
        className="w-[90%] rounded border border-neutral-600 bg-neutral-800 px-1 text-xs text-neutral-100 outline-none focus:border-blue-500"
        placeholder={isDir ? 'Folder name' : 'File name'}
      />
      {error && (
        <div data-testid="inline-edit-error" className="mt-0.5 text-[11px] text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
