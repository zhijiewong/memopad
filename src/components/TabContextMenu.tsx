import { useEffect, useRef } from 'react';

export interface TabContextMenuItem {
  label: string;
  enabled: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: TabContextMenuItem[];
  onClose: () => void;
}

export function TabContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-[180px] rounded border border-neutral-700 bg-neutral-900 py-1 text-xs text-neutral-200 shadow-lg"
    >
      {items.map((item, i) => (
        <button
          key={i}
          role="menuitem"
          disabled={!item.enabled}
          onClick={() => {
            if (item.enabled) {
              item.onClick();
              onClose();
            }
          }}
          className="block w-full px-3 py-1.5 text-left enabled:hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-500"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
