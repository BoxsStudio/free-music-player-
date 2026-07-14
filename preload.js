const { contextBridge, ipcRenderer } = require('electron');
const pathModule = require('path');

function resolveBgVideo() {
  const fs = require('fs');
  const exeDir = pathModule.dirname(process.execPath);
  const candidates = [
    pathModule.join(exeDir, 'bg.webm'),
    pathModule.join(exeDir, 'resources', 'bg.webm'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return '';
}

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onPageLoaded: (cb) => ipcRenderer.on('page-loaded', cb),
  fetchHome: () => ipcRenderer.invoke('fetch-home'),
  fetchSearch: (q) => ipcRenderer.invoke('fetch-search', q),
  fetchPage: (p) => ipcRenderer.invoke('fetch-page', p),
  fetchArtist: (id) => ipcRenderer.invoke('fetch-artist', id),
  fetchCollection: (id) => ipcRenderer.invoke('fetch-collection', id),
  fetchRecommendations: (track) => ipcRenderer.invoke('fetch-recommendations', track),
  scSearch: (q) => ipcRenderer.invoke('sc-search', q),
  scSearchPage: (q, nextHref) => ipcRenderer.invoke('sc-search-page', q, nextHref),
  scGetStream: (id) => ipcRenderer.invoke('sc-get-stream', id),
  scHome: () => ipcRenderer.invoke('sc-home'),
  getBgVideoPath: () => resolveBgVideo()
});
