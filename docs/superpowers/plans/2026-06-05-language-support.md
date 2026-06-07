# Language Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add broad syntax highlighting (~30 languages) plus a status-bar language picker with a manual override and auto-detect, mirroring the existing encoding/EOL popovers.

**Architecture:** A data-driven language registry in `src/lib/language.ts` maps file paths → CodeMirror language extensions (official `@codemirror/lang-*` + `@codemirror/legacy-modes`). A per-buffer in-memory `languageId` override (not persisted) layers over auto-detection. `EditorPane` applies `languageExtensionsById(effectiveLanguageId(buffer))`; the status-bar segment becomes a filterable picker.

**Tech Stack:** React 18 + TypeScript + Zustand + CodeMirror 6 (`@uiw/react-codemirror`); Vitest (jsdom) + WebdriverIO/Mocha e2e.

**Conventions (project norms — do not violate):**
- Specs/plans under `docs/superpowers/` stay **untracked**. Never `git add -A`; always stage explicit paths.
- All work on a feature branch; integrate later with `merge --no-ff` (handled by finishing-a-development-branch, after user confirmation).
- Trust `npx tsc --noEmit` over editor/LSP diagnostics.

---

### Task 0: Create the feature branch

**Files:** none (git only)

- [ ] **Step 1: Branch off main**

Run:
```bash
git switch -c feature/language-support
```
Expected: `Switched to a new branch 'feature/language-support'`

---

### Task 1: Add CodeMirror language packages

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Install the official lang packages + legacy modes**

Run:
```bash
npm install @codemirror/lang-python @codemirror/lang-html @codemirror/lang-css @codemirror/lang-xml @codemirror/lang-sql @codemirror/lang-cpp @codemirror/lang-java @codemirror/lang-php @codemirror/legacy-modes
```
Expected: installs succeed; `package.json` dependencies now list all nine packages.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add CodeMirror language packages for broad syntax support"
```

---

### Task 2: Language registry (`src/lib/language.ts`)

**Files:**
- Create (rewrite): `src/lib/language.ts`
- Test: `src/tests/language.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/language.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  LANGUAGES,
  PLAIN_ID,
  detectLanguageId,
  languageExtensionsById,
  languageLabel,
  effectiveLanguageId,
} from '../lib/language';

describe('detectLanguageId', () => {
  it('detects by extension', () => {
    expect(detectLanguageId('/a/script.py')).to.equal('python');
    expect(detectLanguageId('C:\\proj\\app.tsx')).to.equal('tsx');
    expect(detectLanguageId('conf.yml')).to.equal('yaml');
    expect(detectLanguageId('main.rs')).to.equal('rust');
  });
  it('is case-insensitive on extension', () => {
    expect(detectLanguageId('/a/MAIN.PY')).to.equal('python');
  });
  it('detects by exact filename before extension', () => {
    expect(detectLanguageId('/repo/Dockerfile')).to.equal('dockerfile');
    expect(detectLanguageId('/repo/CMakeLists.txt')).to.equal('cmake');
  });
  it('falls back to plain for unknown ext and null path', () => {
    expect(detectLanguageId('/a/file.unknownext')).to.equal(PLAIN_ID);
    expect(detectLanguageId('/a/noext')).to.equal(PLAIN_ID);
    expect(detectLanguageId(null)).to.equal(PLAIN_ID);
  });
});

describe('effectiveLanguageId', () => {
  it('uses the override when set', () => {
    expect(effectiveLanguageId({ languageId: 'java', path: '/a/x.py' })).to.equal('java');
  });
  it('falls back to detection when override is null/absent', () => {
    expect(effectiveLanguageId({ languageId: null, path: '/a/x.py' })).to.equal('python');
    expect(effectiveLanguageId({ path: '/a/x.py' })).to.equal('python');
  });
});

describe('languageExtensionsById / languageLabel', () => {
  it('returns [] for plain and unknown ids', () => {
    expect(languageExtensionsById(PLAIN_ID)).to.deep.equal([]);
    expect(languageExtensionsById('nope')).to.deep.equal([]);
  });
  it('labels plain and unknown as Plain Text', () => {
    expect(languageLabel(PLAIN_ID)).to.equal('Plain Text');
    expect(languageLabel('nope')).to.equal('Plain Text');
    expect(languageLabel('python')).to.equal('Python');
  });
});

describe('registry integrity (import-safety net)', () => {
  it('has unique ids and lowercase ext/filenames', () => {
    const ids = LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).to.equal(ids.length);
    for (const l of LANGUAGES) {
      for (const e of l.extensions ?? []) expect(e).to.equal(e.toLowerCase());
      for (const f of l.filenames ?? []) expect(f).to.equal(f.toLowerCase());
    }
  });
  it('every load() resolves and yields a non-empty extension (except plain)', () => {
    for (const l of LANGUAGES) {
      const ext = l.load();
      if (l.id === PLAIN_ID) {
        expect(ext).to.deep.equal([]);
      } else {
        expect(ext, `${l.id} load()`).to.be.an('array').with.length.greaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/language.test.ts`
Expected: FAIL (current `language.ts` exports `languageForPath`, not these symbols).

- [ ] **Step 3: Rewrite `src/lib/language.ts`**

Replace the entire file with:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/language.test.ts`
Expected: PASS (all describes green). If a legacy import path/name fails to resolve, fix that single import (fall back to the legacy mode or correct the export name) — the integrity test pinpoints the offending id.

- [ ] **Step 5: Commit**

```bash
git add src/lib/language.ts src/tests/language.test.ts
git commit -m "feat: data-driven language registry with broad detection"
```

---

### Task 3: Per-buffer language override (`src/stores/buffers.ts`)

**Files:**
- Modify: `src/stores/buffers.ts` (Buffer interface, BuffersState interface, action impl)
- Test: `src/tests/buffers.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/tests/buffers.test.ts` (inside the existing file, after the last test in the `describe('buffers store', ...)` block — add a new top-level describe at the end of the file):

```ts
describe('buffers store — language override', () => {
  beforeEach(() => {
    useBuffers.getState().resetAll();
  });

  it('new buffers have no language override', () => {
    useBuffers.getState().newBuffer();
    expect(useBuffers.getState().buffers[0].languageId ?? null).to.equal(null);
  });

  it('setActiveLanguage sets the override on the focused buffer', () => {
    const id = useBuffers.getState().openBuffer({ path: '/a/x.py', content: '', encoding: 'utf-8', eol: 'lf' });
    useBuffers.getState().setActiveLanguage('javascript');
    const b = useBuffers.getState().buffers.find((x) => x.id === id)!;
    expect(b.languageId).to.equal('javascript');
    expect(b.dirty).to.equal(false); // language override does not dirty the buffer
  });

  it('setActiveLanguage(null) clears the override', () => {
    const id = useBuffers.getState().openBuffer({ path: '/a/x.py', content: '', encoding: 'utf-8', eol: 'lf' });
    useBuffers.getState().setActiveLanguage('javascript');
    useBuffers.getState().setActiveLanguage(null);
    const b = useBuffers.getState().buffers.find((x) => x.id === id)!;
    expect(b.languageId).to.equal(null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/tests/buffers.test.ts`
Expected: FAIL with "setActiveLanguage is not a function".

- [ ] **Step 3: Add the field, interface method, and action**

In `src/stores/buffers.ts`:

(a) Add `languageId` to the `Buffer` interface (after `scrollTop: number | null;`):
```ts
  scrollTop: number | null;
  languageId?: string | null;
```

(b) Add the action signature to `BuffersState` (after `setActiveEol: (eol: LineEnding) => void;`):
```ts
  setActiveEol: (eol: LineEnding) => void;
  setActiveLanguage: (id: string | null) => void;
```

(c) Add the action implementation immediately after the `setActiveEol` action (after its closing `},`):
```ts
  setActiveLanguage: (id) => {
    set((s) => {
      const fid = selectFocusedId(s);
      if (fid == null) return s;
      return {
        buffers: s.buffers.map((b) => (b.id === fid ? { ...b, languageId: id } : b)),
      };
    });
  },
```

(`selectFocusedId` is declared at the bottom of this file; function declarations are hoisted, so the reference resolves.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/tests/buffers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stores/buffers.ts src/tests/buffers.test.ts
git commit -m "feat: per-buffer in-memory language override"
```

---

### Task 4: Apply effective language in the editor (`src/components/EditorPane.tsx`)

**Files:**
- Modify: `src/components/EditorPane.tsx` (import + extensions array)

- [ ] **Step 1: Swap the import**

Replace line 20:
```ts
import { languageForPath } from '../lib/language';
```
with:
```ts
import { effectiveLanguageId, languageExtensionsById } from '../lib/language';
```

- [ ] **Step 2: Use the effective language in the extensions array**

Replace the line:
```ts
            ...languageForPath(buffer.path),
```
with:
```ts
            ...languageExtensionsById(effectiveLanguageId(buffer)),
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "feat: editor applies effective (override-or-detected) language"
```

---

### Task 5: Language picker popover (`src/components/LanguagePopover.tsx`)

**Files:**
- Create: `src/components/LanguagePopover.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/LanguagePopover.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGES, PLAIN_ID } from '../lib/language';

interface Props {
  /** The effective language id (override-or-detected) to highlight. */
  currentEffectiveId: string;
  /** True when the buffer has an explicit override (so Auto-detect is not active). */
  hasOverride: boolean;
  anchorRect: DOMRect;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}

export function LanguagePopover({ currentEffectiveId, hasOverride, anchorRect, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const items = LANGUAGES.filter((l) => l.id !== PLAIN_ID);
    if (!q) return items;
    return items.filter((l) => l.label.toLowerCase().includes(q) || l.id.includes(q));
  }, [filter]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = matches[0];
      if (first) { onSelect(first.id); onClose(); }
      return;
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: anchorRect.left, bottom: window.innerHeight - anchorRect.top + 4 }}
      className="fixed z-50 flex max-h-[340px] w-[200px] flex-col rounded border border-neutral-700 bg-neutral-900 text-xs text-neutral-200 shadow-lg"
    >
      <input
        ref={inputRef}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={onKey}
        placeholder="Filter languages…"
        className="m-1 rounded border border-neutral-800 bg-transparent px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
      />
      <div className="overflow-y-auto py-1">
        <button
          onClick={() => { onSelect(null); onClose(); }}
          className={'block w-full px-3 py-1.5 text-left hover:bg-neutral-800 ' + (!hasOverride ? 'text-amber-400' : '')}
        >
          Auto-detect
        </button>
        {matches.map((l) => (
          <button
            key={l.id}
            data-lang-id={l.id}
            onClick={() => { onSelect(l.id); onClose(); }}
            className={'block w-full px-3 py-1.5 text-left hover:bg-neutral-800 ' + (l.id === currentEffectiveId ? 'text-amber-400' : '')}
          >
            {l.label}
          </button>
        ))}
        {matches.length === 0 && (
          <div className="px-3 py-1.5 text-neutral-500">No matches</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/LanguagePopover.tsx
git commit -m "feat: filterable language picker popover"
```

---

### Task 6: Wire the status-bar segment to the picker (`src/components/StatusBar.tsx`)

**Files:**
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Update imports**

Replace line 1:
```ts
import { useState } from 'react';
```
with:
```ts
import { useEffect, useRef, useState } from 'react';
```

Add after the `EolPopover` import (line 4):
```ts
import { LanguagePopover } from './LanguagePopover';
```

Add after the `cursorPos` import (line 6):
```ts
import { effectiveLanguageId, languageLabel } from '../lib/language';
```

- [ ] **Step 2: Remove the local `languageLabel` helper**

Delete the entire local function (lines 21–29):
```ts
function languageLabel(path: string | null): string {
  if (!path) return 'Plain';
  const ext = path.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    rs: 'Rust', js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', tsx: 'TSX',
    json: 'JSON', md: 'Markdown', markdown: 'Markdown',
  };
  return map[ext] ?? 'Plain';
}
```

- [ ] **Step 3: Add the picker state, ref, store action, and palette hook**

After the existing `const [eolRect, setEolRect] = useState<DOMRect | null>(null);` line, add:
```ts
  const [langRect, setLangRect] = useState<DOMRect | null>(null);
  const langBtnRef = useRef<HTMLButtonElement>(null);
  const setActiveLanguage = useBuffers((s) => s.setActiveLanguage);

  useEffect(() => {
    (window as unknown as { __memopadOpenLanguagePicker?: () => void }).__memopadOpenLanguagePicker = () => {
      if (langBtnRef.current) setLangRect(langBtnRef.current.getBoundingClientRect());
    };
    return () => {
      (window as unknown as { __memopadOpenLanguagePicker?: () => void }).__memopadOpenLanguagePicker = undefined;
    };
  }, []);
```

(These hooks sit above the `if (!active)` early return, so hook order stays stable.)

- [ ] **Step 4: Turn the language span into a button**

Replace:
```tsx
      <span data-status-segment="language">{languageLabel(active.path)}</span>
```
with:
```tsx
      <button
        type="button"
        ref={langBtnRef}
        data-status-segment="language"
        onClick={() => { if (langBtnRef.current) setLangRect(langBtnRef.current.getBoundingClientRect()); }}
        className="hover:text-neutral-100"
      >
        {languageLabel(effectiveLanguageId(active))}
      </button>
```

- [ ] **Step 5: Render the popover**

After the existing `{eolRect && ( ... )}` block (before the closing `</div>`), add:
```tsx
      {langRect && (
        <LanguagePopover
          currentEffectiveId={effectiveLanguageId(active)}
          hasOverride={active.languageId != null}
          anchorRect={langRect}
          onSelect={setActiveLanguage}
          onClose={() => setLangRect(null)}
        />
      )}
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/StatusBar.tsx
git commit -m "feat: status-bar language segment opens the picker"
```

---

### Task 7: "Set Language…" palette command (`src/commands/builtins.ts`)

**Files:**
- Modify: `src/commands/builtins.ts`

- [ ] **Step 1: Register the command**

In `registerBuiltins()`, after the `view.toggleMinimap` registration block (around line 194), add:
```ts
  register({
    id: 'view.setLanguage',
    title: 'View: Set Language…',
    run: () => (window as unknown as { __memopadOpenLanguagePicker?: () => void }).__memopadOpenLanguagePicker?.(),
  });
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/builtins.ts
git commit -m "feat: 'Set Language…' command opens the picker"
```

---

### Task 8: e2e test hooks (`src/main.tsx`)

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Import the helper**

Add to the import block at the top (after the `useBuffers, selectActive` import):
```ts
import { effectiveLanguageId } from './lib/language';
```

- [ ] **Step 2: Declare the hook types**

In the `const w = window as unknown as { ... }` type block, add:
```ts
  __memopadTestSetLanguage?: (id: string | null) => void;
  __memopadTestLanguageId?: () => string;
```

- [ ] **Step 3: Assign the hooks**

After `w.__memopadTestResetRecentFiles = ...;`, add:
```ts
w.__memopadTestSetLanguage = (id) => useBuffers.getState().setActiveLanguage(id);
w.__memopadTestLanguageId = () => {
  const b = selectActive(useBuffers.getState());
  return b ? effectiveLanguageId(b) : 'plain';
};
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx
git commit -m "test: expose language test hooks"
```

---

### Task 9: e2e spec (`tests/e2e/language.spec.ts`)

**Files:**
- Create: `tests/e2e/language.spec.ts`

- [ ] **Step 1: Create the spec**

Create `tests/e2e/language.spec.ts`:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function openPy() {
  const w = window as unknown as {
    __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
  };
  w.__memopadTestOpenBuffer({ path: '/tmp/script.py', content: 'print(1)', encoding: 'utf-8', eol: 'lf' });
}

describe('language support', () => {
  beforeEach(async () => {
    await exec(() => {
      (window as unknown as { __memopadTestReset: () => void }).__memopadTestReset();
    });
  });

  it('auto-detects language from the file extension', async () => {
    await exec(openPy);
    const label = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="language"]').textContent;`,
    );
    expect(label).to.equal('Python');
  });

  it('manual override changes the language and Auto-detect reverts it', async () => {
    await exec(openPy);
    await exec(() => {
      (window as unknown as { __memopadTestSetLanguage: (id: string | null) => void }).__memopadTestSetLanguage('javascript');
    });
    let label = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="language"]').textContent;`,
    );
    expect(label).to.equal('JavaScript');

    await exec(() => {
      (window as unknown as { __memopadTestSetLanguage: (id: string | null) => void }).__memopadTestSetLanguage(null);
    });
    label = await classicExecute<string>(
      `return document.querySelector('[data-status-segment="language"]').textContent;`,
    );
    expect(label).to.equal('Python');
  });

  it('clicking the language segment opens (and click-away closes) the picker', async () => {
    await exec(openPy);
    await exec(() => {
      (document.querySelector('[data-status-segment="language"]') as HTMLButtonElement)?.click();
    });
    await sleep(100);
    const open = await classicExecute<boolean>(`return !!document.querySelector('[role="menu"]');`);
    expect(open, 'menu opens on click').to.equal(true);

    // Close via click-away so no stale popover leaks into later specs.
    await exec(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await sleep(60);
    const closed = await classicExecute<boolean>(`return !document.querySelector('[role="menu"]');`);
    expect(closed, 'menu closes on click-away').to.equal(true);
  });

  it('registers the Set Language command', async () => {
    const ids = await classicExecute<string[]>(`return window.__memopadTestCommandIds();`);
    expect(ids).to.include('view.setLanguage');
  });
});
```

- [ ] **Step 2: Commit (build/run happens in Task 11)**

```bash
git add tests/e2e/language.spec.ts
git commit -m "test: e2e for language detection, override, and picker"
```

---

### Task 10: Frontend gates (types + unit tests)

**Files:** none (verification)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full unit suite**

Run: `npm run test`
Expected: all vitest files PASS (including the new `language.test.ts` and the appended buffer-language tests).

- [ ] **Step 3: Rust suite stays green (no Rust changed, but confirm)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

---

### Task 11: e2e gate (release build + WebDriver)

**Files:** none (verification)

- [ ] **Step 1: Run the e2e suite**

Run: `npm run test:e2e`
Expected: builds the release app, then all specs PASS — including `tests/e2e/language.spec.ts` (4 passing) and the existing 65. No new window handles are created, so spec ordering is unaffected.

If the language label asserts fail because the React update hasn't flushed, the `setLanguage` hooks are synchronous store writes — re-check the selector wiring in `StatusBar.tsx` (Task 6) rather than adding sleeps.

---

### Task 12: Version bump to 1.1.0 + CHANGELOG

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.lock`, `CHANGELOG.md`

- [ ] **Step 1: Bump the three manifests**

- `package.json`: `"version": "1.0.0"` → `"version": "1.1.0"`.
- `src-tauri/tauri.conf.json`: `"version": "1.0.0"` → `"version": "1.1.0"`.
- `src-tauri/Cargo.toml`: the `[package]` `version = "1.0.0"` → `version = "1.1.0"`.

- [ ] **Step 2: Refresh Cargo.lock**

Run: `cargo update -p memopad --manifest-path src-tauri/Cargo.toml`
Expected: updates the `memopad` entry in `Cargo.lock` to `1.1.0` (no other crates change).

- [ ] **Step 3: Add the CHANGELOG entry**

Read `CHANGELOG.md`, then add a new section at the top (below the title, above `1.0.0`), matching the file's existing heading style:

```markdown
## 1.1.0

### Added
- Syntax highlighting for ~30 languages — Python, HTML, CSS, XML, SQL, C/C++, Java, PHP, YAML, TOML, shell, Go, Ruby, Lua, Perl, PowerShell, C#, Kotlin, Scala, Swift, R, INI/Properties, Dockerfile, CMake, diff (added to the existing JS/TS/JSX/TSX, JSON, Markdown, Rust).
- A language picker in the status bar: click the language segment to override the auto-detected language (with a filter box and an Auto-detect option). The override is per-tab and resets when the file is reopened.
- "View: Set Language…" command in the command palette.
```

- [ ] **Step 4: Verify the bump**

Run: `npx tsc --noEmit && npm run test`
Expected: green (sanity that nothing broke during the bump).

- [ ] **Step 5: Commit**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock CHANGELOG.md
git commit -m "chore: 1.1.0 — language support"
```

---

### Task 13: Code review + integration handoff

**Files:** none

- [ ] **Step 1: Request code review**

Use the `superpowers:requesting-code-review` skill on the branch diff (`git diff main...feature/language-support`). Address any high-confidence findings (re-run Task 10 gates after fixes).

- [ ] **Step 2: Hand off to integration**

Stop here and use `superpowers:finishing-a-development-branch` to present merge options. **Do not** merge/push/tag/release without explicit user confirmation (project norm: outward/irreversible actions require a go-ahead). The release workflow triggers on the `v1.1.0` tag after merge.

---

## Self-Review notes

- **Spec coverage:** registry (Task 2) ↔ spec §A; buffer override (Task 3) ↔ §B; editor wiring (Task 4) ↔ §C; popover + status bar + command (Tasks 5–7) ↔ §D; hooks + tests (Tasks 8–9) ↔ §E; YAGNI honored (no persistence, no Rust); release (Task 12) ↔ spec Release.
- **Type consistency:** `LanguageDef`, `PLAIN_ID`, `detectLanguageId`, `languageExtensionsById`, `languageLabel`, `effectiveLanguageId` are defined in Task 2 and used identically in Tasks 4/6/8; `setActiveLanguage(id: string | null)` defined in Task 3 and consumed in Tasks 6/8; `__memopadOpenLanguagePicker` registered in Task 6 and called in Task 7.
- **Import-safety:** every legacy import is exercised by the Task 2 integrity test before any UI depends on it.
