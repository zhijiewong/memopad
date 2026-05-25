import type { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';

/**
 * Return a CodeMirror language extension for a file path's extension.
 * Falls back to no extension (plain text) for unknown types.
 */
export function languageForPath(path: string | null): Extension[] {
  if (!path) return [];
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()];
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'ts':
      return [javascript({ typescript: true })];
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'rs':
      return [rust()];
    case 'json':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    default:
      return [];
  }
}
