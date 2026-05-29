import { useState } from 'react';
import { useBuffers, selectFocusedId } from '../stores/buffers';
import { TabContextMenu } from './TabContextMenu';
import { revealInExplorer } from '../lib/tauri';

function fileNameOf(path: string | null, untitledIndex: number): string {
  if (!path) return `Untitled${untitledIndex > 1 ? ' ' + untitledIndex : ''}`;
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function TabStrip() {
  const buffers = useBuffers((s) => s.buffers);
  const focusedId = useBuffers((s) => selectFocusedId(s));
  const setFocusedBuffer = useBuffers((s) => s.setFocusedBuffer);
  const closeBuffer = useBuffers((s) => s.closeBuffer);
  const reorderBuffer = useBuffers((s) => s.reorderBuffer);

  const [dragId, setDragId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; bufferId: string } | null>(null);

  const closeOthers = (keepId: string) => {
    const ids = useBuffers.getState().buffers.map((b) => b.id);
    for (const id of ids) if (id !== keepId) closeBuffer(id);
  };

  const closeToRight = (fromId: string) => {
    const all = useBuffers.getState().buffers;
    const fromIdx = all.findIndex((b) => b.id === fromId);
    if (fromIdx < 0) return;
    const idsToClose = all.slice(fromIdx + 1).map((b) => b.id);
    for (const id of idsToClose) closeBuffer(id);
  };

  if (buffers.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center text-xs tracking-wide"
        style={{ color: 'var(--app-fg-dim)' }}
      >
        Memopad
      </div>
    );
  }

  let untitledCounter = 0;
  const ctxBuffer = ctx ? buffers.find((b) => b.id === ctx.bufferId) : null;

  return (
    <>
      <div className="flex h-full items-stretch overflow-x-auto">
        {buffers.map((b, idx) => {
          const isActive = b.id === focusedId;
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
              onClick={() => setFocusedBuffer(b.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeBuffer(b.id);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, bufferId: b.id });
              }}
              className={
                'group flex h-full max-w-[200px] cursor-pointer items-center gap-1 border-r px-3 text-xs '
                + (isActive
                  ? 'shadow-[inset_0_-2px_0_0_var(--app-accent)]'
                  : '')
                + (dragId === b.id ? ' opacity-50' : '')
              }
              style={{
                borderColor: 'var(--app-border)',
                background: isActive ? 'var(--app-tab-active-bg)' : undefined,
                color: isActive ? 'var(--app-fg)' : 'var(--app-fg-muted)',
              }}
              title={b.path ?? name}
            >
              <span className="truncate">{name}</span>
              {b.dirty && (
                <span aria-label="Unsaved changes" style={{ color: 'var(--app-accent)' }}>●</span>
              )}
            </div>
          );
        })}
      </div>

      {ctx && ctxBuffer && (
        <TabContextMenu
          x={ctx.x}
          y={ctx.y}
          items={[
            { label: 'Close', enabled: true, onClick: () => closeBuffer(ctx.bufferId) },
            { label: 'Close Others', enabled: buffers.length > 1, onClick: () => closeOthers(ctx.bufferId) },
            {
              label: 'Close to Right',
              enabled: buffers.findIndex((b) => b.id === ctx.bufferId) < buffers.length - 1,
              onClick: () => closeToRight(ctx.bufferId),
            },
            {
              label: 'Copy Path',
              enabled: ctxBuffer.path !== null,
              onClick: () => {
                if (ctxBuffer.path) navigator.clipboard.writeText(ctxBuffer.path).catch(() => {});
              },
            },
            {
              label: 'Reveal in Explorer',
              enabled: ctxBuffer.path !== null,
              onClick: () => {
                if (ctxBuffer.path) revealInExplorer(ctxBuffer.path).catch(console.error);
              },
            },
          ]}
          onClose={() => setCtx(null)}
        />
      )}
    </>
  );
}
