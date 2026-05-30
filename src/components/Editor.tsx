import { useState } from 'react';
import { useBuffers, selectFocused } from '../stores/buffers';
import { EditorPane } from './EditorPane';
import { ExternalChangeBanner } from './ExternalChangeBanner';
import { SearchStrip, type SearchStripActions } from './SearchStrip';

interface SearchPanelState {
  open: boolean;
  mode: 'find' | 'replace';
}

export function Editor() {
  const splitActive = useBuffers((s) => s.splitActive);
  const activeId = useBuffers((s) => s.activeId);
  const secondaryId = useBuffers((s) => s.secondaryId);
  const focusedPane = useBuffers((s) => s.focusedPane);
  const setFocusedPane = useBuffers((s) => s.setFocusedPane);

  const focused = useBuffers((s) => selectFocused(s));

  const [searchPanel, setSearchPanel] = useState<SearchPanelState>({ open: false, mode: 'find' });
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [actions, setActions] = useState<SearchStripActions | null>(null);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {focused && focused.externalChange && <ExternalChangeBanner />}
      <SearchStrip
        open={searchPanel.open}
        mode={searchPanel.mode}
        actions={searchPanel.open ? actions : null}
        onClose={() => setSearchPanel((s) => ({ ...s, open: false }))}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        replaceText={replaceText}
        onReplaceChange={setReplaceText}
      />
      {splitActive ? (
        <div data-testid="editor-split" className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 w-full">
            <EditorPane
              bufferId={activeId}
              focused={focusedPane === 'primary'}
              pane="primary"
              inSplit={true}
              onFocus={() => setFocusedPane('primary')}
              onActionsReady={setActions}
              onSearchPanelOpen={(mode) => setSearchPanel({ open: true, mode })}
              onSearchPanelClose={() => setSearchPanel((s) => ({ ...s, open: false }))}
              onSearchFindTextChange={setSearchQuery}
              onSearchReplaceTextChange={setReplaceText}
            />
          </div>
          <div className="w-px bg-neutral-700" />
          <div className="flex flex-1 w-full">
            <EditorPane
              bufferId={secondaryId}
              focused={focusedPane === 'secondary'}
              pane="secondary"
              inSplit={true}
              onFocus={() => setFocusedPane('secondary')}
              onActionsReady={setActions}
              onSearchPanelOpen={(mode) => setSearchPanel({ open: true, mode })}
              onSearchPanelClose={() => setSearchPanel((s) => ({ ...s, open: false }))}
              onSearchFindTextChange={setSearchQuery}
              onSearchReplaceTextChange={setReplaceText}
            />
          </div>
        </div>
      ) : (
        <EditorPane
          bufferId={activeId}
          focused={true}
          pane="primary"
          inSplit={false}
          onFocus={() => {}}
          onActionsReady={setActions}
          onSearchPanelOpen={(mode) => setSearchPanel({ open: true, mode })}
          onSearchPanelClose={() => setSearchPanel((s) => ({ ...s, open: false }))}
          onSearchFindTextChange={setSearchQuery}
          onSearchReplaceTextChange={setReplaceText}
        />
      )}
    </div>
  );
}
