# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## Project

**PasteDL** — a minimal Windows desktop app for downloading video/audio. Paste a link, pick a
quality, download. Electron shell around `yt-dlp.exe` + `ffmpeg.exe`.

- Repo: https://github.com/raizexo/paste-dl
- Releases: https://github.com/raizexo/paste-dl/releases
- Entry point: `src/main.js`
- UI: `src/renderer/` (plain HTML/CSS/JS, no framework)

## Tooling available on this machine

| Tool | Notes |
| --- | --- |
| Node.js / npm | Required; used for build + release |
| **gh CLI** | **Installed and authenticated.** Lives at `C:\Program Files\GitHub CLI\gh.exe`. It is **not on PATH**, so call it by full path (or use `& "C:\Program Files\GitHub CLI\gh.exe"`). Logged in as `raizexo`, token scopes include `repo`. |
| git | Git Credential Manager is configured; the GitHub login is cached in Windows Credential Manager, so HTTPS push works without re-auth. |
| electron-builder / electron-updater | Already in `node_modules` + `package.json`. |

> Adding `C:\Program Files\GitHub CLI` to PATH is optional; full-path invocation always works.

## Dev commands

```bash
npm install     # install deps
npm start       # run in dev mode (update checks are skipped)
npm run dist    # build the NSIS installer into dist/
npm run release # build AND publish to GitHub Releases
```

> **Dev-launch gotcha:** if Electron crashes on startup with
> `TypeError: Cannot read properties of undefined (reading 'isPackaged')`, the environment variable
> `ELECTRON_RUN_AS_NODE=1` is set in the shell. Clear it first: `$env:ELECTRON_RUN_AS_NODE=$null`.

## Git workflow — READ THIS FIRST

**Never commit directly to `main`.** `main` is reserved for version upgrades and receives changes
only by merging a working branch into it.

Rules:

1. Every change starts on a new branch.
2. Work and commit on that branch.
3. Bump the app version **on the branch**, but only if the change actually affects the shipped app.
   Docs-only, tooling-only, or CI-only changes do **not** need a version bump.
4. Merge the branch into `main`.
5. Publish a release from `main` after the merge.

### Creating a branch

Use a short, typed name:

```bash
git checkout main
git pull origin main
git checkout -b feat/short-description     # feature / user-facing change
git checkout -b fix/short-description      # bug fix
git checkout -b chore/short-description    # tooling, docs, config
```

### Merging back into main

```bash
# on the branch, having committed your work
git checkout main
git pull origin main
git merge --no-ff <branch-name>            # keep an explicit merge commit
git push origin main

git branch -d <branch-name>                # clean up locally
git push origin --delete <branch-name>     # clean up remotely (if it was pushed)
```

## Versioning

The app uses [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- `PATCH` — bug fix, no behaviour change beyond the fix (e.g. `1.0.0` -> `1.0.1`)
- `MINOR` — new feature, backwards compatible (e.g. `1.0.0` -> `1.1.0`)
- `MAJOR` — breaking change (rare for this app)

The version lives in **`package.json`** (`version`). It is the single source of truth: the
installer filename, `latest.yml`, and the update check all derive from it.

Bump it with npm on the feature branch (this also creates a commit and git tag):

```bash
npm version patch -m "chore: release v%s"
# or: npm version minor -m "chore: release v%s"
```

> A merge into `main` only "updates the version" if the merged branch carried a version bump.
> If a branch needs no bump (docs/tooling), merge it as-is — `main` stays on the current version.

## Release process

After `main` has the new version:

```bash
git checkout main
git pull origin main
npm run release
```

`npm run release` runs `electron-builder --win nsis --publish always`, which:

1. Builds `dist/PasteDL-Setup-<version>.exe`
2. Creates a `v<version>` tag + GitHub Release
3. Uploads `PasteDL-Setup-<version>.exe`, its `.blockmap`, and `latest.yml`

Installed apps then auto-update: they read `latest.yml` from the newest release and download only
the changed bytes via the `.blockmap`.

Publish target is configured in `package.json` -> `build.publish` (`provider: github`,
`owner: raizexo`, `repo: paste-dl`).

## What has already been done to make the app work

Chronological list of the fixes/features that got the app to a working, shippable state:

1. **Updated the bundled yt-dlp** from `2026.07.04` to `2026.08.19` (`bin/yt-dlp.exe`).
   The old build got `HTTP Error 403: Forbidden` on every format because YouTube had blocked its
   player clients. This was the actual cause of failed downloads.
2. **Fixed the misleading error message.** Downloads that failed with `HTTP Error 403` were reported
   as *"This video is age-restricted or blocked in your region"* — a false diagnosis. Now a real
   age-gate (`Sign in to confirm your age`) tells the user to add cookies, while a plain 403 advises
   updating yt-dlp instead.
3. **Added cookies support** for genuinely gated videos:
   - `authArgs()` in `src/main.js` adds `--cookies <file>` to both the parse and download commands
     when a cookies file is configured and exists on disk.
   - New `chooseCookiesFile` IPC handler (+ `src/preload.js` bridge).
   - Settings UI row with Browse / Clear (`src/renderer/index.html`, `renderer.js`, `style.css`).
4. **Added automatic updates.** `electron-updater` wired into `src/main.js` (guarded to packaged
   builds only) with an update bar in the renderer; `build.publish` points at this GitHub repo.
5. **Added `.gitignore`** excluding `node_modules/`, `dist/`, `.userData/`, `bin/`, and agent tooling.
6. **Added `README.md`** with install, dev, build, and release instructions.
7. **Published `v1.0.0`** to GitHub Releases with the installer, blockmap, and `latest.yml`.

Verified after the fixes: packaged `dist/win-unpacked/resources/bin/yt-dlp.exe` reports
`2026.08.19`, and a full audio download of a previously-failing video completes.

## Gotchas

- **`bin/` is not in git** (~120 MB of binaries). It is bundled into the installer via
  `build.extraResources`. A fresh clone therefore has no `yt-dlp.exe`/`ffmpeg.exe` and will build a
  broken app until they are placed in `bin/`. On this machine `bin/` is already correct.
- **yt-dlp goes stale.** It is the usual cause of download failures. Refresh it periodically with
  `bin\yt-dlp.exe -U`, then rebuild/release so the installer ships the new copy.
- **Cookies carry account risk.** Using a logged-in cookies file with yt-dlp can get a YouTube
  account temporarily restricted. It should be used only for videos that genuinely need sign-in,
  one at a time. The app keeps it optional.
- **Dev mode never checks for updates** (`isPackaged` guard) — expected, not a bug.
- **Windows will warn on install** ("unknown publisher") because the app is not code-signed.
