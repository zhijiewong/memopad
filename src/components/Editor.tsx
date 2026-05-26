import { useCallback, useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  setSearchQuery as cmSetSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  getSearchQuery,
  search,
} from '@codemirror/search';
import { useBuffers, selectActive } from '../stores/buffers';
import { languageForPath } from '../lib/language';
import { useTheme, effectiveTheme } from '../stores/theme';
import { memopadDark } from '../editor/memopad-dark';
import { memopadLight } from '../editor/memopad-light';
import { ExternalChangeBanner } from './ExternalChangeBanner';
import { SearchStrip, type SearchStripActions } from './SearchStrip';

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' },
  '.cm-content': { padding: '8px 0' },
});

interface SearchPanelState {
  open: boolean;
  mode: 'find' | 'replace';
}

declare global {
  // eslint-disable-next-line no-var
  var __memopadSearchPanel: {
    open: (mode: 'find' | 'replace') => void;
    close: () => void;
    /** Test-only: set the find query text directly (bypasses DOM input). */
    setFindQuery: (q: string) => void;
    /** Test-only: set the replace text directly (bypasses DOM input). */
    setReplaceQuery: (q: string) => void;
    /**
     * Test-only: directly apply a search query to the CM view (bypasses React
     * effect scheduling) and return current match count. Useful when React
     * effect chain timing is unpredictable in the WebDriver context.
     */
    applySearch: (find: string, replace: string) => { current: number; total: number };
    /** Test-only: run replaceAll on the CM view. */
    runReplaceAll: () => number;
  } | undefined;
}

export function Editor() {
  const active = useBuffers(selectActive);
  const setActiveContent = useBuffers((s) => s.setActiveContent);
  const themeMode = useTheme((s) => s.mode);
  const themeExt = effectiveTheme(themeMode) === 'dark' ? memopadDark : memopadLight;

  const viewRef = useRef<EditorView | null>(null);
  const [searchPanel, setSearchPanel] = useState<SearchPanelState>({ open: false, mode: 'find' });
  const [searchFindText, setSearchFindText] = useState('');
  const [searchReplaceText, setSearchReplaceText] = useState('');

  const cursorWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistCursor = useCallback((nextCursor: number, nextScrollTop: number) => {
    if (!active) return;
    if (cursorWriteTimer.current) clearTimeout(cursorWriteTimer.current);
    cursorWriteTimer.current = setTimeout(() => {
      useBuffers.getState().setCursor(active.id, nextCursor);
      useBuffers.getState().setScrollTop(active.id, nextScrollTop);
    }, 150);
  }, [active]);

  useEffect(() => {
    globalThis.__memopadSearchPanel = {
      open: (mode) => setSearchPanel({ open: true, mode }),
      close: () => setSearchPanel((s) => ({ ...s, open: false })),
      setFindQuery: (q) => setSearchFindText(q),
      setReplaceQuery: (q) => setSearchReplaceText(q),
      applySearch: (find, replace) => {
        const v = viewRef.current;
        if (!v) return { current: 0, total: 0 };
        const sq = new SearchQuery({ search: find, replace, regexp: false, caseSensitive: false });
        v.dispatch({ effects: cmSetSearchQuery.of(sq) });
        // Also update React state so the UI shows the correct values
        setSearchFindText(find);
        setSearchReplaceText(replace);
        return computeMatchInfo(v);
      },
      runReplaceAll: () => {
        const v = viewRef.current;
        if (!v) return 0;
        const before = countMatches(v);
        replaceAll(v);
        return before;
      },
    };
    return () => {
      globalThis.__memopadSearchPanel = undefined;
    };
  }, []);

  const actions: SearchStripActions = {
    findNext: () => {
      const v = viewRef.current;
      if (!v) return false;
      return findNext(v);
    },
    findPrev: () => {
      const v = viewRef.current;
      if (!v) return false;
      return findPrevious(v);
    },
    replaceCurrent: () => {
      const v = viewRef.current;
      if (!v) return false;
      return replaceNext(v);
    },
    replaceAll: () => {
      const v = viewRef.current;
      if (!v) return 0;
      const before = countMatches(v);
      replaceAll(v);
      return before;
    },
    setQuery: (query, opts) => {
      const v = viewRef.current;
      if (!v) return;
      v.dispatch({
        effects: cmSetSearchQuery.of(
          new SearchQuery({
            search: query,
            replace: opts.replace,
            regexp: opts.regex,
            caseSensitive: opts.caseSensitive,
          }),
        ),
      });
    },
    matchInfo: () => {
      const v = viewRef.current;
      if (!v) return { current: 0, total: 0 };
      return computeMatchInfo(v);
    },
    clear: () => {
      const v = viewRef.current;
      if (!v) return;
      v.dispatch({
        effects: cmSetSearchQuery.of(new SearchQuery({ search: '' })),
      });
    },
  };

  const closePanel = useCallback(() => {
    setSearchPanel((s) => ({ ...s, open: false }));
  }, []);

  useEffect(() => {
    return () => {
      if (cursorWriteTimer.current) clearTimeout(cursorWriteTimer.current);
    };
  }, []);

  if (!active) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: 'var(--app-fg-dim)' }}>
        Ctrl+O to open · Ctrl+N to start typing
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <ExternalChangeBanner />
      <SearchStrip
        open={searchPanel.open}
        mode={searchPanel.mode}
        onClose={closePanel}
        actions={searchPanel.open ? actions : null}
        query={searchFindText}
        onQueryChange={setSearchFindText}
        replaceText={searchReplaceText}
        onReplaceChange={setSearchReplaceText}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirror
          key={active.id}
          value={active.content}
          height="100%"
          style={{ height: '100%' }}
          extensions={[
            editorTheme,
            themeExt,
            search(),
            ...languageForPath(active.path),
          ]}
          onChange={setActiveContent}
          onCreateEditor={(view) => {
            viewRef.current = view;
            // Restore cursor + scroll if we have saved positions.
            if (active && active.cursor != null) {
              const docLen = view.state.doc.length;
              const safe = Math.min(active.cursor, docLen);
              view.dispatch({ selection: { anchor: safe, head: safe } });
            }
            if (active && active.scrollTop != null) {
              // Defer one frame so the editor has laid out.
              requestAnimationFrame(() => {
                view.scrollDOM.scrollTop = active.scrollTop ?? 0;
              });
            }
          }}
          onUpdate={(viewUpdate) => {
            if (!viewUpdate.selectionSet && !viewUpdate.geometryChanged) return;
            const head = viewUpdate.state.selection.main.head;
            const scrollTop = viewUpdate.view.scrollDOM.scrollTop;
            persistCursor(head, scrollTop);
          }}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            indentOnInput: true,
          }}
        />
      </div>
    </div>
  );
}

/** Count total matches in the document for the current search query. */
function countMatches(view: EditorView): number {
  const query = getSearchQuery(view.state);
  const text = view.state.doc.toString();
  if (!query.search) return 0;
  try {
    const re = query.regexp
      ? new RegExp(query.search, query.caseSensitive ? 'g' : 'gi')
      : new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), query.caseSensitive ? 'g' : 'gi');
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      count += 1;
      // Guard against infinite loop on zero-width matches (e.g. /^/g).
      if (re.lastIndex === m.index) re.lastIndex += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

/** Compute { current, total } match position for UI display. */
function computeMatchInfo(view: EditorView): { current: number; total: number } {
  const total = countMatches(view);
  if (total === 0) return { current: 0, total: 0 };
  const query = getSearchQuery(view.state);
  if (!query.search) return { current: 0, total };
  const text = view.state.doc.toString();
  const caret = view.state.selection.main.from;
  try {
    const re = query.regexp
      ? new RegExp(query.search, query.caseSensitive ? 'g' : 'gi')
      : new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), query.caseSensitive ? 'g' : 'gi');
    let n = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      n += 1;
      if (m.index >= caret) return { current: n, total };
      if (re.lastIndex === m.index) re.lastIndex += 1;
    }
    return { current: total, total };
  } catch {
    return { current: 0, total };
  }
}
