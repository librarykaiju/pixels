// Character starter: builds an original skin from a few choices (skin tone,
// eyes, hair style and colour, clothes). Output is separate layers so each
// piece can be hidden, recoloured or repainted on its own.

import { partsFor, faceRects } from "./skin.js";

export const FACIAL_HAIR = [
  { id: "none", label: "None" },
  { id: "stubble", label: "Stubble" },
  { id: "mustache", label: "Mustache" },
  { id: "goatee", label: "Goatee" },
  { id: "beard", label: "Short beard" },
  { id: "fullbeard", label: "Full beard" },
  { id: "midbeard", label: "Medium beard" },
  { id: "longbeard", label: "Long beard" },
];

export const SKIN_TONES = ["#f8e1d0", "#f3d0b4", "#eabd9a", "#e0ab85", "#d29a72", "#c08660", "#ab7150", "#965e40", "#7d4a32", "#663a27", "#4f2c1e", "#3b2016"];
export const EYE_COLOURS = ["#5a3820", "#3b2414", "#8a6a2c", "#b07a1e", "#4d7a3a", "#6b8a6e", "#3f6fb0", "#7fb2e0", "#7f8a94", "#7a5aa8"];
export const HAIR_COLOURS = ["#1c1714", "#3b2618", "#5e3b22", "#8a5a34", "#8e3b1f", "#b5462a", "#d0702e", "#b48a4c", "#dcbf74", "#efe6c8", "#9a9a9e", "#e9e9ea", "#3b6fd0", "#e070b0", "#3fa060", "#7a4ac0"];
export const SHIRT_COLOURS = ["#c0392b", "#2e6fbe", "#2f8f57", "#e0b630", "#6b3fa0", "#e8e8e8", "#2b2b2b", "#e07a2e"];
export const PANTS_COLOURS = ["#2f3a5a", "#23252e", "#6b5640", "#8a8a8a", "#4a5a3a", "#7a2f3a"];
export const SHOE_COLOURS = ["#2a2420", "#f0f0f0", "#6b4a2e", "#3a3a46", "#b03030"];

export const HAIR_STYLES = [
  { id: "crop", label: "Short crop" },
  { id: "sidepart", label: "Side part" },
  { id: "buzz", label: "Buzz cut" },
  { id: "curly", label: "Curly top" },
  { id: "afro", label: "Afro" },
  { id: "bald", label: "Bald" },
  { id: "bob", label: "Bob" },
  { id: "long", label: "Long" },
  { id: "ponytail", label: "Ponytail" },
  { id: "braids", label: "Braids" },
  { id: "bun", label: "Top bun" },
  { id: "pigtails", label: "Pigtails" },
  { id: "mohawk", label: "Shaggy mohawk" },
  { id: "fauxhawk", label: "Fauxhawk" },
  { id: "swept", label: "Swept bangs" },
  { id: "sweptshaved", label: "Swept, shaved sides" },
  { id: "animespiky", label: "Anime spikes" },
  { id: "animelong", label: "Anime long" },
];
const ANIME = new Set(["animespiky", "animelong"]);

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mul = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const FACE_SHADE = { top: 1.08, front: 1, right: 0.9, left: 0.9, back: 0.84, bottom: 0.74 };
// small repeatable noise so hair and skin aren't flat
const noise = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

// distance from the face's front edge, for the side faces (texture is mirrored between them)
const fromFront = (face, lx, w) => (face === "right" ? w - 1 - lx : lx);

// Is (lx,ly) on this head face hair? layer "base" or "over" (hat layer, for volume).
function hairAt(style, layer, face, lx, ly) {
  const edge = lx === 0 || lx === 7;
  const fx = face === "right" || face === "left" ? fromFront(face, lx, 8) : 0;
  const base = layer === "base";
  const side = face === "right" || face === "left";
  const mid = lx >= 2 && lx <= 5; // centre strip, for top / front / back
  switch (style) {
    case "mohawk":
      if (base) {
        if (face === "top") return mid;
        // shaggy fringe falling over the forehead
        if (face === "front") return mid && (ly === 0 || (ly === 1 && lx !== 2) || (ly === 2 && (lx === 3 || lx === 5)));
        if (face === "back") return mid && ly <= 6;
        return false;
      }
      if (face === "top") return mid || ((lx === 1 || lx === 6) && ly >= 5 && noise(lx, ly + 3) < 0.5);
      if (face === "front") return mid && (ly === 0 || (ly === 1 && lx !== 4) || (ly === 2 && lx === 4) || (ly === 3 && lx === 3));
      if (face === "back") return mid && (ly <= 4 || noise(lx + 7, ly) < 0.6); // shaggy ends
      return false;
    case "fauxhawk":
      if (base) {
        if (face === "top") return true;
        if (face === "front") return ly === 0;
        if (side) return ly <= 1 || (ly <= 3 && fx >= 4);
        if (face === "back") return ly <= 4;
        return false;
      }
      if (face === "top") return mid && ly >= 1;
      if (face === "front") return ly === 0 && mid;
      return false;
    case "swept":
      if (base) {
        if (face === "top") return true;
        if (face === "front") return ly === 0 || (ly === 1 && lx <= 5) || (ly === 2 && lx <= 3) || (ly === 3 && lx === 0);
        if (side) return ly <= 3 || (fx >= 4 && ly <= 5);
        if (face === "back") return ly <= 6;
        return false;
      }
      if (face === "top") return true;
      if (face === "front") return ly === 0 || (ly === 1 && lx <= 4) || (ly === 2 && lx <= 1);
      if (side) return ly <= 1;
      if (face === "back") return ly <= 2;
      return false;
    case "sweptshaved":
      if (base) {
        if (face === "top") return true;
        if (face === "front") return ly === 0 || (ly === 1 && lx <= 5) || (ly === 2 && lx <= 3) || (ly === 3 && lx === 0);
        if (side) return ly === 0 || (ly === 1 && fx <= 2);
        if (face === "back") return ly <= 1;
        return false;
      }
      if (face === "top") return true;
      if (face === "front") return ly === 0 || (ly === 1 && lx <= 4) || (ly === 2 && lx <= 1);
      if (side) return ly === 0 && fx <= 3;
      return false;
    case "animespiky":
      if (base) {
        if (face === "top") return true;
        if (face === "front") return ly === 0 || (ly === 1 && lx % 3 !== 2) || (ly === 2 && lx % 3 === 0);
        if (side) return ly <= 2 || (fx >= 3 && ly <= 5) || (fx >= 3 && ly === 6 && lx % 2 === 0);
        if (face === "back") return ly <= 5 || (ly <= 7 && lx % 2 === 0);
        return false;
      }
      return spikeShade(face, lx, ly) !== null;
    case "animelong":
      if (base) {
        if (face === "top") return true;
        if (face === "front") return ly <= 1 || (ly === 2 && lx % 2 === 0) || edge;
        if (side) return ly <= 1 || fx >= 1;
        if (face === "back") return true;
        if (face === "bottom") return ly <= 1;
        return false;
      }
      if (face === "top" || face === "back") return true;
      if (face === "front") return ly === 0 || (ly === 1 && lx % 2 === 1) || (edge && ly >= 2);
      if (side) return ly <= 1 || fx >= 1;
      if (face === "bottom") return ly <= 3 || edge;
      return false;
  }
  if (style === "bald") {
    if (!base) return false;
    if (face === "back") return ly >= 4 && ly <= 5;
    if (face === "right" || face === "left") return ly >= 3 && ly <= 4 && fx >= 4;
    return false;
  }
  if (base) {
    if (face === "top") return true;
    if (face === "bottom") return ["long", "braids", "ponytail", "pigtails"].includes(style) && ly <= 1;
    if (face === "front") {
      switch (style) {
        case "crop": case "buzz": return ly === 0;
        case "sidepart": return ly === 0 || (ly === 1 && lx <= 4) || (ly === 2 && lx <= 1);
        case "curly": return ly === 0 || (ly === 1 && lx % 2 === 0);
        case "afro": return ly <= 1 || (edge && ly <= 3);
        case "bob": return ly <= 1 || (edge && ly <= 5);
        case "long": case "braids": return (ly <= 1 && lx !== 3 && lx !== 4) || ly === 0 || (edge && ly <= 7);
        case "ponytail": case "bun": case "pigtails": return ly === 0 || (ly === 1 && (lx <= 1 || lx >= 6));
      }
    }
    if (face === "right" || face === "left") {
      switch (style) {
        case "crop": case "sidepart": return ly <= 2 || (ly <= 4 && (fx === 1 || fx >= 5));
        case "buzz": case "ponytail": case "bun": return ly <= 2 || (ly <= 4 && fx >= 4);
        case "curly": return ly <= 2 || (ly <= 3 && fx >= 3);
        case "afro": return ly <= 4 || fx >= 2;
        case "bob": return ly <= 1 || (fx >= 1 && ly <= 6);
        case "long": case "braids": case "pigtails": return ly <= 1 || fx >= 1;
      }
    }
    if (face === "back") {
      if (["crop", "sidepart", "buzz", "curly"].includes(style)) return ly <= 5;
      if (style === "bob") return ly <= 6;
      return true;
    }
    return false;
  }
  // outer (hat) layer: adds volume
  switch (style) {
    case "afro":
      if (face === "top" || face === "back") return true;
      if (face === "right" || face === "left") return !(fx === 0 && ly >= 3);
      if (face === "front") return ly === 0 || (edge && ly <= 3);
      return false;
    case "curly":
      if (face === "top") return (lx + ly) % 3 !== 0;
      if (face === "front") return ly === 0 && lx % 2 === 1;
      if (face === "right" || face === "left" || face === "back") return ly === 0 && (lx + 1) % 2 === 0;
      return false;
    case "bob":
      if (face === "top") return true;
      if (face === "front") return ly === 0;
      if (face === "right" || face === "left") return ly === 0 || (fx >= 1 && ly <= 6);
      if (face === "back") return ly <= 6;
      return false;
    case "long": case "braids":
      if (face === "top" || face === "back") return true;
      if (face === "front") return ly === 0;
      if (face === "right" || face === "left") return ly <= 1 || fx >= 1;
      if (face === "bottom") return ly <= 2;
      return false;
    case "ponytail":
      if (face === "back") return ly <= 1 || (lx >= 3 && lx <= 4);
      if (face === "bottom") return ly === 0 && lx >= 3 && lx <= 4;
      return false;
    case "bun":
      if (face === "top") return ly <= 3 && lx >= 2 && lx <= 5;
      if (face === "back") return ly <= 2 && lx >= 2 && lx <= 5;
      return false;
    case "pigtails":
      if (face === "right" || face === "left") return fx >= 5 && ly >= 2;
      if (face === "back") return (lx <= 1 || lx >= 6) && ly >= 2;
      if (face === "bottom") return ly <= 1 && edge;
      return false;
    case "sidepart":
      if (face === "top") return ly >= 4 && lx <= 5;
      if (face === "front") return ly === 0 && lx <= 4;
      return false;
  }
  return false;
}

// hair hanging down the body's back (and pigtails onto the shoulders)
function bodyHairAt(style, layer, face, lx, ly) {
  if (face !== "back") return false;
  if (style === "long") return layer === "base" ? ly <= 3 : ly <= 5;
  if (style === "braids") return layer === "over" && ly <= 8 && (lx === 1 || lx === 2 || lx === 5 || lx === 6);
  if (style === "ponytail") return layer === "over" && ly <= 5 && lx >= 3 && lx <= 4;
  if (style === "animelong") return layer === "base" ? ly <= 4 : ly <= 9 && !(ly >= 8 && lx % 2 === 1);
  return false;
}

// shaved sides (mohawk): tinted skin rather than hair
function shavedAt(style, face, lx, ly) {
  if (style === "sweptshaved") return ((face === "right" || face === "left") && ly <= 5) || (face === "back" && ly <= 5);
  if (style !== "mohawk") return false;
  const mid = lx >= 2 && lx <= 5;
  if (face === "right" || face === "left") return ly <= 4;
  if (face === "back") return !mid && ly <= 6;
  if (face === "top") return !mid;
  return false;
}

// Anime spikes. A skin can't change the head's shape, so the spikes are faked with the
// hat layer: raised, lit spikes on the outer layer over a shadowed inner layer, with gaps
// between the tips so the outline is jagged. Returns a shade factor, or null for no spike.
const SPIKES = {
  front: [{ c: 1.1, h: 3.2, s: -0.15 }, { c: 4, h: 3.8 }, { c: 6.9, h: 3.2, s: 0.15 }],
  side: [{ c: 1.2, h: 3, s: 0.3 }, { c: 3.6, h: 5, s: 0.45 }, { c: 6.2, h: 6.4, s: 0.35 }],
  back: [{ c: 0.8, h: 6.5, s: -0.2 }, { c: 3.5, h: 8, s: 0 }, { c: 6.2, h: 7, s: 0.2 }],
};
function spikeShade(face, lx, ly) {
  if (face === "bottom") return null;
  if (face === "top") {
    // a star of ridges from the crown; the dips between them stay on the shadowed base layer
    const dx = lx + 0.5 - 4, dy = ly + 0.5 - 4.5, r = Math.hypot(dx, dy);
    if (r < 1.3) return 1.15;
    const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1.04) % 1 * 7, t = (a % 1) * 2 - 1; // -1..1 across a ridge
    if (Math.abs(t) > 0.62 && r < 4.6) return null;
    return t < 0 ? 1.2 : 0.92;
  }
  const side = face === "right" || face === "left";
  const x = side ? fromFront(face, lx, 8) : lx;
  if (ly <= 0) return 1.12; // root row
  for (const k of SPIKES[side ? "side" : face] || []) {
    if (ly >= k.h) continue;
    const c = k.c + (k.s || 0) * ly, half = 1.7 * (1 - ly / k.h) + 0.35;
    const t = (x + 0.5 - c) / half;
    if (Math.abs(t) > 1) continue;
    let f = t < 0 ? 1.22 : 0.92; // lit on one side, shaded on the other
    if (t > 0.6) f *= 0.85; // shadowed edge of the spike
    if (ly >= k.h - 1) f *= 0.9; // tip
    return f;
  }
  return null;
}

function hairColour(style, colour, x, y, face, layer, ly = -1, lx = -1) {
  if (style === "animespiky" && lx >= 0) {
    if (layer === "over") {
      const f = spikeShade(face, lx, ly);
      const c = mul(colour, (f ?? 1) * (0.97 + noise(x, y) * 0.06));
      return f > 1.14 ? mix(c, [255, 255, 255], 0.18) : c; // shine on the lit edge
    }
    return mul(colour, FACE_SHADE[face] * 0.5 * (0.95 + noise(x, y) * 0.08)); // shadow under the spikes
  }
  const n = noise(x, y);
  let f = FACE_SHADE[face] * (0.9 + n * 0.16);
  if (layer === "over") f *= 1.06;
  if (style === "braids" && layer === "over") f *= (y + (x % 2)) % 3 === 0 ? 0.78 : 1.06; // slanted weave
  else if (face !== "top" && x % 2) f *= 0.95; // strands
  if (style === "buzz") return mul(colour, f * 0.85);
  // anime styles: a bright shine band across the hair
  if (ANIME.has(style) && layer === "over" && (face === "right" || face === "left" || face === "back") && ly === 2) return mix(mul(colour, f), [255, 255, 255], 0.35);
  if (ANIME.has(style) && layer === "base" && face === "front" && ly === 0) return mix(mul(colour, f), [255, 255, 255], 0.25);
  return mul(colour, f);
}

export function buildCharacter(o) {
  const model = o.model || "classic";
  const tone = hex(o.tone), eyes = hex(o.eyes), hair = hex(o.hairColour);
  const shirt = hex(o.shirt), pants = hex(o.pants), shoes = hex(o.shoes);
  const body = new Uint8ClampedArray(64 * 64 * 4), face = new Uint8ClampedArray(64 * 64 * 4), hairPx = new Uint8ClampedArray(64 * 64 * 4);
  const put = (px, x, y, c) => { const k = (y * 64 + x) * 4; px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255; };
  const buzzBlend = (c) => mix(tone, c, 0.55);

  for (const p of partsFor(model)) {
    const [w, h, d] = p.size;
    for (const layer of ["base", "over"]) {
      const [u, v] = p[layer];
      const rects = faceRects(u, v, w, h, d);
      for (const fname of Object.keys(rects)) {
        const [rx, ry, rw, rh] = rects[fname];
        for (let ly = 0; ly < rh; ly++) for (let lx = 0; lx < rw; lx++) {
          const x = rx + lx, y = ry + ly, s = FACE_SHADE[fname];
          // ---- body layer (skin + clothes), inner layer only
          if (layer === "base") {
            let c = mul(tone, s * (0.97 + noise(x, y) * 0.05));
            if (p.id === "body") {
              c = mul(shirt, s * (0.96 + noise(x, y) * 0.06));
              if ((fname === "front" || fname === "back" || fname === "left" || fname === "right") && ly >= 10) c = mul(pants, s);
              if (fname === "bottom") c = mul(pants, s);
              if (fname === "front" && ly === 0 && lx >= 3 && lx <= 4) c = mul(tone, s * 0.95); // neckline
            } else if (p.arm) {
              const sleeve = o.sleeves === "long" ? (fname === "bottom" ? false : ly < rh - 1) : ly < 4;
              if (fname === "top" || sleeve) c = mul(shirt, s * (0.96 + noise(x, y) * 0.06));
              if (o.sleeves === "long" && fname !== "top" && ly === rh - 2) c = mul(shirt, s * 0.85); // cuff
            } else if (p.id.endsWith("leg")) {
              c = mul(pants, s * (0.95 + noise(x, y) * 0.06));
              if (fname === "bottom" || (fname !== "top" && ly >= rh - 2)) c = mul(shoes, s);
              if (fname === "front" && ly === rh - 3) c = mul(pants, s * 0.8); // hem shadow
            } else if (p.id === "head" && fname === "bottom") {
              c = mul(tone, 0.72);
            }
            put(body, x, y, c);
          }
          // ---- hair layer
          if (p.id === "head" && layer === "base" && shavedAt(o.hair, fname, lx, ly)) put(hairPx, x, y, buzzBlend(mul(hair, s * 0.85)));
          if (p.id === "head" && hairAt(o.hair, layer, fname, lx, ly)) {
            let c = hairColour(o.hair, hair, x, y, fname, layer, ly, lx);
            if (o.hair === "buzz") c = buzzBlend(c);
            put(hairPx, x, y, c);
          }
          if (p.id === "body" && bodyHairAt(o.hair, layer, fname, lx, ly)) put(hairPx, x, y, hairColour(o.hair, hair, x, y, fname, layer, ly));
        }
      }
    }
  }

  // ---- face layer: head front is at (8,8)
  const F = (lx, ly, c) => put(face, 8 + lx, 8 + ly, c);
  const white = [244, 242, 238], brow = o.hair === "bald" || o.hair === "buzz" ? mul(hair, 0.8) : mul(hair, 0.72);
  F(1, 4, white); F(2, 4, eyes); F(5, 4, eyes); F(6, 4, white);
  F(2, 3, brow); F(1, 3, brow); F(5, 3, brow); F(6, 3, brow);
  F(3, 5, mul(tone, 0.9)); F(4, 5, mul(tone, 0.9));
  const lip = mix(mul(tone, 0.78), [170, 70, 70], 0.25);
  F(3, 6, lip); F(4, 6, lip);

  // ---- facial hair, on its own layer so it's easy to hide
  const long = o.facial === "longbeard", medium = o.facial === "midbeard";
  const fh = long || medium ? "fullbeard" : o.facial || "none";
  const beardPx = new Uint8ClampedArray(64 * 64 * 4);
  if (fh !== "none") {
    const bc = mul(hair, 0.88);
    const B = (x, y, shade = 1) => {
      const c = fh === "stubble" ? mix(mul(tone, shade), bc, 0.4) : mul(bc, shade * (0.92 + noise(x, y) * 0.14));
      put(beardPx, x, y, c);
    };
    const front = (lx, ly) => B(8 + lx, 8 + ly);
    const side = (fx, ly) => { B(0 + (7 - fx), 8 + ly, FACE_SHADE.right); B(16 + fx, 8 + ly, FACE_SHADE.left); };
    const chin = (lx, ly) => B(16 + lx, 0 + ly, FACE_SHADE.bottom); // head underside, ly 7 = front
    const mouth = (lx, ly) => ly === 6 && (lx === 3 || lx === 4);
    if (fh === "stubble") {
      for (let ly = 5; ly < 8; ly++) for (let lx = 0; lx < 8; lx++) {
        if (mouth(lx, ly) || (ly === 5 && (lx === 3 || lx === 4))) continue;
        if (noise(lx + 40, ly) < 0.7) front(lx, ly);
      }
      for (let ly = 5; ly < 8; ly++) for (let fx = 0; fx < 3; fx++) if (noise(fx + 60, ly) < 0.7) side(fx, ly);
    }
    if (fh === "mustache" || fh === "fullbeard") for (let lx = 2; lx <= 5; lx++) front(lx, 5);
    if (fh === "goatee") { front(2, 6); front(5, 6); for (let lx = 2; lx <= 5; lx++) front(lx, 7); front(3, 5); front(4, 5); }
    if (fh === "beard" || fh === "fullbeard") {
      for (let lx = 0; lx < 8; lx++) { if (!mouth(lx, 6)) front(lx, 6); front(lx, 7); }
      front(0, 5); front(7, 5);
      const depth = fh === "fullbeard" ? 4 : 3, top = fh === "fullbeard" ? 4 : 5;
      for (let ly = top; ly < 8; ly++) for (let fx = 0; fx < depth; fx++) side(fx, ly);
      for (let ly = fh === "fullbeard" ? 4 : 5; ly < 8; ly++) for (let lx = 0; lx < 8; lx++) chin(lx, ly);
    }
    if (fh === "fullbeard") {
      // a little volume on the outer layer: hat front starts at (40,8)
      for (let lx = 1; lx <= 6; lx++) B(40 + lx, 8 + 7, 1.05);
    }
    if (medium) {
      // a short point onto the chest: about half the long beard
      [[1, 6], [2, 5], [3, 4]].forEach(([a, b], ly) => { for (let lx = a; lx <= b; lx++) B(20 + lx, 36 + ly, 1.04); });
      for (let ly = 5; ly < 8; ly++) for (let lx = 1; lx <= 6; lx++) B(48 + lx, ly, FACE_SHADE.bottom);
    }
    if (long) {
      // hangs onto the chest on the outer (jacket) layer, front at (20,36), tapering to a point
      const widths = [[1, 6], [1, 6], [1, 6], [2, 5], [2, 5], [3, 4]];
      widths.forEach(([a, b], ly) => { for (let lx = a; lx <= b; lx++) B(20 + lx, 36 + ly, 1.04); });
      // and under the chin on the hat layer (underside at (48,0), ly 7 = front)
      for (let ly = 4; ly < 8; ly++) for (let lx = 1; lx <= 6; lx++) B(48 + lx, ly, FACE_SHADE.bottom);
    }
  }

  const out = [
    { name: "Body", px: body },
    { name: "Face", px: face },
  ];
  if (fh !== "none") out.push({ name: "Facial hair", px: beardPx });
  out.push({ name: "Hair", px: hairPx });
  return out;
}
