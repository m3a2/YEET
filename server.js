// server.js
// npm i express cors express-rate-limit dotenv
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

// -------------------- Host helpers --------------------
function isTubeTenHost(host = '') {
  const h = String(host || '').toLowerCase();
  return h.startsWith('tubeten.');
}
function getHost(req) {
  // Render/Proxy จะส่ง x-forwarded-host มาให้ ใช้ค่านี้ก่อน
  return req.headers['x-forwarded-host'] || req.headers.host || req.hostname || '';
}

// -------------------- Host-aware routes (มาก่อน static) --------------------
app.get('/', (req, res) => {
  const host = getHost(req);
  if (isTubeTenHost(host)) {
    return res.sendFile(path.join(PUBLIC_DIR, 'tubeten.html'));
  }
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/privacy', (req, res) => {
  const host = getHost(req);
  if (isTubeTenHost(host)) {
    // ให้ใช้ privacy เฉพาะโดเมนหลัก
    return res.redirect(302, 'https://yeetstudio.work/privacy');
  }
  return res.sendFile(path.join(PUBLIC_DIR, 'privacy.html'));
});

// บนโดเมนหลัก ถ้าเข้าทาง /tubeten ให้เด้งไป subdomain ที่ถูกต้อง
app.get('/tubeten', (_req, res) => {
  res.redirect(302, 'https://tubeten.yeetstudio.work');
});

// -------------------- Static (มา "หลัง" route ข้างบน) --------------------
app.use(express.static(PUBLIC_DIR, {
  index: false,               // กัน static เสิร์ฟ index.html เองก่อนเรา
  extensions: ['html'],
}));

// health check
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

// ==================== YouTube API (native fetch) ====================
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
    const url = `${base}?part=snippet&maxResults=50&playlistId=${encodeURIComponent(
      playlistId
    )}&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
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

const pools = {}; // { playlistId: [...] }

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
    res.json({ playlistId, count: pool.length, sample: pool.slice(0, 6) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

app.get('/api/pool/:playlistId', (req, res) => {
  const pool = pools[req.params.playlistId];
  if (!pool) return res.status(404).json({ error: 'not_found' });
  res.json({ playlistId: req.params.playlistId, count: pool.length, items: pool });
});

// -------------------- Start --------------------
const PORT = process.env.PORT || 4000; // Render จะกำหนด PORT ให้เอง
app.listen(PORT, () => console.log('Server running on port', PORT));
