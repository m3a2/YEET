// server.js
// npm i express node-fetch cors express-rate-limit dotenv
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());

// CORS
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));

// Rate limit
app.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));

/* ---------- Static files & host-aware routes ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// เสิร์ฟ asset จาก public/
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// helper: เช็คว่าเป็น subdomain tubeten หรือไม่
function isTubeTenHost(hostname = '') {
  return String(hostname).toLowerCase().startsWith('tubeten.');
}

// root: เสิร์ฟตาม host
app.get('/', (req, res) => {
  if (isTubeTenHost(req.hostname)) {
    return res.sendFile(path.join(PUBLIC_DIR, 'tubeten.html'));
  }
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// privacy: ให้ใช้ที่โดเมนหลักเท่านั้น
app.get('/privacy', (req, res) => {
  if (isTubeTenHost(req.hostname)) {
    // redirect ไปโดเมนหลัก
    return res.redirect(302, 'https://yeetstudio.work/privacy');
  }
  return res.sendFile(path.join(PUBLIC_DIR, 'privacy.html'));
});

// health check
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

/* ---------- YouTube API (ของเดิม) ---------- */
const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  console.warn('Warning: YOUTUBE_API_KEY not set in env');
}

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
    const url =
      `${base}?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${API_KEY}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`YT playlistItems failed: ${res.status} ${text}`);
    }
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
  const result = {};
  const base = 'https://www.googleapis.com/youtube/v3/videos';
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50).join(',');
    const url = `${base}?part=contentDetails,snippet&id=${batch}&key=${API_KEY}&maxResults=50`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`YT videos failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    if (data.items) {
      for (const v of data.items) {
        result[v.id] = {
          duration: v.contentDetails?.duration,
          title: v.snippet?.title,
          thumbnails: v.snippet?.thumbnails
        };
      }
    }
  }
  return result;
}

const pools = {}; // { playlistId: [ {videoId, title, thumbnails, duration, addedAt} ] }

app.post('/api/import-playlist', async (req, res) => {
  try {
    const { url } = req.body;
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return res.status(400).json({ error: 'invalid_playlist' });
    if (!API_KEY) return res.status(500).json({ error: 'missing_api_key' });

    const items = await fetchPlaylistItems(playlistId);
    if (items.length === 0) return res.status(404).json({ error: 'empty_playlist' });

    const details = await fetchVideoDetails(items.map(i => i.videoId));
    const pool = items.map(i => ({
      videoId: i.videoId,
      title: i.title,
      thumbnails: i.thumbnails,
      duration: details[i.videoId]?.duration || null,
      addedAt: Date.now()
    }));

    pools[playlistId] = pool;

    return res.json({
      playlistId,
      count: pool.length,
      sample: pool.slice(0, 6),
      message: 'imported',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

app.get('/api/pool/:playlistId', (req, res) => {
  const { playlistId } = req.params;
  const pool = pools[playlistId];
  if (!pool) return res.status(404).json({ error: 'not_found' });
  res.json({ playlistId, count: pool.length, items: pool });
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 4000; // Render จะเซ็ต PORT ให้เอง
app.listen(PORT, () => console.log('Server running on port', PORT));
