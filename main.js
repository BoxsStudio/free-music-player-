const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, net } = require('electron');
const path = require('path');
const { URL } = require('url');
const https = require('https');

let mainWindow;
let tray;
const BASE = 'https://rus.hitmoz.org';
const SC_BASE = 'https://api-v2.soundcloud.com';
const SC_CLIENT_ID = 'EJXLGDA385DFulBm9nOdenF6rKx4aTCl';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121212',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('page-loaded');
  });

  mainWindow.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('Page load failed:', code, desc);
    mainWindow.webContents.send('page-loaded');
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('minimize', () => { mainWindow.hide(); createTray(); });
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); createTray(); }
  });
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Free Music Player');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Показать', click: () => mainWindow.show() },
    { label: 'Выход', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => mainWindow.show());
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9'
      }
    });
    let body = '';
    request.on('response', (response) => {
      response.on('data', (chunk) => { body += chunk.toString(); });
      response.on('end', () => resolve(body));
    });
    request.on('error', reject);
    request.end();
  });
}

function fixUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return BASE + url;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function scSearchPage(query, nextHref) {
  try {
    let url;
    if (nextHref) {
      url = nextHref + (nextHref.includes('?') ? '&' : '?') + `client_id=${SC_CLIENT_ID}`;
    } else {
      url = `${SC_BASE}/search/tracks?q=${encodeURIComponent(query)}&client_id=${SC_CLIENT_ID}&limit=50`;
    }
    const data = await httpsGet(url);
    const json = JSON.parse(data);
    const tracks = (json.collection || []).map(t => ({
      id: String(t.id),
      title: t.title,
      artist: t.user?.username || 'Unknown',
      url: '',
      cover: t.artwork_url ? t.artwork_url.replace('-large', '-t300x300') : '',
      sc_id: t.id,
      duration: t.duration
    }));
    return { tracks, next_href: json.next_href || null };
  } catch (e) { return { tracks: [], next_href: null }; }
}

async function scSearch(query) {
  const result = await scSearchPage(query);
  return result.tracks;
}

async function scGetStreamUrl(trackId) {
  try {
    const data = await httpsGet(`${SC_BASE}/tracks/${trackId}?client_id=${SC_CLIENT_ID}`);
    const track = JSON.parse(data);
    const mp3 = track.media?.transcodings?.find(t => t.format?.mime_type === 'audio/mpeg');
    if (!mp3) return '';
    const streamData = await httpsGet(`${mp3.url}?client_id=${SC_CLIENT_ID}`);
    const stream = JSON.parse(streamData);
    return stream.url || '';
  } catch (e) { return ''; }
}

async function scGetRecommendations(trackId) {
  try {
    const data = await httpsGet(`${SC_BASE}/tracks/${trackId}/related?client_id=${SC_CLIENT_ID}&limit=20`);
    const json = JSON.parse(data);
    return (json.collection || []).map(t => ({
      id: String(t.id),
      title: t.title,
      artist: t.user?.username || 'Unknown',
      url: '',
      cover: t.artwork_url ? t.artwork_url.replace('-large', '-t300x300') : '',
      sc_id: t.id,
      duration: t.duration
    }));
  } catch (e) { return []; }
}

function parseTracks(html) {
  const tracks = [];
  const regex = /data-musmeta='(\{[^']+\})'/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const meta = JSON.parse(match[1].replace(/\\u0026/g, '&'));
      tracks.push({
        id: meta.id,
        title: meta.title,
        artist: meta.artist,
        url: fixUrl(meta.url),
        cover: fixUrl(meta.img)
      });
    } catch (e) {}
  }
  return tracks;
}

function parseCollections(html) {
  const collections = [];
  const regex = /href="\/collection\/(\d+)"[^>]*>[\s\S]*?background-image:\s*url\('([^']+)'\)[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    collections.push({ id: match[1], cover: fixUrl(match[2]), title: match[3].trim() });
  }
  return collections;
}

function parseAlbums(html) {
  const albums = [];
  const regex = /href="\/album\/(\d+)"[\s\S]*?background-image:\s*url\('([^']+)'\)[\s\S]*?<span[^>]*class="sidebar-album-title[^"]*"[^>]*>([^<]+)<\/span>[\s\S]*?<div[^>]*class="sidebar-album-singer"[^>]*>\s*([^<]+)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    albums.push({ id: match[1], cover: fixUrl(match[2]), title: match[3].trim(), artist: match[4].trim() });
  }
  return albums;
}

function parseArtists(html) {
  const artists = [];
  const regex = /href="\/artist\/(\d+)"[\s\S]*?background-image:\s*url\(([^)]+)\)[\s\S]*?<span[^>]*class="top-singer-name"[^>]*>([^<]+)<\/span>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    artists.push({ id: match[1], avatar: fixUrl(match[2]), name: match[3].trim() });
  }
  return artists;
}

function extractSection(html, title) {
  const titleIdx = html.indexOf(title + '</h2>');
  if (titleIdx < 0) return '';
  const ulStart = html.indexOf('<ul', titleIdx);
  if (ulStart < 0) return '';
  const ulEnd = html.indexOf('</ul>', ulStart);
  if (ulEnd < 0) return '';
  return html.substring(ulStart, ulEnd + 5);
}

function parseSearch(html) {
  const tracks = parseTracks(html);

  const artists = [];
  const singersSection = extractSection(html, 'Исполнители');
  const artistRegex = /href="\/artist\/(\d+)"[^>]*>[\s\S]*?background-image:\s*url\('([^']+)'\)[^>]*>[\s\S]*?<span[^>]*class="album-title"[^>]*>([^<]+)<\/span>/g;
  let m;
  while ((m = artistRegex.exec(singersSection)) !== null) {
    artists.push({ id: m[1], avatar: fixUrl(m[2]), name: m[3].trim() });
  }

  const albums = [];
  const albumSection = extractSection(html, 'Альбомы');
  const albumRegex = /href="\/album\/(\d+)"[\s\S]*?background-image:\s*url\('([^']+)'\)[^>]*>[\s\S]*?<span[^>]*class="album-title"[^>]*>([^<]+)<\/span>[\s\S]*?<div[^>]*class="album-singer"[^>]*>\s*([^<]*)/g;
  while ((m = albumRegex.exec(albumSection || html)) !== null) {
    albums.push({ id: m[1], cover: fixUrl(m[2]), title: m[3].trim(), artist: m[4].trim() });
  }

  const collections = [];
  const collSection = extractSection(html, 'Сборники');
  const collRegex = /href="\/collection\/(\d+)"[^>]*class="album-link"[\s\S]*?background-image:\s*url\('([^']+)'\)[^>]*>[\s\S]*?<span[^>]*class="album-title"[^>]*>([^<]+)<\/span>/g;
  while ((m = collRegex.exec(collSection || html)) !== null) {
    collections.push({ id: m[1], cover: fixUrl(m[2]), title: m[3].trim() });
  }

  return { tracks, artists, albums, collections };
}

function parseGenres(html) {
  const genres = [];
  const regex = /href="\/genre\/([^"]+)"[^>]*>([^<]+)/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    genres.push({ slug: match[1], name: match[2].trim() });
  }
  return genres;
}

ipcMain.handle('fetch-home', async () => {
  const html = await fetchPage(BASE + '/');
  return {
    popular: parseTracks(html),
    collections: parseCollections(html),
    albums: parseAlbums(html),
    artists: parseArtists(html)
  };
});

ipcMain.handle('fetch-search', async (e, query) => {
  const searchUrl = new URL('/search', BASE);
  searchUrl.searchParams.set('q', query);
  const html = await fetchPage(searchUrl.toString());
  return parseSearch(html);
});

ipcMain.handle('fetch-page', async (e, urlPath) => {
  const html = await fetchPage(`${BASE}${urlPath}`);
  return {
    tracks: parseTracks(html),
    collections: parseCollections(html),
    albums: parseAlbums(html),
    artists: parseArtists(html),
    genres: parseGenres(html)
  };
});

ipcMain.handle('fetch-artist', async (e, id) => {
  const html = await fetchPage(`${BASE}/artist/${id}`);
  let artistName = '';
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) {
    artistName = h1Match[1].replace(/\s*[-–—].*$/, '').trim();
  }
  return { tracks: parseTracks(html), artistName };
});

ipcMain.handle('fetch-collection', async (e, id) => {
  const html = await fetchPage(`${BASE}/collection/${id}`);
  return parseTracks(html);
});

ipcMain.handle('fetch-recommendations', async (e, track) => {
  if (track.sc_id) {
    return scGetRecommendations(track.sc_id);
  }
  const results = [];
  const seen = new Set();
  const currentId = String(track.id || '');

  function addTrack(t) {
    const id = String(t.id || '');
    if (id === currentId || seen.has(id)) return;
    seen.add(id);
    results.push(t);
  }

  try {
    if (track.artist) {
      const searchUrl = new URL('/search', BASE);
      searchUrl.searchParams.set('q', track.artist);
      const searchHtml = await fetchPage(searchUrl.toString());
      parseTracks(searchHtml).slice(0, 10).forEach(addTrack);
    }
    if (track.title) {
      const words = track.title.split(/\s+/).filter(w => w.length > 3);
      if (words.length > 0) {
        const query = words.slice(0, 2).join(' ');
        const searchUrl2 = new URL('/search', BASE);
        searchUrl2.searchParams.set('q', query);
        const searchHtml2 = await fetchPage(searchUrl2.toString());
        parseTracks(searchHtml2).slice(0, 8).forEach(addTrack);
      }
    }
    if (results.length < 15) {
      const topHtml = await fetchPage(`${BASE}/songs/top-today`);
      parseTracks(topHtml).slice(0, 15).forEach(addTrack);
    }
    if (results.length < 20) {
      const newHtml = await fetchPage(`${BASE}/songs/new`);
      parseTracks(newHtml).slice(0, 10).forEach(addTrack);
    }
  } catch (e) {}

  return results.slice(0, 25);
});

// === SOUNDCLOUD HANDLERS ===
ipcMain.handle('sc-search-page', async (e, query, nextHref) => {
  return scSearchPage(query, nextHref);
});

ipcMain.handle('sc-search', async (e, query) => {
  return scSearch(query);
});

ipcMain.handle('sc-get-stream', async (e, trackId) => {
  return scGetStreamUrl(trackId);
});

ipcMain.handle('sc-home', async () => {
  try {
    const data = await httpsGet(`${SC_BASE}/mixed-selections?client_id=${SC_CLIENT_ID}&limit=20`);
    const json = JSON.parse(data);
    const tracks = [];
    for (const sel of (json.collection || [])) {
      if (sel.track) {
        tracks.push({
          id: String(sel.track.id),
          title: sel.track.title,
          artist: sel.track.user?.username || 'Unknown',
          url: '',
          cover: sel.track.artwork_url ? sel.track.artwork_url.replace('-large', '-t300x300') : '',
          sc_id: sel.track.id
        });
      } else if (sel.tracks) {
        for (const t of sel.tracks.slice(0, 5)) {
          tracks.push({
            id: String(t.id),
            title: t.title,
            artist: t.user?.username || 'Unknown',
            url: '',
            cover: t.artwork_url ? t.artwork_url.replace('-large', '-t300x300') : '',
            sc_id: t.id
          });
        }
      }
    }
    return tracks.slice(0, 30);
  } catch (e) {
    return scSearch('popular music 2024');
  }
});

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });

ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window-close', () => mainWindow.close());
