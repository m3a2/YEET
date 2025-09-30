import { extractPlaylistId, fetchPlaylistItems, fetchVideoDetails, cors } from "../_lib/youtube.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return cors("", 204);
  if (request.method !== "POST") return cors(JSON.stringify({ error: "method_not_allowed" }), 405);

  try {
    const { url } = await request.json();
    const playlistId = extractPlaylistId(url);
    if (!playlistId) return cors(JSON.stringify({ error: "invalid_playlist" }), 400);

    // 👉 เช็คว่ามี ?force=1 ไหม (บังคับรีเฟรช)
    const urlObj = new URL(request.url);
    const force = urlObj.searchParams.get("force") === "1";

    const key = `pool:${playlistId}`;

    // ✅ ถ้าไม่ force และมีแคชใน KV แล้ว → ใช้เลย ไม่ต้องเรียก YouTube
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

    // ถึงตรงนี้คือ “ไม่มีแคช” หรือ “ถูกสั่ง force”
    const API_KEY = env.YOUTUBE_API_KEY;
    if (!API_KEY) return cors(JSON.stringify({ error: "missing_api_key" }), 500);

    const items = await fetchPlaylistItems(playlistId, API_KEY);
    if (!items.length) return cors(JSON.stringify({ error: "empty_playlist" }), 404);

    const details = await fetchVideoDetails(items.map(i => i.videoId), API_KEY);
    
    const isPlayable = (i) => {
      const d = details[i.videoId] || {};
      const status = d.status || {};
      const title = (i.title || "").toLowerCase();

      // ชื่อที่ YouTube มักให้กับ unavailable
      const looksDeletedOrPrivate =
        title === "private video" || title === "deleted video";

      // เงื่อนไขหลัก: ต้องฝังได้ + ไม่ private + อัปโหลดต้อง processed
      const embeddable = status.embeddable !== false; // true/undefined = โอเค
      const notPrivate = status.privacyStatus !== "private"; // อนุญาต public/unlisted
      const processed = status.uploadStatus ? status.uploadStatus === "processed" : true;

      return !looksDeletedOrPrivate && embeddable && notPrivate && processed;
    };
    
        // 4) คัดเฉพาะที่ "เล่นได้" แล้วจำกัดไม่เกิน 50
    const playable = items.filter(isPlayable);
    const limited = playable.slice(0, 50);

    
    const pool = limited.map(i => ({
      videoId: i.videoId,
      title: i.title,
      thumbnails: i.thumbnails,
      duration: details[i.videoId]?.duration || null,
      addedAt: Date.now()
    }));

    // เก็บลง KV (TTL 48 ชม.)
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