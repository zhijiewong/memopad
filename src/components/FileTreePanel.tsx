import { useEffect } from 'react';
import { useWorkspace } from '../stores/workspace';
import { TreeNode } from './TreeNode';

export function FileTreePanel() {
  const folder = useWorkspace((s) => s.workspaceFolder);
  const childrenByPath = useWorkspace((s) => s.childrenByPath);
  const loadingByPath = useWorkspace((s) => s.loadingByPath);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);
  const refreshSubtree = useWorkspace((s) => s.refreshSubtree);
  const watcherError = useWorkspace((s) => s.watcherError);

  useEffect(() => {
    if (!folder) return;
    if (childrenByPath.has(folder)) return;
    if (loadingByPath.has(folder)) return;
    toggleExpand(folder).catch(() => {});
  }, [folder, childrenByPath, loadingByPath, toggleExpand]);

  if (!folder) return null;

  const short = folder.split(/[/\\]/).slice(-2).join('/');
  const kids = childrenByPath.get(folder);
  const rootLoading = loadingByPath.has(folder);

  return (
    <div data-testid="file-tree-panel" className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-neutral-700 px-3 py-1 text-xs text-neutral-400">
        <span className="truncate" title={folder}>{short}</span>
        <button
          type="button"
          title="Refresh"
          data-testid="file-tree-refresh"
          onClick={() => refreshSubtree(folder).catch(() => {})}
          className="rounded px-1 text-neutral-500 hover:text-neutral-200"
        >↻</button>
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
        {rootLoading && !kids && (
          <div className="px-3 py-1 text-xs italic text-neutral-500">Loading…</div>
        )}
        {kids?.map((k) => (
          <TreeNode key={k.path} entry={k} depth={0} />
        ))}
      </div>
    </div>
  );
}
