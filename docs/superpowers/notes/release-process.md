# Memopad release process (manual, v1)

CI runs Vitest + cargo tests on every push. Building and signing a release is
manual until we set up a tag-triggered release workflow (Phase 7 candidate).

## One-time setup

1. **Generate the updater signing keypair** (do this ONCE, then never lose the
   private key):

   ```powershell
   cd src-tauri
   cargo tauri signer generate -w ~/.tauri/memopad.key
   ```

   The command prints the public key and writes the private key to
   `~/.tauri/memopad.key`. Copy the public key into `src-tauri/tauri.conf.json`
   at `plugins.updater.pubkey` (replace the `PLACEHOLDER_...` value). Keep the
   private key file safe and never commit it.

2. **Confirm the manifest URL** in `tauri.conf.json` points at the correct
   GitHub repo and asset name. The default is:

   ```
   https://github.com/GITHUB_OWNER/memopad/releases/latest/download/latest.json
   ```

   Replace `GITHUB_OWNER` with your actual GitHub username or org.

## Cutting a release

1. **Bump the version.** Set the same string in three places:
   - `package.json` → `"version": "0.2.0"`
   - `src-tauri/tauri.conf.json` → `"version": "0.2.0"`
   - `src-tauri/Cargo.toml` → `version = "0.2.0"`

2. **Run every gate locally.** CI runs the cheap ones; the e2e suite + a full
   release build are local-only:

   ```powershell
   $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
   npm test
   cd src-tauri; cargo test; cd ..
   npx tsc --noEmit
   npm run test:e2e
   ```

   All four must be green before continuing.

3. **Build a signed release bundle:**

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$HOME\.tauri\memopad.key"
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""  # empty unless you set one at generate time
   npm run tauri build
   ```

   The bundle command emits:
   - `src-tauri/target/release/bundle/msi/Memopad_<version>_x64_en-US.msi`
   - `src-tauri/target/release/bundle/msi/Memopad_<version>_x64_en-US.msi.sig`
   - `src-tauri/target/release/bundle/nsis/Memopad_<version>_x64-setup.exe`
   - `src-tauri/target/release/bundle/nsis/Memopad_<version>_x64-setup.exe.sig`

4. **Compose `latest.json`.** Tauri's updater fetches this file to decide
   whether to offer an update. Create it locally:

   ```json
   {
     "version": "0.2.0",
     "notes": "What changed in this release.",
     "pub_date": "2026-05-26T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<contents of Memopad_0.2.0_x64-setup.exe.sig>",
         "url": "https://github.com/GITHUB_OWNER/memopad/releases/download/v0.2.0/Memopad_0.2.0_x64-setup.exe"
       }
     }
   }
   ```

   Replace `<contents of ...>` with the literal text inside the `.sig` file.

5. **Create a Git tag and a GitHub Release.** Tag as `v0.2.0`. Upload these
   four files to the release:
   - the NSIS installer (`.exe`)
   - its signature (`.exe.sig`)
   - the MSI
   - `latest.json` (renamed exactly that — the Tauri updater looks for it)

6. **Verify the update.** On a separate machine (or after rolling back to the
   old version locally), launch Memopad. Within ~3 seconds the UpdateBanner
   should appear at the top of the window offering the new version. Clicking
   "Install and relaunch" should download, install, and relaunch into the new
   version.

## Troubleshooting

- **No update banner appears, no console errors.** Check the manifest URL is
  reachable in a browser and that `latest.json` returns valid JSON.
- **"Failed to verify signature".** The `pubkey` in `tauri.conf.json` doesn't
  match the private key that signed the bundle. Regenerate or copy-paste
  carefully — even a trailing newline matters.
- **Update downloads but fails to install.** Likely a Windows permissions issue
  if Memopad is installed under `Program Files`. Tauri's updater requires
  write access; the app must be installed per-user (the default for an
  unsigned MSI on Windows) for self-update to work without UAC.
- **App doesn't relaunch after install.** The Tauri 2 plugin should
  auto-relaunch on Windows, but on some systems an explicit
  `relaunch()` call from `@tauri-apps/plugin-process` is required. If you hit
  this, edit `src/lib/updater.ts` to import `relaunch` and call it after
  `update.downloadAndInstall()`.
