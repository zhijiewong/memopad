# Language Support (syntax highlighting for many languages) — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorming) — awaiting implementation plan
**Target version:** 1.1.0

## Problem

Memopad highlights only 4 language families (JS/TS, Rust, JSON, Markdown). Everything else —
Python, HTML/CSS, YAML, shell, C/C++, Java, Go, TOML, etc. — renders as plain text. The status
bar already has a **read-only** `language` segment, and the encoding/EOL segments next to it are
already click-to-change popovers. So the gap is: (1) a real language **registry** with broad
coverage, and (2) turning the read-only segment into a **picker** with a manual override, exactly
mirroring the existing encoding/EOL popover pattern. This is frontend-only — no Rust, no new IPC.

## Decisions (locked during brainstorming)

- **Broad coverage** (~30 languages): official `@codemirror/lang-*` where they exist, plus
  `@codemirror/legacy-modes` (`StreamLanguage.define`) for the long tail.
- **Eager import** (not lazy). This is a desktop app; the extra bundle weight is paid once at
  install, never over the network. The registry's `load()` indirection leaves a lazy seam if we
  ever want it, but we call them synchronously.
- **Manual override is in-memory only** — like encoding/EOL, it is NOT persisted in `TabEntry`,
  so reopening a file reverts to auto-detect. (No Rust/session changes.)
- **Detection precedence:** exact filename (e.g. `Dockerfile`) → extension → `'plain'`.

## A. Language registry (`src/lib/language.ts`, rewritten)

Replace the ad-hoc `languageForPath` switch with a data-driven registry.

```ts
import type { Extension } from '@codemirror/state';

export interface LanguageDef {
  id: string;                 // stable key, e.g. 'python'
  label: string;              // status-bar text, e.g. 'Python'
  extensions?: string[];      // lowercased, no dot: ['py','pyw','pyi']
  filenames?: string[];       // lowercased exact basenames: ['dockerfile']
  load: () => Extension[];    // builds the CM language extension(s)
}

export const LANGUAGES: LanguageDef[];          // the registry (see table below)
export const PLAIN_ID = 'plain';

export function detectLanguageId(path: string | null): string;        // filename → ext → 'plain'
export function languageExtensionsById(id: string): Extension[];       // def.load() ?? []
export function languageLabel(id: string): string;                     // def.label ?? 'Plain Text'
export function effectiveLanguageId(
  buffer: { languageId?: string | null; path: string | null },
): string;                                                             // languageId ?? detect(path)
```

- `'plain'` is a synthetic entry (`label: 'Plain Text'`, `load: () => []`) so the picker and
  labels are uniform; it has no `extensions`/`filenames` (it's the detection fallback, not matched).
- `detectLanguageId`: lowercase the basename; if it matches any `filenames` entry → that id; else
  take the last `.`-segment and match `extensions`; else `PLAIN_ID`. `null` path → `PLAIN_ID`.
- `languageExtensionsById('plain')` → `[]`. Unknown id → `[]`.
- `effectiveLanguageId` takes a **structural** type (not the `Buffer` import) to keep `language.ts`
  a leaf module with no store coupling.

### Coverage table (registry source-of-truth; smoke test guards every `load()`)

Official `@codemirror/lang-*` (add as deps): **python, html, css, xml, sql, cpp, java, php**
(JS/TS/JSX/TSX, json, markdown, rust already installed).

| id | label | from | match |
|----|-------|------|-------|
| javascript | JavaScript | lang-javascript | js, mjs, cjs |
| jsx | JSX | lang-javascript `{jsx}` | jsx |
| typescript | TypeScript | lang-javascript `{typescript}` | ts, mts, cts |
| tsx | TSX | lang-javascript `{jsx,typescript}` | tsx |
| json | JSON | lang-json | json, jsonc |
| markdown | Markdown | lang-markdown | md, markdown |
| rust | Rust | lang-rust | rs |
| python | Python | lang-python | py, pyw, pyi |
| html | HTML | lang-html | html, htm |
| css | CSS | lang-css | css |
| xml | XML | lang-xml | xml, svg, xsd, xsl |
| sql | SQL | lang-sql | sql |
| cpp | C/C++ | lang-cpp | c, h, cpp, cc, cxx, hpp, hh |
| java | Java | lang-java | java |
| php | PHP | lang-php | php |
| yaml | YAML | legacy `yaml` | yaml, yml |
| toml | TOML | legacy `toml` | toml |
| shell | Shell | legacy `shell` | sh, bash, zsh |
| go | Go | legacy `go` | go |
| ruby | Ruby | legacy `ruby` | rb |
| lua | Lua | legacy `lua` | lua |
| perl | Perl | legacy `perl` | pl, pm |
| powershell | PowerShell | legacy `powerShell` | ps1, psm1, psd1 |
| csharp | C# | legacy `clike.csharp` | cs |
| kotlin | Kotlin | legacy `clike.kotlin` | kt, kts |
| scala | Scala | legacy `clike.scala` | scala, sc |
| swift | Swift | legacy `swift` | swift |
| r | R | legacy `r` | r |
| properties | INI / Properties | legacy `properties` | ini, cfg, conf, properties, env |
| dockerfile | Dockerfile | legacy `dockerfile` | *(filename)* dockerfile |
| cmake | CMake | legacy `cmake` | *(filename)* cmakelists.txt; ext cmake |
| diff | Diff | legacy `diff` | diff, patch |
| plain | Plain Text | — | *(fallback)* |

Legacy entries use `StreamLanguage.define(modeExport)` from
`@codemirror/legacy-modes/mode/<file>`. The exact import paths/exports are verified by the smoke
test (§E); if any official package proves unavailable, that language falls back to its legacy
mode (e.g. `legacy/mode/go`) — a localized, low-risk swap that does not change the registry shape.

## B. Buffer override (`src/stores/buffers.ts`)

- Add `languageId?: string | null` to `Buffer` (absent/undefined ⇒ auto-detect; explicit `null`
  also means auto — both treated identically by `effectiveLanguageId`). `emptyBuffer()` leaves it
  unset; `openBuffer`/`openRestored`/`replaceBuffer` do **not** set it (auto on every (re)open).
- Add action `setActiveLanguage(id: string | null)` that targets the **focused** buffer via
  `selectFocusedId(get())` (not `activeId`). Rationale: the status bar displays the *focused*
  buffer's language, so the picker must mutate the same buffer it labels — otherwise, in split
  view with the secondary pane focused, the picker would change the wrong buffer. Setting it does
  **not** mark the buffer dirty (highlighting is a view concern, unlike encoding/EOL which change
  bytes on save). The existing `setActiveEncoding`/`setActiveEol` are left untouched (their
  `activeId` targeting is a separate, pre-existing concern — out of scope).

```ts
setActiveLanguage: (id) => {
  set((s) => {
    const fid = selectFocusedId(s);
    if (fid == null) return s;
    return { buffers: s.buffers.map((b) => (b.id === fid ? { ...b, languageId: id } : b)) };
  });
},
```

## C. EditorPane (`src/components/EditorPane.tsx`)

- Swap the import `languageForPath` → `effectiveLanguageId, languageExtensionsById`.
- In the `extensions` array, replace `...languageForPath(buffer.path)` with
  `...languageExtensionsById(effectiveLanguageId(buffer))`.
- Each pane renders its own `buffer`, so the effective id is correct per-pane. `@uiw/react-codemirror`
  re-applies the `extensions` array on change (proven by the live wordWrap/minimap toggles), so a
  language override updates highlighting immediately without remounting. `key={buffer.id}` still
  remounts only on buffer switch.

## D. Status-bar picker

**`src/components/LanguagePopover.tsx`** (new) — mirrors `EolPopover` (fixed position above the
anchor, click-away close via `mousedown`, current option highlighted amber) with two additions:

- A top **filter `<input>`** (auto-focused) that type-narrows the list (the registry is ~30 long).
  Case-insensitive substring over `label`. `Escape` closes; `Enter` selects the first match.
- An **"Auto-detect"** row pinned at top that calls `onSelect(null)`; highlighted amber when the
  buffer has no override. Each language row calls `onSelect(def.id)`; the row matching the current
  **effective** id is highlighted.
- Props: `{ currentEffectiveId, hasOverride, anchorRect, onSelect: (id: string | null) => void, onClose }`.
- `max-h` + `overflow-y-auto` on the list (it can be tall).

**`src/components/StatusBar.tsx`** — turn the read-only `<span data-status-segment="language">`
into a `<button data-status-segment="language">` that captures its `DOMRect` and opens
`LanguagePopover`; label = `languageLabel(effectiveLanguageId(active))`. Wire
`onSelect={setActiveLanguage}` from the store. Drop the local hardcoded `languageLabel` map (now
imported from `lib/language`). Keep a button `ref` so a palette command can open it (below).

**Palette command** (`src/commands/builtins.ts`) — `view.setLanguage` / "Set Language…": calls a
window hook `__memopadOpenLanguagePicker?.()` that StatusBar registers (opens the popover anchored
to its button). Mirrors the `edit.gotoLine` → `__memopadOpenGotoLine` pattern.

## E. Testing

**vitest** (`src/tests/language.test.ts`):
- `detectLanguageId`: representative extensions (`a.py`→python, `x.tsx`→tsx, `m.yml`→yaml),
  exact filename (`Dockerfile`→dockerfile, `CMakeLists.txt`→cmake), case-insensitivity,
  unknown ext → `plain`, `null` → `plain`.
- `effectiveLanguageId`: override wins over detection; `null`/absent override falls back to
  detection.
- `languageExtensionsById`: `plain`→`[]`, unknown→`[]`.
- **Import-safety net:** iterate `LANGUAGES` and assert every entry's `load()` neither throws nor
  returns an empty array (except `plain`), and that all `id`s are unique and all
  `extensions`/`filenames` are lowercase. This guarantees every legacy import path resolves.

**e2e** (`tests/e2e/language.spec.ts`) — store-hook + DOM assertions, no new window handles:
- `__memopadTestOpenBuffer({ path:'/t/a.py', ... })` → `[data-status-segment="language"]`
  text === `Python`.
- `__memopadTestSetLanguage('javascript')` → segment text === `JavaScript`;
  `__memopadTestSetLanguage(null)` → back to `Python`.
- Clicking the language button renders a `[role="menu"]` (popover presence).
- Asserts `view.setLanguage` is in `__memopadTestCommandIds()`.

**Test hooks** (`src/main.tsx`):
- `__memopadTestSetLanguage(id: string | null)` → `useBuffers.getState().setActiveLanguage(id)`.
- `__memopadTestLanguageId()` → `effectiveLanguageId` of the active buffer (string).

## F. Scope boundaries (YAGNI — non-goals)

- No persistence of the override across restart (matches encoding/EOL; `TabEntry` untouched).
- No user-defined/custom grammars or syntax themes.
- No language-aware autocompletion or code folding (`basicSetup` keeps
  `autocompletion:false`, `foldGutter:false`).
- No per-language indent settings; no Rust/session/IPC changes.

## Files

| File | Change |
|------|--------|
| `src/lib/language.ts` | Rewrite into registry + `detect`/`effective`/`extensionsById`/`label` |
| `src/stores/buffers.ts` | `languageId?` field + `setActiveLanguage` action |
| `src/components/EditorPane.tsx` | Use `languageExtensionsById(effectiveLanguageId(buffer))` |
| `src/components/LanguagePopover.tsx` | **New** — filterable picker w/ Auto-detect |
| `src/components/StatusBar.tsx` | Segment span → button + popover; import `languageLabel` |
| `src/commands/builtins.ts` | `view.setLanguage` command |
| `src/main.tsx` | `__memopadTestSetLanguage`, `__memopadTestLanguageId` hooks |
| `src/tests/language.test.ts` | **New** — vitest |
| `tests/e2e/language.spec.ts` | **New** — e2e |
| `package.json` | Add `@codemirror/lang-{python,html,css,xml,sql,cpp,java,php}`, `@codemirror/legacy-modes` |

## Release

Ships as **1.1.0** (minor — additive feature). Bump `package.json`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.lock`. CHANGELOG: Added — syntax highlighting for
~30 languages (Python, HTML, CSS, YAML, shell, C/C++, Java, Go, TOML, and more); a language
picker in the status bar with manual override and Auto-detect; "Set Language…" command.
