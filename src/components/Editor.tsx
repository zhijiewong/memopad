import CodeMirror from '@uiw/react-codemirror';
import { useTheme, effectiveTheme } from '../stores/theme';
import { memopadDark } from '../editor/memopad-dark';
import { memopadLight } from '../editor/memopad-light';
import { EditorView } from '@codemirror/view';
import { useBuffers, selectActive } from '../stores/buffers';
import { languageForPath } from '../lib/language';
import { ExternalChangeBanner } from './ExternalChangeBanner';

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' },
  '.cm-content': { padding: '8px 0' },
});

export function Editor() {
  const active = useBuffers(selectActive);
  const setActiveContent = useBuffers((s) => s.setActiveContent);
  const themeMode = useTheme((s) => s.mode);
  const themeExt = effectiveTheme(themeMode) === 'dark' ? memopadDark : memopadLight;

  if (!active) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
        Ctrl+O to open · Ctrl+N to start typing
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <ExternalChangeBanner />
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirror
          key={active.id}
          value={active.content}
          height="100%"
          style={{ height: '100%' }}
          extensions={[editorTheme, themeExt, ...languageForPath(active.path)]}
          onChange={setActiveContent}
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
