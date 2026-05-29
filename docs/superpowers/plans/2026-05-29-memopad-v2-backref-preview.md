# Memopad v2 — Backref-Aware Replace Preview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the SearchPanel's replace preview, expand regex backreferences (`$1`, `$&`, etc.) so the user sees the actual substituted text instead of the literal replacement template. The actual write is unchanged — Rust still performs the real replacement via `regex::Regex::replace_all`.

**Architecture:** A new pure helper `expandBackrefs` in `src/lib/replace-preview.ts` builds a JS `RegExp` from the same query + flags Rust's `build_matcher_pattern` would use, then runs `String.prototype.replace` to expand backrefs per match. `Snippet` (already in `SearchPanel.tsx`) calls it instead of rendering the literal replacement. On any JS RegExp construction error, the helper falls back to the literal replacement so the actual write semantics are never broken.

**Tech Stack:** React, TypeScript. No new dependencies.

**Spec section reference:** `docs/superpowers/specs/2026-05-29-backref-preview-design.md` (all sections).

---

## File Structure

```
memopad/
├── src/
│   ├── lib/
│   │   └── replace-preview.ts        CREATE — escapeRegex + expandBackrefs pure helpers
│   ├── components/
│   │   └── SearchPanel.tsx           MODIFY — Snippet uses expandBackrefs; query+opts threaded through ResultRow + FileGroup
│   └── tests/
│       └── replace-preview.test.ts   CREATE — 4 vitest cases
```

Boundary intent:
- **`replace-preview.ts`** owns the regex + replacement math. Pure, framework-free, easy to test.
- **`SearchPanel.tsx`** owns the prop threading and renders the expanded text. The only behavior change there is wiring `query` + `opts` to `Snippet` and switching from a literal `<mark>{replacement}</mark>` to `<mark>{expandBackrefs(...)}</mark>`.

---

## Task 1: `expandBackrefs` pure helper + 4 tests

**Files:**
- Create: `src/lib/replace-preview.ts`
- Create: `src/tests/replace-preview.test.ts`

- [ ] **Step 1: Create the failing tests at `src/tests/replace-preview.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { expandBackrefs } from '../lib/replace-preview';

const noFlags = { regex: false, case_sensitive: true, whole_word: false } as const;
const regex = { regex: true, case_sensitive: true, whole_word: false } as const;

describe('expandBackrefs', () => {
  it('substitutes capture-group backreferences in regex mode', () => {
    expect(
      expandBackrefs('alice@example.com', '(\\w+)@example\\.com', '$1@new.com', regex)
    ).toBe('alice@new.com');
  });

  it('supports $& for the whole match in regex mode', () => {
    expect(
      expandBackrefs('foo', 'fo+', '<<$&>>', regex)
    ).toBe('<<foo>>');
  });

  it('preserves dollar-prefixed literals in literal mode', () => {
    expect(
      expandBackrefs('foo', 'foo', '$5 dollars', noFlags)
    ).toBe('$5 dollars');
  });

  it('falls back to literal replacement when the pattern is invalid for JS', () => {
    // Rust-only syntax: ?P<name> named groups
    const ruleish = { regex: true, case_sensitive: true, whole_word: false } as const;
    expect(
      expandBackrefs('alpha', '(?P<word>\\w+)', '$word', ruleish)
    ).toBe('$word');
  });
});
```

- [ ] **Step 2: Run — should FAIL**

```powershell
npm test -- replace-preview
```

Expected: FAIL — `src/lib/replace-preview.ts` doesn't exist.

- [ ] **Step 3: Create `src/lib/replace-preview.ts`**

EXACT contents:

```ts
import type { FindOptions } from './tauri';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compute what `replacement` would expand to for a single match of `query`
 * inside `oldSpan`. Mirrors Rust's `regex::Regex::replace` semantics for the
 * common case (literal escape when regex=off, whole_word wrapping, case flag).
 *
 * On any JS RegExp construction error (e.g. Rust-only syntax like `?P<name>`),
 * returns the literal `replacement` string so the preview degrades gracefully.
 * The actual file write in Rust is unaffected by this helper.
 */
export function expandBackrefs(
  oldSpan: string,
  query: string,
  replacement: string,
  opts: FindOptions,
): string {
  try {
    let pattern = opts.regex ? query : escapeRegex(query);
    if (opts.whole_word) pattern = `\\b(?:${pattern})\\b`;
    const flags = opts.case_sensitive ? '' : 'i';
    const re = new RegExp(pattern, flags);
    return oldSpan.replace(re, replacement);
  } catch {
    return replacement;
  }
}
```

- [ ] **Step 4: Run the tests**

```powershell
npm test -- replace-preview
```

Expected: 4 PASS.

- [ ] **Step 5: tsc**

```powershell
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/replace-preview.ts src/tests/replace-preview.test.ts
git commit -m "replace-preview: expandBackrefs helper + 4 tests"
```

---

## Task 2: Thread `query` + `opts` through `Snippet` and call `expandBackrefs`

**Files:**
- Modify: `src/components/SearchPanel.tsx`

- [ ] **Step 1: Add the import at the top of `src/components/SearchPanel.tsx`**

Alongside the existing imports, add:

```ts
import { expandBackrefs } from '../lib/replace-preview';
```

- [ ] **Step 2: Replace the `Snippet` function**

Find the existing `function Snippet({ text, ranges, replacement }: { … }) { … }` near the bottom of the file. Replace its entire definition with:

```tsx
function Snippet({ text, ranges, replacement, query, opts }: {
  text: string;
  ranges: [number, number][];
  replacement?: string;
  query: string;
  opts: FindOptions;
}) {
  if (ranges.length === 0) return <span>{text}</span>;
  const parts: import('react').ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([s, e], i) => {
    if (s > cursor) parts.push(<span key={`p${i}`}>{text.slice(cursor, s)}</span>);
    const oldSpan = text.slice(s, e);
    if (typeof replacement === 'string') {
      const newSpan = expandBackrefs(oldSpan, query, replacement, opts);
      parts.push(<s key={`o${i}`} className="text-neutral-500">{oldSpan}</s>);
      parts.push(<mark key={`n${i}`} className="bg-emerald-500/30 text-emerald-200">{newSpan}</mark>);
    } else {
      parts.push(<mark key={`m${i}`} className="bg-amber-400/30 text-amber-200">{oldSpan}</mark>);
    }
    cursor = e;
  });
  if (cursor < text.length) parts.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{parts}</>;
}
```

- [ ] **Step 3: Update `ResultRow` to accept and pass through `query`**

Find the existing `function ResultRow({ path, match, replacement, opts: _opts }: { … })`. Update the destructure to capture `opts` (not `_opts`) and accept `query`. Update the `<Snippet>` call to forward both:

```tsx
function ResultRow({ path, match, replacement, query, opts }: {
  path: string;
  match: LineMatch;
  replacement?: string;
  query: string;
  opts: FindOptions;
}) {
  return (
    <button
      type="button"
      data-testid="match-row"
      onClick={async () => {
        const existing = useBuffers.getState().buffers.find((b) => b.path === path);
        if (!existing) {
          try {
            const opened = await openFileIpc(path);
            useBuffers.getState().openBuffer(opened);
          } catch { return; }
        }
        const range: [number, number] = match.match_ranges[0] ?? [0, match.line_text.length];
        useBuffers.getState().openFileAtLine(path, match.line_number, range, match.line_text);
      }}
      className="block w-full cursor-pointer truncate px-6 py-0.5 text-left text-xs hover:bg-neutral-800"
      title={match.line_text}
    >
      <span className="mr-2 text-neutral-500">{match.line_number}:</span>
      <Snippet text={match.line_text} ranges={match.match_ranges} replacement={replacement} query={query} opts={opts} />
    </button>
  );
}
```

(`opts` previously was unused — destructured as `_opts`. It is now actively passed to `Snippet`.)

- [ ] **Step 4: Update `FileGroup` to accept and forward `query`**

Find the existing `function FileGroup({ file, replacement, opts }: { … })`. Add `query` to props and forward it to each `<ResultRow>`:

```tsx
function FileGroup({ file, replacement, query, opts }: {
  file: FileMatch;
  replacement?: string;
  query: string;
  opts: FindOptions;
}) {
  const short = file.path.split(/[/\\]/).pop() ?? file.path;
  return (
    <div className="border-b border-neutral-800">
      <div className="truncate px-3 py-1 text-xs text-neutral-400" title={file.path}>{short}</div>
      <ul>
        {file.matches.map((m, i) => (
          <li key={i}>
            <ResultRow path={file.path} match={m} replacement={replacement} query={query} opts={opts} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Update `ResultsBody` to accept and forward `query`**

Find the existing `function ResultsBody({ inFlight, results, replacement, opts, showReplaceUI, onReplaceClick }: { … })`. Add `query` to its props and to each `<FileGroup>` call:

```tsx
function ResultsBody({
  inFlight, results, replacement, query, opts, showReplaceUI, onReplaceClick,
}: {
  inFlight: boolean;
  results: FindResponse | null;
  replacement: string;
  query: string;
  opts: FindOptions;
  showReplaceUI: boolean;
  onReplaceClick: () => void;
}) {
  if (inFlight && !results) return <div className="p-3 text-xs text-neutral-500">Searching…</div>;
  if (!results) return <div className="p-3 text-xs text-neutral-500">Type to search.</div>;
  if (results.error) return <div data-testid="search-error" className="p-3 text-xs text-red-400">{results.error}</div>;
  if (results.files.length === 0) return <div className="p-3 text-xs text-neutral-500">No matches.</div>;

  const total = results.files.reduce((n, f) => n + f.matches.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-auto">
        {results.files.map((f) => (
          <FileGroup
            key={f.path}
            file={f}
            replacement={showReplaceUI ? replacement : undefined}
            query={query}
            opts={opts}
          />
        ))}
      </div>
      <div
        data-testid="search-status"
        className={`flex items-center justify-between gap-2 border-t border-neutral-700 px-3 py-1 text-xs ${
          results.truncated ? 'text-amber-400' : 'text-neutral-500'
        }`}
      >
        <span>
          {results.truncated
            ? `${total.toLocaleString()}+ matches — refine your query`
            : `${total.toLocaleString()} match${total === 1 ? '' : 'es'} in ${results.files.length} file${results.files.length === 1 ? '' : 's'}`}
        </span>
        {showReplaceUI && (
          <button
            type="button"
            data-testid="replace-all"
            onClick={onReplaceClick}
            className="rounded bg-emerald-700 px-2 py-0.5 text-emerald-100 hover:bg-emerald-600"
          >
            Replace All in {results.files.length}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Update the call site in `SearchPanel`**

Find the `<ResultsBody … />` call inside the `SearchPanel` component's return. Add `query={query}`:

```tsx
<ResultsBody
  inFlight={inFlight}
  results={results}
  replacement={replace}
  query={query}
  opts={opts}
  showReplaceUI={replaceVisible}
  onReplaceClick={() => setDialogOpen(true)}
/>
```

(`query` is already in scope as a local `useState` value in `SearchPanel`.)

- [ ] **Step 7: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Expected: tsc clean (per real `npx tsc` output; ignore LSP false positives); all vitest tests green.

- [ ] **Step 8: Commit**

```powershell
git add src/components/SearchPanel.tsx
git commit -m "ui: SearchPanel Snippet renders backref-expanded preview"
```

---

## Task 3: Gates + results doc

**Files:**
- Create: `docs/superpowers/plans/v2-backref-preview-results.md`

- [ ] **Step 1: tsc + vitest**

```powershell
npx tsc --noEmit
npm test
```

Capture vitest total (expected: pre-slice baseline + 4 replace-preview tests). The exact baseline depends on what the worktree branches from; just record the actual number.

- [ ] **Step 2: cargo (sanity — no Rust changes)**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cd src-tauri
cargo test --lib
cd ..
```

Capture the actual number (should equal the worktree's pre-slice cargo baseline).

- [ ] **Step 3: Release build**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture MSI + app.exe sizes. No new code paths in production — sizes should be within rounding of the previous slice.

- [ ] **Step 4: Skip `npm run e2e`** — no new e2e tests; deferred to manual verification.

- [ ] **Step 5: Write results doc**

Create `docs/superpowers/plans/v2-backref-preview-results.md`:

```markdown
# v2 Backref-Aware Replace Preview — Results

## Automated test gates

- Vitest: <N> tests passing (+4 from replace-preview)
- cargo test: <N> tests passing (no change)
- e2e (WebdriverIO): no new tests; existing coverage unchanged
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: <X.XX> MB
- app.exe size: <X.XX> MB

## What shipped

- `src/lib/replace-preview.ts` — `expandBackrefs` pure helper + 4 tests
- `src/components/SearchPanel.tsx` — `Snippet` now receives `query` + `opts` and calls `expandBackrefs` to expand `$1`/`$&` etc. in the preview. `ResultsBody`, `FileGroup`, and `ResultRow` all forward the new prop.
- No Rust changes; the actual replace write is unchanged.

## What is intentionally NOT in this slice

- Live IPC on every keystroke
- Toast / banner UI for JS-vs-Rust regex divergence
- Support for Rust-only regex features in the preview (falls back to literal)

## Follow-ups (next v2 slices)

1. Split view (most invasive remaining slice)
2. Rename `TabContextMenu` → `ContextMenu` (polish from slice 6)
```

Fill in the actual numbers.

- [ ] **Step 6: Commit**

```powershell
git add docs/superpowers/plans/v2-backref-preview-results.md
git commit -m "v2 backref-aware replace preview: record results"
```

---

## Self-review notes (don't delete)

**Spec coverage check:**

| Spec section | Covered by |
| --- | --- |
| `escapeRegex` + `expandBackrefs` pure helpers | Task 1 |
| 4 vitest cases (group backref, `$&`, literal `$5`, fallback on invalid pattern) | Task 1 |
| `Snippet` consumes `expandBackrefs` | Task 2 |
| `Snippet` accepts `query` + `opts` props | Task 2 |
| `ResultRow` forwards `query` to `Snippet` | Task 2 |
| `FileGroup` forwards `query` to `ResultRow` | Task 2 |
| `ResultsBody` forwards `query` to `FileGroup` | Task 2 |
| `SearchPanel` call site passes `query={query}` | Task 2 |
| Graceful fallback when `new RegExp(...)` throws | Task 1 (impl) + verified by test 4 |
| Gates + results doc | Task 3 |

**Placeholder scan:** None.

**Type / signature consistency:**
- `expandBackrefs(oldSpan: string, query: string, replacement: string, opts: FindOptions): string` consistent between definition (Task 1) and consumer (Task 2).
- `FindOptions` is the existing TS type from `src/lib/tauri.ts` (slice 1). No new imports needed beyond what Task 2's `import type { FindOptions }` already provides.
- `Snippet` props after Task 2: `{ text, ranges, replacement?, query, opts }`. Both `replacement` AND `opts`+`query` get destructured.
- `ResultRow` props after Task 2: `{ path, match, replacement?, query, opts }`. Note: slice-3's existing impl destructured `opts: _opts` (unused with underscore prefix). Task 2 renames it back to `opts` because it's now used in the forwarded prop.
- `FileGroup` props after Task 2: `{ file, replacement?, query, opts }`.
- `ResultsBody` props after Task 2: `{ inFlight, results, replacement, query, opts, showReplaceUI, onReplaceClick }`.

**Notes for executor:**
- This plan does NOT push to remote and does NOT merge to main (matches the user's standing "do not commit until I say so" boundary; local commits in the worktree are allowed per the established workflow).
- The existing `_opts` underscore-prefix in `ResultRow` is a small mark of "this is unused but threaded for future use". Slice 7 is that future use — drop the underscore.
- If `tsc --noEmit` complains about unused-locals in any other intermediate destructure, the executor should rename the destructure (e.g. `query` → `_query`) only when the value really isn't used in that function body. Right now every component in the threading chain (ResultsBody, FileGroup, ResultRow, Snippet) genuinely consumes `query`.
