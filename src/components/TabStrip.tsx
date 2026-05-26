import { useBuffers } from '../stores/buffers';

function fileNameOf(path: string | null, untitledIndex: number): string {
  if (!path) return `Untitled${untitledIndex > 1 ? ' ' + untitledIndex : ''}`;
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function TabStrip() {
  const buffers = useBuffers((s) => s.buffers);
  const activeId = useBuffers((s) => s.activeId);
  const switchTo = useBuffers((s) => s.switchTo);
  const closeBuffer = useBuffers((s) => s.closeBuffer);

  if (buffers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs tracking-wide text-neutral-500">
        Memopad
      </div>
    );
  }

  let untitledCounter = 0;

  return (
    <div className="flex h-full items-stretch overflow-x-auto">
      {buffers.map((b) => {
        const isActive = b.id === activeId;
        const isUntitled = b.path === null;
        const idx = isUntitled ? ++untitledCounter : 0;
        const name = fileNameOf(b.path, idx);
        return (
          <div
            key={b.id}
            role="tab"
            aria-selected={isActive}
            data-buffer-id={b.id}
            onClick={() => switchTo(b.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeBuffer(b.id);
              }
            }}
            className={
              'group flex h-full max-w-[200px] cursor-pointer items-center gap-1 border-r border-neutral-800 px-3 text-xs '
              + (isActive
                ? 'bg-neutral-950 text-neutral-100 shadow-[inset_0_-2px_0_0_theme(colors.amber.400)]'
                : 'text-neutral-400 hover:bg-neutral-800/60')
            }
            title={b.path ?? name}
          >
            <span className="truncate">{name}</span>
            {b.dirty && (
              <span aria-label="Unsaved changes" className="text-amber-400">●</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
