export async function onRequest() {
  return new Response("ok", { headers: { "content-type": "text/plain" } });
}
