const audio = document.getElementById('audio');
const pageContent = document.getElementById('page-content');
const contentScroll = document.getElementById('content-scroll');
const $ = id => document.getElementById(id);

let queue = [], queueIndex = -1, isPlaying = false, currentTrack = null;
let shuffleOn = false, repeatMode = 0, lastRenderedTracks = [];
let navHistory = [], navIndex = -1;
let activeService = localStorage.getItem('service') || 'hitmo';

let scSearchQuery = '';
let scNextHref = null;
let scLoadingMore = false;

// === Listen History ===
let listenHistory = JSON.parse(localStorage.getItem('listenHistory') || '[]');
function recordListen(track) {
  if (!track) return;
  listenHistory = listenHistory.filter(t => t.id !== track.id);
  listenHistory.unshift({ id: track.id, title: track.title, artist: track.artist, cover: track.cover, url: track.url, sc_id: track.sc_id, ts: Date.now() });
  if (listenHistory.length > 200) listenHistory = listenHistory.slice(0, 200);
  localStorage.setItem('listenHistory', JSON.stringify(listenHistory));
}
function getTopArtists(count) {
  const counts = {};
  listenHistory.forEach(t => { counts[t.artist] = (counts[t.artist] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, count).map(e => e[0]);
}
function getTopWords(count) {
  const counts = {};
  listenHistory.forEach(t => {
    (t.title || '').split(/\s+/).forEach(w => {
      const k = w.toLowerCase().replace(/[^а-яa-z0-9]/g, '');
      if (k.length > 3) counts[k] = (counts[k] || 0) + 1;
    });
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, count).map(e => e[0]);
}

// === Liked Tracks ===
let likedTracks = JSON.parse(localStorage.getItem('likedTracks') || '[]');
function toggleLike(track) {
  if (!track) return;
  const idx = likedTracks.findIndex(t => t.id === track.id);
  if (idx >= 0) { likedTracks.splice(idx, 1); } else { likedTracks.unshift(track); }
  localStorage.setItem('likedTracks', JSON.stringify(likedTracks));
  updateLikeBtns();
  updateLibraryLiked();
}
function isLiked(track) {
  return track && likedTracks.some(t => t.id === track.id);
}
function updateLikeBtns() {
  const liked = currentTrack && isLiked(currentTrack);
  $('btn-like')?.classList.toggle('liked', liked);
  $('np-like')?.classList.toggle('liked', liked);
}

// === HLS.js support for SoundCloud ===
let hls = null;
function playUrl(url, track) {
  if (track && track.sc_id && !url) {
    // SoundCloud: need to resolve stream URL
    api.scGetStream(track.sc_id).then(streamUrl => {
      if (streamUrl) playUrlDirect(streamUrl);
    });
    return;
  }
  playUrlDirect(url);
}

function playUrlDirect(url) {
  if (!url) return;
  if (url.includes('.m3u8') && typeof Hls !== 'undefined' && Hls.isSupported()) {
    if (hls) { hls.destroy(); hls = null; }
    hls = new Hls({ enableWorker: true });
    hls.loadSource(url);
    hls.attachMedia(audio);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { audio.play().catch(() => {}); });
  } else {
    if (hls) { hls.destroy(); hls = null; }
    audio.src = url;
    audio.play().catch(() => {});
  }
}

// === Service Selector ===
function showServiceSelector() {
  $('service-screen').classList.remove('hidden');
}

function selectService(svc) {
  activeService = svc;
  localStorage.setItem('service', svc);
  $('service-screen').classList.add('hidden');
  updateServiceLabel();
  startApp();
}

$('svc-hitmo').addEventListener('click', () => selectService('hitmo'));
$('svc-soundcloud').addEventListener('click', () => selectService('soundcloud'));

// Service switch from sidebar
$('svc-switch-btn').addEventListener('click', () => {
  showServiceSelector();
});
function updateServiceLabel() {
  const label = $('svc-switch-label');
  if (label) label.textContent = activeService === 'soundcloud' ? 'SoundCloud' : 'HitMoZ';
}

// === Init ===
let appStarted = false;
function safeStartApp() {
  if (appStarted) return;
  appStarted = true;
  initVisualizer();
  audio.volume = 0.8;
  updateLibraryLiked();
  const splash = $('splash-screen');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => { splash.style.display = 'none'; }, 500);
  }
  startApp();
}

api.onPageLoaded(() => { setTimeout(safeStartApp, 1500); });
setTimeout(safeStartApp, 4000);

async function startApp() {
  updateServiceLabel();
  if (activeService === 'soundcloud') {
    await loadSCHome();
  } else {
    await loadWave();
  }
  pushNav('wave');
}

// === Window ===
$('minimize')?.addEventListener('click', () => api.minimize());
$('maximize')?.addEventListener('click', () => api.maximize());
$('close')?.addEventListener('click', () => api.close());

// === Nav ===
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    if (page === 'search') {
      $('search-box').classList.toggle('visible');
      if ($('search-box').classList.contains('visible')) $('search-input').focus();
    } else {
      $('search-box').classList.remove('visible');
      pushNav(page);
      navigateTo(page);
    }
  });
});

$('search-input').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  pageContent.innerHTML = '<div class="loading-text">Поиск...</div>';
  if (activeService === 'soundcloud') {
    scSearchQuery = e.target.value.trim();
    scNextHref = null;
    const result = await api.scSearchPage(scSearchQuery, null);
    scNextHref = result.next_href;
    renderSCTracks(result.tracks, 'Результаты поиска');
  } else {
    scSearchQuery = '';
    scNextHref = null;
    const data = await api.fetchSearch(e.target.value.trim());
    renderSearchResults(data);
  }
});

function renderSearchResults(data) {
  if (!data) { pageContent.innerHTML = '<div class="loading-text">Ошибка</div>'; return; }
  const { tracks, artists, albums, collections } = data;
  let h = '';
  const hasAny = (tracks?.length) || (artists?.length) || (albums?.length) || (collections?.length);
  if (!hasAny) { pageContent.innerHTML = '<div class="loading-text">Ничего не найдено</div>'; return; }

  if (artists?.length) {
    h += '<h2 class="section-title">Исполнители</h2><div class="artists-grid">';
    artists.forEach(a => { h += `<div class="artist-card" onclick="loadArtistPage('${a.id}')"><img class="artist-avatar" src="${a.avatar}" loading="lazy" onerror="this.style.background='#333'"><div class="artist-name">${esc(a.name)}</div></div>`; });
    h += '</div>';
  }
  if (albums?.length) {
    h += '<h2 class="section-title">Альбомы</h2><div class="cards-grid">';
    albums.forEach(a => { h += `<div class="card" onclick="loadAlbum('${a.id}')"><img class="card-cover" src="${a.cover}" loading="lazy" onerror="this.style.background='#333'"><div class="card-title">${esc(a.title)}</div><div class="card-sub">${esc(a.artist)}</div></div>`; });
    h += '</div>';
  }
  if (collections?.length) {
    h += '<h2 class="section-title">Сборники</h2><div class="cards-grid">';
    collections.forEach(c => { h += `<div class="card" onclick="loadCollection('${c.id}')"><img class="card-cover" src="${c.cover}" loading="lazy" onerror="this.style.background='#333'"><div class="card-title">${esc(c.title)}</div></div>`; });
    h += '</div>';
  }
  if (tracks?.length) {
    lastRenderedTracks = tracks;
    h += '<h2 class="section-title">Треки</h2>' + tracksHtml(tracks);
  }
  pageContent.innerHTML = h;
}

function pushNav(page) {
  navHistory = navHistory.slice(0, navIndex + 1);
  navHistory.push(page);
  navIndex = navHistory.length - 1;
  updateNavBtns();
}
$('btn-back').addEventListener('click', () => {
  if (navIndex > 0) { navIndex--; navigateTo(navHistory[navIndex]); updateNavBtns(); }
});
$('btn-fwd').addEventListener('click', () => {
  if (navIndex < navHistory.length - 1) { navIndex++; navigateTo(navHistory[navIndex]); updateNavBtns(); }
});
function updateNavBtns() {
  $('btn-back').disabled = navIndex <= 0;
  $('btn-fwd').disabled = navIndex >= navHistory.length - 1;
}

// === Player controls ===
$('btn-play').addEventListener('click', togglePlay);
$('btn-like').addEventListener('click', () => { if (currentTrack) toggleLike(currentTrack); });
$('btn-prev').addEventListener('click', playPrev);
$('btn-next').addEventListener('click', playNext);
$('btn-shuffle').addEventListener('click', () => {
  shuffleOn = !shuffleOn;
  $('btn-shuffle').classList.toggle('active', shuffleOn);
});
$('btn-repeat').addEventListener('click', () => {
  repeatMode = (repeatMode + 1) % 3;
  $('btn-repeat').classList.toggle('active', repeatMode > 0);
  $('btn-repeat').title = ['Повтор', 'Повтор всех', 'Повтор трека'][repeatMode];
});
$('volume-slider').addEventListener('input', e => { audio.volume = e.target.value / 100; });

// === Progress drag ===
let dragging = false;
$('progress-bar').addEventListener('mousedown', e => { dragging = true; seek(e); });
document.addEventListener('mousemove', e => { if (dragging) seek(e); });
document.addEventListener('mouseup', () => { dragging = false; });

function seek(e) {
  if (!audio.duration) return;
  const r = $('progress-bar').getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  audio.currentTime = p * audio.duration;
}

audio.ontimeupdate = () => {
  if (!audio.duration) return;
  const p = (audio.currentTime / audio.duration) * 100;
  $('progress-fill').style.width = p + '%';
  $('progress-thumb').style.left = p + '%';
  $('player-current').textContent = fmt(audio.currentTime);
  $('player-duration').textContent = fmt(audio.duration);
};

audio.onended = () => {
  if (repeatMode === 2) { audio.currentTime = 0; audio.play(); return; }
  playNext();
};

// === Navigation ===
async function navigateTo(page) {
  pageContent.innerHTML = '<div class="loading-text">Загрузка...</div>';
  contentScroll.scrollTop = 0;
  if (page === 'wave') { await loadWave(); return; }
  if (page === 'liked') { renderLikedTracks(); return; }
  if (activeService === 'soundcloud') {
    const tracks = await api.scSearch(page === 'home' ? 'popular music' : page);
    renderSCTracks(tracks, page);
    return;
  }
  const routes = { home: '/', top: '/songs/top-today', new: '/songs/new', genres: '/genres', artists: '/artists', collections: '/collections' };
  try {
    const data = await api.fetchPage(routes[page] || '/');
    if (page === 'genres' && data.genres) renderGenres(data.genres);
    else if (page === 'artists' && data.artists) renderArtists(data.artists);
    else if (data.tracks?.length) { lastRenderedTracks = data.tracks; renderTracks(data.tracks, { top: 'Топ чарты', new: 'Новые треки' }[page] || page); }
  } catch (e) { pageContent.innerHTML = '<div class="loading-text">Ошибка загрузки</div>'; }
}

// === Моя Волна ===
async function loadWave() {
  pageContent.innerHTML = '<div class="loading-text">Подбираем волну...</div>';
  if (listenHistory.length === 0 && likedTracks.length === 0) {
    pageContent.innerHTML = '<div class="wave-empty"><h2>Моя волна</h2><p>Начните слушать музыку или добавляйте треки в избранное — и волна подберёт треки по вашему вкусу</p></div>';
    return;
  }
  const seen = new Set();
  listenHistory.slice(0, 50).forEach(t => seen.add(String(t.id)));
  likedTracks.forEach(t => seen.add(String(t.id)));
  const results = [];
  function addTrack(t) {
    const id = String(t.id || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    results.push(t);
  }
  try {
    const artists = getTopArtists(5);
    const likedArtists = [];
    likedTracks.forEach(t => { if (t.artist) likedArtists.push(t.artist); });
    const allArtists = [...new Set([...artists, ...likedArtists])].slice(0, 6);
    for (const artist of allArtists.slice(0, 4)) {
      const data = await api.fetchSearch(artist);
      if (data?.tracks) data.tracks.slice(0, 8).forEach(addTrack);
    }
    const words = getTopWords(5);
    likedTracks.forEach(t => {
      if (t.title) t.title.split(/\s+/).forEach(w => { if (w.length > 3) words.push(w); });
    });
    if (words.length > 0) {
      const q = [...new Set(words)].slice(0, 3).join(' ');
      const data = await api.fetchSearch(q);
      if (data?.tracks) data.tracks.slice(0, 10).forEach(addTrack);
    }
    if (results.length < 15) {
      const data = await api.fetchPage('/songs/top-today');
      if (data?.tracks) data.tracks.slice(0, 15).forEach(addTrack);
    }
  } catch (e) {}
  if (results.length === 0) {
    pageContent.innerHTML = '<div class="loading-text">Не удалось подобрать волну</div>';
    return;
  }
  lastRenderedTracks = results;
  const src = [];
  const topArt = getTopArtists(3);
  if (topArt.length) src.push('прослушивания: ' + topArt.join(', '));
  if (likedTracks.length) src.push('избранное (' + likedTracks.length + ')');
  let h = '<h2 class="section-title">Моя волна</h2>';
  h += '<div class="wave-info">На основе ' + src.join(', ') + '</div>';
  h += tracksHtml(results);
  pageContent.innerHTML = h;
}

// === Liked Tracks ===
function renderLikedTracks() {
  if (likedTracks.length === 0) {
    pageContent.innerHTML = '<div class="wave-empty"><h2>Избранное</h2><p>Нажимайте сердечко на треках, чтобы сохранять их здесь</p></div>';
    return;
  }
  lastRenderedTracks = [...likedTracks];
  let h = '<h2 class="section-title">Избранное</h2>' + tracksHtml(likedTracks);
  pageContent.innerHTML = h;
}

function updateLibraryLiked() {
  if ($('library-liked-count')) $('library-liked-count').textContent = likedTracks.length;
  if ($('library-liked-sub')) {
    const n = likedTracks.length;
    $('library-liked-sub').textContent = n === 0 ? 'Нет треков' : n + ' ' + (n === 1 ? 'трек' : n < 5 ? 'трека' : 'треков');
  }
}

async function loadSCHome() {
  pageContent.innerHTML = '<div class="loading-text">Загрузка...</div>';
  try {
    const tracks = await api.scHome();
    renderSCTracks(tracks, 'Рекомендации');
  } catch (e) { pageContent.innerHTML = '<div class="loading-text">Ошибка загрузки</div>'; }
}

function renderSCTracks(tracks, title) {
  if (!tracks?.length) { pageContent.innerHTML = '<div class="loading-text">Ничего не найдено</div>'; return; }
  lastRenderedTracks = tracks;
  renderTracks(tracks, title);
}

async function loadHome() {
  pageContent.innerHTML = '<div class="loading-text">Загрузка...</div>';
  try {
    const data = await api.fetchHome();
    let h = '';
    if (data.popular?.length) { lastRenderedTracks = data.popular; h += '<h2 class="section-title">Популярные треки</h2>' + tracksHtml(data.popular); }
    if (data.albums?.length) {
      h += '<h2 class="section-title">Альбомы</h2><div class="cards-grid">';
      data.albums.forEach(a => { h += `<div class="card" onclick="loadAlbum('${a.id}')"><img class="card-cover" src="${a.cover}" loading="lazy" onerror="this.style.background='#333'"><div class="card-title">${esc(a.title)}</div><div class="card-sub">${esc(a.artist)}</div></div>`; });
      h += '</div>';
    }
    if (data.collections?.length) {
      h += '<h2 class="section-title">Сборники</h2><div class="cards-grid">';
      data.collections.forEach(c => { h += `<div class="card" onclick="loadCollection('${c.id}')"><img class="card-cover" src="${c.cover}" loading="lazy" onerror="this.style.background='#333'"><div class="card-title">${esc(c.title)}</div></div>`; });
      h += '</div>';
    }
    if (data.artists?.length) {
      h += '<h2 class="section-title">Исполнители</h2><div class="artists-grid">';
      data.artists.forEach(a => { h += `<div class="artist-card" onclick="loadArtistPage('${a.id}')"><img class="artist-avatar" src="${a.avatar}" loading="lazy" onerror="this.style.background='#333'"><div class="artist-name">${esc(a.name)}</div></div>`; });
      h += '</div>';
    }
    pageContent.innerHTML = h;
    updateLibrary(data.popular || []);
  } catch (e) { pageContent.innerHTML = '<div class="loading-text">Ошибка загрузки</div>'; }
}

// === Library ===
function updateLibrary(tracks) {
  const list = $('library-list');
  if (!list) return;
  list.innerHTML = tracks.slice(0, 20).map((t, i) => `
    <div class="lib-item${currentTrack && currentTrack.id === t.id ? ' playing' : ''}" onclick="playTrackFromList(${i})">
      <img class="lib-item-cover" src="${t.cover || ''}" onerror="this.style.background='#333'">
      <div class="lib-item-info">
        <div class="lib-item-title">${esc(t.title)}</div>
        <div class="lib-item-sub">${esc(t.artist)}</div>
      </div>
    </div>`).join('');
}

// === Render ===
function renderTracks(tracks, title) {
  lastRenderedTracks = tracks;
  pageContent.innerHTML = `<h2 class="section-title">${esc(title)}</h2>` + tracksHtml(tracks);
}

function tracksHtml(tracks) {
  return '<div class="tracks-grid">' + tracks.map((t, i) => {
    const a = currentTrack && currentTrack.id === t.id;
    return `<div class="track-row${a ? ' playing' : ''}" onclick="playTrackFromList(${i})" data-idx="${i}">
      <div class="track-num">${a && isPlaying ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="#7c5cff"><rect x="3" y="4" width="4" height="16" rx="1"/><rect x="10" y="8" width="4" height="12" rx="1"/><rect x="17" y="2" width="4" height="20" rx="1"/></svg>' : (i+1)}</div>
      <img class="track-row-cover" src="${t.cover || ''}" loading="lazy" onerror="this.style.background='#333'">
      <div class="track-row-info">
        <div class="track-row-title">${esc(t.title)}</div>
        <div class="track-row-artist">${esc(t.artist)}</div>
      </div>
    </div>`;
  }).join('') + '</div>';
}

function renderGenres(genres) {
  pageContent.innerHTML = '<h2 class="section-title">Жанры</h2><div class="genres-grid">' +
    genres.map(g => `<div class="genre-chip" onclick="loadGenre('${esc(g.slug)}')">${esc(g.name)}</div>`).join('') + '</div>';
}

function renderArtists(artists) {
  pageContent.innerHTML = '<h2 class="section-title">Исполнители</h2><div class="artists-grid">' +
    artists.map(a => `<div class="artist-card" onclick="loadArtistPage('${a.id}')"><img class="artist-avatar" src="${a.avatar}" loading="lazy" onerror="this.style.background='#333'"><div class="artist-name">${esc(a.name)}</div></div>`).join('') + '</div>';
}

// === Playback ===
window.playTrackFromList = function(index) {
  queue = [...lastRenderedTracks];
  queueIndex = index;
  playCurrent();
};

function playCurrent() {
  if (queueIndex < 0 || queueIndex >= queue.length) return;
  const t = queue[queueIndex];
  currentTrack = t;
  recordListen(t);
  updateLikeBtns();
  if (t.url) {
    playUrlDirect(t.url);
  } else if (t.sc_id) {
    api.scGetStream(t.sc_id).then(streamUrl => {
      if (streamUrl) {
        t.url = streamUrl;
        playUrlDirect(streamUrl);
      }
    });
    isPlaying = true;
    updatePlayBtn();
    updatePlayerUI(t);
    updateLibrary(lastRenderedTracks);
    updateQueue();
    return;
  } else {
    return;
  }
  isPlaying = true;
  updatePlayBtn();
  updatePlayerUI(t);
  updateLibrary(lastRenderedTracks);
  updateQueue();
}

function togglePlay() {
  if (!audio.src) return;
  if (isPlaying) audio.pause(); else audio.play().catch(() => {});
  isPlaying = !isPlaying;
  updatePlayBtn();
}

function playNext() {
  if (!queue.length) return;
  if (shuffleOn) queueIndex = Math.floor(Math.random() * queue.length);
  else if (repeatMode === 1 && queueIndex >= queue.length - 1) queueIndex = 0;
  else if (queueIndex < queue.length - 1) queueIndex++;
  else { isPlaying = false; updatePlayBtn(); return; }
  playCurrent();
}

function playPrev() {
  if (audio.currentTime > 3) audio.currentTime = 0;
  else if (queueIndex > 0) { queueIndex--; playCurrent(); }
}

function updatePlayBtn() {
  $('btn-play').querySelector('.icon-play').classList.toggle('hidden', isPlaying);
  $('btn-play').querySelector('.icon-pause').classList.toggle('hidden', !isPlaying);
  if (!$('now-playing-overlay').classList.contains('hidden')) updateNpPlayBtn();
}

function updatePlayerUI(t) {
  $('player-title').textContent = t.title;
  $('player-artist').textContent = t.artist;
  if (t.cover) $('player-cover').src = t.cover;
  $('np-title').textContent = t.title;
  $('np-artist').textContent = t.artist;
  if (t.cover) $('np-cover').innerHTML = `<img src="${t.cover}" onerror="this.parentElement.innerHTML=''">`;
  // Sync fullscreen player if open
  if (!$('now-playing-overlay').classList.contains('hidden')) syncNpUI();
  document.querySelectorAll('.track-row').forEach(el => {
    const i = parseInt(el.dataset.idx);
    const is = lastRenderedTracks[i] && currentTrack && lastRenderedTracks[i].id === currentTrack.id;
    el.classList.toggle('playing', is);
  });
}

// === Queue panel ===
function updateQueue() {
  const list = $('queue-list');
  if (!list) return;
  list.innerHTML = queue.map((t, i) => `
    <div class="q-item" onclick="playTrackFromList(${i})" style="${i === queueIndex ? 'opacity:1' : 'opacity:0.6'}">
      <img class="q-item-cover" src="${t.cover || ''}" onerror="this.style.background='#333'">
      <div class="q-item-info">
        <div class="q-item-title" style="${i === queueIndex ? 'color:#7c5cff' : ''}">${esc(t.title)}</div>
        <div class="q-item-artist">${esc(t.artist)}</div>
      </div>
    </div>`).join('');
}

$('clear-queue')?.addEventListener('click', () => { queue = []; queueIndex = -1; updateQueue(); });
$('btn-queue')?.addEventListener('click', () => {
  const rp = $('right-panel');
  rp.style.display = rp.style.display === 'none' ? 'flex' : 'none';
});

// === Sub-pages (no playback interrupt!) ===
async function loadGenre(slug) {
  pageContent.innerHTML = '<div class="loading-text">Загрузка...</div>';
  try { const d = await api.fetchPage('/genre/' + slug); if (d.tracks?.length) { lastRenderedTracks = d.tracks; renderTracks(d.tracks, slug.replace(/-/g, ' ')); } } catch(e) { pageContent.innerHTML = '<div class="loading-text">Ошибка</div>'; }
}
async function loadArtistPage(id) {
  pageContent.innerHTML = '<div class="loading-text">Загрузка...</div>';
  try {
    const d = await api.fetchArtist(id);
    if (d.tracks?.length) {
      lastRenderedTracks = d.tracks;
      renderTracks(d.tracks, d.artistName || 'Треки исполнителя');
    } else {
      pageContent.innerHTML = '<div class="loading-text">Треки не найдены</div>';
    }
  } catch(e) { pageContent.innerHTML = '<div class="loading-text">Ошибка</div>'; }
}
async function loadAlbum(id) {
  pageContent.innerHTML = '<div class="loading-text">Загрузка...</div>';
  try { const d = await api.fetchPage('/album/' + id); if (d.tracks?.length) { lastRenderedTracks = d.tracks; renderTracks(d.tracks, 'Альбом'); } } catch(e) { pageContent.innerHTML = '<div class="loading-text">Ошибка</div>'; }
}
async function loadCollection(id) {
  pageContent.innerHTML = '<div class="loading-text">Загрузка...</div>';
  try { const d = await api.fetchCollection(id); if (d.length) { lastRenderedTracks = d; renderTracks(d, 'Сборник'); } } catch(e) { pageContent.innerHTML = '<div class="loading-text">Ошибка</div>'; }
}

// === Visualizer ===
let visInterval;
function initVisualizer() {
  if (visInterval) return;
  const c = $('player-visualizer'), ctx = c.getContext('2d');
  visInterval = setInterval(() => {
    ctx.clearRect(0, 0, c.width, c.height);
    if (!isPlaying) { for (let i = 0; i < 17; i++) { ctx.fillStyle = '#333'; ctx.fillRect(i * 6, c.height - 2, 3, 2); } return; }
    for (let i = 0; i < 17; i++) {
      const h = Math.random() * 24 + 4 + Math.sin(Date.now() / 200 + i) * 6;
      const g = ctx.createLinearGradient(0, c.height - h, 0, c.height);
      g.addColorStop(0, '#7c5cff'); g.addColorStop(1, '#7c5cff33');
      ctx.fillStyle = g; ctx.fillRect(i * 6, c.height - h, 3, h);
    }
  }, 80);
}

function fmt(s) { return Math.floor(s/60) + ':' + String(Math.floor(s%60)).padStart(2,'0'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// === FULLSCREEN NOW PLAYING ===
let npBgMode = localStorage.getItem('npBgMode') || 'cover';
let npCustomImage = localStorage.getItem('npCustomImage') || '';
let npCustomVideo = localStorage.getItem('npCustomVideo') || '';

function openNowPlaying() {
  const overlay = $('now-playing-overlay');
  if (!currentTrack) return;
  overlay.classList.remove('hidden', 'closing');
  syncNpUI();
  loadRecommendations();
}

function closeNowPlaying() {
  const overlay = $('now-playing-overlay');
  overlay.classList.add('closing');
  setTimeout(() => { overlay.classList.add('hidden'); overlay.classList.remove('closing'); }, 300);
}

function syncNpUI() {
  if (!currentTrack) return;
  $('np-full-title').textContent = currentTrack.title;
  $('np-full-artist').textContent = currentTrack.artist;
  if (currentTrack.cover) {
    $('np-full-cover').src = currentTrack.cover;
    applyNpBackground(currentTrack.cover);
  }
  $('np-full-current').textContent = fmt(audio.currentTime);
  $('np-full-duration').textContent = fmt(audio.duration || 0);
  updateNpPlayBtn();
  updateNpProgress();
}

function applyNpBackground(coverUrl) {
  const bg = $('np-bg');
  const video = $('np-bg-video');

  video.classList.remove('active');
  video.src = '';

  if (npBgMode === 'cover' && coverUrl) {
    bg.style.backgroundImage = `url(${coverUrl})`;
    $('np-cover-glow').style.backgroundImage = `url(${coverUrl})`;
  } else if (npBgMode === 'gradient') {
    bg.style.backgroundImage = '';
    bg.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f3460 60%, #533483 100%)';
    $('np-cover-glow').style.backgroundImage = '';
  } else if (npBgMode === 'image' && npCustomImage) {
    bg.style.backgroundImage = `url(${npCustomImage})`;
    $('np-cover-glow').style.backgroundImage = `url(${npCustomImage})`;
  } else if (npBgMode === 'video' && npCustomVideo) {
    bg.style.backgroundImage = '';
    bg.style.background = '#000';
    video.src = npCustomVideo;
    video.classList.add('active');
    video.play().catch(() => {});
    $('np-cover-glow').style.backgroundImage = coverUrl ? `url(${coverUrl})` : '';
  } else if (coverUrl) {
    bg.style.backgroundImage = `url(${coverUrl})`;
    $('np-cover-glow').style.backgroundImage = `url(${coverUrl})`;
  } else {
    bg.style.backgroundImage = '';
    bg.style.background = '#111';
    $('np-cover-glow').style.backgroundImage = '';
  }
}

function updateNpPlayBtn() {
  const btn = $('np-play');
  btn.querySelector('.np-icon-play').classList.toggle('hidden', isPlaying);
  btn.querySelector('.np-icon-pause').classList.toggle('hidden', !isPlaying);
}

function updateNpProgress() {
  if (!audio.duration) return;
  const p = (audio.currentTime / audio.duration) * 100;
  $('np-progress-fill').style.width = p + '%';
  $('np-progress-thumb').style.left = p + '%';
  $('np-full-current').textContent = fmt(audio.currentTime);
  $('np-full-duration').textContent = fmt(audio.duration);
}

// Hook into existing audio timeupdate
const _origTimeUpdate = audio.ontimeupdate;
audio.addEventListener('timeupdate', () => {
  if (!$('now-playing-overlay').classList.contains('hidden')) updateNpProgress();
});

// Overlay controls
$('np-close').addEventListener('click', closeNowPlaying);
$('np-play').addEventListener('click', togglePlay);
$('np-prev').addEventListener('click', playPrev);
$('np-next').addEventListener('click', playNext);
$('np-shuffle').addEventListener('click', () => {
  shuffleOn = !shuffleOn;
  $('np-shuffle').classList.toggle('active', shuffleOn);
  $('btn-shuffle').classList.toggle('active', shuffleOn);
});
$('np-repeat').addEventListener('click', () => {
  repeatMode = (repeatMode + 1) % 3;
  $('np-repeat').classList.toggle('active', repeatMode > 0);
  $('btn-repeat').classList.toggle('active', repeatMode > 0);
  $('np-repeat').title = ['Повтор', 'Повтор всех', 'Повтор трека'][repeatMode];
});
$('np-like').addEventListener('click', () => {
  if (!currentTrack) return;
  toggleLike(currentTrack);
});

// Progress drag on fullscreen
let npDragging = false;
$('np-progress-bar').addEventListener('mousedown', e => { npDragging = true; npSeek(e); });
document.addEventListener('mousemove', e => { if (npDragging) npSeek(e); });
document.addEventListener('mouseup', () => { npDragging = false; });
function npSeek(e) {
  if (!audio.duration) return;
  const r = $('np-progress-bar').getBoundingClientRect();
  const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  audio.currentTime = p * audio.duration;
}

// ESC to close
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('now-playing-overlay').classList.contains('hidden')) closeNowPlaying();
});

// === SETTINGS ===
$('np-settings-btn').addEventListener('click', () => {
  $('np-settings').classList.toggle('hidden');
  updateSettingsPreview();
});
$('np-settings-close').addEventListener('click', () => {
  $('np-settings').classList.add('hidden');
});

// Background mode buttons
document.querySelectorAll('.np-bg-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.np-bg-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    npBgMode = btn.dataset.bg;
    localStorage.setItem('npBgMode', npBgMode);

    if (npBgMode === 'image') $('np-bg-image-input').click();
    else if (npBgMode === 'video') $('np-bg-video-input').click();
    else updateSettingsPreview();

    if (currentTrack) applyNpBackground(currentTrack.cover);
  });
});

// File inputs
$('np-bg-image-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    npCustomImage = ev.target.result;
    localStorage.setItem('npCustomImage', npCustomImage);
    if (currentTrack) applyNpBackground(currentTrack.cover);
    updateSettingsPreview();
  };
  reader.readAsDataURL(file);
});
$('np-bg-video-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    npCustomVideo = ev.target.result;
    localStorage.setItem('npCustomVideo', npCustomVideo);
    if (currentTrack) applyNpBackground(currentTrack.cover);
    updateSettingsPreview();
  };
  reader.readAsDataURL(file);
});

function updateSettingsPreview() {
  const box = $('np-preview-box');
  const preview = $('np-custom-preview');
  box.innerHTML = '';
  if (npBgMode === 'image' && npCustomImage) {
    preview.style.display = '';
    box.innerHTML = `<img src="${npCustomImage}">`;
  } else if (npBgMode === 'video' && npCustomVideo) {
    preview.style.display = '';
    box.innerHTML = `<video src="${npCustomVideo}" muted loop autoplay></video>`;
  } else {
    preview.style.display = 'none';
  }
  // Highlight active button
  document.querySelectorAll('.np-bg-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.bg === npBgMode);
  });
}

// Init bg mode from storage on startup
(function initNpBgMode() {
  document.querySelectorAll('.np-bg-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.bg === npBgMode);
  });
})();

// === RECOMMENDATIONS ===
let recCache = null;
let recCacheId = null;

async function loadRecommendations(force) {
  if (!currentTrack) return;
  const list = $('np-rec-list');
  if (!list) return;

  const trackKey = currentTrack.id || currentTrack.title;
  if (!force && recCacheId === trackKey && recCache) {
    renderRecList(recCache);
    return;
  }

  list.innerHTML = '<div class="np-rec-loading">Подбираем музыку...</div>';

  try {
    const tracks = await api.fetchRecommendations({
      artist: currentTrack.artist,
      title: currentTrack.title,
      id: currentTrack.id
    });
    recCache = tracks;
    recCacheId = trackKey;
    renderRecList(tracks);
  } catch (e) {
    list.innerHTML = '<div class="np-rec-loading">Не удалось загрузить</div>';
  }
}

function renderRecList(tracks) {
  const list = $('np-rec-list');
  if (!list || !tracks?.length) {
    if (list) list.innerHTML = '<div class="np-rec-loading">Ничего не найдено</div>';
    return;
  }
  list.innerHTML = tracks.map((t, i) => {
    const playing = currentTrack && t.id && currentTrack.id === t.id;
    return `<div class="np-rec-item${playing ? ' playing' : ''}" onclick="playRecTrack(${i})">
      <img class="np-rec-cover" src="${t.cover || ''}" loading="lazy" onerror="this.style.background='#333'">
      <div class="np-rec-info">
        <div class="np-rec-name">${esc(t.title)}</div>
        <div class="np-rec-artist">${esc(t.artist)}</div>
      </div>
    </div>`;
  }).join('');
  recCache = tracks;
}

window.playRecTrack = function(index) {
  if (!recCache || !recCache[index]) return;
  const track = recCache[index];
  const idx = queue.findIndex(t => t.id === track.id);
  if (idx >= 0) {
    queueIndex = idx;
    playCurrent();
  } else {
    queue.push(track);
    queueIndex = queue.length - 1;
    playCurrent();
  }
};

$('np-rec-refresh')?.addEventListener('click', () => loadRecommendations(true));

// === INFINITE SCROLL for SoundCloud search ===
contentScroll.addEventListener('scroll', async () => {
  if (!scSearchQuery || scLoadingMore || !scNextHref) return;
  const scrollBottom = contentScroll.scrollHeight - contentScroll.scrollTop - contentScroll.clientHeight;
  if (scrollBottom > 200) return;
  scLoadingMore = true;
  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading-text';
  loadingEl.textContent = 'Загрузка ещё...';
  pageContent.appendChild(loadingEl);
  try {
    const result = await api.scSearchPage(scSearchQuery, scNextHref);
    scNextHref = result.next_href;
    if (result.tracks?.length) {
      lastRenderedTracks = lastRenderedTracks.concat(result.tracks);
      const tracksContainer = pageContent.querySelector('.tracks-grid');
      if (tracksContainer) {
        const idx = lastRenderedTracks.length - result.tracks.length;
        result.tracks.forEach((t, i) => {
          const div = document.createElement('div');
          div.className = 'track-row';
          div.setAttribute('onclick', `playTrackFromList(${idx + i})`);
          div.setAttribute('data-idx', idx + i);
          div.innerHTML = `<div class="track-num">${idx + i + 1}</div>
            <img class="track-row-cover" src="${t.cover || ''}" loading="lazy" onerror="this.style.background='#333'">
            <div class="track-row-info">
              <div class="track-row-title">${esc(t.title)}</div>
              <div class="track-row-artist">${esc(t.artist)}</div>
            </div>`;
          tracksContainer.appendChild(div);
        });
      }
    }
    if (!result.next_href) {
      scNextHref = null;
    }
  } catch (e) {}
  loadingEl.remove();
  scLoadingMore = false;
});

// === APP BACKGROUND ===
let currentBg = localStorage.getItem('appBg') || 'dark';
let customBgImage = localStorage.getItem('appBgImage') || '';
let customBgVideo = localStorage.getItem('appBgVideo') || '';

function applyBg(mode) {
  document.body.className = mode !== 'dark' ? 'bg-' + mode : '';
  const video = $('app-bg-video');
  const overlay = $('app-bg-overlay');

  video.classList.remove('active');
  video.src = '';

  if (mode === 'video') {
    const vsrc = customBgVideo || api.getBgVideoPath() || 'bg.webm';
    video.src = vsrc;
    video.classList.add('active');
    video.play().catch(() => {});
    overlay.style.background = '';
  } else if (mode === 'custom' && customBgImage) {
    overlay.style.backgroundImage = `url(${customBgImage})`;
    overlay.style.backgroundSize = 'cover';
    overlay.style.backgroundPosition = 'center';
  } else if (mode === 'transparent') {
    overlay.style.backgroundImage = '';
    overlay.style.background = '';
  } else {
    overlay.style.backgroundImage = '';
    overlay.style.background = '';
  }

  document.querySelectorAll('.bg-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.bg === mode);
  });
}

document.querySelectorAll('.bg-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.bg;
    if (mode === 'custom') {
      $('bg-image-input').click();
      return;
    }
    if (mode === 'video' && !customBgVideo) {
      $('bg-video-input').click();
      return;
    }
    currentBg = mode;
    localStorage.setItem('appBg', mode);
    applyBg(mode);
  });
});

$('bg-image-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    customBgImage = ev.target.result;
    localStorage.setItem('appBgImage', customBgImage);
    currentBg = 'custom';
    localStorage.setItem('appBg', 'custom');
    applyBg('custom');
  };
  reader.readAsDataURL(file);
});

$('bg-video-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    customBgVideo = ev.target.result;
    localStorage.setItem('appBgVideo', customBgVideo);
    currentBg = 'video';
    localStorage.setItem('appBg', 'video');
    applyBg('video');
  };
  reader.readAsDataURL(file);
});

applyBg(currentBg);
