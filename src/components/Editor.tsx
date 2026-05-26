import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { useBuffers, selectActive } from '../stores/buffers';
import { languageForPath } from '../lib/language';

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' },
  '.cm-content': { padding: '8px 0' },
});

export function Editor() {
  const active = useBuffers(selectActive);
  const setActiveContent = useBuffers((s) => s.setActiveContent);

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-neutral-500">
        Ctrl+O to open · Ctrl+N to start typing
      </div>
    );
  }

  return (
    <CodeMirror
      key={active.id}
      value={active.content}
      height="100%"
      theme={oneDark}
      extensions={[editorTheme, ...languageForPath(active.path)]}
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
  );
}
