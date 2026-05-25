import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { useBuffer } from '../stores/buffer';
import { languageForPath } from '../lib/language';

const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' },
  '.cm-content': { padding: '8px 0' },
});

export function Editor() {
  const content = useBuffer((s) => s.content);
  const path = useBuffer((s) => s.path);
  const setContent = useBuffer((s) => s.setContent);

  return (
    <CodeMirror
      value={content}
      height="100%"
      theme={oneDark}
      extensions={[editorTheme, ...languageForPath(path)]}
      onChange={setContent}
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
