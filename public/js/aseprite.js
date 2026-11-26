// Read and write .aseprite / .ase files (Aseprite's own format, documented in its repo
// under docs/ase-file-specs.md). Reads RGBA, grayscale and indexed sprites with layers,
// groups, blend modes, linked cels, tags, slices, palettes and tilemaps (tilemaps come in
// as tilemap layers). Writes RGBA with the same things, tilemap layers as plain pixels.

export const ASE_BLENDS = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity", "addition", "subtract", "divide"];

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// ---------------------------------------------------------------- read
export async function readAse(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  if (dv.getUint16(4, true) !== 0xa5e0) throw new Error("That isn't an Aseprite file.");
  const nFrames = dv.getUint16(6, true), W = dv.getUint16(8, true), H = dv.getUint16(10, true), depth = dv.getUint16(12, true);
  const flags = dv.getUint32(14, true), transIdx = dv.getUint8(28);
  if (W > 512 || H > 512) throw new Error(`That sprite is ${W}×${H}; the most this app opens is 512×512.`);
  if (nFrames > 500) throw new Error("That file has more than 500 frames.");
  const bpp = depth === 32 ? 4 : depth === 16 ? 2 : 1;
  const palette = [];
  const layers = [], tags = [], slices = [], tilesets = {};
  const frames = [];
  let p = 128;
  const str = (o) => { const n = dv.getUint16(o, true); return [dec.decode(u8.subarray(o + 2, o + 2 + n)), o + 2 + n]; };
  const toRGBA = (raw, n) => {
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      if (bpp === 4) { out[i * 4] = raw[i * 4]; out[i * 4 + 1] = raw[i * 4 + 1]; out[i * 4 + 2] = raw[i * 4 + 2]; out[i * 4 + 3] = raw[i * 4 + 3]; }
      else if (bpp === 2) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = raw[i * 2]; out[i * 4 + 3] = raw[i * 2 + 1]; }
      else {
        const idx = raw[i];
        if (idx === transIdx) continue;
        const c = palette[idx] || [0, 0, 0, 255];
        out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = c[3];
      }
    }
    return out;
  };
  const pending = []; // cels to decode after palettes are known
  let groupStack = [];
  for (let f = 0; f < nFrames; f++) {
    const fsize = dv.getUint32(p, true);
    if (dv.getUint16(p + 4, true) !== 0xf1fa) throw new Error("This Aseprite file looks damaged.");
    let nChunks = dv.getUint16(p + 6, true);
    const dur = dv.getUint16(p + 8, true), newChunks = dv.getUint32(p + 12, true);
    if (newChunks) nChunks = newChunks;
    frames.push({ duration: dur || 100, cels: [] });
    let c = p + 16;
    let lastSlice = null;
    for (let k = 0; k < nChunks; k++) {
      const csize = dv.getUint32(c, true), type = dv.getUint16(c + 4, true), d = c + 6;
      if (type === 0x2004) {
        const lflags = dv.getUint16(d, true), ltype = dv.getUint16(d + 2, true), level = dv.getUint16(d + 4, true);
        const blend = dv.getUint16(d + 10, true), opacity = flags & (ltype === 1 ? 2 : 1) ? dv.getUint8(d + 12) / 255 : 1;
        const [name, after] = str(d + 16);
        const tileset = ltype === 2 ? dv.getUint32(after, true) : -1;
        groupStack = groupStack.slice(0, level);
        const L = { name, type: ltype, level, visible: !!(lflags & 1), opacity, blend: ASE_BLENDS[blend] || "normal", tileset, collapsed: !!(lflags & 32), parents: groupStack.slice() };
        layers.push(L);
        if (ltype === 1) groupStack[level] = layers.length - 1;
      } else if (type === 0x2005) {
        const li = dv.getUint16(d, true), x = dv.getInt16(d + 2, true), y = dv.getInt16(d + 4, true), op = dv.getUint8(d + 6), ct = dv.getUint16(d + 7, true);
        const body = d + 16, end = c + csize;
        if (ct === 0) { const w = dv.getUint16(body, true), h = dv.getUint16(body + 2, true); pending.push({ f, li, x, y, op, w, h, raw: u8.slice(body + 4, body + 4 + w * h * bpp) }); }
        else if (ct === 1) frames[f].cels.push({ li, link: dv.getUint16(body, true) });
        else if (ct === 2) { const w = dv.getUint16(body, true), h = dv.getUint16(body + 2, true); pending.push({ f, li, x, y, op, w, h, z: u8.slice(body + 4, end) }); }
        else if (ct === 3) {
          const w = dv.getUint16(body, true), h = dv.getUint16(body + 2, true), bits = dv.getUint16(body + 4, true), mask = dv.getUint32(body + 6, true);
          pending.push({ f, li, x, y, op, w, h, tiles: true, bits, mask, z: u8.slice(body + 32, end) });
        }
      } else if (type === 0x2019) {
        const first = dv.getUint32(d + 4, true), last = dv.getUint32(d + 8, true);
        let o = d + 20;
        for (let i = first; i <= last; i++) {
          const ef = dv.getUint16(o, true);
          palette[i] = [u8[o + 2], u8[o + 3], u8[o + 4], u8[o + 5]];
          o += 6;
          if (ef & 1) o = str(o)[1];
        }
      } else if ((type === 0x0004 || type === 0x0011) && !palette.length) {
        const packets = dv.getUint16(d, true); let o = d + 2, idx = 0;
        for (let i = 0; i < packets; i++) {
          idx += u8[o]; let n = u8[o + 1] || 256; o += 2;
          for (let j = 0; j < n; j++, idx++, o += 3) { const m = type === 0x0011 ? 4 : 1; palette[idx] = [u8[o] * m, u8[o + 1] * m, u8[o + 2] * m, 255]; }
        }
      } else if (type === 0x2018) {
        const n = dv.getUint16(d, true); let o = d + 10;
        for (let i = 0; i < n; i++) {
          const from = dv.getUint16(o, true), to = dv.getUint16(o + 2, true), dir = u8[o + 4];
          const color = "#" + [u8[o + 13], u8[o + 14], u8[o + 15]].map((v) => v.toString(16).padStart(2, "0")).join("");
          const [name, after] = str(o + 17);
          tags.push({ name, from, to, dir: dir === 1 ? "reverse" : dir >= 2 ? "pingpong" : "forward", color });
          o = after;
        }
      } else if (type === 0x2022) {
        const keys = dv.getUint32(d, true), sflags = dv.getUint32(d + 4, true);
        let [name, o] = str(d + 12);
        for (let i = 0; i < keys; i++) {
          const s = { name, x: dv.getInt32(o + 4, true), y: dv.getInt32(o + 8, true), w: dv.getUint32(o + 12, true), h: dv.getUint32(o + 16, true), center: null };
          o += 20;
          if (sflags & 1) { s.center = { x: dv.getInt32(o, true), y: dv.getInt32(o + 4, true), w: dv.getUint32(o + 8, true), h: dv.getUint32(o + 12, true) }; o += 16; }
          if (sflags & 2) o += 8;
          if (i === 0) { slices.push(s); lastSlice = s; }
        }
      } else if (type === 0x2023) {
        const id = dv.getUint32(d, true), tflags = dv.getUint32(d + 4, true), n = dv.getUint32(d + 8, true);
        const tw = dv.getUint16(d + 12, true), th = dv.getUint16(d + 14, true);
        let o = str(d + 32)[1];
        if (tflags & 1) o += 8;
        if (tflags & 2) { const len = dv.getUint32(o, true); tilesets[id] = { tw, th, n, z: u8.slice(o + 4, o + 4 + len) }; }
      }
      c += csize;
    }
    p += fsize;
  }
  // decode tilesets
  for (const ts of Object.values(tilesets)) {
    const raw = await inflate(ts.z), px = toRGBA(raw, ts.tw * ts.th * ts.n);
    ts.tiles = Array.from({ length: ts.n }, (_, i) => px.slice(i * ts.tw * ts.th * 4, (i + 1) * ts.tw * ts.th * 4));
  }
  // decode cels into full-canvas images
  for (const cel of pending) {
    const L = layers[cel.li];
    if (!L) continue;
    let img, w = cel.w, h = cel.h;
    if (cel.tiles) {
      const ts = tilesets[L.tileset];
      const raw = await inflate(cel.z), ids = new DataView(raw.buffer);
      if (!ts) continue;
      w = cel.w * ts.tw; h = cel.h * ts.th; img = new Uint8ClampedArray(w * h * 4);
      const map = new Int32Array(cel.w * cel.h);
      for (let i = 0; i < cel.w * cel.h; i++) {
        const v = cel.bits === 32 ? ids.getUint32(i * 4, true) : cel.bits === 16 ? ids.getUint16(i * 2, true) : raw[i];
        const t = ts.tiles[v & (cel.mask || 0x1fffffff)];
        map[i] = v & (cel.mask || 0x1fffffff);
        if (!t) continue;
        const cx = (i % cel.w) * ts.tw, cy = Math.floor(i / cel.w) * ts.th;
        for (let j = 0; j < ts.th; j++) img.set(t.subarray(j * ts.tw * 4, (j + 1) * ts.tw * 4), ((cy + j) * w + cx) * 4);
      }
      L.tileInfo = { tw: ts.tw, th: ts.th, ox: cel.x, oy: cel.y };
    } else {
      img = toRGBA(cel.raw || (await inflate(cel.z)), w * h);
    }
    const full = new Uint8ClampedArray(W * H * 4);
    for (let j = 0; j < h; j++) {
      const ty = cel.y + j; if (ty < 0 || ty >= H) continue;
      for (let i = 0; i < w; i++) {
        const tx = cel.x + i; if (tx < 0 || tx >= W) continue;
        const s = (j * w + i) * 4, t = (ty * W + tx) * 4;
        full[t] = img[s]; full[t + 1] = img[s + 1]; full[t + 2] = img[s + 2]; full[t + 3] = cel.op === 255 ? img[s + 3] : Math.round(img[s + 3] * cel.op / 255);
      }
    }
    frames[cel.f].cels.push({ li: cel.li, px: full });
  }
  const usedPalette = depth === 8 ? palette.filter(Boolean).map((c) => "#" + c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")) : null;
  return { w: W, h: H, frames, layers, tags, slices, palette: usedPalette };
}

// ---------------------------------------------------------------- write
class Out {
  constructor() { this.buf = new Uint8Array(1 << 16); this.n = 0; }
  need(k) { if (this.n + k > this.buf.length) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k)); b.set(this.buf); this.buf = b; } }
  u8(v) { this.need(1); this.buf[this.n++] = v & 255; }
  u16(v) { this.u8(v); this.u8(v >> 8); }
  i16(v) { this.u16(v & 0xffff); }
  u32(v) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  bytes(b) { this.need(b.length); this.buf.set(b, this.n); this.n += b.length; }
  zeros(k) { this.need(k); this.n += k; }
  str(s) { const b = new TextEncoder().encode(s); this.u16(b.length); this.bytes(b); }
  setU32(at, v) { this.buf[at] = v & 255; this.buf[at + 1] = (v >> 8) & 255; this.buf[at + 2] = (v >> 16) & 255; this.buf[at + 3] = (v >>> 24) & 255; }
  done() { return this.buf.slice(0, this.n); }
}
const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function bbox(px, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export async function writeAse(doc) {
  doc.syncFrame();
  const W = doc.w, H = doc.h;
  // layer order: bottom to top, a group's chunk right before its members
  const order = []; // {kind:"group", g} | {kind:"layer", l}
  const placed = new Set();
  for (const l of doc.layers) {
    if (l.group && !placed.has(l.group)) {
      const g = doc.groups.find((x) => x.id === l.group);
      if (g) { placed.add(g.id); order.push({ kind: "group", g }); for (const m of doc.layers) if (m.group === g.id) order.push({ kind: "layer", l: m, level: 1 }); continue; }
    }
    if (!l.group || !doc.groups.find((x) => x.id === l.group)) order.push({ kind: "layer", l, level: 0 });
  }
  const layerIndex = new Map(); order.forEach((o, i) => { if (o.kind === "layer") layerIndex.set(o.l.id, i); });

  const out = new Out();
  out.zeros(128); // header filled in at the end
  // palette: the drawing's own (indexed mode) or the colours it uses
  let pal = doc.palette;
  if (!pal) {
    const seen = new Set();
    for (let i = 0; i < doc.frames.length && seen.size < 256; i++) {
      const c = doc.compositeFrame(i);
      for (let k = 0; k < c.length && seen.size < 256; k += 4) if (c[k + 3]) seen.add("#" + [c[k], c[k + 1], c[k + 2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
    }
    pal = [...seen];
  }
  if (!pal.length) pal = ["#000000"];

  for (let f = 0; f < doc.frames.length; f++) {
    const start = out.n;
    out.u32(0); out.u16(0xf1fa); out.u16(0); out.u16(doc.frames[f].duration); out.zeros(2); out.u32(0);
    let chunks = 0;
    const chunk = async (type, body) => { const s = out.n; out.u32(0); out.u16(type); await body(); out.setU32(s, out.n - s); chunks++; };
    if (f === 0) {
      await chunk(0x2007, () => { out.u16(1); out.u16(0); out.u32(0); out.zeros(8); }); // sRGB
      await chunk(0x2019, () => {
        out.u32(pal.length); out.u32(0); out.u32(pal.length - 1); out.zeros(8);
        for (const h of pal) { out.u16(0); const [r, g, b] = hexRGB(h); out.u8(r); out.u8(g); out.u8(b); out.u8(255); }
      });
      for (const o of order) {
        await chunk(0x2004, () => {
          if (o.kind === "group") {
            out.u16((o.g.visible ? 1 : 0) | 2 | (o.g.collapsed ? 32 : 0)); out.u16(1); out.u16(0); out.u16(0); out.u16(0); out.u16(0);
            out.u8(Math.round((o.g.opacity ?? 1) * 255)); out.zeros(3); out.str(o.g.name);
          } else {
            const l = o.l, bi = Math.max(0, ASE_BLENDS.indexOf(l.blend || "normal"));
            out.u16((l.visible ? 1 : 0) | 2); out.u16(0); out.u16(o.level); out.u16(0); out.u16(0); out.u16(bi);
            out.u8(Math.round(l.opacity * 255)); out.zeros(3); out.str(l.name);
          }
        });
      }
      if (doc.tags.length) await chunk(0x2018, () => {
        out.u16(doc.tags.length); out.zeros(8);
        for (const t of doc.tags) {
          out.u16(t.from); out.u16(t.to); out.u8(t.dir === "reverse" ? 1 : t.dir === "pingpong" ? 2 : 0); out.u16(0); out.zeros(6);
          const [r, g, b] = hexRGB(t.color || "#7b6aa0"); out.u8(r); out.u8(g); out.u8(b); out.u8(0); out.str(t.name);
        }
      });
      for (const s of doc.slices) await chunk(0x2022, () => {
        out.u32(1); out.u32(s.center ? 1 : 0); out.u32(0); out.str(s.name);
        out.u32(0); out.u32(s.x); out.u32(s.y); out.u32(s.w); out.u32(s.h);
        if (s.center) { out.u32(s.center.x); out.u32(s.center.y); out.u32(s.center.w); out.u32(s.center.h); }
      });
    }
    for (const o of order) {
      if (o.kind !== "layer") continue;
      const l = o.l, li = layerIndex.get(l.id);
      const fr = doc.frames[f], g = fr.links && fr.links[l.id];
      const first = g ? doc.frames.findIndex((x) => x.links && x.links[l.id] === g) : f;
      if (first < f) { await chunk(0x2005, () => { out.u16(li); out.i16(0); out.i16(0); out.u8(255); out.u16(1); out.i16(0); out.zeros(5); out.u16(first); }); continue; }
      const px = l.tilemap ? l.px : fr.px[l.id];
      if (!px) continue;
      const bb = bbox(px, W, H);
      if (!bb) continue;
      const raw = new Uint8Array(bb.w * bb.h * 4);
      for (let j = 0; j < bb.h; j++) raw.set(px.subarray(((bb.y + j) * W + bb.x) * 4, ((bb.y + j) * W + bb.x + bb.w) * 4), j * bb.w * 4);
      const z = await deflate(raw);
      await chunk(0x2005, () => { out.u16(li); out.i16(bb.x); out.i16(bb.y); out.u8(255); out.u16(2); out.i16(0); out.zeros(5); out.u16(bb.w); out.u16(bb.h); out.bytes(z); });
    }
    out.setU32(start, out.n - start);
    out.buf[start + 6] = Math.min(chunks, 0xffff) & 255; out.buf[start + 7] = (Math.min(chunks, 0xffff) >> 8) & 255;
    out.setU32(start + 12, chunks);
  }
  // header
  const hd = new DataView(out.buf.buffer);
  hd.setUint32(0, out.n, true); hd.setUint16(4, 0xa5e0, true); hd.setUint16(6, doc.frames.length, true);
  hd.setUint16(8, W, true); hd.setUint16(10, H, true); hd.setUint16(12, 32, true); hd.setUint32(14, 3, true);
  hd.setUint16(18, 100, true); hd.setUint8(28, 0); hd.setUint16(32, Math.min(pal.length, 256) === 256 ? 0 : pal.length, true);
  hd.setUint8(34, 1); hd.setUint8(35, 1); hd.setUint16(40, 16, true); hd.setUint16(42, 16, true);
  return out.done();
}
