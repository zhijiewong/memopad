import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import type { StreamParser } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { rust } from '@codemirror/lang-rust';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { php } from '@codemirror/lang-php';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { go } from '@codemirror/legacy-modes/mode/go';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { csharp, kotlin, scala } from '@codemirror/legacy-modes/mode/clike';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { r } from '@codemirror/legacy-modes/mode/r';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { diff } from '@codemirror/legacy-modes/mode/diff';

export interface LanguageDef {
  /** Stable key, e.g. 'python'. */
  id: string;
  /** Status-bar label, e.g. 'Python'. */
  label: string;
  /** Lowercased extensions without the dot. */
  extensions?: string[];
  /** Lowercased exact basenames, e.g. 'dockerfile'. */
  filenames?: string[];
  /** Build the CodeMirror language extension(s). */
  load: () => Extension[];
}

export const PLAIN_ID = 'plain';

const legacy = (mode: StreamParser<unknown>): Extension[] => [StreamLanguage.define(mode)];

export const LANGUAGES: LanguageDef[] = [
  { id: 'javascript', label: 'JavaScript', extensions: ['js', 'mjs', 'cjs'], load: () => [javascript()] },
  { id: 'jsx', label: 'JSX', extensions: ['jsx'], load: () => [javascript({ jsx: true })] },
  { id: 'typescript', label: 'TypeScript', extensions: ['ts', 'mts', 'cts'], load: () => [javascript({ typescript: true })] },
  { id: 'tsx', label: 'TSX', extensions: ['tsx'], load: () => [javascript({ jsx: true, typescript: true })] },
  { id: 'json', label: 'JSON', extensions: ['json', 'jsonc'], load: () => [json()] },
  { id: 'markdown', label: 'Markdown', extensions: ['md', 'markdown'], load: () => [markdown()] },
  { id: 'rust', label: 'Rust', extensions: ['rs'], load: () => [rust()] },
  { id: 'python', label: 'Python', extensions: ['py', 'pyw', 'pyi'], load: () => [python()] },
  { id: 'html', label: 'HTML', extensions: ['html', 'htm'], load: () => [html()] },
  { id: 'css', label: 'CSS', extensions: ['css'], load: () => [css()] },
  { id: 'xml', label: 'XML', extensions: ['xml', 'svg', 'xsd', 'xsl'], load: () => [xml()] },
  { id: 'sql', label: 'SQL', extensions: ['sql'], load: () => [sql()] },
  { id: 'cpp', label: 'C/C++', extensions: ['c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh'], load: () => [cpp()] },
  { id: 'java', label: 'Java', extensions: ['java'], load: () => [java()] },
  { id: 'php', label: 'PHP', extensions: ['php'], load: () => [php()] },
  { id: 'yaml', label: 'YAML', extensions: ['yaml', 'yml'], load: () => legacy(yaml) },
  { id: 'toml', label: 'TOML', extensions: ['toml'], load: () => legacy(toml) },
  { id: 'shell', label: 'Shell', extensions: ['sh', 'bash', 'zsh'], load: () => legacy(shell) },
  { id: 'go', label: 'Go', extensions: ['go'], load: () => legacy(go) },
  { id: 'ruby', label: 'Ruby', extensions: ['rb'], load: () => legacy(ruby) },
  { id: 'lua', label: 'Lua', extensions: ['lua'], load: () => legacy(lua) },
  { id: 'perl', label: 'Perl', extensions: ['pl', 'pm'], load: () => legacy(perl) },
  { id: 'powershell', label: 'PowerShell', extensions: ['ps1', 'psm1', 'psd1'], load: () => legacy(powerShell) },
  { id: 'csharp', label: 'C#', extensions: ['cs'], load: () => legacy(csharp) },
  { id: 'kotlin', label: 'Kotlin', extensions: ['kt', 'kts'], load: () => legacy(kotlin) },
  { id: 'scala', label: 'Scala', extensions: ['scala', 'sc'], load: () => legacy(scala) },
  { id: 'swift', label: 'Swift', extensions: ['swift'], load: () => legacy(swift) },
  { id: 'r', label: 'R', extensions: ['r'], load: () => legacy(r) },
  { id: 'properties', label: 'INI / Properties', extensions: ['ini', 'cfg', 'conf', 'properties', 'env'], load: () => legacy(properties) },
  { id: 'dockerfile', label: 'Dockerfile', filenames: ['dockerfile'], load: () => legacy(dockerFile) },
  { id: 'cmake', label: 'CMake', extensions: ['cmake'], filenames: ['cmakelists.txt'], load: () => legacy(cmake) },
  { id: 'diff', label: 'Diff', extensions: ['diff', 'patch'], load: () => legacy(diff) },
  { id: PLAIN_ID, label: 'Plain Text', load: () => [] },
];

const byId = new Map(LANGUAGES.map((l) => [l.id, l]));

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() ?? '';
}

/** Detect a language id from a path: exact filename → extension → 'plain'. */
export function detectLanguageId(path: string | null): string {
  if (!path) return PLAIN_ID;
  const name = basename(path).toLowerCase();
  for (const lang of LANGUAGES) {
    if (lang.filenames?.includes(name)) return lang.id;
  }
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  if (ext) {
    for (const lang of LANGUAGES) {
      if (lang.extensions?.includes(ext)) return lang.id;
    }
  }
  return PLAIN_ID;
}

/** Build the CodeMirror extension(s) for a language id ([] for plain/unknown). */
export function languageExtensionsById(id: string): Extension[] {
  return byId.get(id)?.load() ?? [];
}

/** Human label for a language id ('Plain Text' for plain/unknown). */
export function languageLabel(id: string): string {
  return byId.get(id)?.label ?? 'Plain Text';
}

/** Effective language: explicit override, else auto-detected from the path. */
export function effectiveLanguageId(
  buffer: { languageId?: string | null; path: string | null },
): string {
  return buffer.languageId ?? detectLanguageId(buffer.path);
}
