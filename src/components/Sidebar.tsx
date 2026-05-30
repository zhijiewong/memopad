import { useEffect, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { SearchPanel } from './SearchPanel';
import { FileTreePanel } from './FileTreePanel';
import { SidebarTabs } from './SidebarTabs';

interface Props {
  open: boolean;
  onOpenFolder: () => void;
}

type Tab = 'files' | 'search';

export function Sidebar({ open, onOpenFolder }: Props) {
  const folder = useWorkspace((s) => s.workspaceFolder);
  const [activeTab, setActiveTab] = useState<Tab>('files');

  useEffect(() => {
    (window as unknown as { __memopadToggleSidebarTab?: () => void }).__memopadToggleSidebarTab = () => {
      setActiveTab((t) => (t === 'files' ? 'search' : 'files'));
    };
    (window as unknown as { __memopadShowSearchPanel?: () => void }).__memopadShowSearchPanel = () => {
      setActiveTab('search');
    };
    (window as unknown as { __memopadShowFilesPanel?: () => void }).__memopadShowFilesPanel = () => {
      setActiveTab('files');
    };
  }, []);

  if (!open) return null;
  return (
    <aside
      data-testid="sidebar"
      className="flex w-[280px] shrink-0 flex-col border-r border-neutral-700 bg-neutral-900 text-neutral-200"
    >
      <SidebarTabs active={activeTab} onChange={setActiveTab} />
      {folder ? (
        activeTab === 'files' ? <FileTreePanel /> : <SearchPanel />
      ) : (
        <div className="flex flex-1 flex-col items-start gap-3 p-4 text-sm text-neutral-400">
          <p>Open a folder to browse and search.</p>
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
