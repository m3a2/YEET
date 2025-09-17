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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Core middlewares ----------
app.use(express.json());
app.use(
  cors({
    // ใส่โดเมนจริงตอนขึ้น prod เช่น https://tubeten.yeetstudio.work
    origin: process.env.ALLOWED_ORIGIN || '*',
  })
);
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 นาที
    max: 30, // จำกัด request กันสแปม
  })
);

// ---------- Static site (โฟลเดอร์ public) ----------
app.use(
  express.static(path.join(__dirname, 'public'), {
    // ปรับได้ตามเหมาะสม
    maxAge: '1h',
    extensions: ['html'],
  })
);

// หน้าแรก: ชี้ไปที่ public/tubeten.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tubeten.html'));
});

// ---------- YT helper / API ----------
const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  console.warn('Warning: YOUTUBE_API_KEY not set in env');
}

// extract playlistId จาก URL หรือ id ตรง ๆ
function extractPlaylistId(urlOrId) {
  if (!urlOrId) return null;
  if (/^(PL|UU|FL|LL|RD|OL)[A-Za-z0-9_-]+$/.test(urlOrId)) return urlOrId;
  const m = urlOrId.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// ดึงรายการใน playlist (มี pagination)
async function fetchPlaylistItems(playlistId) {
  const items = [];
  let pageToken = '';
  const base = 'https://www.googleapis.com/youtube/v3/playlistItems';

  while (true) {
    const url = `${base}?part=snippet&maxResults=50&playlistId=${encodeURIComponent(
      playlistId
    )}&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`YT playlistItems failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    if (!data.items) break;

    for (const it of data.items) {
      if (it.snippet?.resourceId?.videoId) {
        items.push({
          videoId: it.snippet.resourceId.videoId,
          title: it.snippet.title,
          thumbnails: it.snippet.thumbnails ?? null,
          position: it.snippet.position ?? null,
        });
      }
    }
    if (data.nextPageToken) pageToken = data.nextPageToken;
    else break;
  }
  return items;
}

// ดึงรายละเอียดวิดีโอทีละชุด (duration ฯลฯ)
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
          duration: v.contentDetails?.duration || null, // ISO8601
          title: v.snippet?.title || null,
          thumbnails: v.snippet?.thumbnails || null,
        };
      }
    }
  }
  return result;
}

// เก็บ pool ไว้ในหน่วยความจำ (demo)
const pools = {}; // { playlistId: [ { videoId, title, thumbnails, duration, addedAt } ] }

// นำเข้า playlist → สร้าง pool
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

    res.json({
      playlistId,
      count: pool.length,
      sample: pool.slice(0, 6),
      message: 'imported',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

// ดึง pool กลับมา
app.get('/api/pool/:playlistId', (req, res) => {
  const { playlistId } = req.params;
  const pool = pools[playlistId];
  if (!pool) return res.status(404).json({ error: 'not_found' });
  res.json({ playlistId, count: pool.length, items: pool });
});

// ---------- SPA fallback ----------
// ถ้าเส้นทางไหนไม่ใช่ /api/* ให้เสิร์ฟหน้า public/tubeten.html (กัน 404)
// หมายเหตุ: ต้องวางไว้หลัง route /api/*
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tubeten.html'));
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000; // Render จะส่ง PORT มาเอง
app.listen(PORT, () => console.log('Server running on port', PORT));
