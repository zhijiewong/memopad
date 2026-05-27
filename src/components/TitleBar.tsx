import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TabStrip } from './TabStrip';

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

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
    <div
      className="drag-region flex h-9 select-none items-center justify-between border-b"
      style={{ background: 'var(--app-bg)', borderColor: 'var(--app-border)', color: 'var(--app-fg-muted)' }}
    >
      <button
        type="button"
        className="no-drag flex h-full w-9 items-center justify-center text-base"
        style={{ color: 'var(--app-fg-muted)' }}
        aria-label="App menu"
      >
        ≡
      </button>
      <button
        type="button"
        title="Toggle sidebar (Ctrl+B)"
        data-testid="sidebar-toggle"
        onClick={() => (window as unknown as { __memopadToggleSidebar?: () => void }).__memopadToggleSidebar?.()}
        className="no-drag flex h-full w-9 items-center justify-center text-sm hover:bg-neutral-800"
        style={{ color: 'var(--app-fg-muted)' }}
        aria-label="Toggle sidebar"
      >
        ☰
      </button>

      <div className="no-drag flex-1 overflow-hidden">
        <TabStrip />
      </div>

      <div className="no-drag flex h-full">
        <button
          type="button"
          aria-label="Minimize"
          className="flex h-full w-11 items-center justify-center hover:opacity-70"
          onClick={() => invoke('window_minimize').catch(console.error)}
        >
          &#x2013;
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          className="flex h-full w-11 items-center justify-center hover:opacity-70"
          onClick={() => invoke('window_toggle_maximize').catch(console.error)}
        >
          {maximized ? '❐' : '☐'}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="flex h-full w-11 items-center justify-center hover:text-white"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--app-danger)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
          onClick={() => invoke('window_close').catch(console.error)}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
