import { useEffect, useRef } from 'react';
import type { Encoding } from '../stores/buffers';

const OPTIONS: { value: Encoding; label: string }[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-8-bom', label: 'UTF-8 BOM' },
  { value: 'utf-16-le', label: 'UTF-16 LE' },
  { value: 'utf-16-be', label: 'UTF-16 BE' },
];

interface Props {
  current: Encoding;
  anchorRect: DOMRect;
  onSelect: (next: Encoding) => void;
  onClose: () => void;
}

export function EncodingPopover({ current, anchorRect, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: anchorRect.left, bottom: window.innerHeight - anchorRect.top + 4 }}
      className="fixed z-50 min-w-[140px] rounded border border-neutral-700 bg-neutral-900 py-1 text-xs text-neutral-200 shadow-lg"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => { onSelect(opt.value); onClose(); }}
          className={
            'block w-full px-3 py-1.5 text-left hover:bg-neutral-800 '
            + (opt.value === current ? 'text-amber-400' : '')
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
