# Backref-Aware Replace Preview — v2 Slice 7 Design

Date: 2026-05-29
Status: Approved (awaiting implementation plan)
Predecessor: `2026-05-28-replace-in-files-design.md` (slice 3; introduced the Snippet preview)

## Goal

In the SearchPanel's replace preview, expand regex backreferences (`$1`, `$&`, etc.) in the replacement string so the user sees the actual substituted text per match rather than the literal replacement template. The actual write still happens in Rust via `regex::Regex::replace_all`; this slice only fixes the preview render. Smallest v2 slice.

## Non-goals

- **Live IPC on every keystroke** to ask Rust to substitute. Preview stays client-side.
- **Toast / error UI** for regex syntax mismatches between JS and Rust. Silent fallback to literal.
- **Named capture groups** in preview if JS doesn't support the exact syntax (`(?<name>…)` works in modern JS; `?P<name>` from Python/Rust does not). Documented as a small gotcha; common cases work.
- **Changing the existing Rust replace semantics.** No backend changes.

## Pillars

1. **Pure helper.** All logic lives in `src/lib/replace-preview.ts` so vitest can test it without React.
2. **Graceful fallback.** If `new RegExp(...)` throws (e.g. a Rust-specific pattern feature JS doesn't recognize), the preview falls back to showing the literal replacement string. The actual write is still correct because it uses the Rust regex crate.
3. **Match the Rust matcher's options.** Construct the JS regex with the same case-sensitive / whole-word / literal-escape rules `search.rs::build_matcher_pattern` uses.

## Architecture

### `src/lib/replace-preview.ts` (new, ~20 LOC)

```ts
import type { FindOptions } from './tauri';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

Behavior:
- `escapeRegex` matches the same character set Rust's `regex::escape` produces for the literal case.
- `whole_word` wrapping mirrors `build_matcher_pattern`'s `\b(?:...)\b`.
- JS RegExp's `i` flag (case-insensitive) covers what Rust's `RegexBuilder::case_insensitive(true)` does for ASCII; Unicode case folding may diverge in rare cases but is not a v1 concern.
- The replace call runs `String.prototype.replace(regexp, replacement)`. JS treats `$1`, `$&`, `$$` specially regardless of whether captures exist — this aligns with Rust's `regex` crate behavior for the same tokens.
- `try/catch` protects against `new RegExp(...)` throwing on patterns JS doesn't accept (Rust-only syntax).

### `src/components/SearchPanel.tsx` modifications

The current `Snippet` function (from slice 3) signature:

```ts
function Snippet({ text, ranges, replacement }: {
  text: string;
  ranges: [number, number][];
  replacement?: string;
}) { … }
```

Inside the loop, it currently renders `<mark>{replacement}</mark>` literally for each match. Change to expand backrefs:

```ts
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

Add at the top of the file:

```ts
import { expandBackrefs } from '../lib/replace-preview';
```

Thread `query` + `opts` through the existing chain `ResultRow` → `Snippet`. Slice 3 already passes `opts` to `ResultRow` and `replacement` to `Snippet`; this slice just adds `query` to both, and ensures `opts` is forwarded into `Snippet`.

The parent `SearchPanel` already owns `query` (the find input state) and `opts` (the toggles state) — pass them down via the new props.

## Data flow

1. User types in the find input → `query` updates.
2. User toggles regex/case/whole-word → `opts` updates.
3. User types in the replace input → `replace` (state) updates.
4. `Snippet` re-renders for every visible match; for each match it calls `expandBackrefs(oldSpan, query, replacement, opts)` to compute what the substitution would look like.
5. The user clicks Replace All → existing slice-3 flow invokes Rust `replace_in_files`, which uses Rust's `regex::Regex::replace_all` — same backref semantics.

## Error handling

| Scenario | Behavior |
| --- | --- |
| Empty query (user hasn't typed yet) | Snippet has no matches → returns plain text → expandBackrefs never called. |
| Empty replacement string | `expandBackrefs` runs `oldSpan.replace(re, '')` which returns `''`. Preview shows strikethrough-old next to an empty mark — visually "this gets deleted". Matches slice 3's "Delete N matches" confirm copy. |
| Invalid regex (with `regex: true`) | `new RegExp(...)` throws → caught → fallback to literal `replacement` string. The Search panel's existing error path (red banner) already disables the Replace All button, so the preview being slightly off doesn't matter. |
| Rust-only regex feature in pattern (e.g. `(?P<name>...)`) | `new RegExp(...)` throws → fallback to literal. |
| Backref number with no matching group (e.g. `$5` when query has no groups) | JS `String.replace` passes `$5` through literally. Matches Rust behavior. |
| `$$` in replacement | Both JS and Rust expand to literal `$`. Consistent. |
| `$&` in replacement | Both expand to the entire match. Consistent. |
| Whole-word toggle + a query that JS interprets differently inside `\b(?:...)\b` | Rare; caught by try/catch fallback to literal. |

## Testing

### Vitest — `src/tests/replace-preview.test.ts` (target 4 cases)

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
    // Rust-only syntax: P<name> named groups
    const ruleish = { regex: true, case_sensitive: true, whole_word: false } as const;
    expect(
      expandBackrefs('alpha', '(?P<word>\\w+)', '$word', ruleish)
    ).toBe('$word');
  });
});
```

### Gates to ship

- vitest: +4 from `replace-preview` tests
- cargo test: no change
- e2e: no change
- `tsc --noEmit` clean
- Manual smoke: open Memopad's source folder, search regex `(\w+)Buffer`, type replacement `$1Mark` in the replace input, verify the preview shows expanded text (e.g. `EmptyBuffer` → `EmptyMark`) instead of `$1Mark` literally.

## Risks and open questions

- **JS RegExp vs Rust `regex` crate divergence.** For 99% of patterns the user will type, behavior is identical. The catch-all fallback to literal handles the remainder.
- **`$NN` (two-digit group references)** are supported in both engines for groups ≤ 99. Same behavior.
- **Lookahead `(?=...)` and lookbehind `(?<=...)`** — both supported in modern JS engines (V8/WebView2 ≥ Edge 79). Same as Rust regex with the `unicode` feature. Edge cases are unlikely to bite v1 users.
- **Renaming `Snippet` props** — `query` and `opts` were already supposed to be threaded per slice 3's spec but ended up unused in the impl. Threading them now is the right cleanup, not new tech debt.
