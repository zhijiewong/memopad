import { useEffect } from 'react';
import { useWorkspace } from '../stores/workspace';
import { TreeNode } from './TreeNode';
import { InlineEditRow } from './InlineEditRow';
import { ConfirmDialog } from './ConfirmDialog';

export function FileTreePanel() {
  const folder = useWorkspace((s) => s.workspaceFolder);
  const childrenByPath = useWorkspace((s) => s.childrenByPath);
  const loadingByPath = useWorkspace((s) => s.loadingByPath);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);
  const refreshSubtree = useWorkspace((s) => s.refreshSubtree);
  const watcherError = useWorkspace((s) => s.watcherError);
  const editState = useWorkspace((s) => s.editState);
  const setEditState = useWorkspace((s) => s.setEditState);
  const pendingDelete = useWorkspace((s) => s.pendingDelete);
  const setPendingDelete = useWorkspace((s) => s.setPendingDelete);

  useEffect(() => {
    if (!folder) return;
    if (childrenByPath.has(folder)) return;
    if (loadingByPath.has(folder)) return;
    toggleExpand(folder).catch(() => {});
  }, [folder, childrenByPath, loadingByPath, toggleExpand]);

  // e2e test hooks — drive CRUD without simulating the native context menu.
  useEffect(() => {
    const w = window as unknown as {
      __memopadTreeCreate?: (parent: string, name: string, isDir: boolean) => Promise<unknown>;
      __memopadTreeRename?: (path: string, newName: string) => Promise<unknown>;
      __memopadTreeDelete?: (path: string) => Promise<unknown>;
    };
    w.__memopadTreeCreate = (parent, name, isDir) =>
      useWorkspace.getState().createEntry(parent, name, isDir);
    w.__memopadTreeRename = (path, newName) =>
      useWorkspace.getState().renameEntry(path, newName);
    w.__memopadTreeDelete = (path) => useWorkspace.getState().deleteEntry(path);
    return () => {
      delete w.__memopadTreeCreate;
      delete w.__memopadTreeRename;
      delete w.__memopadTreeDelete;
    };
  }, []);

  if (!folder) return null;

  const short = folder.split(/[/\\]/).slice(-2).join('/');
  const kids = childrenByPath.get(folder);
  const rootLoading = loadingByPath.has(folder);
  const isRootCreate = editState?.mode === 'create' && editState.parent === folder;

  return (
    <div data-testid="file-tree-panel" className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-1 text-xs text-neutral-400">
        <span className="truncate" title={folder}>{short}</span>
        <span className="flex items-center gap-1">
          <button
            type="button" title="New File" data-testid="file-tree-new-file"
            onClick={() => setEditState({ mode: 'create', parent: folder, isDir: false })}
            className="rounded px-1 text-neutral-500 hover:text-neutral-200"
          >🖹</button>
          <button
            type="button" title="New Folder" data-testid="file-tree-new-folder"
            onClick={() => setEditState({ mode: 'create', parent: folder, isDir: true })}
            className="rounded px-1 text-neutral-500 hover:text-neutral-200"
          >🗀</button>
          <button
            type="button" title="Refresh" data-testid="file-tree-refresh"
            onClick={() => refreshSubtree(folder).catch(() => {})}
            className="rounded px-1 text-neutral-500 hover:text-neutral-200"
          >↻</button>
        </span>
      </div>
      {watcherError && (
        <div data-testid="fs-watcher-error" className="border-b border-amber-700 bg-amber-900/40 px-3 py-1 text-xs text-amber-200">
          Live updates unavailable — refresh manually.
          <button
            type="button"
            onClick={() => useWorkspace.getState().setWatcherError(null)}
            className="ml-2 text-amber-300 hover:text-amber-100"
          >×</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {isRootCreate && editState?.mode === 'create' && (
          <InlineEditRow
            depth={0}
            isDir={editState.isDir}
            initialValue=""
            onCommit={async (name) => {
              await useWorkspace.getState().createEntry(folder, name, editState.isDir);
              setEditState(null);
            }}
            onCancel={() => setEditState(null)}
          />
        )}
        {rootLoading && !kids && (
          <div className="px-3 py-1 text-xs italic text-neutral-500">Loading…</div>
        )}
        {kids?.map((k) => (
          <TreeNode key={k.path} entry={k} depth={0} />
        ))}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.is_dir ? 'Delete folder' : 'Delete file'}
          message={`Move "${pendingDelete.name}" to the Recycle Bin?`}
          confirmLabel="Move to Recycle Bin"
          onConfirm={() => {
            const target = pendingDelete.path;
            setPendingDelete(null);
            useWorkspace.getState().deleteEntry(target).catch((err) => console.error('delete:', err));
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
