/* ============================================================
   gtagassets.com — Application Logic (local-only, no Firebase)
   ============================================================ */

window.addEventListener('error', (e) => {
  console.error('Global error:', e.error || e.message);
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = 'Error: ' + (e.message || 'Something went wrong');
    toast.className = 'toast show error';
    clearTimeout(window._globalToastTimer);
    window._globalToastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
  }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
});

// ─── State ───────────────────────────────────────────────────
let ASSETS = [];
let CURRENT_USER = null;
let FOLLOWERS = {};
let ACCOUNTS = {};
let authMode = 'signin';
let currentCategory = 'all';
let searchQuery = '';
let sortBy = 'newest';
let selectedAssetId = null;
let selectedCreator = null;
let userRatings = {};
let uploadedFileData = null;
let uploadedFileType = '';

let soundsCategory = 'all';
let soundsSearch = '';
let soundsSort = 'newest';

let creatorsSearch = '';
let creatorsSort = 'uploads';
let activePage = 'assets';

// Admin state — stored in localStorage only
let ANNOUNCEMENTS = [];
let MAINTENANCE = null;
let maintenanceTimer = null;

// ─── Admin guard — ONLY the user "cook" is admin ─────────────
function isAdmin() {
  return CURRENT_USER && CURRENT_USER.name === 'cook';
}

// ─── Persistence ─────────────────────────────────────────────
function loadState() {
  try {
    ASSETS        = JSON.parse(localStorage.getItem('gtaga_assets')        || '[]');
    CURRENT_USER  = JSON.parse(localStorage.getItem('gtaga_user')          || 'null');
    FOLLOWERS     = JSON.parse(localStorage.getItem('gtaga_followers')     || '{}');
    userRatings   = JSON.parse(localStorage.getItem('gtaga_ratings')       || '{}');
    ACCOUNTS      = JSON.parse(localStorage.getItem('gtaga_accounts')      || '{}');
    ANNOUNCEMENTS = JSON.parse(localStorage.getItem('gtaga_announcements') || '[]');
    MAINTENANCE   = JSON.parse(localStorage.getItem('gtaga_maintenance')   || 'null');
  } catch (e) {
    ASSETS = []; CURRENT_USER = null; FOLLOWERS = {}; userRatings = {};
    ACCOUNTS = {}; ANNOUNCEMENTS = []; MAINTENANCE = null;
  }

  fileDataCache = {};
  migrateFileData();
  checkMaintenanceMode();
  showLatestAnnouncement();
}

async function migrateFileData() {
  let migrated = false;
  for (const asset of ASSETS) {
    if (asset.fileData) {
      try {
        await fileDB.store(asset.id, asset.fileData);
        fileDataCache[asset.id] = asset.fileData;
        delete asset.fileData;
        asset.hasFile = true;
        migrated = true;
      } catch (err) {
        console.error('Migration failed for:', asset.name, err);
      }
    }
  }
  if (migrated) saveAssets();
}

function saveAssets() {
  localStorage.setItem('gtaga_assets', JSON.stringify(ASSETS));
}

function saveUser() {
  localStorage.setItem('gtaga_user', JSON.stringify(CURRENT_USER));
}

function saveFollowers() {
  localStorage.setItem('gtaga_followers', JSON.stringify(FOLLOWERS));
}

function saveRatings() {
  localStorage.setItem('gtaga_ratings', JSON.stringify(userRatings));
}

function saveAccounts() {
  localStorage.setItem('gtaga_accounts', JSON.stringify(ACCOUNTS));
}

function saveAnnouncements() {
  localStorage.setItem('gtaga_announcements', JSON.stringify(ANNOUNCEMENTS));
}

function saveMaintenance() {
  localStorage.setItem('gtaga_maintenance', JSON.stringify(MAINTENANCE));
}

// ─── IndexedDB for File Data ──────────────────────────────────
const fileDB = {
  _db: null,
  open() {
    return new Promise((resolve, reject) => {
      if (this._db) return resolve(this._db);
      const req = indexedDB.open('gtagassets_files', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
      req.onerror  = (e) => reject(e);
    });
  },
  async store(id, data) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(data, id);
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e);
    });
  },
  async get(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = (e) => reject(e);
    });
  },
  async remove(id) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e);
    });
  }
};

let fileDataCache = {};

// ─── Utilities ───────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function categoryLabel(cat) {
  const map = {
    'logos':'LOGOS','fonts':'FONTS','thumbnails':'THUMBNAIL','overlays':'OVERLAY',
    '3d-models':'3D MODEL','sound-effects':'SFX','ui-assets':'UI ASSET',
    'templates':'TEMPLATE','sounds':'SOUND'
  };
  return map[cat] || cat.toUpperCase();
}

function fileTypeFromName(name) {
  const ext = (name.split('.').pop() || '').toUpperCase();
  const map = {
    PNG:'PNG',JPG:'JPG',JPEG:'JPG',GIF:'GIF',SVG:'SVG',WEBP:'WEBP',
    TTF:'TTF',OTF:'OTF',WOFF:'WOFF',WOFF2:'WOFF2',
    OBJ:'OBJ',FBX:'FBX',GLTF:'GLTF',GLB:'GLB',BLEND:'BLEND',
    WAV:'WAV',MP3:'MP3',OGG:'OGG',FLAC:'FLAC',
    ZIP:'ZIP',RAR:'RAR',PSD:'PSD',PDF:'PDF'
  };
  return map[ext] || ext || 'FILE';
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ─── Password Hashing ────────────────────────────────────────
function hashPassword(str) {
  let hash = 0;
  const salt = 'gtaga_s4lt_2026';
  const s = salt + str + salt;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash = hash & hash;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  let hash2 = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash2 ^= s.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  return hex + '_' + (hash2 >>> 0).toString(16).padStart(8, '0');
}

// ─── Filtering & Sorting ─────────────────────────────────────
function getFilteredAssets() {
  let list = [...ASSETS];
  if (currentCategory !== 'all') list = list.filter(a => a.category === currentCategory);
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    list = list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.creator.toLowerCase().includes(q) ||
      (a.desc || '').toLowerCase().includes(q) ||
      (a.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  if (sortBy === 'newest')  list.sort((a, b) => b.createdAt - a.createdAt);
  if (sortBy === 'popular') list.sort((a, b) => b.downloads - a.downloads);
  if (sortBy === 'rating')  list.sort((a, b) => b.rating - a.rating);
  if (sortBy === 'name')    list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

// ─── Page Switching ──────────────────────────────────────────
function switchPage(page) {
  activePage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector('.nav-link[data-page="' + page + '"]').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'sounds')   renderSoundsGrid();
  if (page === 'creators') renderCreatorsGrid();
}

// ─── Sounds Page ─────────────────────────────────────────────
function getFilteredSounds() {
  let list = ASSETS.filter(a => a.category === 'sounds' || a.category === 'sound-effects');
  if (soundsCategory !== 'all') list = list.filter(a => a.category === soundsCategory);
  if (soundsSearch.trim()) {
    const q = soundsSearch.toLowerCase().trim();
    list = list.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.creator.toLowerCase().includes(q) ||
      (a.desc || '').toLowerCase().includes(q) ||
      (a.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }
  if (soundsSort === 'newest')  list.sort((a, b) => b.createdAt - a.createdAt);
  if (soundsSort === 'popular') list.sort((a, b) => b.downloads - a.downloads);
  if (soundsSort === 'rating')  list.sort((a, b) => b.rating - a.rating);
  if (soundsSort === 'name')    list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function renderSoundsGrid() {
  const grid  = document.getElementById('soundsGrid');
  const empty = document.getElementById('soundsEmptyState');
  const filtered = getFilteredSounds();
  const total = ASSETS.filter(a => a.category === 'sounds' || a.category === 'sound-effects').length;
  document.getElementById('soundsCount').textContent = total + ' SOUND' + (total !== 1 ? 'S' : '');
  const titleMap = { 'all':'All Sounds', 'sound-effects':'Sound Effects', 'sounds':'Music & Loops' };
  document.getElementById('soundsGridTitle').textContent = titleMap[soundsCategory] || 'All Sounds';
  if (filtered.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  grid.innerHTML = filtered.map(renderCard).join('');
  attachCardListeners(grid);
  loadCardThumbnails();
}

// ─── Creators Page ───────────────────────────────────────────
function getCreatorsList() {
  const map = {};
  ASSETS.forEach(a => {
    const key = a.creator.toLowerCase();
    if (!map[key]) map[key] = { name: a.creator, uploads: 0, downloads: 0 };
    map[key].uploads++;
    map[key].downloads += a.downloads;
  });
  let list = Object.values(map);
  list.forEach(c => { c.followers = (FOLLOWERS[c.name.toLowerCase()] || []).length; });
  if (creatorsSearch.trim()) {
    const q = creatorsSearch.toLowerCase().trim();
    list = list.filter(c => c.name.toLowerCase().includes(q));
  }
  if (creatorsSort === 'uploads')   list.sort((a, b) => b.uploads - a.uploads);
  if (creatorsSort === 'downloads') list.sort((a, b) => b.downloads - a.downloads);
  if (creatorsSort === 'followers') list.sort((a, b) => b.followers - a.followers);
  if (creatorsSort === 'name')      list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function renderCreatorsGrid() {
  const grid  = document.getElementById('creatorsGrid');
  const empty = document.getElementById('creatorsEmptyState');
  const list  = getCreatorsList();
  document.getElementById('creatorsCount').textContent = list.length + ' CREATOR' + (list.length !== 1 ? 'S' : '');
  if (list.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  grid.innerHTML = list.map(c => `
    <div class="creator-card" data-creator="${escapeHTML(c.name)}">
      <div class="creator-card-avatar">${c.name.charAt(0).toUpperCase()}</div>
      <div class="creator-card-name">@${escapeHTML(c.name)}</div>
      <div class="creator-card-stats">
        <span><strong>${c.uploads}</strong>Uploads</span>
        <span><strong>${formatNumber(c.downloads)}</strong>Downloads</span>
        <span><strong>${formatNumber(c.followers)}</strong>Followers</span>
      </div>
    </div>`).join('');
  grid.querySelectorAll('.creator-card').forEach(card => {
    card.addEventListener('click', () => openCreatorModal(card.dataset.creator));
  });
}

// ─── Card helpers ─────────────────────────────────────────────
function attachCardListeners(grid) {
  grid.querySelectorAll('.asset-card').forEach(card => {
    const id = card.dataset.id;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-dl-btn') || e.target.closest('.card-creator')) return;
      openAssetModal(id);
    });
    const dlBtn     = card.querySelector('.card-dl-btn');
    const creatorEl = card.querySelector('.card-creator');
    if (dlBtn)     dlBtn.addEventListener('click',     (e) => { e.stopPropagation(); handleDownload(id); });
    if (creatorEl) creatorEl.addEventListener('click', (e) => { e.stopPropagation(); openCreatorModal(creatorEl.dataset.creator); });
  });
}

function renderGrid() {
  const grid  = document.getElementById('assetGrid');
  const empty = document.getElementById('emptyState');
  const filtered = getFilteredAssets();
  const totalCount = ASSETS.length;
  document.getElementById('heroCount').textContent = totalCount + ' ASSET' + (totalCount !== 1 ? 'S' : '');
  const titleMap = {
    'all':'All Assets','logos':'Logos','fonts':'Fonts','thumbnails':'Thumbnails',
    'overlays':'Overlays','3d-models':'3D Models','sound-effects':'Sound Effects',
    'ui-assets':'UI Assets','templates':'Templates','sounds':'Sounds'
  };
  document.getElementById('gridTitle').textContent = titleMap[currentCategory] || 'All Assets';
  if (filtered.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  grid.innerHTML = filtered.map(renderCard).join('');
  attachCardListeners(grid);
  loadCardThumbnails();
}

function renderCard(asset) {
  const cachedData = fileDataCache[asset.id] || null;
  const previewHTML = cachedData
    ? `<img src="${cachedData}" alt="${escapeHTML(asset.name)}" />`
    : (asset.hasFile
      ? `<div class="checkerboard"></div><span class="card-loading" data-id="${asset.id}" style="font-size:1.5rem;position:relative;z-index:1;opacity:0.4;">⏳</span>`
      : `<div class="checkerboard"></div><span style="font-size:2.5rem;position:relative;z-index:1;opacity:0.3;">📦</span>`);
  const ft = asset.fileType || 'FILE';
  const ratingStr = asset.rating > 0 ? asset.rating.toFixed(1) : '—';
  return `
    <div class="asset-card" data-id="${asset.id}">
      <div class="card-preview">
        ${previewHTML}
        <span class="card-category-badge">${categoryLabel(asset.category)}</span>
        <span class="card-filetype-badge">${ft}</span>
      </div>
      <div class="card-body">
        <div class="card-name" title="${escapeHTML(asset.name)}">${escapeHTML(asset.name)}</div>
        <div class="card-creator" data-creator="${escapeHTML(asset.creator)}">@${escapeHTML(asset.creator)}</div>
        <div class="card-footer">
          <div class="card-stats">
            <span title="Downloads">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              ${formatNumber(asset.downloads)}
            </span>
            <span title="Rating">⭐ ${ratingStr}</span>
          </div>
          <button class="card-dl-btn" title="Download">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

async function loadCardThumbnails() {
  const loadingEls = document.querySelectorAll('.card-loading');
  for (const el of loadingEls) {
    const id = el.dataset.id;
    if (fileDataCache[id]) continue;
    try {
      const data = await fileDB.get(id);
      if (data) {
        fileDataCache[id] = data;
        const card = el.closest('.card-preview');
        if (card) {
          const img = document.createElement('img');
          img.src = data; img.alt = '';
          card.insertBefore(img, card.firstChild);
          el.remove();
        }
      }
    } catch (err) { console.warn('Failed to load thumbnail for', id, err); }
  }
}

function escapeHTML(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Asset Detail Modal ───────────────────────────────────────
async function openAssetModal(id) {
  const asset = ASSETS.find(a => a.id === id);
  if (!asset) return;
  selectedAssetId = id;

  document.getElementById('modalTitle').textContent = asset.name;
  document.getElementById('modalCreator').innerHTML = `By <span data-creator="${escapeHTML(asset.creator)}">@${escapeHTML(asset.creator)}</span>`;
  document.getElementById('modalDownloads').textContent = formatNumber(asset.downloads);
  document.getElementById('modalRating').textContent = asset.rating > 0 ? asset.rating.toFixed(1) : '—';
  document.getElementById('modalCategory').textContent = categoryLabel(asset.category);
  document.getElementById('modalFileType').textContent = asset.fileType || 'FILE';
  document.getElementById('modalDesc').textContent = asset.desc || 'No description provided.';

  const previewEl = document.getElementById('modalPreview');
  let fileData = fileDataCache[id] || null;
  if (fileData) {
    previewEl.innerHTML = `<div class="checkerboard"></div><img src="${fileData}" alt="${escapeHTML(asset.name)}" style="position:relative;z-index:1;" />`;
  } else if (asset.hasFile) {
    previewEl.innerHTML = `<div class="checkerboard"></div><span style="font-size:2rem;position:relative;z-index:1;opacity:0.4;">Loading...</span>`;
    try {
      fileData = await fileDB.get(id);
      if (fileData) {
        fileDataCache[id] = fileData;
        if (selectedAssetId === id) {
          previewEl.innerHTML = `<div class="checkerboard"></div><img src="${fileData}" alt="${escapeHTML(asset.name)}" style="position:relative;z-index:1;" />`;
        }
      }
    } catch (err) {
      previewEl.innerHTML = `<div class="checkerboard"></div><span style="font-size:5rem;position:relative;z-index:1;opacity:0.3;">📦</span>`;
    }
  } else {
    previewEl.innerHTML = `<div class="checkerboard"></div><span style="font-size:5rem;position:relative;z-index:1;opacity:0.3;">📦</span>`;
  }

  const tagsEl = document.getElementById('modalTags');
  tagsEl.innerHTML = (asset.tags || []).map(t => `<span class="tag-chip">${escapeHTML(t)}</span>`).join('');

  const userStars = userRatings[id] || 0;
  document.querySelectorAll('#starRating .star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= userStars);
  });

  document.querySelector('#modalCreator span').addEventListener('click', () => {
    closeAllModals();
    openCreatorModal(asset.creator);
  });

  const deleteBtn = document.getElementById('modalDeleteBtn');
  deleteBtn.style.display = canDeleteAsset(asset) ? '' : 'none';

  openModal('assetModal');
}

// ─── Creator Profile Modal ────────────────────────────────────
function openCreatorModal(creatorName) {
  selectedCreator = creatorName;
  const creatorAssets  = ASSETS.filter(a => a.creator.toLowerCase() === creatorName.toLowerCase());
  const totalDownloads = creatorAssets.reduce((sum, a) => sum + a.downloads, 0);
  const followers      = FOLLOWERS[creatorName.toLowerCase()] || [];
  const isFollowing    = CURRENT_USER && followers.includes(CURRENT_USER.name.toLowerCase());

  document.getElementById('creatorAvatar').textContent    = creatorName.charAt(0).toUpperCase();
  document.getElementById('creatorName').textContent      = '@' + creatorName;
  document.getElementById('creatorUploads').textContent   = creatorAssets.length;
  document.getElementById('creatorDownloads').textContent = formatNumber(totalDownloads);
  document.getElementById('creatorFollowers').textContent = formatNumber(followers.length);
  document.getElementById('creatorAssetsName').textContent = creatorName;

  const followBtn = document.getElementById('followBtn');
  followBtn.textContent = isFollowing ? 'Following ✓' : 'Follow';
  followBtn.className   = 'btn btn-follow' + (isFollowing ? ' following' : '');

  const grid = document.getElementById('creatorAssetsGrid');
  grid.innerHTML = creatorAssets.map(renderCard).join('');
  grid.querySelectorAll('.asset-card').forEach(card => {
    card.addEventListener('click', () => { closeAllModals(); openAssetModal(card.dataset.id); });
  });
  loadCardThumbnails();
  openModal('creatorModal');
}

// ─── Download ─────────────────────────────────────────────────
async function handleDownload(id) {
  const asset = ASSETS.find(a => a.id === id);
  if (!asset) return;
  asset.downloads++;
  saveAssets();

  let fileData = fileDataCache[id] || null;
  if (!fileData && asset.hasFile) {
    try {
      fileData = await fileDB.get(id);
      if (fileData) fileDataCache[id] = fileData;
    } catch (err) { console.error('Failed to load file:', err); }
  }

  if (fileData) {
    const link = document.createElement('a');
    link.href = fileData;
    link.download = asset.originalFilename || asset.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  showToast('Downloaded: ' + asset.name, 'success');
  renderGrid(); renderSoundsGrid(); renderCreatorsGrid();
  if (selectedAssetId === id && document.getElementById('assetModal').classList.contains('open')) {
    document.getElementById('modalDownloads').textContent = formatNumber(asset.downloads);
  }
}

// ─── Delete Asset ─────────────────────────────────────────────
function canDeleteAsset(asset) {
  if (!CURRENT_USER) return false;
  if (isAdmin()) return true;
  return asset.creator.toLowerCase() === CURRENT_USER.name.toLowerCase();
}

async function deleteAsset(id) {
  if (!CURRENT_USER) { showToast('Please sign in first', 'error'); return; }
  const asset = ASSETS.find(a => a.id === id);
  if (!asset) return;
  if (!canDeleteAsset(asset)) { showToast('You can only delete your own assets', 'error'); return; }
  const who = isAdmin() && asset.creator.toLowerCase() !== CURRENT_USER.name.toLowerCase() ? ' (admin)' : '';
  if (!confirm('Permanently delete "' + asset.name + '"?' + who + ' This cannot be undone.')) return;
  try { await fileDB.remove(id); } catch (err) { console.warn('IndexedDB remove failed:', err); }
  delete fileDataCache[id];
  ASSETS = ASSETS.filter(a => a.id !== id);
  saveAssets();
  closeAllModals();
  renderGrid(); renderSoundsGrid(); renderCreatorsGrid();
  showToast('Deleted: ' + asset.name, 'success');
}

// ─── Rating ───────────────────────────────────────────────────
async function handleRate(assetId, stars) {
  if (!CURRENT_USER) { showToast('Sign in to rate assets', 'error'); openSigninModal(); return; }
  userRatings[assetId] = stars;
  saveRatings();
  const asset = ASSETS.find(a => a.id === assetId);
  if (!asset) return;
  if (!asset.allRatings) asset.allRatings = [];
  asset.allRatings = asset.allRatings.filter(r => r.user !== CURRENT_USER.name);
  asset.allRatings.push({ user: CURRENT_USER.name, stars });
  asset.rating = asset.allRatings.reduce((s, r) => s + r.stars, 0) / asset.allRatings.length;
  saveAssets();
  document.querySelectorAll('#starRating .star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= stars);
  });
  document.getElementById('modalRating').textContent = asset.rating.toFixed(1);
  showToast('Rated ' + stars + ' star' + (stars !== 1 ? 's' : ''), 'success');
  renderGrid();
}

// ─── Follow ───────────────────────────────────────────────────
async function handleFollow() {
  if (!CURRENT_USER) { showToast('Sign in to follow creators', 'error'); closeAllModals(); openSigninModal(); return; }
  if (!selectedCreator) return;
  const key = selectedCreator.toLowerCase();
  if (!FOLLOWERS[key]) FOLLOWERS[key] = [];
  const userKey = CURRENT_USER.name.toLowerCase();
  const idx = FOLLOWERS[key].indexOf(userKey);
  let msg;
  if (idx === -1) { FOLLOWERS[key].push(userKey); msg = 'Now following @' + selectedCreator; }
  else            { FOLLOWERS[key].splice(idx, 1); msg = 'Unfollowed @' + selectedCreator; }
  saveFollowers();
  openCreatorModal(selectedCreator);
  showToast(msg, 'success');
}

// ─── Upload ───────────────────────────────────────────────────
async function handleUpload(e) {
  e.preventDefault();
  try {
    if (!CURRENT_USER) { showToast('Please sign in first', 'error'); closeAllModals(); openSigninModal(); return; }
    const name        = document.getElementById('assetName').value.trim();
    const category    = document.getElementById('assetCategory').value;
    const desc        = document.getElementById('assetDesc').value.trim();
    const tagsRaw     = document.getElementById('assetTags').value.trim();
    const creatorName = document.getElementById('creatorNameInput').value.trim() || CURRENT_USER.name;
    if (!name)     { showToast('Please enter an asset name', 'error'); return; }
    if (!category) { showToast('Please select a category', 'error'); return; }
    const tags    = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    const assetId = uid();
    const hasFile = !!uploadedFileData;
    if (hasFile) { await fileDB.store(assetId, uploadedFileData); fileDataCache[assetId] = uploadedFileData; }
    const newAsset = {
      id: assetId, name, category, desc, tags, creator: creatorName,
      hasFile, fileType: uploadedFileType || 'FILE',
      originalFilename: hasFile ? (document.getElementById('fileInput').files[0]?.name || name) : null,
      downloads: 0, rating: 0, allRatings: [], createdAt: Date.now()
    };
    ASSETS.unshift(newAsset);
    saveAssets();
    resetUploadForm();
    closeAllModals();
    renderGrid(); renderSoundsGrid(); renderCreatorsGrid();
    showToast('Asset uploaded successfully!', 'success');
  } catch (err) {
    console.error('Upload error:', err);
    showToast('Upload failed: ' + err.message, 'error');
  }
}

function resetUploadForm() {
  document.getElementById('assetName').value  = '';
  document.getElementById('assetDesc').value  = '';
  document.getElementById('assetTags').value  = '';
  document.getElementById('creatorNameInput').value = CURRENT_USER ? CURRENT_USER.name : '';
  document.getElementById('fileInput').value  = '';
  uploadedFileData = null; uploadedFileType = '';
  document.getElementById('filePreview').style.display = 'none';
  document.getElementById('dropZone').style.display    = 'flex';
  setCategoryValue('');
}

// ─── File Handling ────────────────────────────────────────────
function handleFileSelect(file) {
  if (!file) return;
  const MAX_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_SIZE) { showToast('File too large (max 50MB)', 'error'); return; }
  uploadedFileType = fileTypeFromName(file.name);
  const isImage = file.type.startsWith('image/');
  const reader  = new FileReader();
  reader.onload = (e) => {
    uploadedFileData = e.target.result;
    const previewEl   = document.getElementById('filePreview');
    const previewImg  = document.getElementById('filePreviewImg');
    const previewName = document.getElementById('filePreviewName');
    if (isImage) { previewImg.src = uploadedFileData; previewImg.style.display = 'block'; }
    else { previewImg.style.display = 'none'; }
    previewName.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
    previewEl.style.display = 'flex';
    document.getElementById('dropZone').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

// ─── Modal Helpers ────────────────────────────────────────────
function openModal(id)   { document.getElementById(id).classList.add('open'); }
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.custom-select.open').forEach(s => s.classList.remove('open'));
}

function openUploadModal() {
  if (!CURRENT_USER) { showToast('Please sign in to upload', 'error'); openSigninModal(); return; }
  resetUploadForm();
  if (activePage === 'assets' && currentCategory !== 'all') setCategoryValue(currentCategory);
  if (activePage === 'sounds' && soundsCategory !== 'all')  setCategoryValue(soundsCategory);
  openModal('uploadModal');
}

function openSigninModal() {
  setAuthMode('signin');
  document.getElementById('signinName').value     = '';
  document.getElementById('signinPassword').value = '';
  hideAuthError();
  openModal('signinModal');
  setTimeout(() => document.getElementById('signinName').focus(), 200);
}

function setAuthMode(mode) {
  authMode = mode;
  hideAuthError();
  if (mode === 'signin') {
    document.getElementById('authTitle').textContent      = 'Welcome Back';
    document.getElementById('authSubtitle').textContent   = 'Sign in to upload, download, and follow';
    document.getElementById('authSubmitBtn').textContent  = 'Sign In';
    document.getElementById('authToggleText').textContent = "Don't have an account?";
    document.getElementById('authToggleBtn').textContent  = 'Sign Up';
    document.getElementById('signinPassword').setAttribute('autocomplete', 'current-password');
  } else {
    document.getElementById('authTitle').textContent      = 'Create Account';
    document.getElementById('authSubtitle').textContent   = 'Join the Gorilla Tag creator community';
    document.getElementById('authSubmitBtn').textContent  = 'Sign Up';
    document.getElementById('authToggleText').textContent = 'Already have an account?';
    document.getElementById('authToggleBtn').textContent  = 'Sign In';
    document.getElementById('signinPassword').setAttribute('autocomplete', 'new-password');
  }
}

function showAuthError(msg) { const el = document.getElementById('authError'); el.textContent = msg; el.classList.remove('hidden'); }
function hideAuthError()    { document.getElementById('authError').classList.add('hidden'); }

// ─── Auth UI ──────────────────────────────────────────────────
function updateAuthUI() {
  const signinBtn = document.getElementById('openSigninBtn');
  const userMenu  = document.getElementById('userMenu');
  const adminBtn  = document.getElementById('adminMenuBtn');
  if (CURRENT_USER) {
    signinBtn.classList.add('hidden');
    userMenu.classList.remove('hidden');
    document.getElementById('userMenuAvatar').textContent = CURRENT_USER.name.charAt(0).toUpperCase();
    document.getElementById('userMenuName').textContent   = '@' + CURRENT_USER.name;
    // Admin button shown ONLY for cook — exact match, not case-insensitive
    adminBtn.style.display = isAdmin() ? '' : 'none';
  } else {
    signinBtn.classList.remove('hidden');
    userMenu.classList.add('hidden');
    adminBtn.style.display = 'none';
  }
}

function signOut() {
  const name = CURRENT_USER ? CURRENT_USER.name : '';
  CURRENT_USER = null;
  saveUser();
  updateAuthUI();
  document.getElementById('userMenu').classList.remove('open');
  showToast('Signed out of @' + name, '');
}

// ─── Custom Category Select ───────────────────────────────────
const CATEGORY_LABELS = {
  'logos':'Logos','fonts':'Fonts','thumbnails':'Thumbnails','overlays':'Overlays',
  '3d-models':'3D Models','sound-effects':'Sound Effects','ui-assets':'UI Assets',
  'templates':'Templates','sounds':'Sounds'
};

function setCategoryValue(val) {
  const hidden = document.getElementById('assetCategory');
  const label  = document.getElementById('assetCategoryLabel');
  hidden.value = val;
  if (val && CATEGORY_LABELS[val]) { label.textContent = CATEGORY_LABELS[val]; label.classList.remove('placeholder'); }
  else { label.textContent = 'Select category...'; label.classList.add('placeholder'); }
  document.querySelectorAll('#assetCategoryDropdown .custom-select-option').forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.value === val);
  });
}

function initCustomSelect() {
  const wrap    = document.getElementById('assetCategoryWrap');
  const trigger = document.getElementById('assetCategoryTrigger');
  const dropdown = document.getElementById('assetCategoryDropdown');
  trigger.addEventListener('click', (e) => { e.stopPropagation(); wrap.classList.toggle('open'); });
  dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
    opt.addEventListener('click', () => { setCategoryValue(opt.dataset.value); wrap.classList.remove('open'); });
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) wrap.classList.remove('open'); });
}

// ─── Admin: Announcements ─────────────────────────────────────
function showLatestAnnouncement() {
  const banner = document.getElementById('announcementBanner');
  const textEl = document.getElementById('announcementText');
  if (!ANNOUNCEMENTS || ANNOUNCEMENTS.length === 0) { banner.classList.add('hidden'); return; }
  textEl.textContent = ANNOUNCEMENTS[0].text;
  banner.classList.remove('hidden');
}

function hideAnnouncement() {
  document.getElementById('announcementBanner').classList.add('hidden');
}

function postAnnouncement() {
  // Hard gate — only cook can post
  if (!isAdmin()) return;
  const input = document.getElementById('adminAnnouncementInput');
  const text  = input.value.trim();
  if (!text) { showToast('Enter an announcement message', 'error'); return; }
  ANNOUNCEMENTS.unshift({ text, createdAt: Date.now() });
  if (ANNOUNCEMENTS.length > 20) ANNOUNCEMENTS = ANNOUNCEMENTS.slice(0, 20);
  saveAnnouncements();
  input.value = '';
  renderAdminAnnouncements();
  showLatestAnnouncement();
  showToast('Announcement posted!', 'success');
}

function deleteAnnouncement(index) {
  if (!isAdmin()) return;
  ANNOUNCEMENTS.splice(index, 1);
  saveAnnouncements();
  renderAdminAnnouncements();
  showLatestAnnouncement();
}

function renderAdminAnnouncements() {
  const list = document.getElementById('adminAnnouncementsList');
  if (!ANNOUNCEMENTS || ANNOUNCEMENTS.length === 0) {
    list.innerHTML = '<p class="admin-empty">No announcements yet.</p>';
    return;
  }
  list.innerHTML = ANNOUNCEMENTS.map((ann, i) => {
    const timeStr = new Date(ann.createdAt).toLocaleDateString();
    return `<div class="admin-announcement-item">
      <span>${escapeHTML(ann.text)}</span>
      <span class="admin-ann-time">${timeStr}</span>
      <button class="admin-ann-delete" data-index="${i}" title="Delete">&times;</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.admin-ann-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteAnnouncement(parseInt(btn.dataset.index)));
  });
}

// ─── Admin: Maintenance Mode ──────────────────────────────────
function checkMaintenanceMode() {
  const overlay = document.getElementById('maintenanceOverlay');
  if (!MAINTENANCE || !MAINTENANCE.endsAt) {
    overlay.classList.add('hidden');
    if (maintenanceTimer) { clearInterval(maintenanceTimer); maintenanceTimer = null; }
    return;
  }
  if (Date.now() >= MAINTENANCE.endsAt) {
    MAINTENANCE = null;
    saveMaintenance();
    overlay.classList.add('hidden');
    return;
  }
  document.getElementById('maintenanceMessage').textContent = MAINTENANCE.message || "We'll be back shortly!";
  overlay.classList.remove('hidden');
  startMaintenanceCountdown();
}

function startMaintenanceCountdown() {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  const timerEl = document.getElementById('maintenanceTimer');
  function updateTimer() {
    if (!MAINTENANCE || !MAINTENANCE.endsAt) {
      clearInterval(maintenanceTimer);
      document.getElementById('maintenanceOverlay').classList.add('hidden');
      return;
    }
    const remaining = MAINTENANCE.endsAt - Date.now();
    if (remaining <= 0) {
      clearInterval(maintenanceTimer);
      MAINTENANCE = null;
      saveMaintenance();
      document.getElementById('maintenanceOverlay').classList.add('hidden');
      updateAdminMaintenanceUI();
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    timerEl.textContent = 'Estimated return: ' + mins + 'm ' + secs + 's';
  }
  updateTimer();
  maintenanceTimer = setInterval(updateTimer, 1000);
}

function toggleMaintenance() {
  // Hard gate — only cook can toggle maintenance
  if (!isAdmin()) return;
  if (MAINTENANCE && MAINTENANCE.endsAt && Date.now() < MAINTENANCE.endsAt) {
    // Disable
    MAINTENANCE = null;
    saveMaintenance();
    if (maintenanceTimer) { clearInterval(maintenanceTimer); maintenanceTimer = null; }
    document.getElementById('maintenanceOverlay').classList.add('hidden');
    updateAdminMaintenanceUI();
    showToast('Maintenance mode disabled', 'success');
  } else {
    // Enable
    const message  = document.getElementById('adminMaintenanceMsg').value.trim() || "We'll be back shortly!";
    const duration = parseInt(document.getElementById('adminMaintenanceDuration').value) || 30;
    MAINTENANCE    = { message, endsAt: Date.now() + (duration * 60 * 1000) };
    saveMaintenance();
    checkMaintenanceMode();
    updateAdminMaintenanceUI();
    showToast('Maintenance mode enabled for ' + duration + ' minutes', 'success');
  }
}

function updateAdminMaintenanceUI() {
  const btn     = document.getElementById('adminMaintenanceToggle');
  const btnText = document.getElementById('adminMaintenanceBtnText');
  const status  = document.getElementById('adminMaintenanceStatus');
  if (MAINTENANCE && MAINTENANCE.endsAt && Date.now() < MAINTENANCE.endsAt) {
    btnText.textContent   = 'Disable Maintenance';
    btn.classList.add('active');
    const mins = Math.floor((MAINTENANCE.endsAt - Date.now()) / 60000);
    status.textContent    = 'Active — ' + mins + ' minutes remaining';
    status.className      = 'admin-maintenance-status active';
  } else {
    btnText.textContent   = 'Enable Maintenance';
    btn.classList.remove('active');
    status.textContent    = '';
    status.className      = 'admin-maintenance-status';
  }
}

// ─── Admin Panel ──────────────────────────────────────────────
function openAdminPanel() {
  // Double-check — reject anyone who isn't cook
  if (!isAdmin()) { showToast('Access denied', 'error'); return; }
  renderAdminAnnouncements();
  updateAdminMaintenanceUI();
  openModal('adminModal');
}

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  console.log('[gtagassets] Initializing...');
  loadState();
  renderGrid();
  renderSoundsGrid();
  renderCreatorsGrid();
  initCustomSelect();
  updateAuthUI();

  // Nav
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => { e.preventDefault(); switchPage(link.dataset.page); });
  });
  document.querySelector('.logo').addEventListener('click', (e) => { e.preventDefault(); switchPage('assets'); });

  // Category pills
  document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentCategory = pill.dataset.cat;
      renderGrid();
    });
  });

  // Search
  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchQuery = e.target.value; renderGrid(); }, 250);
  });

  // Sort
  document.getElementById('sortSelect').addEventListener('change', (e) => { sortBy = e.target.value; renderGrid(); });

  // Upload buttons
  document.getElementById('openUploadBtn').addEventListener('click', openUploadModal);
  document.getElementById('emptyUploadBtn').addEventListener('click', openUploadModal);

  // Sign in button
  document.getElementById('openSigninBtn').addEventListener('click', openSigninModal);

  // User menu dropdown
  const userMenu = document.getElementById('userMenu');
  document.getElementById('userMenuTrigger').addEventListener('click', (e) => {
    e.stopPropagation();
    userMenu.classList.toggle('open');
  });
  document.addEventListener('click', (e) => { if (!userMenu.contains(e.target)) userMenu.classList.remove('open'); });
  document.getElementById('signOutBtn').addEventListener('click', signOut);
  document.getElementById('viewProfileBtn').addEventListener('click', () => {
    userMenu.classList.remove('open');
    if (CURRENT_USER) openCreatorModal(CURRENT_USER.name);
  });

  // Close modal buttons
  document.getElementById('closeAssetModal').addEventListener('click',    closeAllModals);
  document.getElementById('closeCreatorModal').addEventListener('click',  closeAllModals);
  document.getElementById('closeUploadModal').addEventListener('click',   closeAllModals);
  document.getElementById('closeSigninModal').addEventListener('click',   closeAllModals);

  // Overlay click to close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAllModals(); });
  });

  // Upload form
  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    try { await handleUpload(e); }
    catch (err) { showToast('Upload error: ' + err.message, 'error'); }
  });

  // Auth form
  document.getElementById('signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name     = document.getElementById('signinName').value.trim();
    const password = document.getElementById('signinPassword').value;
    if (!name || !password) { showAuthError('Please fill in all fields'); return; }
    if (password.length < 4) { showAuthError('Password must be at least 4 characters'); return; }
    const key      = name.toLowerCase();
    const passHash = hashPassword(password);
    if (authMode === 'signup') {
      if (ACCOUNTS[key]) { showAuthError('That name is already taken. Try signing in.'); return; }
      ACCOUNTS[key] = { name, passHash };
      saveAccounts();
      CURRENT_USER = { name };
      saveUser();
      updateAuthUI();
      closeAllModals();
      showToast('Account created! Welcome, @' + name + '!', 'success');
    } else {
      if (!ACCOUNTS[key])                           { showAuthError('No account found with that name. Try signing up.'); return; }
      if (ACCOUNTS[key].passHash !== passHash)      { showAuthError('Incorrect password. Please try again.'); return; }
      CURRENT_USER = { name: ACCOUNTS[key].name };
      saveUser();
      updateAuthUI();
      closeAllModals();
      showToast('Welcome back, @' + ACCOUNTS[key].name + '!', 'success');
    }
  });

  // Auth toggle
  document.getElementById('authToggleBtn').addEventListener('click', () => {
    setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
    document.getElementById('signinPassword').value = '';
  });

  // Drop zone
  const dropZone  = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.querySelector('.browse-link').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) handleFileSelect(e.target.files[0]); });
  dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
  });
  document.getElementById('removeFileBtn').addEventListener('click', () => {
    uploadedFileData = null; uploadedFileType = '';
    fileInput.value = '';
    document.getElementById('filePreview').style.display = 'none';
    dropZone.style.display = 'flex';
  });

  // Star rating
  document.querySelectorAll('#starRating .star').forEach(star => {
    star.addEventListener('click', () => { if (selectedAssetId) handleRate(selectedAssetId, parseInt(star.dataset.val)); });
    star.addEventListener('mouseenter', () => {
      const val = parseInt(star.dataset.val);
      document.querySelectorAll('#starRating .star').forEach(s => {
        s.style.color = parseInt(s.dataset.val) <= val ? 'var(--accent-orange)' : '';
      });
    });
  });
  document.getElementById('starRating').addEventListener('mouseleave', () => {
    const userStars = userRatings[selectedAssetId] || 0;
    document.querySelectorAll('#starRating .star').forEach(s => {
      s.style.color = '';
      s.classList.toggle('active', parseInt(s.dataset.val) <= userStars);
    });
  });

  // Modal download / delete
  document.getElementById('modalDownloadBtn').addEventListener('click', () => { if (selectedAssetId) handleDownload(selectedAssetId); });
  document.getElementById('modalDeleteBtn').addEventListener('click',   () => { if (selectedAssetId) deleteAsset(selectedAssetId); });

  // Follow
  document.getElementById('followBtn').addEventListener('click', handleFollow);

  // ── Admin panel ──────────────────────────────────────────────
  document.getElementById('adminMenuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isAdmin()) return; // silent reject for non-cook users
    userMenu.classList.remove('open');
    openAdminPanel();
  });
  document.getElementById('closeAdminModal').addEventListener('click', closeAllModals);
  document.getElementById('adminPostAnnouncementBtn').addEventListener('click', postAnnouncement);
  document.getElementById('adminAnnouncementInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); postAnnouncement(); }
  });
  document.getElementById('adminMaintenanceToggle').addEventListener('click', toggleMaintenance);
  document.getElementById('announcementClose').addEventListener('click', hideAnnouncement);

  // Sounds page
  document.querySelectorAll('.sound-cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.sound-cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      soundsCategory = pill.dataset.scat;
      renderSoundsGrid();
    });
  });
  let soundsSearchTimer;
  document.getElementById('soundsSearchInput').addEventListener('input', (e) => {
    clearTimeout(soundsSearchTimer);
    soundsSearchTimer = setTimeout(() => { soundsSearch = e.target.value; renderSoundsGrid(); }, 250);
  });
  document.getElementById('soundsSortSelect').addEventListener('change', (e) => { soundsSort = e.target.value; renderSoundsGrid(); });
  document.querySelectorAll('.sounds-upload-btn').forEach(btn => btn.addEventListener('click', openUploadModal));

  // Creators page
  let creatorsSearchTimer;
  document.getElementById('creatorsSearchInput').addEventListener('input', (e) => {
    clearTimeout(creatorsSearchTimer);
    creatorsSearchTimer = setTimeout(() => { creatorsSearch = e.target.value; renderCreatorsGrid(); }, 250);
  });
  document.getElementById('creatorsSortSelect').addEventListener('change', (e) => { creatorsSort = e.target.value; renderCreatorsGrid(); });
  document.querySelectorAll('.creators-upload-btn').forEach(btn => btn.addEventListener('click', openUploadModal));

  // Escape to close
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllModals(); });

  console.log('[gtagassets] Ready!');
});
