require('dotenv').config();
const express = require('express');
const axios = require('axios');
const qs = require('querystring');
const cookieSession = require('cookie-session');
const path = require('path');

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:8888/callback';
const PORT = process.env.PORT || 8888;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

const app = express();

// session to store tokens temporarily
app.use(cookieSession({
  name: 'spotify_session',
  keys: [SESSION_SECRET],
  maxAge: 24 * 60 * 60 * 1000
}));

// serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Helper: base64 client creds
function getAuthHeader() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

// 1) Login route -> redirect to Spotify authorize URL
app.get('/login', (req, res) => {
  const scope = [
    'playlist-read-private',
    'playlist-read-collaborative',
    // optionally add user-read-private if you want user info
  ].join(' ');

  const params = qs.stringify({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope,
    show_dialog: true
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// 2) Callback -> exchange code for access token + refresh token
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  if (!code) return res.redirect('/?error=no_code');

  try {
    const tokenResp = await axios.post('https://accounts.spotify.com/api/token',
      qs.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      }), {
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

    // store tokens in session
    req.session.access_token = tokenResp.data.access_token;
    req.session.refresh_token = tokenResp.data.refresh_token;
    req.session.expires_in = Date.now() + (tokenResp.data.expires_in * 1000);

    // redirect to frontend root
    res.redirect('/');
  } catch (err) {
    console.error('Token error', err.response?.data || err.message);
    res.redirect('/?error=token_failed');
  }
});

// 3) Logout
app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// Helper: refresh token if expired
async function ensureAccessToken(req) {
  if (!req.session || !req.session.access_token) {
    throw new Error('not_authenticated');
  }
  const expiresAt = req.session.expires_in || 0;
  if (Date.now() < expiresAt - 5000) { // still valid
    return req.session.access_token;
  }

  // refresh
  const refresh_token = req.session.refresh_token;
  const resp = await axios.post('https://accounts.spotify.com/api/token',
    qs.stringify({
      grant_type: 'refresh_token',
      refresh_token
    }), {
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
  req.session.access_token = resp.data.access_token;
  req.session.expires_in = Date.now() + ((resp.data.expires_in || 3600) * 1000);
  return req.session.access_token;
}

// 4) API endpoints for frontend to fetch data

// Get current user profile (optional)
app.get('/api/me', async (req, res) => {
  try {
    const token = await ensureAccessToken(req);
    const u = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(u.data);
  } catch (err) {
    res.status(401).json({ error: 'not_authenticated' });
  }
});

// Get current user's playlists (paginated, but we fetch up to 50 here)
app.get('/api/playlists', async (req, res) => {
  try {
    const token = await ensureAccessToken(req);
    const resp = await axios.get('https://api.spotify.com/v1/me/playlists?limit=50', {
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(resp.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'fetch_failed' });
  }
});

// Analyze playlist by id: fetch all tracks, fetch audio-features in batches, compute stats
app.get('/api/playlist/:id/analyze', async (req, res) => {
  const playlistId = req.params.id;
  try {
    const token = await ensureAccessToken(req);

    // 1) fetch playlist metadata
    const playlistResp = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const playlist = playlistResp.data;

    // 2) fetch all playlist tracks (pagination)
    let tracks = [];
    let next = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`;
    while (next) {
      const tResp = await axios.get(next, { headers: { Authorization: `Bearer ${token}` } });
      const items = tResp.data.items;
      items.forEach(i => {
        if (i.track) tracks.push(i.track);
      });
      next = tResp.data.next;
    }

    // Prepare lists for features and artist ids
    const trackIds = tracks.map(t => t.id).filter(Boolean);
    const artistIds = [];
    tracks.forEach(t => {
      if (t && t.artists) {
        t.artists.forEach(a => artistIds.push(a.id));
      }
    });

    // 3) get audio-features in batches of 100
    const audioFeatures = {};
    for (let i = 0; i < trackIds.length; i += 100) {
      const batch = trackIds.slice(i, i + 100).join(',');
      if (!batch) continue;
      const fResp = await axios.get(`https://api.spotify.com/v1/audio-features?ids=${batch}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      (fResp.data.audio_features || []).forEach(af => {
        if (af && af.id) audioFeatures[af.id] = af;
      });
    }

    // 4) fetch artists (unique) in batches to get genres and popularity if needed
    const uniqueArtistIds = [...new Set(artistIds)].filter(Boolean);
    const artistsMap = {};
    for (let i = 0; i < uniqueArtistIds.length; i += 50) {
      const batch = uniqueArtistIds.slice(i, i + 50).join(',');
      if (!batch) continue;
      const aResp = await axios.get(`https://api.spotify.com/v1/artists?ids=${batch}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      (aResp.data.artists || []).forEach(a => { artistsMap[a.id] = a; });
    }

    // 5) compute stats
    const totalTracks = tracks.length;
    let totalDurationMs = 0;
    const artistCount = {};
    const trackPopularity = [];

    const featuresAccumulator = {
      danceability: 0,
      energy: 0,
      valence: 0,
      tempo: 0,
      acousticness: 0,
      instrumentalness: 0,
      liveness: 0,
      speechiness: 0
    };
    let featuresCount = 0;

    tracks.forEach(t => {
      if (!t) return;
      totalDurationMs += t.duration_ms || 0;
      trackPopularity.push({ id: t.id, name: t.name, artists: t.artists.map(a => a.name).join(', '), popularity: t.popularity || 0 });

      (t.artists || []).forEach(a => {
        if (!a || !a.id) return;
        artistCount[a.name || a.id] = (artistCount[a.name || a.id] || 0) + 1;
      });

      const af = audioFeatures[t.id];
      if (af) {
        featuresCount++;
        Object.keys(featuresAccumulator).forEach(k => {
          if (af[k] !== undefined && af[k] !== null) {
            featuresAccumulator[k] += af[k];
          }
        });
      }
    });

    // Average features
    const avgFeatures = {};
    if (featuresCount > 0) {
      Object.keys(featuresAccumulator).forEach(k => {
        avgFeatures[k] = +(featuresAccumulator[k] / featuresCount).toFixed(3);
      });
    }

    // Top artists
    const topArtists = Object.entries(artistCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Top tracks by popularity
    const topTracks = trackPopularity.sort((a, b) => b.popularity - a.popularity).slice(0, 10);

    // Genres: aggregate from artistsMap
    const genreCount = {};
    Object.values(artistsMap).forEach(a => {
      (a.genres || []).forEach(g => {
        genreCount[g] = (genreCount[g] || 0) + 1;
      });
    });
    const topGenres = Object.entries(genreCount).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([g,c])=>({genre:g,count:c}));

    // Format duration
    function formatDuration(ms){
      const s = Math.floor(ms/1000);
      const h = Math.floor(s/3600);
      const m = Math.floor((s%3600)/60);
      const sec = s%60;
      return (h>0 ? h+'h ' : '') + m+'m '+sec+'s';
    }

    const result = {
      playlist: {
        id: playlist.id,
        name: playlist.name,
        owner: playlist.owner?.display_name || playlist.owner?.id,
        total_tracks: totalTracks,
        duration_ms: totalDurationMs,
        duration_human: formatDuration(totalDurationMs),
        image: playlist.images?.[0]?.url || null
      },
      analysis: {
        avg_features: avgFeatures,
        features_count: featuresCount,
        top_artists: topArtists,
        top_tracks: topTracks,
        top_genres: topGenres
      }
    };

    res.json(result);

  } catch (err) {
    console.error('Analyze error', err.response?.data || err.message);
    if (err.message === 'not_authenticated') return res.status(401).json({ error: 'not_authenticated' });
    res.status(500).json({ error: 'analysis_failed', detail: err.response?.data || err.message });
  }
});

// default fallback to serve index (for SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// start server
app.listen(PORT, () => {
  console.log(`Server started at http://localhost:${PORT}`);
});
