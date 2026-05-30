# Plan: Get the full e2e suite green

Date: 2026-05-30
Branch: `fix/quick-open-e2e` (worktree)
Baseline: 55 passing / 10 failing across 5 specs.

## Root causes (from systematic-debugging Phase 1)

1. **Missing test hook `__memopadTestGetActiveBufferPath`** — never registered. Tests
   that verify "which file opened" fall through to broken fallback selectors
   (`[data-testid^="tab-"]`, `[data-tauri-drag-region]` — real markup is `role="tab"`
   / `.drag-region`). The files DO open; only verification fails.
   Affects: quick-open(1), file-tree(1), find-in-files(click-match).

2. **Sidebar defaults to the `files` (file-tree) tab; SearchPanel only mounts on the
   `search` tab. `Ctrl+Shift+F` does not switch to the search tab** —
   `__memopadOpenSidebarAndFocusFind` only opens the sidebar + focuses a non-mounted
   input. This is a **real app regression** introduced by the file-tree feature.
   Affects: replace-in-files(2) [app bug], find-in-files(SearchPanel/results) [tests
   assume search shows on workspace-set].

3. **Stale layout assertion** — title bar gained a 5th button (the legit sidebar-toggle
   ☰); layout asserts 4. Affects: layout(button-count).

4. **State leakage** — a prior spec leaves the sidebar open; layout's `beforeEach`
   resets buffers but not the sidebar, so the editor doesn't fill `main`. Passes
   isolated, fails in-suite. Affects: layout(editor-fills-main, empty-state-width).

## Changes

### App
- **`src/main.tsx`**: register
  `__memopadTestGetActiveBufferPath = () => selectActive(useBuffers.getState())?.path ?? null`
  (+ type decl). Fixes RC #1 verification.
- **`src/components/Sidebar.tsx`**: register `__memopadShowSearchPanel = () => setActiveTab('search')`.
- **`src/App.tsx`**: `__memopadOpenSidebarAndFocusFind` opens the sidebar, switches to the
  search tab, then focuses the find input. Fixes RC #2 (the real regression).

### Tests
- **`tests/e2e/layout.spec.ts`**: expect 5 title-bar buttons (update comment); close the
  sidebar in `beforeEach` to stop cross-spec leakage.
- **`tests/e2e/find-in-files.spec.ts`**: drive find-in-files via `Ctrl+Shift+F` (the real
  flow) so the SearchPanel mounts; fix the `.drag-region` fallback selector.
- **`tests/e2e/quick-open.spec.ts`**: fix the dead `[role="tab"]` fallback selector.
- **`tests/e2e/file-tree.spec.ts`**: fix the `.drag-region` fallback selector.

## Verification gates (in the worktree)
- `npx tsc --noEmit` clean
- `npx vitest run` green (124/124)
- `npm run tauri build` (benign signing error OK)
- `npx mocha` — full e2e suite green (65/65)

## Out of scope
Version bump 0.2.0 → 0.3.0 + release notes happen after the suite is green.
