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
