import { useEffect, useState } from 'react';
import { checkForUpdate, type AvailableUpdate } from '../lib/updater';

export function UpdateBanner() {
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const upd = await checkForUpdate();
      if (!cancelled) setAvailable(upd);
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  if (!available || dismissed) return null;

  return (
    <div
      role="status"
      data-update-banner
      className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-xs"
      style={{
        background: 'var(--app-bg-elevated)',
        borderColor: 'var(--app-border)',
        color: 'var(--app-fg)',
      }}
    >
      <span>
        Memopad <strong>{available.version}</strong> is available.
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={installing}
          onClick={async () => {
            setInstalling(true);
            try {
              await available.installAndRelaunch();
            } catch (err) {
              console.error('update install failed:', err);
              setInstalling(false);
            }
          }}
          className="rounded border px-2 py-0.5 disabled:opacity-50"
          style={{
            borderColor: 'var(--app-accent)',
            background: 'var(--app-accent)',
            color: 'var(--app-accent-text)',
          }}
        >
          {installing ? 'Installing…' : 'Install and relaunch'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded border px-2 py-0.5"
          style={{ borderColor: 'var(--app-border)', color: 'var(--app-fg-muted)' }}
        >
          Later
        </button>
      </div>
    </div>
  );
}
