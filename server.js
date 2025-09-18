// server.js
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*'
}));

// Rate limit
app.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));

// ====== YouTube API ======
const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) console.warn('Warning: YOUTUBE_API_KEY not set in env');

function extractPlaylistId(urlOrId) {
  if (!urlOrId) return null;
  if (/^(PL|UU|FL|LL|RD|OL)[A-Za-z0-9_-]+$/.test(urlOrId)) return urlOrId;
  const m = urlOrId.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function fetchPlaylistItems(playlistId) {
  const items = [];
  let pageToken = '';
  const base = 'https://www.googleapis.com/youtube/v3/playlistItems';
  while (true) {
    const url = `${base}?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`playlistItems ${res.status}`);
    const data = await res.json();
    if (!data.items) break;
    for (const it of data.items) {
      const vid = it?.snippet?.resourceId?.videoId;
      if (vid) {
        items.push({
          videoId: vid,
          title: it.snippet.title,
          thumbnails: it.snippet.thumbnails || null,
          position: it.snippet.position ?? null
        });
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return items;
}

async function fetchVideoDetails(videoIds) {
  const out = {};
  const base = 'https://www.googleapis.com/youtube/v3/videos';
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50).join(',');
    const url = `${base}?part=contentDetails,snippet&id=${batch}&key=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`videos ${res.status}`);
    const data = await res.json();
    for (const v of data.items ?? []) {
      out[v.id] = {
        duration: v.contentDetails?.duration ?? null,
        title: v.snippet?.title ?? null,
        thumbnails: v.snippet?.thumbnails ?? null,
      };
    }
  }
  return out;
}

// ====== In-memory data ======
const pools = {}; // { playlistId: [ {videoId, title, thumbnails, duration} ] }

// ====== Routes ======

// import playlist
app.post('/api/import-playlist', async (req, res) => {
  try {
    const { url } = req.body;
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return res.status(400).json({ error: 'invalid_playlist' });
    if (!API_KEY) return res.status(500).json({ error: 'missing_api_key' });

    const items = await fetchPlaylistItems(playlistId);
    if (items.length === 0) return res.status(404).json({ error: 'empty_playlist' });

    const ids = items.map(i => i.videoId);
    const details = await fetchVideoDetails(ids);

    const pool = items.map(i => ({
      videoId: i.videoId,
      title: i.title,
      thumbnails: i.thumbnails,
      duration: details[i.videoId]?.duration || null,
      addedAt: Date.now()
    }));

    pools[playlistId] = pool;
    res.json({ playlistId, count: pool.length, sample: pool.slice(0, 6) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

// get full pool
app.get('/api/pool/:playlistId', (req, res) => {
  const pool = pools[req.params.playlistId];
  if (!pool) return res.status(404).json({ error: 'not_found' });
  res.json({ playlistId: req.params.playlistId, count: pool.length, items: pool });
});

// get session items (random subset)
function pickRandom(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

app.get('/api/play/:playlistId', (req, res) => {
  const pool = pools[req.params.playlistId];
  if (!pool || pool.length === 0) return res.status(404).json({ error: 'not_found' });
  const count = Math.max(1, Math.min(pool.length, parseInt(req.query.count || '10', 10)));
  const items = pickRandom(pool, count).map(({ videoId, title }) => ({ videoId, title }));
  res.json({ playlistId: req.params.playlistId, count: items.length, items });
});

// ====== Start server ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
