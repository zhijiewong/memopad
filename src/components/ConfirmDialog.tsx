import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    // Enter is handled by the focused confirm button's native activation — do
    // NOT also bind Enter here, or onConfirm fires twice (global listener +
    // native button click). The global listener only owns Escape.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="min-w-[320px] rounded border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-200 shadow-xl">
        <h2 className="mb-2 font-medium">{title}</h2>
        <p className="mb-4 text-neutral-400">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            className="rounded bg-red-700 px-3 py-1 text-white hover:bg-red-600"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
