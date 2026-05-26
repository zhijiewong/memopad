import { useState } from 'react';
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
  const reorderBuffer = useBuffers((s) => s.reorderBuffer);

  const [dragId, setDragId] = useState<string | null>(null);

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
      {buffers.map((b, idx) => {
        const isActive = b.id === activeId;
        const isUntitled = b.path === null;
        const fileIdx = isUntitled ? ++untitledCounter : 0;
        const name = fileNameOf(b.path, fileIdx);
        return (
          <div
            key={b.id}
            role="tab"
            aria-selected={isActive}
            data-buffer-id={b.id}
            draggable
            onDragStart={(e) => {
              setDragId(b.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (dragId && dragId !== b.id) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(e) => {
              if (dragId && dragId !== b.id) {
                e.preventDefault();
                reorderBuffer(dragId, idx);
              }
              setDragId(null);
            }}
            onDragEnd={() => setDragId(null)}
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
              + (dragId === b.id ? ' opacity-50' : '')
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
