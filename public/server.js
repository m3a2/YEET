// server.js
// npm i express node-fetch cors express-rate-limit dotenv
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());

// ปรับให้เป็นโดเมนของคุณเมื่อ deploy
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*' // เปลี่ยนเป็นโดเมนจริงก่อนขึ้น production
}));

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30 // ป้องกันการสแปม
});
app.use(limiter);

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  console.warn('Warning: YOUTUBE_API_KEY not set in env');
}

// helper: extract playlistId
function extractPlaylistId(urlOrId) {
  if (!urlOrId) return null;
  // ถ้า user ป้อนตรง ๆ playlistId (เช่น PLxxxx) ให้ใช้ทันที
  if (/^(PL|UU|FL|LL|RD|OL)[A-Za-z0-9_-]+$/.test(urlOrId)) return urlOrId;

  // regex for URL
  const m = urlOrId.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];

  return null;
}

// fetch all playlist items (paginated)
async function fetchPlaylistItems(playlistId) {
  const items = [];
  let pageToken = '';
  const base = 'https://www.googleapis.com/youtube/v3/playlistItems';

  while (true) {
    const url = `${base}?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`YT playlistItems failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    if (!data.items) break;
    // collect videoId & snippet
    for (const it of data.items) {
      if (it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId) {
        items.push({
          videoId: it.snippet.resourceId.videoId,
          title: it.snippet.title,
          thumbnails: it.snippet.thumbnails || null,
          position: it.snippet.position ?? null
        });
      }
    }
    if (data.nextPageToken) pageToken = data.nextPageToken;
    else break;
  }
  return items;
}

// fetch video details (contentDetails) in batches of 50
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
          duration: v.contentDetails?.duration, // ISO8601, e.g. PT3M20S
          title: v.snippet?.title,
          thumbnails: v.snippet?.thumbnails
        };
      }
    }
  }
  return result;
}

// In-memory pool (ตัวอย่าง) — เปลี่ยนเป็น DB ใน production
const pools = {}; // { playlistId: [ {videoId, title, thumbnails, duration} ] }

app.post('/api/import-playlist', async (req, res) => {
  try {
    const { url } = req.body;
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return res.status(400).json({ error: 'invalid_playlist' });

    if (!API_KEY) return res.status(500).json({ error: 'missing_api_key' });

    // fetch basic playlist items
    const items = await fetchPlaylistItems(playlistId);
    if (items.length === 0) return res.status(404).json({ error: 'empty_playlist' });

    // fetch video details (durations) - get IDs
    const ids = items.map(i => i.videoId);
    const details = await fetchVideoDetails(ids);

    // assemble pool array
    const pool = items.map(i => ({
      videoId: i.videoId,
      title: i.title,
      thumbnails: i.thumbnails,
      duration: details[i.videoId]?.duration || null,
      addedAt: Date.now()
    }));

    // store in memory pool (or save to DB)
    pools[playlistId] = pool;

    // return summary
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

// optional: endpoint to get pool
app.get('/api/pool/:playlistId', (req, res) => {
  const { playlistId } = req.params;
  const pool = pools[playlistId];
  if (!pool) return res.status(404).json({ error: 'not_found' });
  res.json({ playlistId, count: pool.length, items: pool });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log('Server running on port', PORT));
