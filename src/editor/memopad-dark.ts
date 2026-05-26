import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const palette = {
  bg: '#1a1a1c',
  bgElevated: '#232325',
  fg: '#e8e6e3',
  fgMuted: '#a09e9b',
  fgDim: '#6b6966',
  cursor: '#f3c969',
  selection: '#3a3527',
  selectionMatch: '#46402b',
  keyword: '#d6a86c',
  string: '#a3c08c',
  number: '#c9a06c',
  comment: '#6b6966',
  variable: '#e8e6e3',
  function: '#82a8c6',
  type: '#c69cc4',
};

const editorTheme = EditorView.theme(
  {
    '&': {
      color: palette.fg,
      backgroundColor: palette.bg,
    },
    '.cm-content': {
      caretColor: palette.cursor,
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: palette.cursor },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: palette.selection },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-gutters': {
      backgroundColor: palette.bg,
      color: palette.fgDim,
      border: 'none',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: palette.fgMuted },
    '.cm-selectionMatch': { backgroundColor: palette.selectionMatch },
    '.cm-searchMatch': { backgroundColor: '#5e4f1f', outline: '1px solid #f3c969' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#8b6b1f' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: palette.keyword },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: palette.variable },
  { tag: [t.function(t.variableName), t.labelName], color: palette.function },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: palette.number },
  { tag: [t.definition(t.name), t.separator], color: palette.fg },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: palette.type },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: palette.keyword },
  { tag: [t.meta, t.comment], color: palette.comment, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: '700', color: palette.keyword },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: palette.number },
  { tag: [t.processingInstruction, t.string, t.inserted], color: palette.string },
  { tag: t.invalid, color: palette.cursor },
]);

export const memopadDark: Extension = [editorTheme, syntaxHighlighting(highlight)];
