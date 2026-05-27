# Memopad Phase 7 — Ship Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Memopad genuinely distributable. CI runs the full e2e suite on every push to `main`. Tagging `v*.*.*` triggers an automated release workflow that builds the signed MSI/NSIS bundles, generates `latest.json`, and uploads everything to a GitHub Release. A polished README invites new users; a CHANGELOG records what shipped. After Phase 7 merges, the user runs through a documented one-time setup (create GitHub repo, generate Tauri signing keypair, store private key as GitHub secret) and pushes a `v0.1.0-rc1` tag to validate the pipeline end-to-end — this is the **final manual verification** of v1.

**Architecture:** Two new GitHub Actions workflows — `e2e.yml` runs the WebdriverIO suite on Windows runners (push to main + manual dispatch, expensive so not on every PR), `release.yml` is tag-triggered and delegates to `tauri-apps/tauri-action@v0` for the heavy lifting (signed bundle build + GitHub Release upload + `latest.json` generation). Code-signing certificate path is documented but not active — we ship unsigned MSI for v1; SmartScreen warning is acknowledged in the install instructions. README and CHANGELOG are static markdown. The Tauri updater pubkey moves from the Phase 6 placeholder string to a real value the user generates locally.

**Tech Stack:** GitHub Actions, `tauri-apps/tauri-action@v0`, existing Tauri 2 / Rust / Node stack. No new application dependencies.

**Spec section reference:** No new feature surface. This phase closes the ship-infra follow-ups documented in `phase-5-results.md` and `phase-6-results.md`.

---

## File Structure

```
memopad/
├── .github/
│   └── workflows/
│       ├── ci.yml                     (unchanged — Phase 6)
│       ├── e2e.yml                    CREATE — e2e on push-to-main + manual dispatch
│       └── release.yml                CREATE — tag-triggered release build
├── docs/
│   ├── images/
│   │   ├── memopad-dark.png           CREATE — vendored screenshot for README
│   │   ├── memopad-light.png          CREATE
│   │   └── memopad-find.png           CREATE
│   └── superpowers/
│       └── notes/
│           ├── release-process.md     MODIFY — reference automated workflow
│           └── github-setup.md        CREATE — one-time setup checklist
├── README.md                          CREATE — install + features + screenshots
├── CHANGELOG.md                       CREATE — Keep a Changelog format
└── src-tauri/
    └── tauri.conf.json                MODIFY — replace placeholder pubkey (still a documented placeholder pattern; real value injected at release time)
```

Boundary intent:

- **`README.md`** is the public-facing project page. Badges, screenshots, install + uninstall, features, license.
- **`CHANGELOG.md`** follows [Keep a Changelog](https://keepachangelog.com/). Each release writes one entry.
- **`.github/workflows/e2e.yml`** is the slow CI job (15-30 min). Runs on `push: branches: [main]` and `workflow_dispatch`. Does not gate PRs because of cost.
- **`.github/workflows/release.yml`** is the deploy pipeline. Triggered on `push: tags: [v*]`.
- **`docs/superpowers/notes/github-setup.md`** is a checklist the user follows once. After it, releases are `git tag v0.1.0 && git push --tags` and the workflow does the rest.

---

## Task 1: Capture polished screenshots for the README

**Files:**
- Create: `docs/images/memopad-dark.png`
- Create: `docs/images/memopad-light.png`
- Create: `docs/images/memopad-find.png`

We need three screenshots: a dark-themed editor with code, a light-themed editor with code, and the find/replace strip in action. We capture them through the e2e harness, then commit to the repo (not `tests/e2e/*.png` — those are gitignored). The images live under `docs/images/` so they're reasonable to include in a markdown README.

- [ ] **Step 1: Write a one-off capture script**

Create `tests/e2e/_readme-shots.ts` (underscore prefix so Mocha doesn't pick it up):

```ts
import { startDriverAndSession, stopDriverAndSession, getBrowser } from './support/driver';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function exec<T>(fn: () => T): Promise<T> {
  return getBrowser().execute(fn);
}

async function shot(file: string) {
  await getBrowser().saveScreenshot(file);
  console.log('saved', file);
}

async function main() {
  const outDir = path.join('docs', 'images');
  fs.mkdirSync(outDir, { recursive: true });

  await startDriverAndSession();
  try {
    // Force dark theme + load a Rust sample.
    await exec(() => {
      const w = window as unknown as {
        __memopadTestReset: () => void;
        __memopadTestRunCommand: (id: string) => void;
        __memopadTestNewBuffer: () => string;
        __memopadTestSetContent: (s: string) => void;
      };
      w.__memopadTestReset();
      w.__memopadTestRunCommand('theme.dark');
      w.__memopadTestNewBuffer();
      w.__memopadTestSetContent(
        'fn main() {\n    let name = "memopad";\n    let count = 7;\n    if count > 0 {\n        println!("{}: {} files", name, count);\n    }\n}\n',
      );
    });
    await sleep(600);
    await shot(path.join(outDir, 'memopad-dark.png'));

    // Switch to light theme.
    await exec(() => {
      (window as unknown as { __memopadTestRunCommand: (id: string) => void }).__memopadTestRunCommand('theme.light');
    });
    await sleep(400);
    await shot(path.join(outDir, 'memopad-light.png'));

    // Open find strip, type a query, restore dark.
    await exec(() => {
      (window as unknown as { __memopadTestRunCommand: (id: string) => void }).__memopadTestRunCommand('theme.dark');
    });
    await sleep(300);
    await getBrowser().keys(['Control', 'f']);
    await sleep(400);
    // Drive the find input via DOM event because the focus is on the input.
    await getBrowser().execute(() => {
      const inp = document.querySelector('[data-search-find-input]') as HTMLInputElement | null;
      if (!inp) return;
      inp.focus();
      inp.value = 'count';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(400);
    await shot(path.join(outDir, 'memopad-find.png'));
    await getBrowser().keys('Escape');
  } finally {
    await stopDriverAndSession();
  }
}

main().catch((err) => { console.error('shots failed:', err); process.exit(1); });
```

- [ ] **Step 2: Run the script**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
npx tsx tests/e2e/_readme-shots.ts
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

Bash timeout: 600000 (10 min).

Expected: three "saved" lines. The release binary must already be built (which it is at this point in the phase, from Phase 6's results commit).

- [ ] **Step 3: Verify the screenshots**

```powershell
Get-ChildItem docs/images/*.png | Format-Table Name, Length
```

Expected three files, each > 10 KB.

- [ ] **Step 4: Delete the throwaway script**

```powershell
Remove-Item tests/e2e/_readme-shots.ts
```

- [ ] **Step 5: Commit**

```powershell
git add docs/images/
git commit -m "docs: vendor three Memopad screenshots for the README"
```

---

## Task 2: README.md

**Files:**
- Create: `README.md`

The README is the project's public face. Keep it tight: what is this, install, features, screenshots, status badges, license, link to the design doc.

- [ ] **Step 1: Create `README.md`**

EXACT contents:

```markdown
# Memopad

A trim, modern alternative to Notepad++ that does two things noticeably better:

- **Never loses your work.** Every keystroke is journaled to disk within 250 ms;
  after a force-kill or power cut, every dirty buffer comes back exactly as you
  left it.
- **Looks good out of the box.** Warm-neutral light and dark themes, JetBrains
  Mono bundled, chromeless title bar, command palette.

![CI](https://github.com/GITHUB_OWNER/memopad/actions/workflows/ci.yml/badge.svg)
![E2E](https://github.com/GITHUB_OWNER/memopad/actions/workflows/e2e.yml/badge.svg)

![Dark theme](docs/images/memopad-dark.png)

## Features

- Multi-buffer editing with drag-reorderable tabs in the title bar
- Syntax highlighting for Rust, JavaScript / TypeScript, JSON, Markdown
- Inline find / replace with regex (`Ctrl+F` / `Ctrl+H`)
- Command palette (`Ctrl+K`) — every action reachable by keyboard
- Memopad Dark + Memopad Light themes, follow system preference by default
- Bulletproof crash recovery — journal-backed dirty buffer restoration
- Session restore — reopen the same tabs on relaunch
- External-change detection with Reload / Keep mine / Diff view
- Encoding-aware (UTF-8, UTF-8 BOM, UTF-16 LE/BE) with round-trip preservation
- Auto-update via GitHub Releases

## Install

Memopad is currently Windows-only. macOS and a web build are planned for v2.

1. Download the latest `Memopad_*.msi` from the [Releases](https://github.com/GITHUB_OWNER/memopad/releases) page.
2. Run the installer. Windows SmartScreen will show an "unrecognized app" warning
   because the binary is not yet code-signed. Click **More info → Run anyway**.
3. Launch Memopad from the Start menu.

To uninstall: Settings → Apps → Memopad → Uninstall.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | `Ctrl+K` or `Ctrl+Shift+P` |
| Open file | `Ctrl+O` |
| Save | `Ctrl+S` |
| Save as | `Ctrl+Shift+S` |
| New tab | `Ctrl+N` |
| Close tab | `Ctrl+W` |
| Reopen closed tab | `Ctrl+Shift+T` |
| Next / Previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Find | `Ctrl+F` |
| Replace | `Ctrl+H` |

All shortcuts are also reachable through the command palette.

## Themes

| Memopad Dark | Memopad Light |
| --- | --- |
| ![Dark](docs/images/memopad-dark.png) | ![Light](docs/images/memopad-light.png) |

## Find and replace

![Find strip](docs/images/memopad-find.png)

## Building from source

Prerequisites:

- Node 20+, npm 10+
- Rust 1.75+ (`rustup default stable`)
- Microsoft Visual C++ Build Tools (Desktop development with C++ workload)
- WebView2 runtime (preinstalled on Windows 11)

```powershell
git clone https://github.com/GITHUB_OWNER/memopad.git
cd memopad
npm install
npm run tauri build
```

The MSI and NSIS installers land under `src-tauri/target/release/bundle/`.

## Development

```powershell
npm run dev          # Vite dev server only
npm run tauri dev    # Vite + Tauri shell, hot reload
npm test             # Vitest UI unit tests
npm run test:e2e     # WebdriverIO end-to-end suite
```

See `docs/superpowers/specs/2026-05-25-memopad-design.md` for the design
specification and `docs/superpowers/plans/` for the implementation history.

## License

MIT. JetBrains Mono is bundled under the SIL Open Font License 1.1.
```

- [ ] **Step 2: TS check (the README isn't TS but it's a sanity that nothing else broke)**

Skip — README is markdown only. Move to commit.

- [ ] **Step 3: Commit**

```powershell
git add README.md
git commit -m "docs: README with install + features + screenshots + shortcuts"
```

---

## Task 3: CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Pre-fills an `[Unreleased]` section + one `[0.1.0]` entry summarizing what shipped.

- [ ] **Step 1: Create `CHANGELOG.md`**

EXACT contents:

```markdown
# Changelog

All notable changes to Memopad are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-27

The first public release. Six implementation phases over the v1 plan.

### Added

- Multi-buffer editing with drag-reorderable tabs in the title bar
- CodeMirror 6 editor with syntax highlighting (Rust, JS/TS, JSON, Markdown)
- Inline find / replace strip with regex and case-sensitive toggles
- Command palette (`Ctrl+K`) with fuzzy search and recent-first ordering
- Memopad Dark + Memopad Light themes; follows system preference
- JetBrains Mono bundled font
- Status bar with clickable encoding + line-ending segments
- Right-click tab context menu (Close, Close Others, Close to Right, Copy Path, Reveal in Explorer)
- Encoding-aware file I/O preserving UTF-8 / UTF-8 BOM / UTF-16 LE / UTF-16 BE
- Atomic save (write to `.tmp`, fsync, rename) — no torn files
- On-disk journal of dirty buffer snapshots — survives `kill -9`
- Session restore — reopens the same tabs and active buffer
- External-change detection on window focus with Reload / Keep / Diff actions
- Per-tab cursor and scroll position restoration
- Auto-update wired to GitHub Releases via Tauri updater
- GitHub Actions CI (TypeScript + Vitest + scoped cargo tests)
- WebdriverIO e2e suite (45 tests against the real release binary)

### Known limitations

- Windows only (macOS and web planned for v2)
- Unsigned MSI — Windows SmartScreen warning on first install
- Find-in-files, file-tree sidebar, and split view are explicit non-goals for v1
```

- [ ] **Step 2: Commit**

```powershell
git add CHANGELOG.md
git commit -m "docs: CHANGELOG.md with v0.1.0 entry"
```

---

## Task 4: Repo-setup checklist for the user

**Files:**
- Create: `docs/superpowers/notes/github-setup.md`

The user needs to do five things ONCE before the release workflow can publish:

1. Create the GitHub repo (or use an existing one).
2. `git remote add origin` + `git push -u origin main`.
3. Generate the Tauri signing keypair locally and put the public key in `tauri.conf.json`.
4. Store the private key + password as GitHub Actions secrets.
5. Push a `v0.1.0-rc1` tag to dry-run the release workflow against a draft GitHub Release.

This task writes the doc. It does NOT execute any of these steps — those are user-driven and run after Phase 7 merges.

- [ ] **Step 1: Create `docs/superpowers/notes/github-setup.md`**

EXACT contents:

```markdown
# GitHub setup (one-time, before the first release)

After Phase 7 merges, you do these five steps once. The release workflow then
publishes a new MSI every time you push a `v*.*.*` tag.

## 1. Create or claim the GitHub repository

If the repo doesn't exist yet, create it on github.com (private or public, your
choice). Note the URL — say `https://github.com/yourname/memopad`.

## 2. Wire up the local checkout to the remote

```powershell
git remote add origin https://github.com/yourname/memopad.git
git push -u origin main
```

`main` should now match the local branch. Push any other branches you want
preserved.

## 3. Generate the Tauri updater signing keypair

The updater requires that every release bundle is signed with a private key,
and the public counterpart is baked into `tauri.conf.json` so the running app
can verify update payloads. Generate the keypair locally:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri -- signer generate -w "$HOME\.tauri\memopad.key"
```

The command prints the public key. **Copy it.** Open
`src-tauri/tauri.conf.json` and replace
`"PLACEHOLDER_REPLACE_WITH_REAL_PUBKEY_BEFORE_FIRST_RELEASE"` (under
`plugins.updater.pubkey`) with the value you just copied. Commit and push.

Also replace `GITHUB_OWNER` in the same file's `endpoints` URL with your actual
GitHub username (e.g. `yourname/memopad`).

## 4. Store the private key as GitHub Actions secrets

On the repo's GitHub page: **Settings → Secrets and variables → Actions →
New repository secret**.

Add two secrets:

| Name | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | the contents of `$HOME\.tauri\memopad.key` (paste the whole file) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password you chose at generate time (empty string if you didn't set one) |

Once both secrets exist, the release workflow can sign bundles automatically.

## 5. Dry-run the release workflow with a release-candidate tag

Push a non-public test tag:

```powershell
git tag v0.1.0-rc1
git push --tags
```

This triggers `.github/workflows/release.yml`. Go to the repo's **Actions** tab
and watch it run. Expected outcome:

- The workflow builds the release MSI + NSIS bundle on a `windows-latest` runner.
- It generates `latest.json` referencing the new bundle.
- A **draft** GitHub Release named `v0.1.0-rc1` appears under **Releases**, with
  the MSI, NSIS, signatures, and `latest.json` attached.
- The draft is NOT published as `latest` — Tauri's updater only looks at the
  release marked `latest`, so the rc1 tag is harmless.

If the workflow succeeds, delete the draft release and the `v0.1.0-rc1` tag,
then push the real tag:

```powershell
git tag -d v0.1.0-rc1
git push --delete origin v0.1.0-rc1
git tag v0.1.0
git push --tags
```

This time, the GitHub Release should be auto-published (the release workflow
publishes non-prerelease tags directly). Verify:

- Visit the release URL — the MSI, NSIS, signatures, and `latest.json` are attached.
- `https://github.com/yourname/memopad/releases/latest/download/latest.json`
  returns a JSON manifest with the version and signature.

## 6. Verify the auto-update path

To prove updates work, you'll cut a second release later. For now, the
single-release setup is enough to ship v0.1.0 to other users.

## Troubleshooting

- **Workflow fails at "sign" step.** Check the secrets are set with the exact
  names above. The whole `memopad.key` file content goes in
  `TAURI_SIGNING_PRIVATE_KEY` — no editing.
- **Draft release doesn't appear.** Look at the workflow logs under Actions.
  The `tauri-apps/tauri-action` step prints the upload URL it used; if it
  failed to authenticate, the `GITHUB_TOKEN` permissions may need to be raised
  (Settings → Actions → General → Workflow permissions → Read and write).
- **`latest.json` 404s.** Open the release page in the browser and confirm
  `latest.json` is in the assets list. The `tauri-apps/tauri-action` v0 emits
  it automatically; if it's missing, the action version may have changed —
  pin to an older release in `.github/workflows/release.yml`.
```

- [ ] **Step 2: Commit**

```powershell
git add docs/superpowers/notes/github-setup.md
git commit -m "docs: one-time GitHub setup checklist (repo, keypair, secrets, tag)"
```

---

## Task 5: E2E CI workflow (push-to-main + manual dispatch)

**Files:**
- Create: `.github/workflows/e2e.yml`

The e2e suite is slow (~10-20 min including release build + driver dance). We don't run it on every PR. We run it on `push` to `main` (so a merged PR is gated) and on `workflow_dispatch` (so you can re-run it on demand).

- [ ] **Step 1: Create `.github/workflows/e2e.yml`**

EXACT contents:

```yaml
name: E2E

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  e2e:
    runs-on: windows-latest
    timeout-minutes: 60

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-pc-windows-msvc

      - name: Cache cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
          key: ${{ runner.os }}-cargo-${{ hashFiles('src-tauri/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-

      - name: Install npm dependencies
        run: npm ci

      - name: Install tauri-driver
        run: cargo install tauri-driver --locked

      - name: Run e2e suite
        run: npm run test:e2e
        env:
          # Keep the WebView from buffering for ages on a fresh runner.
          WEBKIT_DISABLE_COMPOSITING_MODE: 1

      - name: Upload failure artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-screenshots
          path: tests/e2e/*.png
          if-no-files-found: ignore
```

Notes for the reader (not in the file):

- `npm run test:e2e` already does `tauri build && mocha`, so the release binary is built fresh during the workflow.
- `cargo install tauri-driver --locked` is the slowest step on a cold cache (~2-4 min). The cargo cache covers it on subsequent runs.
- We don't preinstall `msedgedriver` — the `edgedriver` npm package downloads it on first use, which the e2e harness already triggers.
- `windows-latest` includes a real desktop session; WebView2 is preinstalled.
- On failure we upload any screenshots the harness wrote so the diff is visible from the Actions UI.

- [ ] **Step 2: Commit**

```powershell
git add .github/workflows/e2e.yml
git commit -m "ci(e2e): WebdriverIO suite on Windows runner, push-to-main + dispatch"
```

---

## Task 6: Release workflow (tag-triggered)

**Files:**
- Create: `.github/workflows/release.yml`

Triggered by pushing `v*.*.*` tags. Delegates to `tauri-apps/tauri-action@v0` which handles the build + sign + upload + manifest dance. Pre-release tags (containing `-rc`, `-alpha`, etc.) create a draft release; final tags publish directly.

- [ ] **Step 1: Create `.github/workflows/release.yml`**

EXACT contents:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  release:
    runs-on: windows-latest
    timeout-minutes: 60
    permissions:
      contents: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-pc-windows-msvc

      - name: Cache cargo
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            src-tauri/target
          key: ${{ runner.os }}-cargo-release-${{ hashFiles('src-tauri/Cargo.lock') }}
          restore-keys: |
            ${{ runner.os }}-cargo-release-

      - name: Install npm dependencies
        run: npm ci

      - name: Decide draft / prerelease
        id: meta
        shell: bash
        run: |
          TAG="${GITHUB_REF#refs/tags/}"
          if [[ "$TAG" =~ -[a-z] ]]; then
            echo "draft=true" >> "$GITHUB_OUTPUT"
            echo "prerelease=true" >> "$GITHUB_OUTPUT"
          else
            echo "draft=false" >> "$GITHUB_OUTPUT"
            echo "prerelease=false" >> "$GITHUB_OUTPUT"
          fi
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"

      - name: Build & publish release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ steps.meta.outputs.tag }}
          releaseName: 'Memopad ${{ steps.meta.outputs.tag }}'
          releaseBody: |
            See [CHANGELOG.md](https://github.com/${{ github.repository }}/blob/main/CHANGELOG.md) for the full list of changes.

            **Install (Windows):** Download `Memopad_*_x64_en-US.msi`, run the installer. Windows SmartScreen will warn because the binary is unsigned — click **More info → Run anyway**.
          releaseDraft: ${{ steps.meta.outputs.draft }}
          prerelease: ${{ steps.meta.outputs.prerelease }}
          includeUpdaterJson: true
          updaterJsonPreferNsis: true
```

Notes:

- `permissions: contents: write` is required so the workflow can publish a release. The default `GITHUB_TOKEN` has read-only contents otherwise.
- `includeUpdaterJson: true` makes the action also emit `latest.json` next to the bundle. `updaterJsonPreferNsis: true` makes the manifest point at the NSIS `.exe` (smaller, auto-updates more reliably than MSI).
- Pre-release tags (anything with `-something` like `-rc1`, `-alpha`) become drafts. Real tags publish directly.
- If `tauri-apps/tauri-action` releases breaking changes between writing this plan and running it, pin the version (e.g. `@v0.5.18`).

- [ ] **Step 2: Commit**

```powershell
git add .github/workflows/release.yml
git commit -m "ci(release): tag-triggered build + sign + upload via tauri-action"
```

---

## Task 7: Update `release-process.md` to reference the automated workflow

**Files:**
- Modify: `docs/superpowers/notes/release-process.md`

The Phase 6 release runbook is now obsolete for the happy path. Most of it stays, but we update the "Cutting a release" section to reference the workflow as the primary path and keep the manual local build as a fallback.

- [ ] **Step 1: Read the current `docs/superpowers/notes/release-process.md`**

It currently documents the fully manual process. We'll rewrite the "Cutting a release" section to lead with the automated path.

- [ ] **Step 2: Overwrite `docs/superpowers/notes/release-process.md`**

EXACT contents:

```markdown
# Memopad release process

Releases are automated by `.github/workflows/release.yml`. The one-time setup
(GitHub repo, signing keypair, secrets) is documented in
[`github-setup.md`](./github-setup.md). Assuming that's done, every release is
three commands.

## Cutting a release (happy path)

1. Bump the version in three places. Use the same string everywhere:
   - `package.json` → `"version": "0.2.0"`
   - `src-tauri/tauri.conf.json` → `"version": "0.2.0"`
   - `src-tauri/Cargo.toml` → `version = "0.2.0"`

2. Update `CHANGELOG.md` — move items from `[Unreleased]` to a new `[0.2.0]`
   section with the date.

3. Commit, tag, push:
   ```powershell
   git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml CHANGELOG.md
   git commit -m "release: v0.2.0"
   git tag v0.2.0
   git push
   git push --tags
   ```

   The release workflow on GitHub Actions then:
   - Builds the signed MSI + NSIS bundle on a `windows-latest` runner.
   - Generates `latest.json` pointing at the NSIS exe.
   - Publishes a GitHub Release `Memopad v0.2.0` with all four assets.
   - Pre-release tags (matching `v*.*.*-*` like `v0.2.0-rc1`) become drafts;
     real semver tags publish directly.

4. Verify the release page on GitHub. Click the MSI link — it should download.
   Check `https://github.com/<owner>/memopad/releases/latest/download/latest.json`
   returns valid JSON with the new version.

5. (Optional) Locally launch an older Memopad and watch for the update banner
   within ~3 seconds. Click **Install and relaunch**.

## Cutting a release (manual / fallback path)

If you need to bypass the workflow (e.g. you don't have GitHub set up, or the
action is broken), build locally:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm test
cd src-tauri; cargo test; cd ..
npx tsc --noEmit
npm run test:e2e

$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.tauri\memopad.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri build
```

Then manually compose `latest.json`:

```json
{
  "version": "0.2.0",
  "notes": "Summary of changes.",
  "pub_date": "2026-05-27T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of Memopad_0.2.0_x64-setup.exe.sig>",
      "url": "https://github.com/<owner>/memopad/releases/download/v0.2.0/Memopad_0.2.0_x64-setup.exe"
    }
  }
}
```

Upload the NSIS exe, its `.sig`, the MSI, and `latest.json` to a GitHub Release
named `Memopad v0.2.0` against the `v0.2.0` tag.

## Code signing (when you obtain a cert)

Memopad currently ships unsigned MSI. Users see a SmartScreen warning on first
install. To remove that warning, obtain a Windows code-signing certificate
(EV recommended for instant reputation — ~$300/yr; OV cheaper but accumulates
reputation slowly).

To enable signing in the release workflow:

1. Convert the cert to a base64-encoded PFX. Store it as the GitHub secret
   `WINDOWS_CERTIFICATE`.
2. Store the cert password as `WINDOWS_CERTIFICATE_PASSWORD`.
3. In `.github/workflows/release.yml`, add these env vars to the `tauri-action`
   step:
   ```yaml
   TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
   TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
   WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}
   WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}
   ```
4. In `src-tauri/tauri.conf.json` `bundle.windows`, add:
   ```json
   "certificateThumbprint": null,
   "digestAlgorithm": "sha256",
   "timestampUrl": "http://timestamp.digicert.com"
   ```
   (`certificateThumbprint: null` makes Tauri pick up the env var-supplied cert.)

The next tagged release will produce a signed MSI/NSIS pair.

## Troubleshooting

- **"Failed to verify signature".** The `pubkey` in `tauri.conf.json` doesn't
  match the private key that signed the bundle. Regenerate or copy-paste
  carefully — trailing newlines matter.
- **Update downloads but fails to install.** Likely a Windows permissions issue
  if Memopad is installed under `Program Files`. The app installs per-user by
  default for unsigned MSI on Windows; self-update works without UAC there.
- **App doesn't relaunch after install.** The Tauri 2 plugin should
  auto-relaunch on Windows, but on some systems an explicit `relaunch()` call
  from `@tauri-apps/plugin-process` is required. If you hit this, edit
  `src/lib/updater.ts` to import `relaunch` and call it after
  `update.downloadAndInstall()`.
- **`releaseBody` is empty in the published release.** The `tauri-action` step
  uses the `releaseBody` field as-is; if you're using a templated body, ensure
  there are no unresolved `${{ }}` expressions.
```

- [ ] **Step 3: Commit**

```powershell
git add docs/superpowers/notes/release-process.md
git commit -m "docs: release-process.md prioritizes the automated workflow path"
```

---

## Task 8: Final results doc + Phase 7 acceptance prep

**Files:**
- Create: `docs/superpowers/plans/phase-7-results.md`

This task records the gates after all the workflow code lands, and explicitly hands off to the user for the final manual verification.

- [ ] **Step 1: Run all automated gates**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm test
Set-Location src-tauri
cargo test
Set-Location ..
npx tsc --noEmit
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
npm run test:e2e
Get-Process | Where-Object { $_.ProcessName -match '^(tauri-driver|msedgedriver|app)$' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

Expected: Vitest 50 (unchanged), cargo 51 (unchanged), tsc 0, e2e 45 (unchanged). No new test surface — this phase is workflow + docs only.

- [ ] **Step 2: Validate the workflow YAML files**

```powershell
python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'));     print('ci.yml OK')"     2>&1
python -c "import yaml; yaml.safe_load(open('.github/workflows/e2e.yml'));    print('e2e.yml OK')"    2>&1
python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('release.yml OK')" 2>&1
```

If Python isn't installed, skip — GitHub surfaces errors on first push.

- [ ] **Step 3: Build a final release MSI locally for size baseline**

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run tauri build
```

Capture MSI + app.exe sizes.

- [ ] **Step 4: Create `docs/superpowers/plans/phase-7-results.md`**

EXACT template (fill the `__` blanks):

```markdown
# Phase 7 — Results

## Automated test gates

- Vitest: __ tests passing (unchanged — workflow-only phase)
- cargo test: __ tests passing (unchanged)
- e2e (WebdriverIO): __ tests passing (unchanged)
- tsc --noEmit: exit 0

## Build artifacts

- MSI size: __ MB (Phase 6 baseline 5.63 MB)
- app.exe size: __ MB (Phase 6 baseline 13.64 MB)

## What shipped

- `README.md` — install, features, shortcuts, screenshots, build-from-source, license
- `CHANGELOG.md` — Keep a Changelog format with v0.1.0 entry
- `docs/images/memopad-{dark,light,find}.png` — vendored screenshots for README
- `.github/workflows/e2e.yml` — Windows runner, push-to-main + dispatch, 60 min timeout
- `.github/workflows/release.yml` — tag-triggered, signed bundle + GitHub Release + `latest.json`
- `docs/superpowers/notes/github-setup.md` — one-time setup checklist
- `docs/superpowers/notes/release-process.md` — refreshed to lead with the automated path

## What is intentionally NOT in this phase

- Code-signing certificate purchase — documented as a follow-up
- macOS or web build — v2
- v2 features (find-in-files, file tree, split view)

## Handoff: user-driven final verification

After Phase 7 merges to `main`, the user runs through
`docs/superpowers/notes/github-setup.md` to:

1. Create / connect a GitHub repo.
2. Generate the Tauri signing keypair.
3. Add the private key to GitHub secrets.
4. Replace `PLACEHOLDER_REPLACE_WITH_REAL_PUBKEY_BEFORE_FIRST_RELEASE` in
   `src-tauri/tauri.conf.json` and replace `GITHUB_OWNER` in the same file.
5. Push a `v0.1.0-rc1` tag and verify the release workflow produces a draft release.
6. Push a `v0.1.0` tag to publish the first real release.
7. Install the published MSI on a clean machine (or VM) — that's the **final manual check** for v1.

Once v0.1.0 is published, Memopad ships.
```

- [ ] **Step 5: Commit**

```powershell
git add docs/superpowers/plans/phase-7-results.md
git commit -m "phase 7: record results + hand off to user for final v0.1.0 verification"
```

---

## Phase 7 Acceptance

Close when ALL:

1. `npm test` → 50 passing (unchanged)
2. `cargo test` → 51 passing (unchanged)
3. `npx tsc --noEmit` → exit 0
4. `npm run test:e2e` → 45 passing (unchanged)
5. `npm run tauri build` produces an MSI
6. `.github/workflows/e2e.yml` and `.github/workflows/release.yml` exist and are syntactically valid
7. `README.md` and `CHANGELOG.md` exist
8. `docs/superpowers/notes/github-setup.md` and the updated `release-process.md` exist
9. `docs/superpowers/plans/phase-7-results.md` exists with real numbers

## What the user does after Phase 7 merges

The Phase 7 plan ends with code merged to `main`. The user then runs through
`docs/superpowers/notes/github-setup.md` to publish v0.1.0. Once v0.1.0 is on
GitHub Releases and the user has installed it, v1 ships and the project is
genuinely complete.
