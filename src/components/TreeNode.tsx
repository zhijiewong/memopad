import { useWorkspace } from '../stores/workspace';
import { useBuffers } from '../stores/buffers';
import { openFile as openFileIpc, type DirEntry } from '../lib/tauri';

interface Props {
  entry: DirEntry;
  depth: number;
}

export function TreeNode({ entry, depth }: Props) {
  const expanded = useWorkspace((s) => s.expanded);
  const childrenByPath = useWorkspace((s) => s.childrenByPath);
  const loadingByPath = useWorkspace((s) => s.loadingByPath);
  const toggleExpand = useWorkspace((s) => s.toggleExpand);

  const isOpen = expanded.has(entry.path);
  const kids = childrenByPath.get(entry.path);
  const isLoading = loadingByPath.has(entry.path);

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

  return (
    <>
      <button
        type="button"
        data-testid="tree-row"
        data-depth={depth}
        data-is-dir={entry.is_dir}
        onClick={onClick}
        title={entry.path}
        className="block w-full cursor-pointer truncate text-left text-xs text-neutral-300 hover:bg-neutral-800"
        style={{ paddingLeft: `${depth * 12 + 6}px`, paddingTop: 2, paddingBottom: 2 }}
      >
        <span className="mr-1 inline-block w-3 text-neutral-500">
          {entry.is_dir ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="text-neutral-500">
          {entry.is_dir ? '📁' : '📄'}
        </span>
        <span className="ml-1">{entry.name}</span>
      </button>
      {entry.is_dir && isOpen && (
        <>
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
    </>
  );
}
