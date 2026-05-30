import { useCallback, useEffect, useRef } from 'react';
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
import { useBuffers, selectPaneState } from '../stores/buffers';
import { languageForPath } from '../lib/language';
import { useTheme, effectiveTheme } from '../stores/theme';
import { memopadDark } from '../editor/memopad-dark';
import { memopadLight } from '../editor/memopad-light';
import { type SearchStripActions } from './SearchStrip';

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' },
  '.cm-content': { padding: '8px 0' },
});

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

export interface EditorPaneProps {
  bufferId: string | null;
  focused: boolean;
  pane: 'primary' | 'secondary';
  /** True when rendered as one of two split panes (enables the focus indicator). */
  inSplit: boolean;
  onFocus: () => void;
  onActionsReady: (actions: SearchStripActions | null) => void;
  /** Called by the focused pane to open/close the search panel in the orchestrator. */
  onSearchPanelOpen?: (mode: 'find' | 'replace') => void;
  onSearchPanelClose?: () => void;
  onSearchFindTextChange?: (q: string) => void;
  onSearchReplaceTextChange?: (q: string) => void;
}

export function EditorPane(props: EditorPaneProps) {
  const buffer = useBuffers((s) =>
    props.bufferId == null ? null : s.buffers.find((b) => b.id === props.bufferId) ?? null
  );
  const cursor = useBuffers((s) => selectPaneState(s, props.pane, props.bufferId).cursor);
  const scrollTop = useBuffers((s) => selectPaneState(s, props.pane, props.bufferId).scrollTop);
  const setActiveContent = useBuffers((s) => s.setActiveContent);
  const themeMode = useTheme((s) => s.mode);
  const themeExt = effectiveTheme(themeMode) === 'dark' ? memopadDark : memopadLight;

  const viewRef = useRef<EditorView | null>(null);

  // Keep a stable ref to onActionsReady so the effect below doesn't re-run on every render.
  const onActionsReadyRef = useRef(props.onActionsReady);
  useEffect(() => {
    onActionsReadyRef.current = props.onActionsReady;
  });

  const onSearchPanelOpenRef = useRef(props.onSearchPanelOpen);
  const onSearchPanelCloseRef = useRef(props.onSearchPanelClose);
  const onSearchFindTextChangeRef = useRef(props.onSearchFindTextChange);
  const onSearchReplaceTextChangeRef = useRef(props.onSearchReplaceTextChange);
  useEffect(() => {
    onSearchPanelOpenRef.current = props.onSearchPanelOpen;
    onSearchPanelCloseRef.current = props.onSearchPanelClose;
    onSearchFindTextChangeRef.current = props.onSearchFindTextChange;
    onSearchReplaceTextChangeRef.current = props.onSearchReplaceTextChange;
  });

  const cursorWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistCursor = useCallback((nextCursor: number, nextScrollTop: number) => {
    if (!buffer) return;
    if (cursorWriteTimer.current) clearTimeout(cursorWriteTimer.current);
    cursorWriteTimer.current = setTimeout(() => {
      if (props.pane === 'primary') {
        useBuffers.getState().setCursor(buffer.id, nextCursor);
        useBuffers.getState().setScrollTop(buffer.id, nextScrollTop);
      } else {
        useBuffers.getState().setSecondaryCursor(buffer.id, nextCursor);
        useBuffers.getState().setSecondaryScrollTop(buffer.id, nextScrollTop);
      }
    }, 150);
  }, [buffer, props.pane]);

  const getActions = useCallback((): SearchStripActions => ({
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
  }), []);

  // Notify orchestrator of our actions on mount; clear on unmount.
  useEffect(() => {
    onActionsReadyRef.current(getActions());
    return () => {
      onActionsReadyRef.current(null);
    };
  }, [getActions]);

  // When this pane becomes the focused pane (e.g. via Ctrl+1/Ctrl+2), move real
  // DOM focus into its editor so the cursor and subsequent typing land here.
  // Only relevant in split mode; single-pane keeps native focus behavior.
  useEffect(() => {
    if (props.focused && props.inSplit) viewRef.current?.focus();
  }, [props.focused, props.inSplit]);

  // Register window globals gated on focused.
  useEffect(() => {
    if (!props.focused) return;
    globalThis.__memopadSearchPanel = {
      open: (mode) => onSearchPanelOpenRef.current?.(mode),
      close: () => onSearchPanelCloseRef.current?.(),
      setFindQuery: (q) => onSearchFindTextChangeRef.current?.(q),
      setReplaceQuery: (q) => onSearchReplaceTextChangeRef.current?.(q),
      applySearch: (find, replace) => {
        const v = viewRef.current;
        if (!v) return { current: 0, total: 0 };
        const sq = new SearchQuery({ search: find, replace, regexp: false, caseSensitive: false });
        v.dispatch({ effects: cmSetSearchQuery.of(sq) });
        onSearchFindTextChangeRef.current?.(find);
        onSearchReplaceTextChangeRef.current?.(replace);
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
  }, [props.focused]);

  useEffect(() => {
    return () => {
      if (cursorWriteTimer.current) clearTimeout(cursorWriteTimer.current);
    };
  }, []);

  if (!buffer) {
    return (
      <div
        data-testid="editor-pane"
        data-focused={props.focused}
        onMouseDown={props.onFocus}
        className={`flex flex-1 flex-col w-full overflow-hidden ${
          props.inSplit
            ? props.focused
              ? 'ring-1 ring-inset ring-[var(--app-accent)]'
              : 'opacity-60'
            : ''
        }`}
      >
        <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: 'var(--app-fg-dim)' }}>
          Ctrl+O to open · Ctrl+N to start typing
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="editor-pane"
      data-focused={props.focused}
      onMouseDown={props.onFocus}
      className={`flex flex-1 flex-col w-full overflow-hidden ${
        props.inSplit
          ? props.focused
            ? 'ring-1 ring-inset ring-[var(--app-accent)]'
            : 'opacity-60'
          : ''
      }`}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirror
          key={buffer.id}
          value={buffer.content}
          height="100%"
          style={{ height: '100%' }}
          extensions={[
            editorTheme,
            themeExt,
            search(),
            ...languageForPath(buffer.path),
          ]}
          onChange={setActiveContent}
          onCreateEditor={(view) => {
            viewRef.current = view;
            if (buffer && cursor != null) {
              const docLen = view.state.doc.length;
              const safe = Math.min(cursor, docLen);
              view.dispatch({ selection: { anchor: safe, head: safe } });
            }
            if (buffer && scrollTop != null) {
              requestAnimationFrame(() => {
                view.scrollDOM.scrollTop = scrollTop ?? 0;
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
