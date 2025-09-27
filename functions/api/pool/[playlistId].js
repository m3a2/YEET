import { cors } from "../../_lib/youtube.js";

export async function onRequest({ params, env, request }) {
  if (request.method === "OPTIONS") return cors("", 204);
  if (request.method !== "GET") return cors(JSON.stringify({ error: "method_not_allowed" }), 405);

  const raw = await env.TUBETEN_POOL.get(`pool:${params.playlistId}`);
  if (!raw) return cors(JSON.stringify({ error: "not_found" }), 404);

  const items = JSON.parse(raw);
  return cors(JSON.stringify({ playlistId: params.playlistId, count: items.length, items }));
}
