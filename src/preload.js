const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  parse: (url) => ipcRenderer.invoke('parse', url),
  download: (req) => ipcRenderer.invoke('download', req),
  cancel: () => ipcRenderer.invoke('cancel'),
  cancelParse: () => ipcRenderer.invoke('cancelParse'),
  chooseFolder: () => ipcRenderer.invoke('chooseFolder'),
  chooseCookiesFile: () => ipcRenderer.invoke('chooseCookiesFile'),
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('saveSettings', settings),
  openFolder: (folder) => ipcRenderer.invoke('openFolder', folder),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onMaximizedState: (cb) => {
    const h = (_e, state) => cb(state);
    ipcRenderer.on('window-maximized-state', h);
    return () => ipcRenderer.removeListener('window-maximized-state', h);
  },
  onProgress: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('progress', h);
    return () => ipcRenderer.removeListener('progress', h);
  },
  onUpdate: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('update', h);
    return () => ipcRenderer.removeListener('update', h);
  },
  installUpdate: () => ipcRenderer.invoke('installUpdate')
});