# Bracket Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Go to Matching Bracket" and "Select to Matching Bracket" commands that move/extend the caret to the bracket matching the one adjacent to it.

**Architecture:** A pure helper `matchingBracketTarget(state, pos)` wraps CodeMirror's `matchBrackets` (syntax-tree-aware, with plain-text fallback) and returns the caret destination. Thin command wrappers in `EditorPane` dispatch the selection; they're reached via a `Ctrl+Shift+\` keymap entry and a focused-pane `__memopadBracketCommand` window global, with two palette commands in `builtins.ts`. Frontend-only — no Rust, no persistence.

**Tech Stack:** TypeScript, React, CodeMirror 6 (`@codemirror/language`, `@codemirror/state`, `@codemirror/view`), Zustand, vitest, WebdriverIO + Mocha (e2e).

**Spec:** `docs/superpowers/specs/2026-06-07-bracket-nav-design.md`

---

## File Structure

- `src/lib/brackets.ts` — **new**. Pure `matchingBracketTarget(state, pos): number | null`. One responsibility: given a caret position, compute the matching-bracket destination.
- `src/tests/brackets.test.ts` — **new**. Unit tests for the helper.
- `src/components/EditorPane.tsx` — **modify**. Two command wrappers, a keymap entry, and the `__memopadBracketCommand` focused-pane global.
- `src/commands/builtins.ts` — **modify**. Two palette commands.
- `tests/e2e/bracket-nav.spec.ts` — **new**. e2e behavior + command registration.
- Version files + `CHANGELOG.md` — **modify** at the end (1.2.0).

---

## Task 1: Pure helper `matchingBracketTarget` + unit tests

**Files:**
- Create: `src/lib/brackets.ts`
- Test: `src/tests/brackets.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/brackets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EditorState, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { matchingBracketTarget } from '../lib/brackets';

const stateFor = (doc: string, extensions: Extension[] = []) =>
  EditorState.create({ doc, extensions });

describe('matchingBracketTarget', () => {
  it('caret before an opening bracket → lands after the matching close', () => {
    // "(foo)": '(' at 0, ')' at 4. Caret at 0 → after ')' = 5.
    expect(matchingBracketTarget(stateFor('(foo)'), 0)).to.equal(5);
  });

  it('caret after a closing bracket → lands before the matching open', () => {
    // Caret at 5 (after ')') → before '(' = 0.
    expect(matchingBracketTarget(stateFor('(foo)'), 5)).to.equal(0);
  });

  it('resolves the correct partner when brackets nest', () => {
    // "(a(b)c)": outer '(' 0 / ')' 6, inner '(' 2 / ')' 4.
    // Caret at 0 (only the outer '(' is adjacent) → after outer ')' = 7.
    expect(matchingBracketTarget(stateFor('(a(b)c)'), 0)).to.equal(7);
    // Caret at 2 (only the inner '(' is adjacent) → after inner ')' = 5.
    expect(matchingBracketTarget(stateFor('(a(b)c)'), 2)).to.equal(5);
  });

  it('returns null when the caret is not adjacent to a bracket', () => {
    // "(foo)": caret at 2 is between 'f' and 'o'.
    expect(matchingBracketTarget(stateFor('(foo)'), 2)).to.equal(null);
  });

  it('returns null for a mismatched or unbalanced bracket', () => {
    expect(matchingBracketTarget(stateFor('(]'), 0)).to.equal(null);
    expect(matchingBracketTarget(stateFor('(foo'), 0)).to.equal(null);
  });

  it('matches inside a real language grammar (tree-aware path)', () => {
    // "function f(){}": '(' at 10, ')' at 11. Caret at 10 → after ')' = 12.
    const s = stateFor('function f(){}', [javascript()]);
    expect(matchingBracketTarget(s, 10)).to.equal(12);
  });

  it('ping-pongs: applying the target twice returns to the start', () => {
    const s = stateFor('(foo)');
    const a = matchingBracketTarget(s, 0);
    expect(a).to.equal(5);
    expect(matchingBracketTarget(s, a as number)).to.equal(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/tests/brackets.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/brackets"` (module doesn't exist yet).

- [ ] **Step 3: Implement the helper**

Create `src/lib/brackets.ts`:

```ts
import { EditorState } from '@codemirror/state';
import { matchBrackets } from '@codemirror/language';

type Match = ReturnType<typeof matchBrackets>;

/** A bracket was found AND it has a balanced partner of the correct type. */
function usable(m: Match): m is NonNullable<Match> & { end: { from: number; to: number } } {
  return !!m && m.matched && !!m.end;
}

/**
 * Return the caret destination at the bracket matching the one adjacent to `pos`,
 * or null when the caret is not next to a balanced bracket.
 *
 * Looks for a bracket immediately before the caret (dir -1) first, then
 * immediately after it (dir +1) — matching CodeMirror's own bracket-matching
 * precedence so navigation agrees with the highlight. Falls through on
 * "found but no valid match" (not just null) to handle the sandwiched case ")(".
 * The destination is the far side of the partner bracket (the side pointing away
 * from the start bracket) so repeated invocations ping-pong between the pair.
 */
export function matchingBracketTarget(state: EditorState, pos: number): number | null {
  let m = matchBrackets(state, pos, -1);
  if (!usable(m)) m = matchBrackets(state, pos, 1);
  if (!usable(m)) return null;
  const { start, end } = m;
  return end.from > start.from ? end.to : end.from;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/tests/brackets.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: clean exit (0). (Ignore any LSP/editor diagnostics — trust `tsc`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/brackets.ts src/tests/brackets.test.ts
git commit -m "feat: matchingBracketTarget helper for bracket navigation"
```

---

## Task 2: EditorPane command wrappers + keymap + window global

**Files:**
- Modify: `src/components/EditorPane.tsx`

There is no clean vitest path for these wrappers (they need a live `EditorView`); they are validated by `tsc` here and behaviorally by the Task 4 e2e. The matching logic itself is already covered by Task 1.

- [ ] **Step 1: Import the helper**

In `src/components/EditorPane.tsx`, add to the imports near the other `../lib` imports (the file already imports from `../lib/language`):

```ts
import { matchingBracketTarget } from '../lib/brackets';
```

- [ ] **Step 2: Add the command wrappers (module scope)**

Add these two functions at module scope, just **above** `export interface EditorPaneProps` (after the `declare global` block):

```ts
function goToMatchingBracket(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const target = matchingBracketTarget(view.state, pos);
  if (target == null) return false;
  view.dispatch({
    selection: { anchor: target, head: target },
    effects: EditorView.scrollIntoView(target),
  });
  return true;
}

function selectToMatchingBracket(view: EditorView): boolean {
  const { anchor, head } = view.state.selection.main;
  const target = matchingBracketTarget(view.state, head);
  if (target == null) return false;
  view.dispatch({
    selection: { anchor, head: target },
    effects: EditorView.scrollIntoView(target),
  });
  return true;
}
```

- [ ] **Step 3: Declare the window global**

In the `declare global` block, add alongside `__memopadLineCommand` (keep the existing eslint-disable comment style):

```ts
  // eslint-disable-next-line no-var
  var __memopadBracketCommand: ((cmd: 'goto' | 'select') => void) | undefined;
```

- [ ] **Step 4: Add the keymap binding**

Find the existing keymap line in the `extensions` array:

```ts
            Prec.high(keymap.of([{ key: 'Mod-d', run: copyLineDown, preventDefault: true }])),
```

Replace it with:

```ts
            Prec.high(keymap.of([
              { key: 'Mod-d', run: copyLineDown, preventDefault: true },
              { key: 'Mod-Shift-\\', run: goToMatchingBracket, preventDefault: true },
            ])),
```

- [ ] **Step 5: Register/clear the window global in the focused effect**

In the focused-pane effect (the one that sets `globalThis.__memopadLineCommand`), add the registration right after the `__memopadLineCommand` assignment block:

```ts
    globalThis.__memopadBracketCommand = (cmd) => {
      const v = viewRef.current;
      if (!v) return;
      (cmd === 'select' ? selectToMatchingBracket : goToMatchingBracket)(v);
      v.focus();
    };
```

And in that effect's cleanup `return () => { ... }`, add alongside the other resets:

```ts
      globalThis.__memopadBracketCommand = undefined;
```

- [ ] **Step 6: Verify types**

Run: `npx tsc --noEmit`
Expected: clean exit (0).

- [ ] **Step 7: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "feat: bracket-nav command wrappers, Ctrl+Shift+\\ keymap, window global"
```

---

## Task 3: Palette commands in builtins

**Files:**
- Modify: `src/commands/builtins.ts`

- [ ] **Step 1: Register the two commands**

In `src/commands/builtins.ts`, inside `registerBuiltins()`, add right **after** the `edit.deleteLine` registration block (the last of the line-op commands, ending at the `});` for delete line):

```ts
  register({
    id: 'edit.goToMatchingBracket',
    title: 'Edit: Go to Matching Bracket',
    shortcut: 'Ctrl+Shift+\\',
    run: () => globalThis.__memopadBracketCommand?.('goto'),
  });
  register({
    id: 'edit.selectToMatchingBracket',
    title: 'Edit: Select to Matching Bracket',
    run: () => globalThis.__memopadBracketCommand?.('select'),
  });
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: clean exit (0). (`__memopadBracketCommand` is declared on `globalThis` from Task 2.)

- [ ] **Step 3: Run the full unit suite to confirm nothing regressed**

Run: `npx vitest run`
Expected: PASS (187 prior + 7 new from Task 1 = 194).

- [ ] **Step 4: Commit**

```bash
git add src/commands/builtins.ts
git commit -m "feat: Go to / Select to Matching Bracket palette commands"
```

---

## Task 4: e2e spec + full gate

**Files:**
- Create: `tests/e2e/bracket-nav.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/bracket-nav.spec.ts`:

```ts
import { expect } from 'chai';
import { getBrowser, classicExecute } from './support/driver';

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

describe('bracket navigation', () => {
  beforeEach(async () => {
    await exec(() => {
      (window as unknown as { __memopadTestReset: () => void }).__memopadTestReset();
    });
  });

  it('Go to Matching Bracket jumps the caret to the partner', async () => {
    await exec(() => {
      (window as unknown as {
        __memopadTestOpenBuffer: (f: { path: string; content: string; encoding: string; eol: string }) => string;
      }).__memopadTestOpenBuffer({ path: '/tmp/brk.js', content: '(foo)', encoding: 'utf-8', eol: 'lf' });
    });
    await sleep(120);
    // Deterministically place the caret at offset 0 (before '(') and focus the pane.
    await exec(() => {
      (window as unknown as { __memopadGotoLine?: (n: number) => void }).__memopadGotoLine?.(1);
    });
    await sleep(40);
    await exec(() => {
      (window as unknown as { __memopadBracketCommand?: (c: 'goto' | 'select') => void }).__memopadBracketCommand?.('goto');
    });
    await sleep(60);
    const pos = await classicExecute<{ line: number; col: number }>(
      `return window.__memopadTestCursorPos();`,
    );
    // After ')' in "(foo)" → Ln 1, Col 6 (1-based column).
    expect(pos.line).to.equal(1);
    expect(pos.col).to.equal(6);
  });

  it('registers the bracket-navigation commands', async () => {
    const ids = await classicExecute<string[]>(`return window.__memopadTestCommandIds();`);
    expect(ids).to.include('edit.goToMatchingBracket');
    expect(ids).to.include('edit.selectToMatchingBracket');
  });
});
```

- [ ] **Step 2: Build the release binary and run the full e2e suite**

`npm run test:e2e` runs `tauri build && mocha`, but a plain `tauri build` fails locally on the updater **signing** step (the signing key is a CI-only secret). Use `--no-bundle` to skip bundling/signing while still producing `app.exe`:

Run: `(npx tauri build --no-bundle && npx mocha) 2>&1 | tee e2e-bracket.log`
Expected: all specs pass — **87 passing** (85 prior + 2 new), **0 failing**. Confirm the two new `bracket navigation` specs are green in the output.

(If `npx mocha` exits non-zero only on the `zz-close` teardown while every test shows a ✔, re-run `npx mocha` alone — the teardown ERROR logs are a known red herring; all tests still pass.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/bracket-nav.spec.ts
git commit -m "test: e2e for bracket navigation"
```

---

## Task 5: Version bump to 1.2.0 + CHANGELOG

**Files:**
- Modify: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `CHANGELOG.md`

- [ ] **Step 1: Bump the three version fields to 1.2.0**

- `package.json` line 4: `"version": "1.1.0",` → `"version": "1.2.0",`
- `src-tauri/tauri.conf.json` line 4: `"version": "1.1.0",` → `"version": "1.2.0",`
- `src-tauri/Cargo.toml` line 3: `version = "1.1.0"` → `version = "1.2.0"`

- [ ] **Step 2: Refresh Cargo.lock**

Run: `cargo update -p app --manifest-path src-tauri/Cargo.toml`
Expected: `Updating app v1.1.0 -> v1.2.0`. (The Cargo package name is `app`, not `memopad`.)

- [ ] **Step 3: Add the CHANGELOG entry**

In `CHANGELOG.md`, replace the `## [Unreleased]` line with:

```markdown
## [Unreleased]

## [1.2.0] — 2026-06-07

### Added

- **Bracket navigation** — **Go to Matching Bracket** (`Ctrl+Shift+\`) jumps the caret
  between a bracket and its partner; **Select to Matching Bracket** extends the
  selection to it. Both are in the command palette ("Edit: Go to / Select to Matching
  Bracket") and are syntax-aware, working across `()`, `[]`, and `{}`.
```

- [ ] **Step 4: Verify the bump**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; vitest 194 passing.

- [ ] **Step 5: Commit**

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md
git commit -m "chore: 1.2.0 — bracket navigation"
```

---

## Integration (after all tasks pass — requires explicit user go-ahead)

Not a TDD task. Once gates are green (tsc clean · vitest 194 · cargo 124 · e2e 87) and the **user explicitly approves the outward/irreversible steps**, integrate via `superpowers:finishing-a-development-branch`:

1. `git checkout main && git pull --ff-only`
2. `git merge --no-ff feature/bracket-nav` (merge message summarizing the feature + gates)
3. `git push origin main`
4. `git tag -a v1.2.0 -m "Memopad 1.2.0 — bracket navigation"` then `git push origin v1.2.0`
5. Watch `release.yml` (`gh run watch …`) to confirm the signed release publishes.
6. Update memory: `project_memopad.md` (1.2.0 entry + frontmatter) and `known-e2e-failures.md` (87/87).
7. Delete the merged local branch.
```
