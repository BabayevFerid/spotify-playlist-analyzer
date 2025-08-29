// Frontend logic: login, get playlists, request analysis, render charts
// Buttons and DOM
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userArea = document.getElementById('user-area');
const userInfoEl = document.getElementById('user-info');
const playlistsSelect = document.getElementById('playlists');
const analyzeBtn = document.getElementById('analyzeBtn');
const resultArea = document.getElementById('result-area');

const statTracks = document.getElementById('stat-tracks');
const statDuration = document.getElementById('stat-duration');
const statFeatures = document.getElementById('stat-features');
const playlistHeader = document.getElementById('playlist-header');

const topArtistsEl = document.getElementById('topArtists');
const topTracksEl = document.getElementById('topTracks');
const topGenresEl = document.getElementById('topGenres');

const featuresCanvas = document.getElementById('featuresChart');
let featuresChart = null;

// helper fetch wrapper
async function apiGet(path){
  const r = await fetch(path);
  if (!r.ok) throw new Error('API_ERROR');
  return r.json();
}

async function checkAuthAndLoad(){
  try {
    const me = await apiGet('/api/me');
    // logged in
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    userArea.classList.remove('hidden');
    userInfoEl.innerHTML = `<strong>${me.display_name || me.id}</strong> (${me.product || 'user'})`;

    // load playlists
    const pl = await apiGet('/api/playlists');
    playlistsSelect.innerHTML = '';
    (pl.items || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} — ${p.tracks.total} tracks`;
      playlistsSelect.appendChild(opt);
    });
  } catch (err) {
    // not authenticated
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    userArea.classList.add('hidden');
  }
}

loginBtn.addEventListener('click', () => {
  window.location.href = '/login';
});
logoutBtn.addEventListener('click', async () => {
  await fetch('/logout');
  location.href = '/';
});

analyzeBtn.addEventListener('click', async () => {
  const id = playlistsSelect.value;
  if (!id) return alert('Please select a playlist');
  try {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
    const result = await apiGet(`/api/playlist/${id}/analyze`);
    renderAnalysis(result);
  } catch (err) {
    alert('Analysis failed. Make sure you are logged in and try again.');
    console.error(err);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze Playlist';
  }
});

function renderAnalysis(data){
  // show header
  resultArea.classList.remove('hidden');
  const p = data.playlist;
  playlistHeader.innerHTML = `
    <img src="${p.image || ''}" alt="Playlist cover" onerror="this.style.display='none'" />
    <div>
      <h2 style="margin:0">${escapeHtml(p.name)}</h2>
      <div style="color:#9aa4b2">${escapeHtml(p.owner)} • ${p.total_tracks} tracks</div>
    </div>
  `;

  statTracks.textContent = p.total_tracks;
  statDuration.textContent = p.duration_human;
  statFeatures.textContent = data.analysis.features_count;

  // features chart (danceability, energy, valence, tempo, acousticness)
  const features = data.analysis.avg_features || {};
  const labels = ['danceability','energy','valence','acousticness','tempo'];
  const values = labels.map(l => features[l] !== undefined ? features[l] : 0);

  if (featuresChart) featuresChart.destroy();
  featuresChart = new Chart(featuresCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Average',
        data: values,
        backgroundColor: [
          '#1db954','#4ade80','#60a5fa','#fca5a5','#fbbf24'
        ],
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });

  // top artists
  topArtistsEl.innerHTML = '';
  (data.analysis.top_artists || []).forEach(a => {
    const li = document.createElement('li');
    li.textContent = `${a.name} — ${a.count} track(s)`;
    topArtistsEl.appendChild(li);
  });

  // top tracks
  topTracksEl.innerHTML = '';
  (data.analysis.top_tracks || []).forEach(t => {
    const li = document.createElement('li');
    li.textContent = `${t.name} — ${t.artists} (popularity: ${t.popularity})`;
    topTracksEl.appendChild(li);
  });

  // top genres
  topGenresEl.innerHTML = '';
  (data.analysis.top_genres || []).forEach(g => {
    const li = document.createElement('li');
    li.textContent = `${g.genre} (${g.count})`;
    topGenresEl.appendChild(li);
  });

  // scroll to result
  resultArea.scrollIntoView({ behavior: 'smooth' });
}

function escapeHtml(s){
  if (!s) return '';
  return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

// initial check
checkAuthAndLoad();
