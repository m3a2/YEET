import { pickRandom, cors } from "../../_lib/youtube.js";

export async function onRequest({ params, env, request }) {
  if (request.method === "OPTIONS") return cors("", 204);
  if (request.method !== "GET") return cors(JSON.stringify({ error: "method_not_allowed" }), 405);

  const url = new URL(request.url);
  const count = Math.max(1, Math.min(50, parseInt(url.searchParams.get("count") || "10", 10)));

  const raw = await env.TUBETEN_POOL.get(`pool:${params.playlistId}`);
  if (!raw) return cors(JSON.stringify({ error: "not_found" }), 404);

  const pool = JSON.parse(raw);
  const items = pickRandom(pool, Math.min(pool.length, count)).map(({ videoId, title }) => ({ videoId, title }));
  return cors(JSON.stringify({ playlistId: params.playlistId, count: items.length, items }));
}
