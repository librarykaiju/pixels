// pixels.brandonj.ink
// Serves the static editor from ./public and one small API route:
//   GET /api/skin/<java-username>  -> that player's current skin PNG
// Mojang's endpoints don't send CORS headers, so the browser can't call them directly.

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const UA = { "user-agent": "pixels-skin-editor/1.0 (+https://pixels.brandonj.ink)", accept: "application/json" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/skin/")) {
      if (request.method !== "GET") return text("Method not allowed", 405);
      const name = decodeURIComponent(url.pathname.slice("/api/skin/".length));
      if (!NAME_RE.test(name)) return text("That isn't a valid Java username.", 400);
      try {
        return await skinFor(name, request, ctx);
      } catch (err) {
        return text("Couldn't reach Mojang. Try again in a minute.", 502);
      }
    }

    if (url.pathname.startsWith("/api/")) return text("Not found", 404);
    return env.ASSETS.fetch(request);
  },
};

async function skinFor(name, request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(`/api/skin/${name.toLowerCase()}`, request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // Name -> UUID. Mojang has two endpoints for this; the older one refuses some
  // Cloudflare egress, so try the newer one first and fall back.
  const n = encodeURIComponent(name);
  let id = null, notFound = 0, tried = 0;
  for (const u of [`https://api.minecraftservices.com/minecraft/profile/lookup/name/${n}`, `https://api.mojang.com/users/profiles/minecraft/${n}`]) {
    tried++;
    try {
      const r = await fetch(u, { headers: UA });
      if (r.status === 404 || r.status === 204) { notFound++; continue; }
      if (!r.ok) continue;
      const j = await r.json();
      if (j && typeof j.id === "string" && /^[0-9a-f]{32}$/i.test(j.id)) { id = j.id; break; }
    } catch {}
  }
  if (!id) return notFound === tried ? text("No Java player has that name.", 404) : text("Mojang didn't answer. Try again in a minute.", 502);

  const sess = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`, { headers: UA });
  if (!sess.ok) return text("Mojang didn't answer. Try again in a minute.", 502);
  const data = await sess.json();
  const prop = (data.properties || []).find((p) => p.name === "textures");
  if (!prop) return text("That player has no skin set.", 404);
  const textures = JSON.parse(atob(prop.value)).textures || {};
  const skin = textures.SKIN;
  if (!skin || !skin.url) return text("That player uses a default skin.", 404);

  const skinUrl = skin.url.replace(/^http:/, "https:");
  if (!/^https:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]+$/.test(skinUrl)) {
    return text("Unexpected skin address from Mojang.", 502);
  }
  const png = await fetch(skinUrl, { headers: UA });
  if (!png.ok) return text("Couldn't download the skin.", 502);

  const res = new Response(png.body, {
    headers: {
      "content-type": "image/png",
      "x-skin-model": skin.metadata && skin.metadata.model === "slim" ? "slim" : "classic",
      "cache-control": "public, max-age=600",
      "x-content-type-options": "nosniff",
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function text(body, status) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
