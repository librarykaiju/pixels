// Minecraft skin layout (64x64, Java and Bedrock share it).
// Each part is a box: size w (x), h (y), d (z) and a texture origin (u, v).
// Faces are cut from the texture in the standard "box UV" arrangement.

export const PARTS = [
  // id, label, base origin, overlay origin, size, model position (min corner, in pixels, feet at y=0)
  { id: "head", label: "Head", base: [0, 0], over: [32, 0], size: [8, 8, 8], pos: [-4, 24, -4], inflate: 0.5 },
  { id: "body", label: "Body", base: [16, 16], over: [16, 32], size: [8, 12, 4], pos: [-4, 12, -2], inflate: 0.25 },
  { id: "rarm", label: "Right arm", base: [40, 16], over: [40, 32], size: [4, 12, 4], pos: [-8, 12, -2], inflate: 0.25, arm: "r" },
  { id: "larm", label: "Left arm", base: [32, 48], over: [48, 48], size: [4, 12, 4], pos: [4, 12, -2], inflate: 0.25, arm: "l" },
  { id: "rleg", label: "Right leg", base: [0, 16], over: [0, 32], size: [4, 12, 4], pos: [-4, 0, -2], inflate: 0.25 },
  { id: "lleg", label: "Left leg", base: [16, 48], over: [0, 48], size: [4, 12, 4], pos: [0, 0, -2], inflate: 0.25 },
];

// Part geometry for a model ("classic" 4px arms or "slim" 3px arms).
export function partsFor(model) {
  return PARTS.map((p) => {
    if (!p.arm || model !== "slim") return { ...p, size: [...p.size], pos: [...p.pos] };
    const size = [3, 12, 4];
    const pos = p.arm === "r" ? [-7, 12, -2] : [4, 12, -2];
    return { ...p, size, pos };
  });
}

// Face rectangles for a box at texture origin (u, v), size (w, h, d).
// Returns { name: [x, y, width, height] }.
export function faceRects(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h], // character's right side (-x)
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h], // character's left side (+x)
    back: [u + d + w + d, v + d, w, h],
  };
}

// Every face of every part, for one model: [{part, layer, face, rect}]
export function allFaces(model) {
  const out = [];
  for (const p of partsFor(model)) {
    const [w, h, d] = p.size;
    for (const layer of ["base", "over"]) {
      const [u, v] = p[layer];
      const rects = faceRects(u, v, w, h, d);
      for (const face of Object.keys(rects)) out.push({ part: p, layer, face, rect: rects[face] });
    }
  }
  return out;
}

// Lookup table: texel index -> face info (or null) for quick hit tests.
const faceMaps = {};
export function faceAt(model, x, y) {
  if (!faceMaps[model]) {
    const map = new Array(64 * 64).fill(null);
    for (const f of allFaces(model)) {
      const [rx, ry, rw, rh] = f.rect;
      for (let j = ry; j < ry + rh; j++) for (let i = rx; i < rx + rw; i++) map[j * 64 + i] = f;
    }
    faceMaps[model] = map;
  }
  if (x < 0 || y < 0 || x >= 64 || y >= 64) return null;
  return faceMaps[model][y * 64 + x];
}

// Mirror a texel across the part's own left/right centre (front<->front flipped,
// right side <-> left side). Returns [x, y] or null if the texel isn't on a face.
export function mirrorTexel(model, x, y) {
  const f = faceAt(model, x, y);
  if (!f) return null;
  const [w, h, d] = f.part.size;
  const [u, v] = f.part[f.layer];
  const rects = faceRects(u, v, w, h, d);
  const [rx, ry, rw] = f.rect;
  const lx = x - rx, ly = y - ry;
  if (f.face === "right" || f.face === "left") {
    const other = rects[f.face === "right" ? "left" : "right"];
    return [other[0] + (d - 1 - lx), other[1] + ly];
  }
  return [rx + (rw - 1 - lx), y];
}

// Copy one limb's texture onto the other (both layers). mirror: flipped like a reflection, so a watch on the
// outside of the right wrist lands on the outside of the left wrist; otherwise a straight copy.
// px is a 64x64 RGBA layer; changes it in place and returns how many texels changed.
export function copyLimb(model, px, fromId, toId, mirror = true) {
  const parts = partsFor(model), A = parts.find((p) => p.id === fromId), B = parts.find((p) => p.id === toId);
  if (!A || !B) return 0;
  const src = px.slice();
  let changed = 0;
  for (const layer of ["base", "over"]) {
    const [w, h, d] = B.size;
    const ra = faceRects(A[layer][0], A[layer][1], ...A.size), rb = faceRects(B[layer][0], B[layer][1], w, h, d);
    for (const face of Object.keys(rb)) {
      const from = mirror && (face === "left" || face === "right") ? (face === "left" ? "right" : "left") : face;
      const [ax, ay, aw, ah] = ra[from], [bx, by, bw, bh] = rb[face];
      for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
        const si = Math.min(aw - 1, mirror ? aw - 1 - i : i), sj = Math.min(ah - 1, j);
        const s = ((ay + sj) * 64 + ax + si) * 4, t = ((by + j) * 64 + bx + i) * 4;
        if (px[t] !== src[s] || px[t + 1] !== src[s + 1] || px[t + 2] !== src[s + 2] || px[t + 3] !== src[s + 3]) changed++;
        px[t] = src[s]; px[t + 1] = src[s + 1]; px[t + 2] = src[s + 2]; px[t + 3] = src[s + 3];
      }
    }
  }
  return changed;
}

// Base-layer faces with transparent pixels. Java draws those as black or see-through
// depending on version; Bedrock may reject the skin. Returns list of part labels.
export function transparentBaseParts(rgba, model) {
  const bad = new Set();
  for (const f of allFaces(model)) {
    if (f.layer !== "base") continue;
    const [rx, ry, rw, rh] = f.rect;
    outer: for (let j = ry; j < ry + rh; j++) {
      for (let i = rx; i < rx + rw; i++) {
        if (rgba[(j * 64 + i) * 4 + 3] < 255) { bad.add(f.part.label); break outer; }
      }
    }
  }
  return [...bad];
}

// Fill transparent base-layer pixels with a colour (in place).
export function fillTransparentBase(rgba, model, [r, g, b]) {
  for (const f of allFaces(model)) {
    if (f.layer !== "base") continue;
    const [rx, ry, rw, rh] = f.rect;
    for (let j = ry; j < ry + rh; j++) for (let i = rx; i < rx + rw; i++) {
      const k = (j * 64 + i) * 4;
      if (rgba[k + 3] < 255) {
        const a = rgba[k + 3] / 255;
        rgba[k] = Math.round(rgba[k] * a + r * (1 - a));
        rgba[k + 1] = Math.round(rgba[k + 1] * a + g * (1 - a));
        rgba[k + 2] = Math.round(rgba[k + 2] * a + b * (1 - a));
        rgba[k + 3] = 255;
      }
    }
  }
}

// Convert an old 64x32 skin to 64x64: the left arm and leg didn't exist, so
// they're copied from the right ones, each face mirrored, like the game does.
export function upgradeLegacy(src32) {
  const out = new Uint8ClampedArray(64 * 64 * 4);
  out.set(src32.subarray(0, 64 * 32 * 4));
  const copyMirrored = (fromU, fromV, toU, toV) => {
    const w = 4, h = 12, d = 4;
    const a = faceRects(fromU, fromV, w, h, d);
    const b = faceRects(toU, toV, w, h, d);
    const pairs = [["top", "top"], ["bottom", "bottom"], ["front", "front"], ["back", "back"], ["right", "left"], ["left", "right"]];
    for (const [fa, fb] of pairs) {
      const [ax, ay, aw, ah] = a[fa];
      const [bx, by] = b[fb];
      for (let j = 0; j < ah; j++) for (let i = 0; i < aw; i++) {
        const s = ((ay + j) * 64 + ax + i) * 4;
        const t = ((by + j) * 64 + bx + (aw - 1 - i)) * 4;
        out[t] = out[s]; out[t + 1] = out[s + 1]; out[t + 2] = out[s + 2]; out[t + 3] = out[s + 3];
      }
    }
  };
  copyMirrored(0, 16, 16, 48); // right leg -> left leg
  copyMirrored(40, 16, 32, 48); // right arm -> left arm
  return out;
}

// Guess slim vs classic from an imported skin: slim skins leave the 4th arm
// column (x=54..55, y=20..31 on the right arm's back strip) transparent.
export function guessModel(rgba) {
  for (let y = 20; y < 32; y++) for (let x = 54; x < 56; x++) {
    if (rgba[(y * 64 + x) * 4 + 3] > 0) return "classic";
  }
  return "slim";
}

// An original starter skin: a plain mannequin with each part in its own tone,
// so it's obvious where everything lands. Not based on any game character.
export function mannequin(model) {
  const px = new Uint8ClampedArray(64 * 64 * 4);
  const tones = {
    head: [222, 184, 150], body: [86, 128, 168], rarm: [222, 184, 150], larm: [222, 184, 150],
    rleg: [70, 72, 96], lleg: [70, 72, 96],
  };
  const shade = { top: 1.1, front: 1, right: 0.88, left: 0.88, back: 0.8, bottom: 0.7 };
  for (const f of allFaces(model)) {
    if (f.layer !== "base") continue;
    let [r, g, b] = tones[f.part.id];
    const [rx, ry, rw, rh] = f.rect;
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      let s = shade[f.face];
      let cr = r, cg = g, cb = b;
      // sleeves on the arms, shoes on the legs
      if (f.part.arm && j < 4 && f.face !== "bottom") [cr, cg, cb] = tones.body;
      if (f.part.id.endsWith("leg") && j >= rh - 2 && f.face !== "top") [cr, cg, cb] = [48, 40, 36];
      const k = ((ry + j) * 64 + rx + i) * 4;
      px[k] = Math.min(255, cr * s); px[k + 1] = Math.min(255, cg * s); px[k + 2] = Math.min(255, cb * s); px[k + 3] = 255;
    }
  }
  // simple face: eyes and a mouth on the head front (8,8)
  const put = (x, y, c) => { const k = (y * 64 + x) * 4; px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255; };
  const hair = [92, 62, 40];
  for (let i = 0; i < 8; i++) { put(8 + i, 8, hair); put(8 + i, 0 + 7, hair); }
  for (let x = 0; x < 32; x++) for (let y = 0; y < 8; y++) {
    // hair over the top and upper rows of the sides and back
    const f = faceAt(model, x, y + 0);
    if (f && f.part.id === "head" && f.layer === "base" && (f.face === "top")) put(x, y, hair);
  }
  for (let x = 0; x < 32; x++) for (let y = 8; y < 16; y++) {
    const f = faceAt(model, x, y);
    if (!f || f.part.id !== "head") continue;
    const row = y - 8;
    if (f.face === "back" && row < 6) put(x, y, hair);
    if ((f.face === "left" || f.face === "right") && row < 3) put(x, y, hair);
  }
  const white = [245, 245, 245], iris = [60, 96, 140], mouth = [150, 90, 80];
  put(9, 12, white); put(10, 12, iris); put(13, 12, iris); put(14, 12, white);
  put(11, 14, mouth); put(12, 14, mouth);
  return px;
}
