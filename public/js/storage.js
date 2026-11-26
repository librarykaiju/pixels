// Saves drawings in this browser (localStorage). Each drawing is stored as
// one PNG per layer, plus a small index with thumbnails for the gallery.

import { renderTilemap } from "./tilemap.js";
import { Doc } from "./doc.js";

const IDX = "pixels:index", DOC = (id) => `pixels:doc:${id}`, PREFS = "pixels:prefs";

export function pxToDataURL(px, w, h, scale = 1) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
  if (scale === 1) return c.toDataURL("image/png");
  const s = document.createElement("canvas");
  s.width = Math.round(w * scale); s.height = Math.round(h * scale);
  const g = s.getContext("2d"); g.imageSmoothingEnabled = false;
  g.drawImage(c, 0, 0, s.width, s.height);
  return s.toDataURL("image/png");
}

export function loadImage(src) {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => bad(new Error("That file couldn't be read as an image."));
    img.src = src;
  });
}

export function imageToPx(img, w = img.naturalWidth, h = img.naturalHeight) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

export function listDocs() {
  try { return JSON.parse(localStorage.getItem(IDX) || "[]"); } catch { return []; }
}

const blankURL = new Map();
function celURL(px, w, h) {
  if (px) return pxToDataURL(px, w, h);
  const k = `${w}x${h}`;
  if (!blankURL.has(k)) blankURL.set(k, pxToDataURL(new Uint8ClampedArray(w * h * 4), w, h));
  return blankURL.get(k);
}

export function serialize(doc) {
  doc.syncFrame();
  return {
    v: 3, id: doc.id, name: doc.name, mode: doc.mode, model: doc.model, w: doc.w, h: doc.h, active: doc.active,
    frame: doc.frame, durations: doc.frames.map((f) => f.duration),
    tags: doc.tags, groups: doc.groups, slices: doc.slices, palette: doc.palette, guides: doc.guides,
    layers: doc.layers.map((l) => ({
      name: l.name, visible: l.visible, opacity: l.opacity, alphaLock: !!l.alphaLock, blend: l.blend || "normal", group: l.group || null,
      // linked cels: frames in the same link group store the image once
      links: doc.frames.some((f) => f.links && f.links[l.id]) ? doc.frames.map((f) => (f.links && f.links[l.id]) || null) : undefined,
      frames: l.tilemap ? [] : doc.frames.map((f, i) => {
        const g = f.links && f.links[l.id];
        if (g && doc.frames.findIndex((x) => x.links && x.links[l.id] === g) < i) return null;
        return celURL(f.px[l.id], doc.w, doc.h);
      }),
      tilemap: l.tilemap ? { tw: l.tilemap.tw, th: l.tilemap.th, cols: l.tilemap.cols, rows: l.tilemap.rows, map: [...l.tilemap.map], tiles: l.tilemap.tiles.map((t) => pxToDataURL(t, l.tilemap.tw, l.tilemap.th)) } : undefined,
    })),
  };
}

export async function deserialize(data) {
  if (!data || !Array.isArray(data.layers) || !data.w || !data.h) throw new Error("That isn't a Pixels project file.");
  if (data.w > 512 || data.h > 512) throw new Error("That project is bigger than 512×512.");
  const layers = [];
  const nFrames = Math.max(1, Math.min(500, Array.isArray(data.durations) ? data.durations.length : 1));
  const frames = Array.from({ length: nFrames }, (_, i) => ({ duration: Math.max(20, +(data.durations || [])[i] || 100), px: {} }));
  for (const l of data.layers) {
    const id = `l${Math.random().toString(36).slice(2, 10)}`;
    const srcs = Array.isArray(l.frames) ? l.frames : [l.png];
    const links = Array.isArray(l.links) ? l.links : null;
    for (let i = 0; i < nFrames; i++) {
      const g = links && links[i];
      if (g) { frames[i].links = frames[i].links || {}; frames[i].links[id] = String(g); }
      if (!srcs[i]) continue;
      frames[i].px[id] = imageToPx(await loadImage(srcs[i]), data.w, data.h);
    }
    if (links) for (let i = 0; i < nFrames; i++) {
      const g = links[i]; if (!g) continue;
      const first = links.indexOf(g);
      if (first !== i && frames[first].px[id]) frames[i].px[id] = frames[first].px[id];
    }
    let tilemap;
    if (l.tilemap && Array.isArray(l.tilemap.tiles)) {
      const t = l.tilemap;
      tilemap = { tw: t.tw | 0, th: t.th | 0, cols: t.cols | 0, rows: t.rows | 0, map: Int32Array.from(t.map || []), tiles: [] };
      for (const src of t.tiles) tilemap.tiles.push(imageToPx(await loadImage(src), tilemap.tw, tilemap.th));
      const px = renderTilemap(tilemap, data.w, data.h);
      for (const f of frames) f.px[id] = px;
    }
    const blend = typeof l.blend === "string" ? l.blend : "normal";
    layers.push({ id, name: String(l.name || "Layer").slice(0, 60), visible: l.visible !== false, opacity: l.opacity === 0 ? 0 : +l.opacity || 1, alphaLock: !!l.alphaLock, blend, group: l.group || null, tilemap, px: frames[0].px[id] || new Uint8ClampedArray(data.w * data.h * 4) });
  }
  const doc = new Doc({ w: data.w, h: data.h, mode: data.mode === "skin" ? "skin" : "art", model: data.model === "slim" ? "slim" : "classic", name: String(data.name || "Untitled").slice(0, 80), layers, id: data.id, frames });
  const arr = (v) => (Array.isArray(v) ? v : []);
  doc.tags = arr(data.tags).filter((t) => t && t.to < nFrames).map((t) => ({ name: String(t.name || "Tag").slice(0, 40), from: t.from | 0, to: t.to | 0, dir: ["forward", "reverse", "pingpong"].includes(t.dir) ? t.dir : "forward", color: t.color || "#7b6aa0" }));
  doc.groups = arr(data.groups).map((g) => ({ id: String(g.id), name: String(g.name || "Group").slice(0, 40), visible: g.visible !== false, opacity: g.opacity === 0 ? 0 : +g.opacity || 1, collapsed: !!g.collapsed }));
  doc.slices = arr(data.slices).map((t) => ({ name: String(t.name || "Slice").slice(0, 40), x: t.x | 0, y: t.y | 0, w: t.w | 0, h: t.h | 0, center: t.center ? { x: t.center.x | 0, y: t.center.y | 0, w: t.center.w | 0, h: t.center.h | 0 } : null }));
  doc.palette = Array.isArray(data.palette) ? data.palette.filter((h) => /^#[0-9a-f]{6}$/i.test(h)).slice(0, 256) : null;
  doc.guides = data.guides && typeof data.guides === "object" ? data.guides : null;
  doc.loadFrame(data.frame > 0 && data.frame < nFrames ? data.frame | 0 : 0);
  doc.active = Math.min(Math.max(0, data.active | 0), layers.length - 1);
  return doc;
}

export function saveDoc(doc) {
  const data = serialize(doc);
  const comp = doc.composite();
  const scale = Math.min(4, 128 / Math.max(doc.w, doc.h));
  const entry = { id: doc.id, name: doc.name, mode: doc.mode, w: doc.w, h: doc.h, frames: doc.frames.length, updated: Date.now(), thumb: pxToDataURL(comp, doc.w, doc.h, Math.max(1, Math.floor(scale))) };
  try {
    localStorage.setItem(DOC(doc.id), JSON.stringify(data));
    const idx = listDocs().filter((e) => e.id !== doc.id);
    idx.unshift(entry);
    localStorage.setItem(IDX, JSON.stringify(idx));
    localStorage.setItem("pixels:last", doc.id);
    return true;
  } catch (e) {
    console.warn("save failed", e);
    return false;
  }
}

export async function openDoc(id) {
  const raw = localStorage.getItem(DOC(id));
  if (!raw) throw new Error("That drawing is gone.");
  const doc = await deserialize(JSON.parse(raw));
  localStorage.setItem("pixels:last", id);
  return doc;
}

export function deleteDoc(id) {
  localStorage.removeItem(DOC(id));
  localStorage.setItem(IDX, JSON.stringify(listDocs().filter((e) => e.id !== id)));
  if (localStorage.getItem("pixels:last") === id) localStorage.removeItem("pixels:last");
}

export function lastDocId() { return localStorage.getItem("pixels:last"); }

export function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS) || "{}"); } catch { return {}; } }
export function savePrefs(p) { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch {} }

function anchorDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

// iPads and phones: a plain download link is unreliable (Safari asks first, then hides the file in
// Files > Downloads; Chrome on iPad often does nothing). Where the share sheet can take files, use it instead:
// Save Image, Save to Files, AirDrop. The share has to start inside the tap that asked for it, so the file is
// built right away (no fetch), and files asked for in the same moment share together.
const TOUCH = typeof matchMedia === "function" && (matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)));
const TYPES = { png: "image/png", gif: "image/gif", json: "application/json", txt: "text/plain", gpl: "text/plain", hex: "text/plain", aseprite: "application/octet-stream" };
const blobs = new Map(); // object URL -> Blob, so a download can be turned into a File without fetching
if (TOUCH && typeof URL !== "undefined" && URL.createObjectURL) {
  const make = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (o) => { const u = make(o); if (o instanceof Blob) blobs.set(u, o); return u; };
  URL.revokeObjectURL = (u) => { setTimeout(() => blobs.delete(u), 60000); revoke(u); };
}
function dataURLToBlob(href) {
  const i = href.indexOf(","), meta = href.slice(5, i), body = href.slice(i + 1);
  const type = meta.split(";")[0] || "application/octet-stream";
  if (!/;base64/.test(meta)) return new Blob([decodeURIComponent(body)], { type });
  const bin = atob(body), out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return new Blob([out], { type });
}
let pending = null, fallback = null;
// fn(files): shown when the share sheet isn't available or refuses (the app shows the image to press-and-hold)
export function setDownloadFallback(fn) { fallback = fn; }
export function download(href, filename) {
  if (!TOUCH) return anchorDownload(href, filename);
  const blob = href.startsWith("data:") ? dataURLToBlob(href) : blobs.get(href);
  if (!blob) return anchorDownload(href, filename);
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const file = new File([blob], filename, { type: TYPES[ext] || blob.type || "application/octet-stream" });
  if (!pending) { pending = []; queueMicrotask(flushShare); } // a microtask still counts as part of the tap
  pending.push(file);
}
function flushShare() {
  const files = pending; pending = null;
  const give = () => { if (fallback) fallback(files); else files.forEach((f) => { const u = URL.createObjectURL(f); anchorDownload(u, f.name); }); };
  let ok = false;
  try { ok = !!(navigator.share && navigator.canShare && navigator.canShare({ files })); } catch {}
  if (!ok) return give();
  navigator.share({ files }).catch((e) => { if (!e || e.name !== "AbortError") give(); });
}

export function safeName(s, fallback = "pixels") {
  return (String(s || "").trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").slice(0, 60) || fallback).toLowerCase();
}
