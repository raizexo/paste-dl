const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const isPackaged = app.isPackaged;

// Isolate userData path and disable GPU program cache in development to prevent folder locks
if (!isPackaged) {
  const devDataPath = path.join(app.getAppPath(), '.userData');
  try {
    fs.mkdirSync(devDataPath, { recursive: true });
    app.setPath('userData', devDataPath);
  } catch (_) {}
}
app.commandLine.appendSwitch('disable-gpu-program-cache');
function binDir() {
  // In dev: ./bin   In packaged: process.resourcesPath/bin
  return isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'bin');
}
function binFile(name) {
  return path.join(binDir(), name);
}

// Make yt-dlp able to find ffmpeg by putting bin/ on PATH (shared build needs DLLs too)
function envWithBin() {
  const b = binDir();
  return { ...process.env, PATH: `${b};${process.env.PATH || ''}` };
}

let win = null;
let activeProc = null;       // single-child constraint -> lightest CPU + lowest ban risk
let activeParseProc = null;  // active metadata parse process
const state = new EventEmitter();

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load settings', e);
  }
  return {};
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings', e);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 560,
    frame: false, // Frameless window for custom title bar controls
    backgroundColor: '#ffffff',
    title: 'PasteDL',
    icon: path.join(__dirname, '..', 'build', 'pastedl.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: false
    }
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  
  // Track maximization state changes to update renderer button icons
  win.on('maximize', () => win.webContents.send('window-maximized-state', true));
  win.on('unmaximize', () => win.webContents.send('window-maximized-state', false));
  
  win.on('closed', () => { win = null; });
}

function defaultOutDir() {
  return path.join(app.getPath('downloads'), 'PasteDL');
}

// Extra yt-dlp auth args from saved settings (cookies file for
// age-restricted / private / login-required videos).
function authArgs() {
  try {
    const s = loadSettings();
    const p = (s.cookiesPath || '').trim();
    if (p && fs.existsSync(p)) return ['--cookies', p];
  } catch (_) {}
  return [];
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---- auto update (GitHub Releases) ------------------------------------------
// Only runs in a packaged build; dev mode has no app-update.yml to read.
function setupAutoUpdates() {
  if (!isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    send('update', { state: 'available', version: info.version });
  });
  autoUpdater.on('download-progress', (p) => {
    send('update', { state: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    send('update', { state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    send('update', { state: 'error', message: err?.message || 'Update check failed' });
  });

  autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.handle('installUpdate', () => {
  if (!isPackaged) return { ok: false };
  try {
    autoUpdater.quitAndInstall();
    return { ok: true };
  } catch (_) {
    return { ok: false };
  }
});

const PARSE_TIMEOUT_MS = 30000;



// Parse metadata: yt-dlp -J --no-playlist (no download, minimal hit)
ipcMain.handle('parse', async (_e, url) => {
  if (!url) return { ok: false, error: 'No URL' };
  if (activeProc) return { ok: false, error: 'A download is still running' };
  try {
    const out = await runParse(['--no-playlist', '-J', '--no-warnings', ...authArgs(), url], PARSE_TIMEOUT_MS);
    const info = JSON.parse(out);
    const d = info.duration || 0;
    const isPlaylist = /playlist/i.test(info.extractor || '') || (info.playlist_count && info.playlist_count > 1);
    return {
      ok: true,
      data: {
        title: info.title,
        uploader: info.uploader || info.channel,
        duration: d,
        thumbnail: info.thumbnail,
        extractor: info.extractor,
        isPlaylist
      }
    };
  } catch (err) {
    return { ok: false, error: friendlyError(err.stderr || err.message || 'parse failed') };
  }
});

// Download with chosen mode
ipcMain.handle('download', async (_e, { url, mode, resolution, destFolder }) => {
  if (!url) return { ok: false, error: 'No URL' };
  if (activeProc) return { ok: false, error: 'A download is already running' };

  const outDir = destFolder || defaultOutDir();
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}

  const outTemplate = path.join(outDir, '%(title)s [%(id)s].%(ext)s');
  const argv = [
    '--no-playlist',
    '--no-part',
    '--retries', '5',
    '--fragment-retries', '5',
    '--concurrent-fragments', '4',
    '--throttled-rate', '100K',
    '--newline',
    '--no-warnings',
    ...authArgs(),
    '-o', outTemplate
  ];

  if (mode === 'audio') {
    argv.push('-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
    argv.push('--postprocessor-args', '-af volume=3.0');
  } else {
    const r = parseInt(resolution, 10);
    if (!Number.isNaN(r)) {
      argv.push('-f', `bv*[height<=${r}][ext=mp4]+ba[ext=m4a]/best[height<=${r}]/best`);
      argv.push('--merge-output-format', 'mp4');
    } else {
      argv.push('-f', 'bv*+ba/best', '--merge-output-format', 'mp4');
    }
    argv.push('--postprocessor-args', '-c:a aac -af volume=3.0 -b:a 128k');
  }

  argv.push(url);

  await runStream(argv, (line) => {
    if (!line) return;

    // Final summary line: "[download] 100% of 100.81MiB in 00:00:25 at 4.01MiB/s"
    const finalMatch = line.match(/^\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+in\s+([\d:]+)\s+at\s+(.+?)\/s\s*$/);
    if (finalMatch) {
      send('progress', {
        percent: parseFloat(finalMatch[1]),
        total: finalMatch[2],
        speed: finalMatch[4] + '/s',
        eta: finalMatch[3]
      });
      return;
    }

    // Live progress line:
    //   "[download]   87.0% of  100.81MiB at    8.13MiB/s ETA 00:01"
    //   "[download]   96.4% of  100.81MiB at    Unknown B/s ETA Unknown"
    const liveMatch = line.match(/^\[download\]\s+([\d.]+)%\s+of\s+~?([\d.]+\w+)\s+at\s+(.+?)\s+ETA\s+(.+?)\s*$/);
    if (liveMatch) {
      send('progress', {
        percent: parseFloat(liveMatch[1]),
        total: liveMatch[2],
        speed: liveMatch[3],
        eta: liveMatch[4]
      });
      return;
    }

    // Fragment count style during fragment downloads
    const fragMatch = line.match(/fragment\s+(\d+)\s+of\s+(\d+)/i);
    if (fragMatch) {
      send('progress', { fragment: parseInt(fragMatch[1]), fragments: parseInt(fragMatch[2]) });
      return;
    }

    // Merging / extracting / converting stages (yt-dlp's own passes)
    const stageMatch = line.match(/^\[(Merger|ExtractAudio|VideoConvertor|Metadata|EmbedSubtitles|Downloading subtitles)\]/i);
    if (stageMatch) {
      send('progress', { stage: stageMatch[1] });
      return;
    }
  });

  // Audio boost happens inline during yt-dlp's merger/extraction via --postprocessor-args.
  // No separate ffmpeg pass needed — saves a full file read+write per download.

  // Now send the final done event
  send('progress', {
    done: true,
    cancelled: activeProc_cancelled,
    code: activeProc_error ? 1 : 0,
    error: activeProc_error && !activeProc_cancelled && friendlyError(activeProc_stderr || 'Download failed')
  });

  return { ok: !activeProc_error && !activeProc_cancelled };
});

let activeProc_error = false;
let activeProc_stderr = '';
let activeProc_cancelled = false;

ipcMain.handle('cancel', async () => {
  if (activeProc) {
    activeProc_cancelled = true;
    try { activeProc.kill('SIGTERM'); } catch (_) {}
    activeProc = null;
    send('progress', { stage: 'cancelled' });
  }
  return { ok: true };
});

ipcMain.handle('chooseFolder', async () => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('chooseCookiesFile', async () => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Cookies', extensions: ['txt'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('getSettings', async () => {
  const s = loadSettings();
  return {
    destFolder: s.destFolder || defaultOutDir(),
    cookiesPath: s.cookiesPath || '',
    rateLimit: s.rateLimit || '',
    sponsorblockRemove: !!s.sponsorblockRemove
  };
});

ipcMain.handle('saveSettings', async (_e, settings) => {
  const s = loadSettings();
  const updated = { ...s, ...settings };
  saveSettings(updated);
  return { ok: true };
});

ipcMain.handle('cancelParse', async () => {
  if (activeParseProc) {
    try { activeParseProc.kill('SIGTERM'); } catch (_) {}
    activeParseProc = null;
  }
  return { ok: true };
});

ipcMain.handle('openFolder', async (_e, folder) => {
  if (folder) shell.openPath(folder);
});

// Custom Title Bar Window Controls IPC listeners
ipcMain.on('window-minimize', () => {
  if (win) win.minimize();
});
ipcMain.on('window-maximize', () => {
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});
ipcMain.on('window-close', () => {
  if (win) win.close();
});

// ---- spawn helpers -----------------------------------------------------------

function friendlyError(message) {
  const text = String(message || '').trim();
  if (!text) return 'Something unexpected happened. Try again.';
  if (/timed out/i.test(text)) return 'Connection timed out. Check your internet and try again.';
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';

  if (/Sign in to confirm your age/i.test(text)) return 'This video is age-restricted. Add a YouTube cookies file in Settings, then try again.';
  if (/HTTP Error 403/i.test(text)) return 'Download was blocked (HTTP 403). Update yt-dlp to the latest version, or add cookies in Settings if the video needs sign-in, then try again.';
  if (/HTTP Error 4\d\d/i.test(text)) return 'Video is private, unavailable, or requires sign-in.';
  if (/Video unavailable/i.test(text)) return 'This video is unavailable or has been removed.';
  if (/Private video/i.test(text)) return 'This video is private. Sign in with cookies to access it.';
  if (/Sign in/i.test(text)) return 'This video requires sign-in. Add cookies in settings and try again.';
  if (/ffmpeg not found/i.test(text)) return 'Audio processing tool (ffmpeg) is missing. Reinstall the app.';
  if (/HTTP Error 5\d\d/i.test(text)) return 'The video platform is having issues. Try again later.';
  if (/is not a valid URL/i.test(text)) return 'That doesn\'t look like a valid link. Paste a full YouTube or video URL.';

  const useful = [...lines].reverse().find(line => !/^\[download\]|\[youtube\]|\[debug\]|^\[/i.test(line));
  const cleaned = (useful || last).replace(/^ERROR:\s*/i, '').replace(/:?\s*\[\w+\]\s*\d+\s*$/, '');
  return cleaned || 'Something unexpected happened. Tap "Try again" to retry.';
}

function runParse(args, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const p = spawn(binFile('yt-dlp.exe'), args, { env: envWithBin() });
    activeParseProc = p;
    let stdout = '', stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      try { p.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => {
        if (!settled) {
          try { p.kill('SIGKILL'); } catch (_) {}
        }
      }, 1500);
    }, timeoutMs) : null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (activeParseProc === p) activeParseProc = null;
      fn(value);
    };
    p.stdout.on('data', (d) => stdout += d);
    p.stderr.on('data', (d) => stderr += d);
    p.on('error', (err) => finish(reject, err));
    p.on('close', (code) => {
      if (timedOut) finish(reject, new Error('parse timed out'));
      else if (code === 0) finish(resolve, stdout);
      else finish(reject, new Error(stderr || `yt-dlp exited ${code}`));
    });
  });
}

function runStream(args, onLine) {
  return new Promise((resolve) => {
    activeProc_error = false;
    activeProc_stderr = '';
    activeProc_cancelled = false;
    const p = spawn(binFile('yt-dlp.exe'), args, { env: envWithBin() });
    activeProc = p;
    let stderr = '', lineBuf = '';
    const feed = (chunk, isStderr) => {
      if (isStderr) stderr += chunk;
      lineBuf += chunk;
      let idx;
      while ((idx = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, idx).trim();
        lineBuf = lineBuf.slice(idx + 1);
        if (line) onLine(line);
      }
    };
    p.stdout.on('data', d => feed(d.toString(), false));
    p.stderr.on('data', d => feed(d.toString(), true));
    p.on('error', (e) => {
      if (!activeProc_cancelled) activeProc_error = true;
      activeProc_stderr = e.message || 'Download failed';
      activeProc = null;
    });
    p.on('close', (code) => {
      activeProc = null;
      if (code !== 0 && !activeProc_cancelled) activeProc_error = true;
      if (stderr) activeProc_stderr = stderr;
      // Note: the final `done` event is sent by the download handler,
      // so the renderer sees the audio-improvement stage between downloading and done.
      resolve();
    });
  });
}

// ---- graceful shutdown ------------------------------------------------------

app.on('before-quit', (e) => {
  let needsQuitDelay = false;
  if (activeProc) {
    needsQuitDelay = true;
    try { activeProc.kill('SIGKILL'); } catch (_) {}
    activeProc = null;
  }
  if (activeParseProc) {
    needsQuitDelay = true;
    try { activeParseProc.kill('SIGKILL'); } catch (_) {}
    activeParseProc = null;
  }
  if (needsQuitDelay) {
    e.preventDefault();
    setTimeout(() => app.quit(), 50);
  }
});

app.on('window-all-closed', () => {
  if (activeProc) try { activeProc.kill('SIGTERM'); } catch (_) {}
  if (activeParseProc) try { activeParseProc.kill('SIGTERM'); } catch (_) {}
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdates();
});
