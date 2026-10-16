const $ = (id) => document.getElementById(id);
const urlInput = $('url');
const parseBtn = $('parseBtn');
const emptyStateEl = $('emptyState');
const loading = $('loading');
const metaBox = $('meta');
const thumb = $('thumb');
const titleEl = $('title');
const subtitleEl = $('subtitle');
const modesBox = $('modes');
const modeBtns = document.querySelectorAll('.mode');
const progressBox = $('progress');
const barFill = $('barFill');
const statusEl = $('status');
const cancelBtn = $('cancelBtn');
const phaseDownload = $('phaseDownload');
const phaseProcess = $('phaseProcess');
const phaseAudio = $('phaseAudio');
const resultEl = $('result');
const resultMessage = $('resultMessage');
const retryBtn = $('retryBtn');
const openResultFolder = $('openResultFolder');
const copyPathBtn = $('copyPathBtn');
const copyPathIcon = $('copyPathIcon');
const copyPathText = $('copyPathText');
const settingsBtn = $('settingsBtn');
const settingsBox = $('settings');
const destFolderInput = $('destFolder');
const browseBtn = $('browseBtn');
const openFolderBtn = $('openFolderBtn');
const folderHint = $('folderHint');
const cookiesPathInput = $('cookiesPath');
const cookiesBrowseBtn = $('cookiesBrowseBtn');
const cookiesClearBtn = $('cookiesClearBtn');
const updateBar = $('updateBar');
const updateText = $('updateText');
const updateAction = $('updateAction');

// Title Bar Custom Window Controls selectors
const minBtn = $('minBtn');
const maxBtn = $('maxBtn');
const maxSvg = $('maxSvg');
const closeBtn = $('closeBtn');

let state = {
  url: '',
  parsed: false,
  destFolder: '',
  downloading: false,
  downloadCancelled: false,
  parsing: false,
  parseId: 0
};

let progressState = {
  percent: 0,
  phase: 'download',
  phaseRank: 0
};

let lastTextUpdate = 0;

function fmtDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function show(el) { el.classList.remove('hidden'); }
// Special helper to handle layout visibility on flex/grid elements cleanly
function hide(el) { el.classList.add('hidden'); }

function setParsing(flag) {
  state.parsing = flag;
  // Disable button only when downloading, allow it to serve as a cancel button during parsing
  parseBtn.disabled = state.downloading;
  
  if (flag) {
    parseBtn.textContent = 'Cancel';
    parseBtn.className = 'danger'; // Styles it as a Cancel action
    hide(emptyStateEl);
    show(loading);
  } else {
    parseBtn.textContent = 'Look up';
    parseBtn.className = 'primary';
    hide(loading);
    if (!state.parsed) {
      show(emptyStateEl);
    }
  }
}

function setDownloading(flag) {
  state.downloading = flag;
  parseBtn.disabled = flag;
  urlInput.disabled = flag;
  modeBtns.forEach(b => b.disabled = flag);
  cancelBtn.disabled = !flag;
  progressBox.classList.toggle('hidden', !flag && barFill.style.transform === 'scaleX(0)');
}

function setOverallProgress(percent) {
  progressState.percent = Math.max(progressState.percent, Math.min(100, percent));
  barFill.style.transform = 'scaleX(' + (progressState.percent / 100) + ')';
}

function setPhase(phase) {
  const ranks = { download: 0, process: 1, audio: 2 };
  const nextRank = ranks[phase] ?? 0;
  if (nextRank < progressState.phaseRank) return;
  progressState.phase = phase;
  progressState.phaseRank = nextRank;
  phaseDownload.classList.toggle('active', phase === 'download');
  phaseProcess.classList.toggle('active', phase === 'process');
  phaseAudio.classList.toggle('active', phase === 'audio');
  phaseDownload.classList.toggle('done', phase !== 'download');
  phaseProcess.classList.toggle('done', phase === 'audio');
}

function resetMetadata() {
  hide(metaBox);
  thumb.src = '';
  titleEl.textContent = '';
  subtitleEl.textContent = '';
  hide(modesBox);
  state.parsed = false;
  if (!state.parsing) {
    show(emptyStateEl);
  }
}

function resetProgress() {
  hide(progressBox);
  progressState = { percent: 0, phase: 'download', phaseRank: 0 };
  barFill.style.transform = 'scaleX(0)';
  statusEl.textContent = '';
  hide(resultEl);
  setPhase('download');
}

function showResult(msg, className, showRetry, showPostActions) {
  resultMessage.textContent = msg;
  resultEl.className = 'result ' + className;
  hide(retryBtn);
  hide(openResultFolder);
  hide(copyPathBtn);
  if (showRetry) show(retryBtn);
  if (showPostActions) { show(openResultFolder); show(copyPathBtn); }
  show(resultEl);
}

async function parseUrl() {
  if (state.parsing) {
    // Interactive Cancel action during active URL lookups
    await window.api.cancelParse();
    setParsing(false);
    resetMetadata();
    resetProgress();
    return;
  }

  const url = urlInput.value.trim();
  if (!url || state.downloading || state.parsing) return;

  const parseId = ++state.parseId;
  state.url = url;
  resetMetadata();
  resetProgress();
  setParsing(true);

  try {
    const res = await window.api.parse(url);
    if (parseId !== state.parseId || url !== urlInput.value.trim()) return;

    if (!res.ok) {
      showResult(res.error, 'err', true);
      return;
    }

    const d = res.data;
    state.parsed = true;
    hide(emptyStateEl);
    thumb.src = d.thumbnail || '';
    titleEl.textContent = d.title || '(no title)';
    const subtitleParts = [d.uploader, fmtDuration(d.duration), d.extractor].filter(Boolean);
    if (d.isPlaylist) subtitleParts.push('Playlist — only first video will download');
    subtitleEl.textContent = subtitleParts.join(' - ');
    show(metaBox);
    show(modesBox);
  } catch (err) {
    if (parseId !== state.parseId) return;
    showResult(err?.message || 'Unexpected app error', 'err', true);
  } finally {
    if (parseId === state.parseId) setParsing(false);
  }
}

async function startDownload(mode, resolution) {
  if (!state.url || state.downloading || state.parsing) return;

  state.currentMode = mode;
  resetProgress();
  show(progressBox);
  statusEl.textContent = 'Starting...';
  state.downloadCancelled = false;
  setDownloading(true);
  hide(resultEl);

  // Hide audio phase chip for video downloads dynamically (column count adjusts automatically)
  phaseAudio.classList.toggle('hidden', mode !== 'audio');

  try {
    await window.api.download({
      url: state.url,
      mode,
      resolution,
      destFolder: state.destFolder
    });
  } catch (err) {
    statusEl.textContent = 'Failed';
    showResult(err?.message || 'Download failed', 'err');
  } finally {
    setDownloading(false);
  }
}

function updateProgress(p) {
  if (!p) return;

  // Update ARIA on progress bar
  if (p.percent !== undefined) {
    barFill.parentElement.setAttribute('aria-valuenow', Math.round(p.percent));
  }

  if (p.done) {
    if (p.cancelled || state.downloadCancelled) {
      state.downloadCancelled = true;
      statusEl.textContent = 'Cancelled';
      showResult('Download cancelled. Pick a quality to try again.', 'err');
      setDownloading(false);
      return;
    }

    if (p.error) {
      statusEl.textContent = 'Failed';
      showResult(p.error || 'Download failed', 'err', true);
    } else {
      setPhase(state.currentMode === 'audio' ? 'audio' : 'process');
      setOverallProgress(100);
      statusEl.textContent = 'Done';
      showResult('Saved to ' + state.destFolder, 'ok', false, true);
    }
    return;
  }

  if (p.stage === 'cancelled') {
    state.downloadCancelled = true;
    statusEl.textContent = 'Cancelled';
    showResult('Download cancelled. Pick a quality to try again.', 'err');
    setDownloading(false);
    return;
  }

  if (state.downloadCancelled) return;

  const now = Date.now();

  if (p.percent !== undefined) {
    setPhase('download');
    setOverallProgress(p.percent * 0.85); // Maps to 85% smoothly
    
    // Throttled text updates prevent visual jitter during downloading
    if (now - lastTextUpdate >= 150) {
      const speed = (p.speed && !/^unknown/i.test(p.speed)) ? p.speed : '...';
      const eta = (p.eta && !/^unknown/i.test(p.eta)) ? p.eta : '...';
      const totalStr = p.total ? ` • ${p.total}` : '';
      statusEl.textContent = `Downloading ${p.percent}%${totalStr} • ${speed} • ${eta} remaining`;
      lastTextUpdate = now;
    }
  } else if (p.fragments !== undefined) {
    const pct = (p.fragment / p.fragments * 100);
    setPhase('download');
    setOverallProgress(pct * 0.85);
    
    if (now - lastTextUpdate >= 150) {
      statusEl.textContent = `Downloading part ${p.fragment}/${p.fragments} (${pct.toFixed(0)}%)`;
      lastTextUpdate = now;
    }
  } else if (p.stage) {
    setPhase('process');
    setOverallProgress(90);
    statusEl.textContent = p.stage === 'Merger' ? 'Merging video and audio' : p.stage;
  }
}

async function loadSettings() {
  const s = await window.api.getSettings();
  state.destFolder = s.destFolder;
  destFolderInput.value = s.destFolder;
  folderHint.textContent = 'Saves to ' + s.destFolder;
  cookiesPathInput.value = s.cookiesPath || '';
}

parseBtn.addEventListener('click', parseUrl);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') parseUrl(); });
urlInput.addEventListener('input', () => {
  const current = urlInput.value.trim();
  if (!current) {
    state.parseId++;
    resetMetadata();
    resetProgress();
    setParsing(false);
    return;
  }

  if (!state.parsing && state.parsed && current !== state.url) {
    state.parseId++;
    resetMetadata();
    resetProgress();
  }
});

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    startDownload(btn.dataset.mode, btn.dataset.res);
  });
});

cancelBtn.addEventListener('click', () => window.api.cancel());

retryBtn.addEventListener('click', () => { hide(resultEl); parseUrl(); });
openResultFolder.addEventListener('click', () => window.api.openFolder(state.destFolder));

copyPathBtn.addEventListener('click', () => {
  // Satisfying visual clipboard confirmation feedback
  navigator.clipboard.writeText(state.destFolder).then(() => {
    const origIcon = copyPathIcon.innerHTML;
    const origText = copyPathText.textContent;
    
    copyPathIcon.innerHTML = `<polyline points="20 6 9 17 4 12"></polyline>`;
    copyPathText.textContent = 'Copied!';
    copyPathBtn.classList.add('accent');
    
    setTimeout(() => {
      copyPathIcon.innerHTML = origIcon;
      copyPathText.textContent = origText;
      copyPathBtn.classList.remove('accent');
    }, 2000);
  }).catch(() => {});
});

settingsBtn.addEventListener('click', () => {
  const open = !settingsBox.classList.toggle('hidden');
  settingsBtn.querySelector('span').textContent = open ? 'Close Settings' : 'Settings';
  settingsBtn.classList.toggle('active', open);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.downloading) {
    window.api.cancel();
  }
  // Number keys 1-5 for quality selection when meta panel is open
  if (!modesBox.classList.contains('hidden')) {
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= modeBtns.length) {
      const btn = modeBtns[num - 1];
      if (!btn.disabled) { startDownload(btn.dataset.mode, btn.dataset.res); }
    }
  }
});

browseBtn.addEventListener('click', async () => {
  const f = await window.api.chooseFolder();
  if (f) {
    state.destFolder = f;
    destFolderInput.value = f;
    folderHint.textContent = 'Saves to ' + f;
    // Persist settings changes immediately
    await window.api.saveSettings({ destFolder: f });
  }
});

openFolderBtn.addEventListener('click', () => window.api.openFolder(state.destFolder));

cookiesBrowseBtn.addEventListener('click', async () => {
  const f = await window.api.chooseCookiesFile();
  if (f) {
    cookiesPathInput.value = f;
    await window.api.saveSettings({ cookiesPath: f });
  }
});

cookiesClearBtn.addEventListener('click', async () => {
  cookiesPathInput.value = '';
  await window.api.saveSettings({ cookiesPath: '' });
});

// Custom Title Bar Window Controls click listeners
minBtn.addEventListener('click', () => window.api.minimize());
maxBtn.addEventListener('click', () => window.api.maximize());
closeBtn.addEventListener('click', () => window.api.close());

// Maximize/Restore SVG state update handler
const stopMaxState = window.api.onMaximizedState((isMaximized) => {
  if (isMaximized) {
    maxSvg.innerHTML = `<path d="M3,1.5 L8.5,1.5 L8.5,7 M1.5,3 L7,3 L7,8.5 L1.5,8.5 Z" fill="none" stroke="currentColor" stroke-width="1"/>`;
    maxBtn.title = 'Restore Down';
  } else {
    maxSvg.innerHTML = `<rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/>`;
    maxBtn.title = 'Maximize';
  }
});

const stopProgress = window.api.onProgress(updateProgress);

function handleUpdate(u) {
  if (!u) return;
  if (u.state === 'available') {
    updateText.textContent = `Downloading update ${u.version}...`;
    hide(updateAction);
    show(updateBar);
  } else if (u.state === 'downloading') {
    updateText.textContent = `Downloading update... ${u.percent}%`;
    hide(updateAction);
    show(updateBar);
  } else if (u.state === 'ready') {
    updateText.textContent = `Update ${u.version} is ready.`;
    show(updateAction);
    show(updateBar);
  } else if (u.state === 'error') {
    hide(updateBar);
  }
}

updateAction.addEventListener('click', () => window.api.installUpdate());

const stopUpdate = window.api.onUpdate(handleUpdate);

window.addEventListener('beforeunload', () => {
  try { stopProgress(); } catch (_) {}
  try { stopMaxState(); } catch (_) {}
  try { stopUpdate(); } catch (_) {}
});

loadSettings();
