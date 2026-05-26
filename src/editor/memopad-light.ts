import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

const palette = {
  bg: '#faf8f4',
  bgElevated: '#f1ede4',
  fg: '#2b2926',
  fgMuted: '#6b6966',
  fgDim: '#a09e9b',
  cursor: '#b9892e',
  selection: '#f0e2b4',
  selectionMatch: '#e7d28a',
  keyword: '#9e5a14',
  string: '#5b7a3c',
  number: '#8a5a14',
  comment: '#a09e9b',
  variable: '#2b2926',
  function: '#2f6b94',
  type: '#7a3e76',
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
    '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.03)' },
    '.cm-gutters': {
      backgroundColor: palette.bg,
      color: palette.fgDim,
      border: 'none',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: palette.fgMuted },
    '.cm-selectionMatch': { backgroundColor: palette.selectionMatch },
    '.cm-searchMatch': { backgroundColor: '#f4dca6', outline: '1px solid #b9892e' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#e9c674' },
  },
  { dark: false },
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

export const memopadLight: Extension = [editorTheme, syntaxHighlighting(highlight)];
