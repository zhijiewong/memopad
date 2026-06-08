import { useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';
import { openFile as openFileIpc, type DirEntry, revealInExplorer } from '../lib/tauri';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { InlineEditRow } from './InlineEditRow';
import { relativeToWorkspace, isInvalidMove } from '../lib/path';

interface Props {
  entry: DirEntry;
  depth: number;
}

export function TreeNode({ entry, depth }: Props) {
  const expanded = useWorkspace((s) => s.expanded);
  const childrenByPath = useWorkspace((s) => s.childrenByPath);
  const loadingByPath = useWorkspace((s) => s.loadingByPath);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);
  const editState = useWorkspace((s) => s.editState);
  const setEditState = useWorkspace((s) => s.setEditState);
  const setPendingDelete = useWorkspace((s) => s.setPendingDelete);
  const dragPath = useWorkspace((s) => s.dragPath);
  const setDragPath = useWorkspace((s) => s.setDragPath);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const isOpen = expanded.has(entry.path);
  const kids = childrenByPath.get(entry.path);
  const isLoading = loadingByPath.has(entry.path);

  const isRenaming = editState?.mode === 'rename' && editState.path === entry.path;
  const isCreateHere = editState?.mode === 'create' && editState.parent === entry.path;

  const onClick = async () => {
    if (entry.is_dir) {
      await toggleExpand(entry.path);
      return;
    }
    const existing = useBuffers.getState().buffers.find((b) => b.path === entry.path);
    if (existing) {
      useBuffers.getState().switchTo(existing.id);
      return;
    }
    try {
      const opened = await openFileIpc(entry.path);
      useBuffers.getState().openBuffer(opened);
    } catch {
      // swallow — existing fs error UI handles the message
    }
  };

  async function beginCreate(isDir: boolean) {
    if (!expanded.has(entry.path)) await toggleExpand(entry.path);
    setEditState({ mode: 'create', parent: entry.path, isDir });
  }

  function buildMenuItems(): ContextMenuItem[] {
    const workspaceFolder = useWorkspace.getState().workspaceFolder ?? '';
    const items: ContextMenuItem[] = [];
    if (entry.is_dir) {
      items.push({ label: 'New File', enabled: true, onClick: () => { void beginCreate(false); } });
      items.push({ label: 'New Folder', enabled: true, onClick: () => { void beginCreate(true); } });
    }
    items.push({ label: 'Rename', enabled: true, onClick: () => setEditState({ mode: 'rename', path: entry.path }) });
    items.push({ label: 'Delete', enabled: true, onClick: () => setPendingDelete(entry) });
    items.push({
      label: 'Reveal in Explorer', enabled: true,
      onClick: () => { revealInExplorer(entry.path).catch((err) => console.error('reveal:', err)); },
    });
    items.push({
      label: 'Copy Path', enabled: true,
      onClick: () => { navigator.clipboard.writeText(entry.path).catch((err) => console.error('clipboard:', err)); },
    });
    items.push({
      label: 'Copy Relative Path', enabled: workspaceFolder !== '',
      onClick: () => {
        const rel = relativeToWorkspace(entry.path, workspaceFolder);
        navigator.clipboard.writeText(rel).catch((err) => console.error('clipboard:', err));
      },
    });
    return items;
  }

  return (
    <>
      {isRenaming ? (
        <InlineEditRow
          depth={depth}
          isDir={entry.is_dir}
          initialValue={entry.name}
          onCommit={async (name) => {
            await useWorkspace.getState().renameEntry(entry.path, name);
            setEditState(null);
          }}
          onCancel={() => setEditState(null)}
        />
      ) : (
        <button
          type="button"
          data-testid="tree-row"
          data-depth={depth}
          data-is-dir={entry.is_dir}
          onClick={onClick}
          onContextMenu={(e) => { e.preventDefault(); setMenuPos({ x: e.clientX, y: e.clientY }); }}
          onKeyDown={(e) => {
            if (e.key === 'F2') { e.preventDefault(); setEditState({ mode: 'rename', path: entry.path }); }
            else if (e.key === 'Delete') { e.preventDefault(); setPendingDelete(entry); }
          }}
          draggable
          onDragStart={(e) => { e.stopPropagation(); setDragPath(entry.path); }}
          onDragEnd={() => setDragPath(null)}
          onDragOver={entry.is_dir ? (e) => {
            if (dragPath && !isInvalidMove(dragPath, entry.path)) {
              e.preventDefault();
              setIsDropTarget(true);
            }
          } : undefined}
          onDragLeave={entry.is_dir ? () => setIsDropTarget(false) : undefined}
          onDrop={entry.is_dir ? (e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDropTarget(false);
            const src = dragPath;
            setDragPath(null);
            if (src && !isInvalidMove(src, entry.path)) {
              useWorkspace.getState().moveEntry(src, entry.path)
                .catch((err) => useWorkspace.getState().setMoveError(String(err?.message ?? err)));
            }
          } : undefined}
          title={entry.path}
          className={`block w-full cursor-pointer truncate text-left text-xs text-neutral-300 hover:bg-neutral-800 ${isDropTarget ? 'bg-blue-900/40 ring-1 ring-inset ring-blue-500' : ''}`}
          style={{ paddingLeft: `${depth * 12 + 6}px`, paddingTop: 2, paddingBottom: 2 }}
        >
          <span className="mr-1 inline-block w-3 text-neutral-500">
            {entry.is_dir ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span className="text-neutral-500">{entry.is_dir ? '📁' : '📄'}</span>
          <span className="ml-1">{entry.name}</span>
        </button>
      )}
      {entry.is_dir && isOpen && (
        <>
          {isCreateHere && editState?.mode === 'create' && (
            <InlineEditRow
              depth={depth + 1}
              isDir={editState.isDir}
              initialValue=""
              onCommit={async (name) => {
                await useWorkspace.getState().createEntry(entry.path, name, editState.isDir);
                setEditState(null);
              }}
              onCancel={() => setEditState(null)}
            />
          )}
          {isLoading && !kids && (
            <div
              data-testid="tree-loading"
              className="px-2 py-0.5 text-xs italic text-neutral-500"
              style={{ paddingLeft: `${(depth + 1) * 12 + 6}px` }}
            >
              Loading…
            </div>
          )}
          {kids?.map((k) => (
            <TreeNode key={k.path} entry={k} depth={depth + 1} />
          ))}
        </>
      )}
      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={buildMenuItems()}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}
