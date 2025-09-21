// server.js
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
app.use(express.json());

// CORS (แก้ ALLOWED_ORIGIN ใน .env ได้)
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));

// Rate limit กันยิงถี่ ๆ
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

// Path helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// เสิร์ฟไฟล์ static
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

// root => tubeten.html
app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "tubeten.html"));
});

// SPA fallback: ทุกเส้นทางที่ไม่ใช่ /api/* -> tubeten.html
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "tubeten.html"));
});

/* ------------------- API: YouTube (คงเดิม) ------------------- */
const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) console.warn("Warning: YOUTUBE_API_KEY not set");

function extractPlaylistId(urlOrId) {
  if (!urlOrId) return null;
  if (/^(PL|UU|FL|LL|RD|OL)[A-Za-z0-9_-]+$/.test(urlOrId)) return urlOrId;
  const m = urlOrId.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function fetchPlaylistItems(playlistId) {
  const items = [];
  let pageToken = "";
  const base = "https://www.googleapis.com/youtube/v3/playlistItems";
  while (true) {
    const url = `${base}?part=snippet&maxResults=50&playlistId=${encodeURIComponent(
      playlistId
    )}&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`playlistItems ${r.status}`);
    const data = await r.json();
    for (const it of data.items ?? []) {
      const vid = it?.snippet?.resourceId?.videoId;
      if (vid) {
        items.push({
          videoId: vid,
          title: it.snippet.title,
          thumbnails: it.snippet.thumbnails || null,
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
  const base = "https://www.googleapis.com/youtube/v3/videos";
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50).join(",");
    const url = `${base}?part=contentDetails,snippet&id=${batch}&key=${API_KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`videos ${r.status}`);
    const data = await r.json();
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

const pools = {}; // { playlistId: [ ... ] }

app.post("/api/import-playlist", async (req, res) => {
  try {
    const { url } = req.body;
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return res.status(400).json({ error: "invalid_playlist" });
    if (!API_KEY) return res.status(500).json({ error: "missing_api_key" });

    const items = await fetchPlaylistItems(playlistId);
    if (items.length === 0) return res.status(404).json({ error: "empty_playlist" });

    const details = await fetchVideoDetails(items.map(i => i.videoId));
    const pool = items.map(i => ({
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
    res.status(500).json({ error: "server_error", detail: e.message });
  }
});

app.get("/api/pool/:playlistId", (req, res) => {
  const pool = pools[req.params.playlistId];
  if (!pool) return res.status(404).json({ error: "not_found" });
  res.json({ playlistId: req.params.playlistId, count: pool.length, items: pool });
});

function pickRandom(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

app.get("/api/play/:playlistId", (req, res) => {
  const pool = pools[req.params.playlistId];
  if (!pool?.length) return res.status(404).json({ error: "not_found" });
  const count = Math.max(1, Math.min(pool.length, parseInt(req.query.count || "10", 10)));
  const items = pickRandom(pool, count).map(({ videoId, title }) => ({ videoId, title }));
  res.json({ playlistId: req.params.playlistId, count: items.length, items });
});

/* ------------------- Start ------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on :${PORT}`));
