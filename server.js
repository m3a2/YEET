// server.js
// Minimal Express backend for TubeTen
// - Requires: Node 18+ (global fetch available) or node-fetch installed
// - Put YOUTUBE_API_KEY in .env
// - Usage: POST /api/import-playlist { url }  -> imports & filters playlist into in-memory pool
//          GET  /api/play/:playlistId?count=10  -> returns up to `count` randomized items from pool
//          GET  /api/pool/:playlistId -> returns full stored pool

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS: restrict in production by setting ALLOWED_ORIGIN in .env
const ALLOWED = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED }));

// basic rate limiter
app.use(rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // requests per IP per windowMs
}));

const API_KEY = process.env.YOUTUBE_API_KEY || '';
if (!API_KEY) {
  console.warn('Warning: YOUTUBE_API_KEY not set in environment (.env). /api/import-playlist will fail.');
}

// in-memory pool store: { playlistId: [ { videoId, title, thumbnails, durationSec, ... } ] }
const pools = {};

// ---------- helpers ----------
function extractPlaylistId(input = '') {
  if (!input) return null;
  // if user provided playlist id directly (PL...)
  if (/^(PL|UU|FL|LL|RD|OL)[A-Za-z0-9_-]+$/.test(input)) return input;
  // try URL query ?list=
  const m = input.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

// parse ISO8601 duration (PT#H#M#S) -> seconds
function parseISODurationToSeconds(iso = '') {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = parseInt(m[1] || '0', 10);
  const mm = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  return h * 3600 + mm * 60 + s;
}

// fetch playlistItems paginated (maxResults=50/page)
async function fetchPlaylistItems(playlistId) {
  if (!API_KEY) throw new Error('missing_api_key');
  const base = 'https://www.googleapis.com/youtube/v3/playlistItems';
  const items = [];
  let pageToken = '';
  while (true) {
    const url = `${base}?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${API_KEY}` + (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`YT playlistItems failed ${res.status}: ${txt}`);
      err.status = res.status;
      throw err;
    }
    const j = await res.json();
    (j.items || []).forEach(it => {
      const vid = it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId;
      if (vid) {
        items.push({
          videoId: vid,
          title: it.snippet.title,
          thumbnails: it.snippet.thumbnails || null,
        });
      }
    });
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
    // safety: prevent infinite loop (very large playlists), optional cap
    if (items.length > 2000) break;
  }
  return items;
}

// fetch video details (contentDetails,status,snippet) in batches of up to 50 ids
async function fetchVideoDetails(videoIds = []) {
  if (!API_KEY) throw new Error('missing_api_key');
  const result = {}; // id -> details
  const base = 'https://www.googleapis.com/youtube/v3/videos';
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50).join(',');
    const url = `${base}?part=contentDetails,status,snippet&id=${encodeURIComponent(batch)}&key=${API_KEY}&maxResults=50`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`YT videos failed ${res.status}: ${txt}`);
      err.status = res.status;
      throw err;
    }
    const j = await res.json();
    (j.items || []).forEach(v => {
      result[v.id] = {
        durationISO: v.contentDetails?.duration || null,
        durationSec: parseISODurationToSeconds(v.contentDetails?.duration || 'PT0S'),
        embeddable: v.status?.embeddable !== false, // default true unless explicitly false
        privacyStatus: v.status?.privacyStatus || 'public',
        title: v.snippet?.title || '',
        thumbnails: v.snippet?.thumbnails || null,
      };
    });
  }
  return result;
}

// shuffle helper
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- API routes ----------

// health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// import playlist -> build pool (filter + limit)
app.post('/api/import-playlist', async (req, res) => {
  try {
    const { url } = req.body || {};
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return res.status(400).json({ error: 'invalid_playlist' });
    if (!API_KEY) return res.status(500).json({ error: 'missing_api_key' });

    // 1) fetch playlist items (may be large)
    const items = await fetchPlaylistItems(playlistId);
    if (!items.length) return res.status(404).json({ error: 'empty_playlist' });

    // 2) we'll only request details for a sample window to avoid huge quota
    //    take the first 300 ids (adjustable). Then filter and sample up to 100.
    const sampleIds = items.map(i => i.videoId).slice(0, 300);
    const details = await fetchVideoDetails(sampleIds);

    // 3) map + filter:
    //    - must be embeddable
    //    - must be public
    //    - duration >5s and <= 1800s (30 minutes)
    const mapped = items
      .map(it => {
        const d = details[it.videoId];
        return {
          videoId: it.videoId,
          title: it.title,
          thumbnails: it.thumbnails || null,
          durationSec: d?.durationSec || 0,
          embeddable: d?.embeddable ?? true,
          privacyStatus: d?.privacyStatus ?? 'public'
        };
      })
      .filter(it => it.videoId && it.embeddable && it.privacyStatus === 'public' && it.durationSec > 5 && it.durationSec <= 1800);

    // 4) shuffle & limit to 100
    const pool = shuffleArray(mapped).slice(0, 100);

    pools[playlistId] = pool;

    return res.json({
      playlistId,
      count: pool.length,
      sample: pool.slice(0, 6),
      message: 'imported',
    });
  } catch (err) {
    console.error('import-playlist error:', err);
    if (err.status) return res.status(502).json({ error: 'youtube_api_error', detail: err.message });
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

// get stored pool (full)
app.get('/api/pool/:playlistId', (req, res) => {
  const pid = req.params.playlistId;
  const pool = pools[pid];
  if (!pool) return res.status(404).json({ error: 'not_found' });
  res.json({ playlistId: pid, count: pool.length, items: pool });
});

// get play items (randomized selection up to count)
app.get('/api/play/:playlistId', (req, res) => {
  try {
    const pid = req.params.playlistId;
    const pool = pools[pid];
    if (!pool) return res.status(404).json({ error: 'not_found' });
    const count = Math.min(50, Math.max(1, parseInt(req.query.count || '10', 10))); // limit requested count
    // shuffle copy and pick first count
    const chosen = shuffleArray(pool).slice(0, Math.min(count, pool.length));
    return res.json({ playlistId: pid, count: chosen.length, items: chosen });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

// serve static UI from ./public (if you put HTML/CSS there)
app.use(express.static(path.join(__dirname, 'public')));

// catch-all for others: show basic message
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// start
const PORT = parseInt(process.env.PORT || '4000', 10);
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
