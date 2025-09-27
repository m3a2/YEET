export function extractPlaylistId(urlOrId) {
  if (!urlOrId) return null;
  if (/^(PL|UU|FL|LL|RD|OL)[A-Za-z0-9_-]+$/.test(urlOrId)) return urlOrId;
  const m = String(urlOrId).match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export async function fetchPlaylistItems(playlistId, apiKey) {
  const items = [];
  let pageToken = "";
  const base = "https://www.googleapis.com/youtube/v3/playlistItems";
  while (true) {
    const url = `${base}?part=snippet&maxResults=50&playlistId=${encodeURIComponent(
      playlistId
    )}&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`playlistItems ${r.status}`);
    const data = await r.json();
    for (const it of data.items ?? []) {
      const vid = it?.snippet?.resourceId?.videoId;
      if (vid) items.push({ videoId: vid, title: it.snippet.title, thumbnails: it.snippet.thumbnails || null });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return items;
}

export async function fetchVideoDetails(ids, apiKey) {
  const out = {};
  const base = "https://www.googleapis.com/youtube/v3/videos";
  for (let i = 0; i < ids.length; i += 50) {
    const url = `${base}?part=contentDetails,snippet&id=${ids.slice(i, i+50).join(",")}&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`videos ${r.status}`);
    const data = await r.json();
    for (const v of data.items ?? []) {
      out[v.id] = {
        duration: v.contentDetails?.duration ?? null,
        title: v.snippet?.title ?? null,
        thumbnails: v.snippet?.thumbnails ?? null
      };
    }
  }
  return out;
}

export function pickRandom(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export function cors(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": "no-store"
    }
  });
}
