import { extractPlaylistId, fetchPlaylistItems, fetchVideoDetails, cors } from "../../_lib/youtube.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return cors("", 204);
  if (request.method !== "POST") return cors(JSON.stringify({ error: "method_not_allowed" }), 405);

  try {
    const { url } = await request.json();
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return cors(JSON.stringify({ error: "invalid_playlist" }), 400);

    const API_KEY = env.YOUTUBE_API_KEY;
    if (!API_KEY) return cors(JSON.stringify({ error: "missing_api_key" }), 500);

    const items = await fetchPlaylistItems(playlistId, API_KEY);
    if (!items.length) return cors(JSON.stringify({ error: "empty_playlist" }), 404);

    const details = await fetchVideoDetails(items.map(i => i.videoId), API_KEY);
    const pool = items.map(i => ({
      videoId: i.videoId,
      title: i.title,
      thumbnails: i.thumbnails,
      duration: details[i.videoId]?.duration || null,
      addedAt: Date.now()
    }));

    await env.TUBETEN_POOL.put(`pool:${playlistId}`, JSON.stringify(pool), { expirationTtl: 60 * 60 * 48 });
    return cors(JSON.stringify({ playlistId, count: pool.length, sample: pool.slice(0, 6) }));
  } catch (e) {
    return cors(JSON.stringify({ error: "server_error", detail: String(e.message || e) }), 500);
  }
}
