import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useBuffer } from '../stores/buffer';

function fileNameOf(path: string | null): string {
  if (!path) return 'Untitled';
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const path = useBuffer((s) => s.path);
  const dirty = useBuffer((s) => s.dirty);

  useEffect(() => {
    let mounted = true;
    invoke<boolean>('window_is_maximized')
      .then((v) => mounted && setMaximized(v))
      .catch(() => {});

    const unlistenPromise = getCurrentWindow().onResized(async () => {
      const v = await invoke<boolean>('window_is_maximized').catch(() => false);
      if (mounted) setMaximized(v);
    });

    return () => {
      mounted = false;
      unlistenPromise.then((un) => un()).catch(() => {});
    };
  }, []);

  return (
    <div className="drag-region flex h-9 select-none items-center justify-between border-b border-neutral-800 bg-neutral-900 text-neutral-300">
      <button
        type="button"
        className="no-drag flex h-full w-9 items-center justify-center text-base hover:bg-neutral-800"
        aria-label="App menu"
      >
        ≡
      </button>

      <div className="pointer-events-none flex flex-1 items-center justify-center gap-2 text-xs tracking-wide text-neutral-400">
        <span>{fileNameOf(path)}</span>
        {dirty && <span aria-label="Unsaved changes" className="text-amber-400">●</span>}
      </div>

      <div className="no-drag flex h-full">
        <button
          type="button"
          aria-label="Minimize"
          className="flex h-full w-11 items-center justify-center hover:bg-neutral-800"
          onClick={() => invoke('window_minimize').catch(console.error)}
        >
          &#x2013;
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          className="flex h-full w-11 items-center justify-center hover:bg-neutral-800"
          onClick={() => invoke('window_toggle_maximize').catch(console.error)}
        >
          {maximized ? '❐' : '☐'}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="flex h-full w-11 items-center justify-center hover:bg-red-600 hover:text-white"
          onClick={() => invoke('window_close').catch(console.error)}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
