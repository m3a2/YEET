// server.js
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// core middlewares
app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));

// serve static from /public
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', extensions: ['html'] }));

// landing page -> public/tubeten.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tubeten.html'));
});

// ===== YouTube helpers (use global fetch) =====
const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) console.warn('Warning: YOUTUBE_API_KEY not set');

function extractPlaylistId(urlOrId) {
  if (!urlOrId) return null;
  if (/^(PL|UU|FL|LL|RD|OL)[A-Za-z0-9_-]+$/.test(urlOrId)) return urlOrId;
  const m = String(urlOrId).match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function fetchPlaylistItems(playlistId) {
  const items = [];
  let pageToken = '';
  const base = 'https://www.googleapis.com/youtube/v3/playlistItems';
  while (true) {
    const url = `${base}?part=snippet&maxResults=50&playlistId=${encodeURIComponent(
      playlistId
    )}&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`playlistItems ${res.status}`);
    const data = await res.json();
    for (const it of data.items ?? []) {
      const vid = it?.snippet?.resourceId?.videoId;
      if (vid) {
        items.push({
          videoId: vid,
          title: it.snippet.title,
          thumbnails: it.snippet.thumbnails ?? null,
          position: it.snippet.position ?? null,
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
    const url = `${base}?part=contentDetails,snippet&id=${batch}&key=${API_KEY}&maxResults=50`;
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

const pools = {};

app.post('/api/import-playlist', async (req, res) => {
  try {
    const { url } = req.body;
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return res.status(400).json({ error: 'invalid_playlist' });
    if (!API_KEY) return res.status(500).json({ error: 'missing_api_key' });

    const items = await fetchPlaylistItems(playlistId);
    if (items.length === 0) return res.status(404).json({ error: 'empty_playlist' });

    const ids = items.map((i) => i.videoId);
    const details = await fetchVideoDetails(ids);

    const pool = items.map((i) => ({
      videoId: i.videoId,
      title: i.title,
      thumbnails: i.thumbnails,
      duration: details[i.videoId]?.duration || null,
      addedAt: Date.now(),
    }));

    pools[playlistId] = pool;
    res.json({ playlistId, count: pool.length, sample: pool.slice(0, 6) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error', detail: e.message });
  }
});

app.get('/api/pool/:playlistId', (req, res) => {
  const pool = pools[req.params.playlistId];
  if (!pool) return res.status(404).json({ error: 'not_found' });
  res.json({ playlistId: req.params.playlistId, count: pool.length, items: pool });
});

// SPA fallback (ทุก path ที่ไม่ใช่ /api/* ให้กลับมาหน้าแรก)
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tubeten.html'));
});

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
