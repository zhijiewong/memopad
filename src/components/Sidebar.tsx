import { useWorkspace } from '../stores/workspace';
import { SearchPanel } from './SearchPanel';

interface Props {
  open: boolean;
  onOpenFolder: () => void;
}

export function Sidebar({ open, onOpenFolder }: Props) {
  const folder = useWorkspace((s) => s.workspaceFolder);
  if (!open) return null;
  return (
    <aside
      data-testid="sidebar"
      className="flex w-[280px] shrink-0 flex-col border-r border-neutral-700 bg-neutral-900 text-neutral-200"
    >
      <div className="border-b border-neutral-700 px-3 py-2 text-xs uppercase tracking-wide text-neutral-400">
        Search
      </div>
      {folder ? (
        <SearchPanel />
      ) : (
        <div className="flex flex-1 flex-col items-start gap-3 p-4 text-sm text-neutral-400">
          <p>Open a folder to search across files.</p>
          <button
            type="button"
            onClick={onOpenFolder}
            className="rounded bg-neutral-700 px-3 py-1 text-neutral-100 hover:bg-neutral-600"
          >
            Open folder…
          </button>
        </div>
      )}
    </aside>
  );
}
