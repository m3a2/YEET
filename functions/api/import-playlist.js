// import-playlist.js (API)
// Filters out deleted/private/non-embeddable/unprocessed videos before caching

import { extractPlaylistId, fetchPlaylistItems, fetchVideoDetails, cors } from "../_lib/youtube.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return cors("", 204);
  if (request.method !== "POST") return cors(JSON.stringify({ error: "method_not_allowed" }), 405);

  try {
    const { url } = await request.json();
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return cors(JSON.stringify({ error: "invalid_playlist" }), 400);

    // Optional cache bypass: ?force=1
    const urlObj = new URL(request.url);
    const force = urlObj.searchParams.get("force") === "1";

    const key = `pool:v2:${playlistId}`;

    // Serve from KV cache if present and not forced
    if (!force) {
      const cached = await env.TUBETEN_POOL.get(key);
      if (cached) {
        const pool = JSON.parse(cached);
        return cors(JSON.stringify({
          playlistId,
          count: pool.length,
          sample: pool.slice(0, 6),
          cached: true
        }));
      }
    }

    const API_KEY = env.YOUTUBE_API_KEY;
    if (!API_KEY) return cors(JSON.stringify({ error: "missing_api_key" }), 500);

    // 1) Fetch raw items from playlist (title/id/thumbs)
    const items = await fetchPlaylistItems(playlistId, API_KEY);
    if (!items?.length) return cors(JSON.stringify({ error: "empty_playlist" }), 404);

    // 2) Pre-filter obvious invalids by title/id
    const prelim = items.filter((it) => {
      const id = it.videoId;
      const t = (it.title || '').trim().toLowerCase();
      if (!id || !t) return false;
      if (t === 'deleted video' || t === 'private video' || t === 'not available') return false;
      return true;
    });

    if (!prelim.length) {
      return cors(JSON.stringify({ playlistId, count: 0, sample: [], cached: false }));
    }

    // 3) Validate using videos.list (status/contentDetails/duration)
    const ids = prelim.map((it) => it.videoId);
    const details = await fetchVideoDetails(ids, API_KEY); // expected: map[id] = { status, contentDetails, duration }

    // Build allow-map
    const isOk = (d) => {
      if (!d) return false;
      const s = d.status || {};
        if (s.privacyStatus === 'private') return false;
        if (s.uploadStatus && s.uploadStatus !== 'processed') return false;
        if (s.embeddable === false) return false;
      // Optional: regionRestriction checks could be added here if needed
      return true;
    };

    const pool = prelim
      .filter((it) => isOk(details[it.videoId]))
      .map((it) => ({
        videoId: it.videoId,
        title: it.title,
        thumbnails: it.thumbnails,
        duration: details[it.videoId]?.duration || null,
        addedAt: Date.now()
      }));

    // Cache for 48h
    await env.TUBETEN_POOL.put(key, JSON.stringify(pool), { expirationTtl: 60 * 60 * 48 });

    return cors(JSON.stringify({
      playlistId,
      count: pool.length,
      sample: pool.slice(0, 6),
      cached: false
    }));
  } catch (e) {
    return cors(JSON.stringify({ error: "server_error", detail: String(e.message || e) }), 500);
  }
}