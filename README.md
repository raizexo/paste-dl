# PasteDL

Paste a link, pick a quality, download.

A minimal Windows desktop app that wraps [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg
in a small, clean interface. No ads, no browser, no command line.

## Features

- Paste any URL supported by yt-dlp (YouTube, Vimeo, SoundCloud, and 1000+ more)
- Pick a resolution (1080p / 720p / 480p / 360p) or grab audio-only as MP3
- Audio boost applied during the download in a single pass (no extra re-encode of the whole file)
- Optional cookies file for age-restricted, private, or members-only videos
- Choose your own download folder
- Automatic updates: installed copies check this repo's Releases on startup and update themselves

## Download

Grab the latest installer from **[Releases](https://github.com/raizexo/paste-dl/releases/latest)**,
run it, then launch **PasteDL** from the Start menu.

> Windows will likely show a "Windows protected your PC" / unknown publisher warning, because the
> app is not code-signed. Choose **More info -> Run anyway**. This only happens once; updates after
> that install silently.

## Development

Requirements: Node.js 18+ and Windows.

```bash
npm install
npm start
```

`npm start` runs the app in dev mode. Update checks are skipped there, and user data is kept in a
local `.userData/` folder instead of your real app data.

### The `bin/` folder

The app expects two binaries in `bin/`, which are **not committed to this repo** (they are ~120 MB
and are bundled into the installer instead):

| File | Where to get it |
| --- | --- |
| `bin/yt-dlp.exe` | [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) |
| `bin/ffmpeg.exe` | [gyan.dev ffmpeg builds](https://www.gyan.dev/ffmpeg/builds/) or any Windows build |

Keeping yt-dlp current matters. An out-of-date yt-dlp is by far the most common cause of download
failures ("HTTP Error 403" and similar), so update it now and then:

```bash
bin\yt-dlp.exe -U
```

## Building

```bash
npm run dist
```

Output lands in `dist/` (`PasteDL-Setup-<version>.exe`).

## Releasing an update

1. Bump `version` in `package.json` (for example `1.0.0` -> `1.1.0`)
2. Run:

```bash
npm run release
```

This builds the installer and publishes it to GitHub Releases. Installed copies then update
themselves automatically: they read `latest.yml` from the newest release and download only the
changed bytes via the `.blockmap` file. You will need GitHub credentials for the repo configured
under `build.publish` in `package.json`.

## Tech

Electron, with `electron-builder` for packaging and `electron-updater` for releases. The UI is
plain HTML/CSS/JS with a lightweight Notion-inspired theme.

## License

MIT
