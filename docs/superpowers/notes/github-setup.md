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
