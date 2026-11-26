// Drawing document: layers of RGBA pixels, undo/redo, and pixel operations.

let nextId = 1;
const uid = () => `l${Date.now().toString(36)}${(nextId++).toString(36)}`;

export function newLayer(w, h, name = "Layer") {
  return { id: uid(), name, visible: true, opacity: 1, blend: "normal", group: null, px: new Uint8ClampedArray(w * h * 4) };
}

export class Doc {
  constructor({ w = 32, h = 32, mode = "art", model = "classic", name = "Untitled", layers = null, id = null, frames = null } = {}) {
    this.w = w; this.h = h; this.mode = mode; this.model = model; this.name = name;
    this.id = id || `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.layers = layers || [newLayer(w, h, mode === "skin" ? "Skin" : "Background")];
    this.active = this.layers.length - 1;
    // Animation frames. For the frame being edited, layer.px is the truth; other
    // frames keep their pixels in frames[i].px[layerId] (missing = blank).
    this.frames = frames || [{ duration: 100, px: {} }];
    // Aseprite-style extras
    this.tags = [];      // [{name, from, to, dir: "forward"|"reverse"|"pingpong", color}]
    this.groups = [];    // [{id, name, visible, opacity, collapsed}]; layer.group points at one
    this.slices = [];    // [{name, x, y, w, h, center: {x, y, w, h} | null}]
    this.palette = null; // indexed colour mode: the drawing's own palette (hex list); null = RGB
    this.guides = null;  // template guide lines: {ground, center, cols, rows}
    this.frame = 0;
    if (frames) this.loadFrame(0); else this.syncFrame();
    this.undoStack = []; this.redoStack = [];
    this.listeners = new Set();
    this.dirty = false;
    this._comp = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind = "pixels") { this.propagateLinks(); this._comp = null; this.dirty = true; for (const fn of this.listeners) fn(kind); }
  // linked cels share one image: keep every frame in a link group pointing at the current pixels
  propagateLinks() {
    const cur = this.frames[this.frame];
    if (!cur || !cur.links) return;
    for (const l of this.layers) {
      const g = cur.links[l.id];
      if (!g) continue;
      for (const f of this.frames) if (f !== cur && f.links && f.links[l.id] === g) f.px[l.id] = l.px;
    }
  }

  get layer() { return this.layers[this.active]; }

  // ---- history --------------------------------------------------------
  snapshot() {
    this.syncFrame();
    return {
      layers: this.layers.map((l) => ({ ...l })), active: this.active, model: this.model, w: this.w, h: this.h,
      frames: this.frames.map((f) => ({ duration: f.duration, px: { ...f.px }, links: f.links ? { ...f.links } : undefined })), frame: this.frame,
      tags: this.tags.map((t) => ({ ...t })), groups: this.groups.map((g) => ({ ...g })),
      slices: this.slices.map((t) => ({ ...t, center: t.center ? { ...t.center } : null })),
      palette: this.palette ? this.palette.slice() : null, guides: this.guides,
    };
  }
  restore(s) {
    this.layers = s.layers.map((l) => ({ ...l }));
    this.active = Math.min(s.active, this.layers.length - 1);
    this.model = s.model; this.w = s.w; this.h = s.h;
    this.frames = s.frames.map((f) => ({ duration: f.duration, px: { ...f.px }, links: f.links ? { ...f.links } : undefined }));
    this.frame = Math.min(s.frame, this.frames.length - 1);
    this.tags = s.tags.map((t) => ({ ...t })); this.groups = s.groups.map((g) => ({ ...g }));
    this.slices = s.slices.map((t) => ({ ...t, center: t.center ? { ...t.center } : null }));
    this.palette = s.palette ? s.palette.slice() : null; this.guides = s.guides;
  }

  // ---- frames ---------------------------------------------------------
  syncFrame() {
    const px = {};
    for (const l of this.layers) px[l.id] = l.px;
    this.frames[this.frame].px = px;
    this.propagateLinks();
  }
  loadFrame(i) {
    this.frame = i;
    const f = this.frames[i];
    this.layers = this.layers.map((l) => ({ ...l, px: l.tilemap ? l.px : f.px[l.id] || new Uint8ClampedArray(this.w * this.h * 4) }));
    this.syncFrame();
  }
  cel(i, l) { return i === this.frame || l.tilemap ? l.px : this.frames[i].px[l.id] || null; }
  // what a layer contributes: hidden layers and layers in hidden groups give nothing
  layerAlpha(l) {
    if (!l.visible) return 0;
    let a = l.opacity;
    if (l.group) { const g = this.groups.find((x) => x.id === l.group); if (g) { if (!g.visible) return 0; a *= g.opacity; } }
    return a;
  }
  setFrame(i) {
    if (i < 0 || i >= this.frames.length || i === this.frame) return;
    this.syncFrame(); this.loadFrame(i); this.emit("frame");
  }
  addFrame(duplicate = false) {
    this.beginStructure();
    const cur = this.frames[this.frame];
    const px = {};
    if (duplicate) for (const l of this.layers) px[l.id] = l.px.slice();
    this.frames.splice(this.frame + 1, 0, { duration: cur.duration, px });
    for (const t of this.tags) { if (t.from > this.frame) t.from++; if (t.to >= this.frame) t.to++; }
    this.loadFrame(this.frame + 1);
    this.emit("structure");
  }
  deleteFrame() {
    if (this.frames.length <= 1) return;
    this.beginStructure();
    this.frames.splice(this.frame, 1);
    const i = this.frame;
    this.tags = this.tags.filter((t) => !(t.from === i && t.to === i)).map((t) => ({ ...t, from: t.from > i ? t.from - 1 : t.from, to: t.to >= i ? t.to - 1 : t.to }));
    this.loadFrame(Math.min(this.frame, this.frames.length - 1));
    this.emit("structure");
  }
  moveFrame(dir) {
    const j = this.frame + dir;
    if (j < 0 || j >= this.frames.length) return;
    this.beginStructure();
    [this.frames[this.frame], this.frames[j]] = [this.frames[j], this.frames[this.frame]];
    this.frame = j;
    this.emit("structure");
  }
  setDuration(ms, all = false) {
    this.beginStructure();
    ms = Math.max(20, Math.min(10000, Math.round(ms)));
    if (all) this.frames.forEach((f) => { f.duration = ms; }); else this.frames[this.frame].duration = ms;
    this.emit("structure");
  }
  compositeFrame(i) {
    if (i === this.frame) return this.composite();
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (const l of this.layers) {
      const a = this.layerAlpha(l);
      if (a <= 0) continue;
      const px = this.cel(i, l);
      if (px) blendOver(out, px, a, l.blend);
    }
    return out;
  }
  // Replace every pixel through fn(r,g,b,a) -> [r,g,b,a], in every frame.
  // layerId limits it to one layer. One undo step.
  recolor(fn, layerId = null) {
    this.beginStructure();
    const cache = new Map();
    const map = (src) => {
      const out = new Uint8ClampedArray(src.length);
      for (let k = 0; k < src.length; k += 4) {
        const a = src[k + 3];
        if (a === 0) continue;
        const key = ((src[k] << 24) | (src[k + 1] << 16) | (src[k + 2] << 8) | a) >>> 0;
        let c = cache.get(key);
        if (!c) { c = fn(src[k], src[k + 1], src[k + 2], a); cache.set(key, c); }
        out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2]; out[k + 3] = c[3];
      }
      return out;
    };
    this.frames.forEach((f) => {
      for (const l of this.layers) {
        if (layerId && l.id !== layerId) continue;
        if (f.px[l.id]) f.px[l.id] = map(f.px[l.id]);
      }
    });
    this.loadFrame(this.frame);
    this.emit("structure");
  }
  // Call before changing pixels of the active layer. The old pixel array stays in
  // history; the layer gets a fresh copy to draw on.
  begin() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > (this.w * this.h > 65536 ? 40 : 80)) this.undoStack.shift(); // big canvases keep fewer steps to save memory
    this.redoStack.length = 0;
    const l = this.layer;
    this.layers[this.active] = { ...l, px: l.px.slice() };
  }
  // Call before changing the layer list or layer properties.
  beginStructure() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > (this.w * this.h > 65536 ? 40 : 80)) this.undoStack.shift(); // big canvases keep fewer steps to save memory
    this.redoStack.length = 0;
  }
  // Drop the last history entry if the operation changed nothing.
  cancelIfUnchanged() {
    const s = this.undoStack[this.undoStack.length - 1];
    if (!s) return;
    const before = s.layers[s.active], now = this.layer;
    if (before && before.id === now.id && equalPx(before.px, now.px)) {
      this.undoStack.pop();
      this.layers[this.active] = before;
    }
  }
  undo() {
    const s = this.undoStack.pop(); if (!s) return false;
    this.redoStack.push(this.snapshot()); this.restore(s); this.emit("structure"); return true;
  }
  redo() {
    const s = this.redoStack.pop(); if (!s) return false;
    this.undoStack.push(this.snapshot()); this.restore(s); this.emit("structure"); return true;
  }

  // ---- compositing ----------------------------------------------------
  composite() {
    if (this._comp) return this._comp;
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (const l of this.layers) {
      const a = this.layerAlpha(l);
      if (a <= 0) continue;
      blendOver(out, l.px, a, l.blend);
    }
    this._comp = out;
    return out;
  }

  // ---- pixel ops on the active layer ---------------------------------
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(px, x, y) { const k = (y * this.w + x) * 4; return [px[k], px[k + 1], px[k + 2], px[k + 3]]; }
  set(x, y, c) {
    if (!this.inBounds(x, y)) return;
    const px = this.layer.px, k = (y * this.w + x) * 4;
    px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = c[3];
  }

  // Paint one pixel the way a brush does: respects the layer's "lock transparency"
  // (only already-drawn pixels change, and they keep their alpha).
  paint(x, y, c) {
    if (!this.inBounds(x, y)) return;
    const l = this.layer;
    if (l.alphaLock) {
      const k = (y * this.w + x) * 4, a = l.px[k + 3];
      if (a === 0 || c[3] === 0) return;
      l.px[k] = c[0]; l.px[k + 1] = c[1]; l.px[k + 2] = c[2];
      return;
    }
    this.set(x, y, c);
  }

  // flood fill from (x,y). bounds = [x,y,w,h] limits the fill (used for skin faces).
  // opts.mask(x,y) -> false leaves that pixel alone (dither patterns); opts.wrap fills across edges (tile mode).
  fill(x, y, c, bounds = null, global = false, opts = {}) {
    if (!this.inBounds(x, y)) return;
    const px = this.layer.px, w = this.w, h = this.h;
    const [bx, by, bw, bh] = bounds || [0, 0, this.w, this.h];
    const mask = opts.mask || null, wrap = !!opts.wrap && !bounds;
    const target = this.get(px, x, y);
    if (sameColor(target, c)) return;
    const hits = [];
    if (global) {
      for (let j = by; j < by + bh; j++) for (let i = bx; i < bx + bw; i++) {
        if (sameColor(this.get(px, i, j), target)) hits.push(i, j);
      }
    } else {
      const stack = [x, y];
      const seen = new Uint8Array(w * h);
      while (stack.length) {
        let cy = stack.pop(), cx = stack.pop();
        if (wrap) { cx = (cx + w) % w; cy = (cy + h) % h; }
        if (cx < bx || cy < by || cx >= bx + bw || cy >= by + bh) continue;
        const i = cy * w + cx;
        if (seen[i]) continue; seen[i] = 1;
        if (!sameColor(this.get(px, cx, cy), target)) continue;
        hits.push(cx, cy);
        stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
      }
    }
    // paint after the search, so a dither pattern doesn't change what counts as "the same colour"
    for (let k = 0; k < hits.length; k += 2) if (!mask || mask(hits[k], hits[k + 1])) this.paint(hits[k], hits[k + 1], c);
  }

  // ---- whole-document ops --------------------------------------------
  resize(nw, nh, anchor = "tl") {
    this.beginStructure();
    const ox = anchor.includes("r") ? nw - this.w : anchor.includes("c") ? Math.floor((nw - this.w) / 2) : 0;
    const oy = anchor.includes("b") ? nh - this.h : anchor.includes("m") ? Math.floor((nh - this.h) / 2) : 0;
    const move = (src) => {
      const px = new Uint8ClampedArray(nw * nh * 4);
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const tx = x + ox, ty = y + oy;
        if (tx < 0 || ty < 0 || tx >= nw || ty >= nh) continue;
        const s = (y * this.w + x) * 4, t = (ty * nw + tx) * 4;
        px[t] = src[s]; px[t + 1] = src[s + 1]; px[t + 2] = src[s + 2]; px[t + 3] = src[s + 3];
      }
      return px;
    };
    this.frames.forEach((f) => { const n = {}; for (const id in f.px) n[id] = move(f.px[id]); f.px = n; });
    this.w = nw; this.h = nh;
    this.loadFrame(this.frame);
    this.emit("structure");
  }

  flipLayer(axis) {
    this.begin();
    const src = this.undoStack[this.undoStack.length - 1].layers[this.active].px, px = this.layer.px;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const sx = axis === "h" ? this.w - 1 - x : x, sy = axis === "v" ? this.h - 1 - y : y;
      const s = (sy * this.w + sx) * 4, t = (y * this.w + x) * 4;
      px[t] = src[s]; px[t + 1] = src[s + 1]; px[t + 2] = src[s + 2]; px[t + 3] = src[s + 3];
    }
    this.emit();
  }

  addLayer(name) {
    this.beginStructure();
    const l = newLayer(this.w, this.h, name || `Layer ${this.layers.length + 1}`);
    this.layers.splice(this.active + 1, 0, l);
    this.active++;
    this.emit("structure");
  }
  duplicateLayer() {
    this.beginStructure();
    const l = this.layer, id = uid();
    this.frames.forEach((f, i) => { if (i !== this.frame && f.px[l.id]) f.px[id] = f.px[l.id].slice(); });
    this.layers.splice(this.active + 1, 0, { ...l, id, name: `${l.name} copy`, px: l.px.slice() });
    this.active++;
    this.emit("structure");
  }
  deleteLayer() {
    if (this.layers.length <= 1) return;
    this.beginStructure();
    this.layers.splice(this.active, 1);
    this.active = Math.max(0, this.active - 1);
    this.emit("structure");
  }
  moveLayer(dir) {
    const j = this.active + dir;
    if (j < 0 || j >= this.layers.length) return;
    this.beginStructure();
    [this.layers[this.active], this.layers[j]] = [this.layers[j], this.layers[this.active]];
    this.active = j;
    this.emit("structure");
  }
  mergeDown() {
    if (this.active === 0) return;
    this.beginStructure();
    const top = this.layer, below = this.layers[this.active - 1];
    this.frames.forEach((f, i) => {
      if (i === this.frame || !top.visible || !f.px[top.id]) return;
      const m = f.px[below.id] ? f.px[below.id].slice() : new Uint8ClampedArray(this.w * this.h * 4);
      blendOver(m, f.px[top.id], top.opacity, top.blend);
      f.px[below.id] = m;
    });
    const px = below.px.slice();
    if (top.visible) blendOver(px, top.px, top.opacity, top.blend);
    this.layers[this.active - 1] = { ...below, px };
    this.layers.splice(this.active, 1);
    this.active--;
    this.emit("structure");
  }
  // ---- linked cels ----
  linkWithPrevious() {
    if (this.frame === 0) return false;
    this.beginStructure();
    const l = this.layer, prev = this.frames[this.frame - 1], cur = this.frames[this.frame];
    prev.links = prev.links || {}; cur.links = cur.links || {};
    const g = prev.links[l.id] || uid();
    prev.links[l.id] = g;
    // everything already linked to this frame's cel joins the group too
    const old = cur.links[l.id];
    for (const f of this.frames) if (old && f.links && f.links[l.id] === old) f.links[l.id] = g;
    cur.links[l.id] = g;
    const px = prev.px[l.id] || new Uint8ClampedArray(this.w * this.h * 4);
    this.layers[this.active] = { ...l, px };
    this.emit("structure");
    return true;
  }
  unlinkCel() {
    const cur = this.frames[this.frame], l = this.layer;
    if (!cur.links || !cur.links[l.id]) return false;
    this.beginStructure();
    delete cur.links[l.id];
    this.layers[this.active] = { ...l, px: l.px.slice() };
    this.syncFrame();
    this.emit("structure");
    return true;
  }
  isLinked(i = this.frame, l = this.layer) { const f = this.frames[i]; return !!(f && f.links && f.links[l.id]); }

  setLayerProp(i, prop, value, record = true) {
    if (record) this.beginStructure();
    this.layers[i] = { ...this.layers[i], [prop]: value };
    this.emit("structure");
  }
}

// Layer blend modes (the separable ones Aseprite and Photoshop share). Values are 0..1.
export const BLEND_MODES = {
  normal: (b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  "color-dodge": (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  "color-burn": (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  "hard-light": (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  "soft-light": (b, s) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b)),
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  addition: (b, s) => Math.min(1, b + s),
  subtract: (b, s) => Math.max(0, b - s),
};
export function blendOver(dst, src, opacity = 1, mode = "normal") {
  const fn = mode && mode !== "normal" ? BLEND_MODES[mode] : null;
  for (let k = 0; k < src.length; k += 4) {
    const sa = (src[k + 3] / 255) * opacity;
    if (sa <= 0) continue;
    const da = dst[k + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (!fn || da === 0) {
      dst[k] = (src[k] * sa + dst[k] * da * (1 - sa)) / oa;
      dst[k + 1] = (src[k + 1] * sa + dst[k + 1] * da * (1 - sa)) / oa;
      dst[k + 2] = (src[k + 2] * sa + dst[k + 2] * da * (1 - sa)) / oa;
    } else {
      // W3C compositing: the blended colour shows where both are opaque
      for (let c = 0; c < 3; c++) {
        const cb = dst[k + c] / 255, cs = src[k + c] / 255;
        const mix = (1 - da) * cs + da * fn(cb, cs);
        dst[k + c] = ((mix * sa + cb * da * (1 - sa)) / oa) * 255;
      }
    }
    dst[k + 3] = oa * 255;
  }
}

export function sameColor(a, b) {
  if (a[3] === 0 && b[3] === 0) return true;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function equalPx(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Bresenham line, calls fn(x, y) for every pixel.
export function line(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function rectPoints(x0, y0, x1, y1, filled, fn) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    if (filled || x === ax || x === bx || y === ay || y === by) fn(x, y);
  }
}

// Ellipse inside the box (x0,y0)-(x1,y1), pixel-clean for small sizes.
export function ellipsePoints(x0, y0, x1, y1, filled, fn) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
    if (!inside(x, y)) continue;
    if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) fn(x, y);
  }
}

// ---- colour helpers -------------------------------------------------
export function hexToRgba(hex, a = 255) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) : a;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}
export function rgbaToHex([r, g, b, a = 255], withAlpha = false) {
  const s = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  return withAlpha && a < 255 ? s + a.toString(16).padStart(2, "0") : s;
}
export function shadeColor([r, g, b, a], amount) {
  // move toward white (amount>0) or black (amount<0), with a slight hue shift
  // toward warm highlights and cool shadows, which reads better in pixel art.
  if (a === 0) return [r, g, b, a];
  const t = Math.abs(amount);
  if (amount > 0) return [r + (255 - r) * t * 1.0, g + (245 - g) * t * 0.95, b + (220 - b) * t * 0.85, a].map(Math.round);
  return [r * (1 - t) + 20 * t, g * (1 - t) + 16 * t, b * (1 - t) + 48 * t, a].map(Math.round);
}
