type Tab = 'files' | 'search';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

export function SidebarTabs({ active, onChange }: Props) {
  return (
    <div className="flex items-center border-b border-neutral-700">
      <TabButton label="Files" active={active === 'files'} onClick={() => onChange('files')} />
      <TabButton label="Search" active={active === 'search'} onClick={() => onChange('search')} />
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`sidebar-tab-${label.toLowerCase()}`}
      data-active={active}
      className={`flex-1 px-3 py-2 text-xs uppercase tracking-wide ${
        active
          ? 'text-neutral-200 border-b-2 border-neutral-200'
          : 'text-neutral-500 border-b-2 border-transparent hover:text-neutral-300'
      }`}
    >
      {label}
    </button>
  );
}
