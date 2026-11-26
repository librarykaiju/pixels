import { readAse, writeAse } from "./aseprite.js";
import { buildTilemap, renderTilemap, syncTilemap, placeTile, pruneTiles } from "./tilemap.js";
import { Doc, BLEND_MODES, newLayer, blendOver, line, rectPoints, ellipsePoints, hexToRgba, rgbaToHex, shadeColor, sameColor } from "./doc.js";
import { allFaces, faceAt, mirrorTexel, transparentBaseParts, fillTransparentBase, upgradeLegacy, guessModel, mannequin, PARTS } from "./skin.js";
import { SkinPreview } from "./preview3d.js";
import * as store from "./storage.js";
import { iconSVG } from "./icons.js";
import { encodeGIF } from "./gif.js";
import { rpgAssets, categorySheet, RPG_COLOURS } from "./rpg.js";
import * as packs from "./packs.js";
import { createWheel } from "./wheel.js";
import { buildCharacter, FACIAL_HAIR, SKIN_TONES, EYE_COLOURS, HAIR_COLOURS, HAIR_STYLES, SHIRT_COLOURS, PANTS_COLOURS, SHOE_COLOURS } from "./character.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------------------------------------------------------------- palettes
const PALETTES = {
  "Pixels 32": ["#0d0b14", "#2b2638", "#4b4560", "#7a7391", "#b1abc4", "#eeeaf5", "#3b1726", "#7a2335", "#c43a3f", "#ff6b4a",
    "#ffa36b", "#ffd8a8", "#4a2c12", "#8a5a1f", "#d19a3c", "#ffd166", "#fff1a8", "#123d2c", "#1f7a4d", "#3fbf6a",
    "#a3e67a", "#0f2d4a", "#1d5fa0", "#3aa0e8", "#8fd9ff", "#2a1a4f", "#5b3aa8", "#9b6cff", "#e0b3ff", "#7a2a5c", "#d64f9c", "#ff9ed2"],
  "Skin tones": SKIN_TONES,
  "Eye colours": EYE_COLOURS,
  "Hair colours": HAIR_COLOURS,
  "RPG": RPG_COLOURS,
  "Greys": ["#000000", "#141414", "#262626", "#3a3a3a", "#4f4f4f", "#666666", "#7f7f7f", "#999999", "#b3b3b3", "#cccccc", "#e6e6e6", "#ffffff"],
  "My colours": [],
};

const TOOLS = [
  { id: "pencil", label: "Pencil", key: "B" },
  { id: "eraser", label: "Eraser", key: "E" },
  { id: "fill", label: "Fill (Shift: every pixel of that colour)", key: "F" },
  { id: "picker", label: "Pick colour (or hold Alt)", key: "I" },
  { id: "line", label: "Line (Shift: straight)", key: "L" },
  { id: "rect", label: "Rectangle (Shift: square)", key: "R" },
  { id: "ellipse", label: "Circle (Shift: round)", key: "O" },
  { id: "shade", label: "Shade: left lightens, right darkens", key: "D" },
  { id: "spray", label: "Spray", key: "A" },
  { id: "gradient", label: "Gradient (dithered, left colour to right colour; Shift: 45°)", key: "U" },
  { id: "contour", label: "Contour: draw a closed shape, it fills when you let go", key: "C" },
  { id: "select", label: "Select box (Shift adds, Alt removes)", key: "S" },
  { id: "lasso", label: "Lasso select (Shift adds, Alt removes)", key: "Q" },
  { id: "wand", label: "Magic wand: select touching pixels of one colour (Shift adds, Alt removes)", key: "W" },
  { id: "move", label: "Move layer", key: "V" },
  { id: "slice", label: "Slice: mark named areas and 9-patch borders for game engines", key: "J" },
];
const MAX_SIZE = 512; // biggest canvas, in pixels per side
const SELECT_TOOLS = new Set(["select", "lasso", "wand"]);
const PAINT_ON_3D = new Set(["pencil", "eraser", "fill", "picker", "shade"]);

// ---------------------------------------------------------------- state
const prefs = store.loadPrefs();
if (Array.isArray(prefs.myColours)) PALETTES["My colours"] = prefs.myColours.slice(0, 60);
const customPalettes = prefs.customPalettes && typeof prefs.customPalettes === "object" ? prefs.customPalettes : {};
for (const [n, list] of Object.entries(customPalettes)) if (Array.isArray(list) && !PALETTES[n]) PALETTES[n] = list.slice(0, 256);
const S = {
  tool: "pencil", primary: prefs.primary || [255, 107, 74, 255], secondary: prefs.secondary || [0, 0, 0, 0],
  size: 1, mirrorX: false, mirrorY: false, filled: false, grid: prefs.grid !== false, guides: true,
  zoom: 8, panX: 0, panY: 0, palette: PALETTES[prefs.palette] ? prefs.palette : "Pixels 32",
  hover: null, hover3d: null, sel: null, clip: null,
  showOuter: true, walk: false, pvTarget: "base", sv: prefs.sv === "3d" ? "3d" : "2d",
  onion: false, playing: true, playTag: -1, tileStamp: false, tilePick: 1, isolate: null, lineLock: false,
  perfect: prefs.perfect !== false, dither: "off", tile: false, ref: null,
  ink: "simple", pressure: false, pSize: 0, brush: null,
};
// dither patterns: which pixels a brush may paint
const DITHER = {
  off: null,
  d50: (x, y) => (x + y) % 2 === 0,
  d25: (x, y) => x % 2 === 0 && y % 2 === 0,
  d75: (x, y) => !(x % 2 === 1 && y % 2 === 1),
  d12: (x, y) => y % 2 === 0 && (x + (y % 4 === 0 ? 0 : 2)) % 4 === 0,
  lines: (x, y) => y % 2 === 0,
};
const tileOn = () => S.tile && doc && doc.mode === "art";
// tile mode: coordinates past an edge come back in from the other side
function wrapXY(x, y) {
  if (!tileOn()) return [x, y];
  return [((x % doc.w) + doc.w) % doc.w, ((y % doc.h) + doc.h) % doc.h];
}
const in3D = () => doc && doc.mode === "skin" && S.sv === "3d" && !!preview;
let doc = null;
let preview = null;
let artDoc = null, skinDoc = null; // keep both modes' current drawing while switching

// ---------------------------------------------------------------- canvas view
const view = $("#view"), stage = $("#stage");
const ctx = view.getContext("2d");
const compCanvas = document.createElement("canvas");
const compCtx = compCanvas.getContext("2d");
const floatCanvas = document.createElement("canvas");
let checker = null;

function dpr() { return Math.min(window.devicePixelRatio || 1, 3); }

function makeChecker() {
  const c = document.createElement("canvas"), n = Math.round(8 * dpr());
  c.width = c.height = n * 2;
  const g = c.getContext("2d");
  g.fillStyle = "#3a3546"; g.fillRect(0, 0, n * 2, n * 2);
  g.fillStyle = "#2c2837"; g.fillRect(0, 0, n, n); g.fillRect(n, n, n, n);
  checker = ctx.createPattern(c, "repeat");
}

function resizeView() {
  const r = stage.getBoundingClientRect(), d = dpr();
  view.width = Math.max(1, Math.round(r.width * d));
  view.height = Math.max(1, Math.round(r.height * d));
  makeChecker();
  requestRender();
}

function fit() {
  const r = stage.getBoundingClientRect();
  const z = Math.min((r.width - 48) / doc.w, (r.height - 48) / doc.h);
  S.zoom = z >= 1 ? Math.max(1, Math.floor(z)) : Math.max(0.1, z);
  S.panX = Math.round((r.width - doc.w * S.zoom) / 2);
  S.panY = Math.round((r.height - doc.h * S.zoom) / 2);
  requestRender();
}

const ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80];
function zoomAt(nz, cx, cy) {
  nz = Math.max(0.5, Math.min(96, nz));
  S.panX = cx - (cx - S.panX) * (nz / S.zoom);
  S.panY = cy - (cy - S.panY) * (nz / S.zoom);
  S.zoom = nz;
  requestRender();
}
function zoomStep(dir, cx, cy) {
  const r = stage.getBoundingClientRect();
  if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
  let nz;
  if (dir > 0) nz = ZOOMS.find((z) => z > S.zoom + 0.01) || 96;
  else nz = [...ZOOMS].reverse().find((z) => z < S.zoom - 0.01) || 0.5;
  zoomAt(nz, cx, cy);
}

function toDoc(ev) {
  const r = view.getBoundingClientRect();
  const x = (ev.clientX - r.left - S.panX) / S.zoom, y = (ev.clientY - r.top - S.panY) / S.zoom;
  return [Math.floor(x), Math.floor(y), x, y];
}

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

let unusedPath = null, unusedFor = null;
function unusedRects() {
  if (unusedFor === doc.model && unusedPath) return unusedPath;
  const rects = [];
  for (let y = 0; y < 64; y++) {
    let x = 0;
    while (x < 64) {
      if (faceAt(doc.model, x, y)) { x++; continue; }
      const x0 = x; while (x < 64 && !faceAt(doc.model, x, y)) x++;
      rects.push([x0, y, x - x0, 1]);
    }
  }
  unusedPath = rects; unusedFor = doc.model;
  return rects;
}

// skin texels you can't paint right now (another part is isolated, or the outer layer is off)
function canPaint(x, y) {
  if (doc.mode !== "skin") return true;
  if (!S.isolate && S.showOuter) return true;
  const f = faceAt(doc.model, x, y);
  if (!f) return !S.isolate;
  if (S.isolate && f.part.id !== S.isolate) return false;
  if (!S.showOuter && f.layer === "over") return false;
  return true;
}
let lockedCache = null, lockedKey = "";
function lockedRects() {
  const key = `${doc.model}|${S.isolate}|${S.showOuter}`;
  if (lockedCache && lockedKey === key) return lockedCache;
  const rects = [];
  if (S.isolate || !S.showOuter) {
    for (let y = 0; y < 64; y++) {
      let x = 0;
      while (x < 64) {
        const locked = (i) => faceAt(doc.model, i, y) && !canPaint(i, y);
        if (!locked(x)) { x++; continue; }
        const x0 = x; while (x < 64 && locked(x)) x++;
        rects.push([x0, y, x - x0, 1]);
      }
    }
  }
  lockedCache = rects; lockedKey = key;
  return rects;
}

function render() {
  if (!doc) return;
  const d = dpr(), W = view.width, H = view.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const z = S.zoom * d, ox = S.panX * d, oy = S.panY * d;
  const dw = doc.w * z, dh = doc.h * z;

  // transparent background
  ctx.save();
  ctx.translate(Math.round(ox), Math.round(oy));
  ctx.fillStyle = checker;
  if (tileOn()) ctx.fillRect(-Math.round(dw), -Math.round(dh), Math.round(dw) * 3, Math.round(dh) * 3);
  else ctx.fillRect(0, 0, Math.round(dw), Math.round(dh));
  ctx.restore();
  const drawRef = () => {
    const r = S.ref;
    if (!r || !r.show) return;
    const k = r.fit === "stretch" ? null : Math.min(doc.w / r.img.naturalWidth, doc.h / r.img.naturalHeight);
    const rw = k ? r.img.naturalWidth * k : doc.w, rh = k ? r.img.naturalHeight * k : doc.h;
    ctx.globalAlpha = r.opacity; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(r.img, ox + (doc.w - rw) / 2 * z, oy + (doc.h - rh) / 2 * z, rw * z, rh * z);
    ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
  };
  if (S.ref && !S.ref.top) drawRef();

  // onion skin: previous frame, faint
  if (doc.mode === "art" && S.onion && doc.frames.length > 1) {
    const n = doc.frames.length, prev = (doc.frame - 1 + n) % n;
    ctx.globalAlpha = 0.28; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(animFrameCanvas(prev), Math.round(ox), Math.round(oy), Math.round(dw), Math.round(dh));
    ctx.globalAlpha = 1;
  }

  // pixels
  if (compCanvas.width !== doc.w || compCanvas.height !== doc.h) { compCanvas.width = doc.w; compCanvas.height = doc.h; }
  compCtx.putImageData(new ImageData(doc.composite(), doc.w, doc.h), 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (tileOn()) {
    ctx.globalAlpha = 0.55;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) ctx.drawImage(compCanvas, Math.round(ox) + i * Math.round(dw), Math.round(oy) + j * Math.round(dh), Math.round(dw), Math.round(dh));
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(compCanvas, Math.round(ox), Math.round(oy), Math.round(dw), Math.round(dh));
  if (S.ref && S.ref.top) drawRef();

  // floating selection
  const sel = S.sel;
  if (sel && sel.float) {
    const f = sel.float;
    floatCanvas.width = f.w; floatCanvas.height = f.h;
    floatCanvas.getContext("2d").putImageData(new ImageData(f.px, f.w, f.h), 0, 0);
    ctx.drawImage(floatCanvas, Math.round(ox + f.x * z), Math.round(oy + f.y * z), Math.round(f.w * z), Math.round(f.h * z));
  }

  const px = (v) => Math.round(v) + 0.5;
  // skin: shade the parts of the texture the game never uses, and outline faces
  if (doc.mode === "skin" && S.guides) {
    ctx.fillStyle = "rgba(12,10,16,0.62)";
    for (const [x, y, w, h] of unusedRects()) ctx.fillRect(Math.round(ox + x * z), Math.round(oy + y * z), Math.ceil(w * z), Math.ceil(h * z));
    ctx.fillStyle = "rgba(12,10,16,0.7)";
    for (const [x, y, w, h] of lockedRects()) ctx.fillRect(Math.round(ox + x * z), Math.round(oy + y * z), Math.ceil(w * z), Math.ceil(h * z));
    ctx.lineWidth = 1;
    const hf = S.hover ? faceAt(doc.model, S.hover[0], S.hover[1]) : null;
    for (const f of allFaces(doc.model)) {
      const [x, y, w, h] = f.rect;
      const hot = hf && hf.part.id === f.part.id && hf.layer === f.layer;
      ctx.strokeStyle = hot ? (f.layer === "base" ? "rgba(255,209,102,0.95)" : "rgba(143,160,255,0.95)") : (f.layer === "base" ? "rgba(255,209,102,0.28)" : "rgba(143,160,255,0.28)");
      ctx.strokeRect(px(ox + x * z), px(oy + y * z), Math.round(w * z) - 1, Math.round(h * z) - 1);
    }
  }

  // grid
  if (S.grid && S.zoom >= 6) {
    ctx.beginPath();
    for (let i = 1; i < doc.w; i++) { const x = px(ox + i * z); ctx.moveTo(x, oy); ctx.lineTo(x, oy + dh); }
    for (let j = 1; j < doc.h; j++) { const y = px(oy + j * z); ctx.moveTo(ox, y); ctx.lineTo(ox + dw, y); }
    ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1; ctx.stroke();
    const major = doc.mode === "skin" ? 8 : (doc.w >= 32 ? 8 : 0);
    if (major) {
      ctx.beginPath();
      for (let i = major; i < doc.w; i += major) { const x = px(ox + i * z); ctx.moveTo(x, oy); ctx.lineTo(x, oy + dh); }
      for (let j = major; j < doc.h; j += major) { const y = px(oy + j * z); ctx.moveTo(ox, y); ctx.lineTo(ox + dw, y); }
      ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.stroke();
    }
  }
  // mirror axes
  if (doc.mode === "art" && (S.mirrorX || S.mirrorY)) {
    ctx.setLineDash([6 * d, 4 * d]); ctx.strokeStyle = "rgba(255,122,89,0.8)"; ctx.beginPath();
    if (S.mirrorX) { ctx.moveTo(ox + dw / 2, oy); ctx.lineTo(ox + dw / 2, oy + dh); }
    if (S.mirrorY) { ctx.moveTo(ox, oy + dh / 2); ctx.lineTo(ox + dw, oy + dh / 2); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  // border
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.strokeRect(Math.round(ox) - 0.5, Math.round(oy) - 0.5, Math.round(dw) + 1, Math.round(dh) + 1);

  // template guides
  if (doc.guides && S.grid) {
    const gd = doc.guides;
    ctx.save(); ctx.strokeStyle = "rgba(76,201,166,0.55)"; ctx.lineWidth = 1; ctx.setLineDash([3 * d, 3 * d]); ctx.beginPath();
    if (gd.ground != null) { const y = px(oy + gd.ground * z); ctx.moveTo(ox, y); ctx.lineTo(ox + dw, y); }
    if (gd.center) { const x = px(ox + (doc.w / 2) * z); ctx.moveTo(x, oy); ctx.lineTo(x, oy + dh); }
    if (gd.cols > 1) for (let i = 1; i < gd.cols; i++) { const x = px(ox + (doc.w * i / gd.cols) * z); ctx.moveTo(x, oy); ctx.lineTo(x, oy + dh); }
    if (gd.rows > 1) for (let j = 1; j < gd.rows; j++) { const y = px(oy + (doc.h * j / gd.rows) * z); ctx.moveTo(ox, y); ctx.lineTo(ox + dw, y); }
    ctx.stroke(); ctx.restore();
  }
  // slices
  if (doc.slices.length || (drag && drag.kind === "slice")) {
    ctx.save(); ctx.lineWidth = 1; ctx.font = `${11 * d}px ui-sans-serif, system-ui`;
    const strong = S.tool === "slice";
    for (const sl of [...doc.slices, ...(drag && drag.kind === "slice" ? [{ ...drag.rect, name: "" }] : [])]) {
      ctx.strokeStyle = strong ? "rgba(58,160,232,0.95)" : "rgba(58,160,232,0.4)";
      ctx.strokeRect(px(ox + sl.x * z), px(oy + sl.y * z), Math.round(sl.w * z) - 1, Math.round(sl.h * z) - 1);
      if (sl.center) {
        ctx.setLineDash([2 * d, 2 * d]);
        ctx.strokeRect(px(ox + (sl.x + sl.center.x) * z), px(oy + (sl.y + sl.center.y) * z), Math.round(sl.center.w * z) - 1, Math.round(sl.center.h * z) - 1);
        ctx.setLineDash([]);
      }
      if (strong && sl.name) { ctx.fillStyle = "rgba(58,160,232,0.95)"; ctx.fillText(sl.name, ox + sl.x * z + 3 * d, oy + sl.y * z - 3 * d); }
    }
    ctx.restore();
  }
  // lasso being drawn
  if (drag && drag.kind === "lasso" && drag.pts.length > 1) {
    ctx.beginPath();
    drag.pts.forEach(([a, b], i) => (i ? ctx.lineTo(ox + a * z, oy + b * z) : ctx.moveTo(ox + a * z, oy + b * z)));
    ctx.strokeStyle = "#fff"; ctx.setLineDash([4 * d, 4 * d]); ctx.stroke(); ctx.setLineDash([]);
  }
  // shaped selection outline
  if (sel && sel.mask && !sel.float) {
    const segs = selEdges(sel);
    ctx.beginPath();
    for (let k = 0; k < segs.length; k += 4) { ctx.moveTo(px(ox + segs[k] * z), px(oy + segs[k + 1] * z)); ctx.lineTo(px(ox + segs[k + 2] * z), px(oy + segs[k + 3] * z)); }
    ctx.setLineDash([4 * d, 4 * d]); ctx.lineDashOffset = -(performance.now() / 60) % (8 * d);
    ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.lineDashOffset += 4 * d; ctx.strokeStyle = "#000"; ctx.stroke(); ctx.setLineDash([]);
    requestRender();
  }
  // selection outline
  if (sel && !(sel.mask && !sel.float)) {
    const r = sel.float ? sel.float : sel;
    ctx.setLineDash([4 * d, 4 * d]);
    ctx.lineDashOffset = -(performance.now() / 60) % (8 * d);
    ctx.strokeStyle = "#fff"; ctx.strokeRect(px(ox + r.x * z), px(oy + r.y * z), Math.round(r.w * z) - 1, Math.round(r.h * z) - 1);
    ctx.lineDashOffset += 4 * d; ctx.strokeStyle = "#000"; ctx.strokeRect(px(ox + r.x * z), px(oy + r.y * z), Math.round(r.w * z) - 1, Math.round(r.h * z) - 1);
    ctx.setLineDash([]);
    requestRender(); // marching ants
  }
  // scale / rotate handles on the selection
  const hs = selHandles();
  if (hs) {
    const k = (v) => v * d;
    const top = hs.find((h) => h.id === "n"), rot = hs.find((h) => h.id === "rot");
    ctx.beginPath(); ctx.moveTo(k(top.x), k(top.y)); ctx.lineTo(k(rot.x), k(rot.y));
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 * d; ctx.stroke(); ctx.lineWidth = 1;
    for (const h of hs) {
      ctx.beginPath();
      if (h.id === "rot") ctx.arc(k(h.x), k(h.y), 7 * d, 0, Math.PI * 2);
      else ctx.rect(k(h.x) - 5.5 * d, k(h.y) - 5.5 * d, 11 * d, 11 * d);
      ctx.fillStyle = h.id === "rot" ? "#ff7a59" : "#fff"; ctx.fill();
      ctx.strokeStyle = "#000a"; ctx.lineWidth = 1.5 * d; ctx.stroke(); ctx.lineWidth = 1;
    }
  }

  // brush cursor (also the spot under the pointer on the 3D model)
  const cursors = [];
  if (S.hover && !drag && ["pencil", "eraser", "shade", "contour"].includes(S.tool)) cursors.push(...brushPoints(S.hover[0], S.hover[1]));
  else if (S.hover && !drag && ["fill", "picker", "line", "rect", "ellipse", "wand", "gradient", "spray"].includes(S.tool)) cursors.push(S.hover);
  if (S.hover3d) cursors.push(S.hover3d);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  for (const [x, y] of cursors) {
    if (!doc.inBounds(x, y) && !tileOn()) continue;
    ctx.strokeRect(px(ox + x * z), px(oy + y * z), Math.round(z) - 1, Math.round(z) - 1);
  }
  if (in3D()) renderFlat();
  updateStatus();
}

// small flat copy of the texture shown in the side panel while painting in 3D
function renderFlat() {
  const fc = $("#flat"), g = fc.getContext("2d"), s = fc.width / 64;
  g.clearRect(0, 0, fc.width, fc.height);
  g.imageSmoothingEnabled = false;
  g.drawImage(compCanvas, 0, 0, fc.width, fc.height);
  g.fillStyle = "rgba(12,10,16,0.55)";
  for (const [x, y, w, h] of unusedRects()) g.fillRect(x * s, y * s, w * s, h * s);
  g.fillStyle = "rgba(12,10,16,0.7)";
  for (const [x, y, w, h] of lockedRects()) g.fillRect(x * s, y * s, w * s, h * s);
  if (S.hover3d) {
    g.lineWidth = 2; g.strokeStyle = "#fff";
    for (const [x, y] of mirrored(S.hover3d[0], S.hover3d[1])) g.strokeRect(x * s + 1, y * s + 1, s - 2, s - 2);
  }
}

function setSkinView(v) {
  if (v === "3d" && !preview) { toast("The 3D view needs WebGL, which this browser has turned off."); v = "2d"; }
  S.sv = v;
  document.body.dataset.sv = v;
  $$("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.sv === v));
  const wrap = $(".preview3d"), flat = $("#flat");
  if (wrap) {
    if (v === "3d") {
      stage.insertBefore(wrap, $("#viewSeg"));
      flat.hidden = false;
      $("#pvHint").textContent = "Draw on the model. Drag the background or right-drag to turn. Scroll or pinch to zoom.";
    } else {
      $("#skinCard").insertBefore(wrap, flat);
      flat.hidden = true;
      $("#pvHint").textContent = "Drag the background to turn. Draw on the model.";
    }
  }
  if (preview) { preview.setGrid(v === "3d" && S.grid); preview.requestDraw(); }
  $$("#toolList button").forEach((b) => b.classList.toggle("no3d", v === "3d" && !PAINT_ON_3D.has(b.dataset.tool)));
  if (doc && doc.mode === "skin" && v === "3d" && !PAINT_ON_3D.has(S.tool)) setTool("pencil");
  persistPrefs();
  requestRender();
}

// ---------------------------------------------------------------- drawing helpers
function brushPoints(x, y) {
  if (S.brush && (S.tool === "pencil" || S.tool === "eraser")) {
    const b = S.brush, ox = Math.floor(b.w / 2), oy = Math.floor(b.h / 2), out = [];
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) if (b.px[(j * b.w + i) * 4 + 3]) out.push([x - ox + i, y - oy + j]);
    return out;
  }
  const s = S.pSize || S.size, o = Math.floor((s - 1) / 2), out = [];
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) out.push([x - o + i, y - o + j]);
  return out;
}
function mirrored(x, y) {
  const pts = [[x, y]];
  if (doc.mode === "skin") {
    if (S.mirrorX) { const m = mirrorTexel(doc.model, x, y); if (m) pts.push(m); }
    return pts;
  }
  if (S.mirrorX) pts.push([doc.w - 1 - x, y]);
  if (S.mirrorY) pts.push([x, doc.h - 1 - y]);
  if (S.mirrorX && S.mirrorY) pts.push([doc.w - 1 - x, doc.h - 1 - y]);
  return pts;
}

let strokeTouched = null;
function plot(x, y, color) {
  [x, y] = wrapXY(x, y);
  const dm = S.tool === "shade" ? null : DITHER[S.dither];
  for (const [mx, my] of mirrored(x, y)) {
    if (!doc.inBounds(mx, my) || !canPaint(mx, my) || !inSel(mx, my)) continue;
    if (dm && !dm(mx, my)) continue;
    if (S.tool !== "shade" && S.tool !== "eraser" && S.ink !== "simple" && Array.isArray(color)) {
      const k = (my * doc.w + mx) * 4, px = doc.layer.px, cur = [px[k], px[k + 1], px[k + 2], px[k + 3]];
      if (S.ink === "behind") { if (cur[3] > 0) continue; doc.paint(mx, my, color); continue; }
      if (S.ink === "blend") {
        if (color[3] >= 255 || cur[3] === 0) { doc.paint(mx, my, color); continue; }
        const sa = color[3] / 255, da = cur[3] / 255, oa = sa + da * (1 - sa);
        doc.paint(mx, my, [0, 1, 2].map((c) => Math.round((color[c] * sa + cur[c] * da * (1 - sa)) / oa)).concat(Math.round(oa * 255)));
        continue;
      }
      if (S.ink === "shading") {
        const kk = my * doc.w + mx;
        if (strokeTouched.has(kk) || cur[3] === 0) continue;
        strokeTouched.add(kk);
        const list = (doc.palette && S.palette === DOC_PAL) ? doc.palette : PALETTES[S.palette] || [];
        const at = list.indexOf(rgbaToHex(cur));
        if (at < 0) continue;
        const next = list[Math.max(0, Math.min(list.length - 1, at + inkDir))];
        doc.paint(mx, my, [...hexToRgba(next).slice(0, 3), cur[3]]);
        continue;
      }
    }
    if (S.tool === "shade") {
      const k = my * doc.w + mx;
      if (strokeTouched.has(k)) continue;
      strokeTouched.add(k);
      const c = doc.get(doc.layer.px, mx, my);
      if (c[3] === 0) continue;
      let nc = shadeColor(c, color === "lighter" ? 0.14 : -0.14);
      if (doc.palette) {
        // indexed: step to the next lighter/darker palette colour instead of a new colour
        const lum = (q) => 0.299 * q[0] + 0.587 * q[1] + 0.114 * q[2], cur = lum(c), up = color === "lighter";
        const cand = doc.palette.map((h) => hexToRgba(h)).filter((q) => (up ? lum(q) > cur + 1 : lum(q) < cur - 1));
        if (!cand.length) continue;
        nc = cand.reduce((a, q) => (Math.abs(lum(q) - cur) < Math.abs(lum(a) - cur) ? q : a));
        nc = [nc[0], nc[1], nc[2], c[3]];
      }
      doc.paint(mx, my, nc);
    } else doc.paint(mx, my, color);
  }
}
// Pixel-perfect strokes: when a freehand line makes an L-shaped corner, drop the corner pixel.
function perfectPush(x, y) {
  const p = drag.path, last = p[p.length - 1];
  if (last && last[0] === x && last[1] === y) return;
  stamp(x, y, drag.color);
  p.push([x, y]);
  if (p.length < 3) return;
  const [a, b, c] = p.slice(-3);
  if (Math.abs(a[0] - c[0]) === 1 && Math.abs(a[1] - c[1]) === 1 && (b[0] === a[0] || b[1] === a[1]) && (b[0] === c[0] || b[1] === c[1])) {
    const [bx, by] = wrapXY(b[0], b[1]);
    for (const [mx, my] of mirrored(bx, by)) {
      if (!doc.inBounds(mx, my)) continue;
      const k = (my * doc.w + mx) * 4;
      doc.layer.px.set(drag.base.subarray(k, k + 4), k);
    }
    p.splice(p.length - 2, 1);
  }
}
let inkDir = 1, brushOwn = true;
function stamp(x, y, color) {
  if (S.brush && (S.tool === "pencil" || S.tool === "eraser")) {
    // custom brush: its own colours on left click, a solid shape in the right-click colour
    const b = S.brush, ox = Math.floor(b.w / 2), oy = Math.floor(b.h / 2);
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
      const k = (j * b.w + i) * 4;
      if (!b.px[k + 3]) continue;
      plot(x - ox + i, y - oy + j, S.tool === "eraser" ? [0, 0, 0, 0] : brushOwn ? [b.px[k], b.px[k + 1], b.px[k + 2], b.px[k + 3]] : color);
    }
    return;
  }
  for (const [bx, by] of brushPoints(x, y)) plot(bx, by, color);
}
// ---- selection shape helpers (a selection is a box, optionally with a full-canvas mask)
function inSel(x, y) {
  const s = S.sel;
  if (!s || s.float || SELECT_TOOLS.has(S.tool)) return true;
  if (x < s.x || y < s.y || x >= s.x + s.w || y >= s.y + s.h) return false;
  return !s.mask || s.mask[y * doc.w + x] === 1;
}
function selMask() {
  const s = S.sel;
  if (!s) return null;
  if (s.mask && !s.float) return s.mask;
  const r = s.float || s, m = new Uint8Array(doc.w * doc.h);
  for (let y = Math.max(0, r.y); y < Math.min(doc.h, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(doc.w, r.x + r.w); x++) m[y * doc.w + x] = 1;
  return m;
}
function selFromMask(m) {
  let x0 = doc.w, y0 = doc.h, x1 = -1, y1 = -1;
  for (let y = 0; y < doc.h; y++) for (let x = 0; x < doc.w; x++) if (m[y * doc.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, mask: m, float: null };
}
function combineMask(prev, next, mode) {
  if (!prev || mode === "new") return next;
  const out = new Uint8Array(prev.length);
  for (let k = 0; k < out.length; k++) out[k] = mode === "add" ? (prev[k] || next[k] ? 1 : 0) : (prev[k] && !next[k] ? 1 : 0);
  return out;
}
function rectMask(x, y, w, h) { const m = new Uint8Array(doc.w * doc.h); for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (doc.inBounds(i, j)) m[j * doc.w + i] = 1; return m; }
function polyMask(pts) {
  const m = new Uint8Array(doc.w * doc.h);
  if (pts.length < 3) return m;
  let y0 = Infinity, y1 = -Infinity;
  for (const [, py] of pts) { y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(doc.h - 1, Math.ceil(y1)); y++) {
    const cy = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + (cy - ay) * (bx - ax) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(doc.w - 1, Math.floor(xs[k + 1] - 0.5)); x++) m[y * doc.w + x] = 1;
  }
  return m;
}
function wandMask(x, y) {
  const m = new Uint8Array(doc.w * doc.h);
  if (!doc.inBounds(x, y)) return m;
  const px = doc.layer.px, w = doc.w, k0 = (y * w + x) * 4;
  const t = [px[k0], px[k0 + 1], px[k0 + 2], px[k0 + 3]];
  const same = (k) => (t[3] === 0 ? px[k + 3] === 0 : px[k] === t[0] && px[k + 1] === t[1] && px[k + 2] === t[2] && px[k + 3] === t[3]);
  const st = [x, y];
  while (st.length) {
    const cy = st.pop(), cx = st.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= doc.h) continue;
    const i = cy * w + cx;
    if (m[i] || !same(i * 4)) continue;
    m[i] = 1; st.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }
  return m;
}
function selEdges(sel) {
  if (sel._edges) return sel._edges;
  const m = sel.mask, w = doc.w, segs = [];
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < doc.h && m[y * w + x];
  for (let y = sel.y; y < sel.y + sel.h; y++) for (let x = sel.x; x < sel.x + sel.w; x++) {
    if (!on(x, y)) continue;
    if (!on(x, y - 1)) segs.push(x, y, x + 1, y);
    if (!on(x, y + 1)) segs.push(x, y + 1, x + 1, y + 1);
    if (!on(x - 1, y)) segs.push(x, y, x, y + 1);
    if (!on(x + 1, y)) segs.push(x + 1, y, x + 1, y + 1);
  }
  sel._edges = segs;
  return segs;
}
function showSel(sel) { S.sel = sel; $("#selBar").hidden = !sel; requestRender(); }

function strokeColor(button) {
  if (S.tool === "eraser") return [0, 0, 0, 0];
  if (S.tool === "shade") return button === 2 ? "darker" : "lighter";
  const c = (button === 2 ? S.secondary : S.primary).slice();
  if (doc.palette && c[3] > 0) return [...nearPal()(c[0], c[1], c[2]).slice(0, 3), 255]; // indexed: palette colours only
  return c;
}

function fillAt(x, y, color, global) {
  [x, y] = wrapXY(x, y);
  for (const [mx, my] of mirrored(x, y)) {
    let bounds = null;
    if (doc.mode === "skin") {
      const f = faceAt(doc.model, mx, my);
      bounds = f ? f.rect : null;
      if (!f || !canPaint(mx, my)) continue;
    }
    const dm = DITHER[S.dither];
    doc.fill(mx, my, color, bounds, global, { mask: S.sel && !S.sel.float ? (a, b) => inSel(a, b) && (!dm || dm(a, b)) : dm, wrap: tileOn() });
  }
}

function pickAt(x, y, button) {
  [x, y] = wrapXY(x, y);
  if (!doc.inBounds(x, y)) return;
  const c = doc.get(doc.composite(), x, y);
  if (button === 2) S.secondary = c; else S.primary = c;
  syncColors();
}

// ---------------------------------------------------------------- selection
function commitFloat() {
  const sel = S.sel;
  if (!sel || !sel.float) return;
  const f = sel.float, px = doc.layer.px;
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
    const x = f.x + i, y = f.y + j;
    if (!doc.inBounds(x, y)) continue;
    const s = (j * f.w + i) * 4;
    if (f.px[s + 3] === 0) continue;
    const t = (y * doc.w + x) * 4;
    px[t] = f.px[s]; px[t + 1] = f.px[s + 1]; px[t + 2] = f.px[s + 2]; px[t + 3] = f.px[s + 3];
  }
  sel.x = f.x; sel.y = f.y; sel.w = f.w; sel.h = f.h;
  if (sel.mask) {
    // a shaped selection follows its pixels to where they were dropped
    const m = new Uint8Array(doc.w * doc.h);
    for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) if (doc.inBounds(f.x + i, f.y + j) && f.px[(j * f.w + i) * 4 + 3]) m[(f.y + j) * doc.w + f.x + i] = 1;
    sel.mask = m; sel._edges = null;
    const nb = selFromMask(m);
    if (nb) Object.assign(sel, { x: nb.x, y: nb.y, w: nb.w, h: nb.h });
  }
  sel.float = null;
  doc.emit();
}
function clearSelection() { commitFloat(); S.sel = null; $("#selBar").hidden = true; requestRender(); }
function selRect() { const s = S.sel; return s ? (s.float || s) : null; }
function regionPx(x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4), px = doc.layer.px;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!doc.inBounds(x + i, y + j)) continue;
    if (S.sel && S.sel.mask && !S.sel.float && !S.sel.mask[(y + j) * doc.w + x + i]) continue;
    const s = ((y + j) * doc.w + x + i) * 4, t = (j * w + i) * 4;
    out[t] = px[s]; out[t + 1] = px[s + 1]; out[t + 2] = px[s + 2]; out[t + 3] = px[s + 3];
  }
  return out;
}
function lift() {
  const s = S.sel;
  if (!s || s.float) return;
  doc.begin();
  s.float = { x: s.x, y: s.y, w: s.w, h: s.h, px: regionPx(s.x, s.y, s.w, s.h) };
  for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) if (!s.mask || s.mask[(s.y + j) * doc.w + s.x + i]) doc.set(s.x + i, s.y + j, [0, 0, 0, 0]);
  doc.emit();
}
function selAction(a) {
  if (S.sel && S.sel.float) S.sel.float.src = null;
  const s = S.sel;
  if (!s) return;
  if (a === "done") return clearSelection();
  if (a === "copy") {
    const r = selRect();
    S.clip = { w: r.w, h: r.h, px: s.float ? s.float.px.slice() : regionPx(r.x, r.y, r.w, r.h) };
    toast("Copied. Ctrl+V pastes.");
    return;
  }
  if (a === "delete") {
    if (s.float) { s.float = null; doc.emit(); }
    else { doc.begin(); for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) if (!s.mask || s.mask[(s.y + j) * doc.w + s.x + i]) doc.set(s.x + i, s.y + j, [0, 0, 0, 0]); doc.emit(); }
    S.sel = null; $("#selBar").hidden = true; requestRender();
    return;
  }
  if (a === "flipH" || a === "flipV") {
    lift();
    const f = s.float, out = new Uint8ClampedArray(f.px.length);
    for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
      const si = a === "flipH" ? f.w - 1 - i : i, sj = a === "flipV" ? f.h - 1 - j : j;
      out.set(f.px.subarray((sj * f.w + si) * 4, (sj * f.w + si) * 4 + 4), (j * f.w + i) * 4);
    }
    f.px = out; requestRender();
  }
  if (a === "rotL" || a === "rotR") {
    lift();
    const f = s.float, nw = f.h, nh = f.w, out = new Uint8ClampedArray(f.px.length);
    for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
      const [ti, tj] = a === "rotR" ? [nw - 1 - j, i] : [j, nh - 1 - i];
      out.set(f.px.subarray((j * f.w + i) * 4, (j * f.w + i) * 4 + 4), (tj * nw + ti) * 4);
    }
    f.x += Math.floor((f.w - nw) / 2); f.y += Math.floor((f.h - nh) / 2);
    f.w = nw; f.h = nh; f.px = out; requestRender();
  }
  if (a === "transform") transformDialog();
  if (a === "invert") {
    commitFloat();
    const m = selMask(), inv = new Uint8Array(m.length);
    for (let k = 0; k < m.length; k++) inv[k] = m[k] ? 0 : 1;
    showSel(selFromMask(inv));
  }
  if (a === "brush") {
    const r = selRect();
    let px = s.float ? s.float.px : regionPx(r.x, r.y, r.w, r.h), w = r.w, h = r.h;
    // trim see-through edges
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (px[(j * w + i) * 4 + 3]) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j); }
    if (x1 < 0) return toast("The selection is empty.");
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, bpx = new Uint8ClampedArray(bw * bh * 4);
    for (let j = 0; j < bh; j++) bpx.set(px.subarray(((y0 + j) * w + x0) * 4, ((y0 + j) * w + x1 + 1) * 4), j * bw * 4);
    S.brush = { w: bw, h: bh, px: bpx };
    clearSelection(); setTool("pencil"); syncBrushChip();
    toast("Custom brush ready: left click stamps its colours, right click stamps its shape in your right-click colour.");
  }
}
// nearest-neighbour scale + rotate, so pixels stay crisp
// Handle positions in CSS pixels on the view: 8 around the box plus a rotate knob above it.
function selHandles() {
  const sel = S.sel;
  if (!sel || !SELECT_TOOLS.has(S.tool) || in3D() || (drag && drag.kind !== "seltf")) return null;
  const r = sel.float || selRect();
  if (!r || r.w < 1 || r.h < 1) return null;
  const x0 = S.panX + r.x * S.zoom, y0 = S.panY + r.y * S.zoom, x1 = x0 + r.w * S.zoom, y1 = y0 + r.h * S.zoom;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const hs = [
    { id: "nw", x: x0, y: y0 }, { id: "n", x: mx, y: y0 }, { id: "ne", x: x1, y: y0 }, { id: "e", x: x1, y: my },
    { id: "se", x: x1, y: y1 }, { id: "s", x: mx, y: y1 }, { id: "sw", x: x0, y: y1 }, { id: "w", x: x0, y: my },
  ];
  if (r.w * S.zoom < 24 || r.h * S.zoom < 24) hs.splice(0, hs.length, hs[0], hs[2], hs[4], hs[6], hs[1]); // tiny box: corners only (n kept for the knob line)
  hs.push({ id: "rot", x: mx, y: y0 - 28 });
  return hs;
}
function handleAt(e) {
  const hs = selHandles(); if (!hs) return null;
  const r = view.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const reach = e.pointerType === "mouse" ? 9 : 20;
  let best = null, bd = reach;
  for (const h of hs) { const dd = Math.hypot(h.x - x, h.y - y); if (dd <= bd) { bd = dd; best = h; } }
  return best;
}
function startHandleDrag(h, e) {
  lift();
  const f = S.sel.float;
  if (!f.src) { f.src = { px: f.px, w: f.w, h: f.h }; f.tw = f.w; f.th = f.h; f.deg = 0; }
  const r = view.getBoundingClientRect();
  drag = { kind: "seltf", id: h.id, sx: e.clientX - r.left, sy: e.clientY - r.top, box: { x: f.x, y: f.y, w: f.w, h: f.h }, tw: f.tw, th: f.th, deg: f.deg, keep: true };
  requestRender();
}
function moveHandleDrag(e) {
  const f = S.sel.float, g = drag, r = view.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const cx = S.panX + (g.box.x + g.box.w / 2) * S.zoom, cy = S.panY + (g.box.y + g.box.h / 2) * S.zoom;
  let tw = g.tw, th = g.th, deg = g.deg;
  if (g.id === "rot") {
    deg = g.deg + (Math.atan2(y - cy, x - cx) - Math.atan2(g.sy - cy, g.sx - cx)) * 180 / Math.PI;
    const snap = Math.round(deg / 15) * 15;
    if (Math.abs(deg - snap) < 4 || e.shiftKey) deg = snap;
    deg = ((Math.round(deg) % 360) + 360) % 360;
  } else if (!g.deg) {
    // unrotated: drag the edge, the opposite side stays put
    const dx = (x - g.sx) / S.zoom, dy = (y - g.sy) / S.zoom;
    let w = g.box.w + (g.id.includes("e") ? dx : g.id.includes("w") ? -dx : 0);
    let h = g.box.h + (g.id.includes("s") ? dy : g.id.includes("n") ? -dy : 0);
    if (g.id.length === 2 && !e.shiftKey) { const k = Math.max(w / g.box.w, h / g.box.h); w = g.box.w * k; h = g.box.h * k; } // corners keep the shape
    tw = Math.max(1, Math.min(1024, Math.round(w))); th = Math.max(1, Math.min(1024, Math.round(h)));
  } else {
    // rotated: scale evenly from the middle by how far the finger moved from it
    const k = Math.hypot(x - cx, y - cy) / Math.max(1, Math.hypot(g.sx - cx, g.sy - cy));
    tw = Math.max(1, Math.min(1024, Math.round(g.tw * (g.id === "n" || g.id === "s" ? 1 : k))));
    th = Math.max(1, Math.min(1024, Math.round(g.th * (g.id === "e" || g.id === "w" ? 1 : k))));
    if (g.id.length === 2) { tw = Math.max(1, Math.round(g.tw * k)); th = Math.max(1, Math.round(g.th * k)); }
  }
  if (tw === f.tw && th === f.th && deg === f.deg) return;
  const t = transformPx(f.src.px, f.src.w, f.src.h, tw, th, deg);
  f.tw = tw; f.th = th; f.deg = deg; f.px = t.px; f.w = t.w; f.h = t.h;
  if (g.id === "rot" || g.deg) { f.x = Math.round(g.box.x + g.box.w / 2 - t.w / 2); f.y = Math.round(g.box.y + g.box.h / 2 - t.h / 2); }
  else {
    f.x = g.id.includes("w") ? g.box.x + g.box.w - t.w : g.id.includes("e") ? g.box.x : Math.round(g.box.x + (g.box.w - t.w) / 2);
    f.y = g.id.includes("n") ? g.box.y + g.box.h - t.h : g.id.includes("s") ? g.box.y : Math.round(g.box.y + (g.box.h - t.h) / 2);
    if (g.id.length === 2) { /* corners: anchored on both axes above */ }
  }
  toastHint(g.id === "rot" ? `${deg}°` : `${tw} × ${th}`);
  requestRender();
}
let hintEl = null;
function toastHint(text) {
  if (!hintEl) { hintEl = document.createElement("div"); hintEl.className = "tfHint"; document.body.appendChild(hintEl); }
  hintEl.textContent = text; hintEl.hidden = !text;
}
function transformPx(src, w, h, nw, nh, deg) {
  const scaled = new Uint8ClampedArray(nw * nh * 4);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
    const si = Math.min(w - 1, Math.floor((i + 0.5) * w / nw)), sj = Math.min(h - 1, Math.floor((j + 0.5) * h / nh));
    scaled.set(src.subarray((sj * w + si) * 4, (sj * w + si) * 4 + 4), (j * nw + i) * 4);
  }
  const r = ((deg % 360) + 360) % 360;
  if (!r) return { px: scaled, w: nw, h: nh };
  const t = r * Math.PI / 180, cos = Math.cos(t), sin = Math.sin(t);
  const rw = Math.max(1, Math.round(Math.abs(nw * cos) + Math.abs(nh * sin))), rh = Math.max(1, Math.round(Math.abs(nw * sin) + Math.abs(nh * cos)));
  const out = new Uint8ClampedArray(rw * rh * 4);
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
    const dx = i + 0.5 - rw / 2, dy = j + 0.5 - rh / 2;
    const sx = Math.floor(dx * cos + dy * sin + nw / 2), sy = Math.floor(-dx * sin + dy * cos + nh / 2);
    if (sx < 0 || sy < 0 || sx >= nw || sy >= nh) continue;
    out.set(scaled.subarray((sy * nw + sx) * 4, (sy * nw + sx) * 4 + 4), (j * rw + i) * 4);
  }
  return { px: out, w: rw, h: rh };
}
// Resize layer: select what's on the layer and open Scale / rotate on it.
function resizeLayer() {
  if (doc.layer.tilemap) { toast("Tilemap layers resize by their tiles. Use Canvas size instead."); return; }
  commitFloat();
  const px = doc.layer.px;
  let x0 = doc.w, y0 = doc.h, x1 = -1, y1 = -1;
  for (let y = 0; y < doc.h; y++) for (let x = 0; x < doc.w; x++) if (px[(y * doc.w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { toast("This layer is empty."); return; }
  setTool("select");
  S.sel = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, float: null };
  $("#selBar").hidden = false;
  lift(); requestRender();
  toast("Drag a corner to scale, an edge to stretch, the orange knob to rotate. Done puts it down. Scale / rotate… takes exact numbers.");
}
async function transformDialog() {
  const s = S.sel;
  if (!s) return;
  lift();
  const f = s.float;
  const r = await dialog(`<h2>Scale / rotate selection</h2>
    <div class="grid2">
      <label for="tfW">Width</label><input type="number" id="tfW" min="1" max="1024" value="${f.w}">
      <label for="tfH">Height</label><input type="number" id="tfH" min="1" max="1024" value="${f.h}">
      <label for="tfKeep">Keep shape</label><input type="checkbox" id="tfKeep" checked>
      <label for="tfDeg">Rotate (degrees)</label><input type="number" id="tfDeg" min="-360" max="360" value="0">
    </div>
    <p class="dim">Pixels are copied, never blended, so edges stay sharp. Small angles on tiny sprites look jagged; 90° turns are clean.</p>
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Apply</button></div>`,
  () => ({ w: +$("#tfW").value, h: +$("#tfH").value, deg: +$("#tfDeg").value }),
  (form) => {
    const W = form.querySelector("#tfW"), H = form.querySelector("#tfH"), K = form.querySelector("#tfKeep");
    W.addEventListener("input", () => { if (K.checked) H.value = Math.max(1, Math.round(W.value * f.h / f.w)); });
    H.addEventListener("input", () => { if (K.checked) W.value = Math.max(1, Math.round(H.value * f.w / f.h)); });
  });
  if (!r || r.value !== "ok") return;
  const nw = Math.max(1, Math.min(1024, r.data.w | 0)), nh = Math.max(1, Math.min(1024, r.data.h | 0));
  const t = transformPx(f.px, f.w, f.h, nw, nh, r.data.deg || 0);
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  f.px = t.px; f.w = t.w; f.h = t.h; f.x = Math.round(cx - t.w / 2); f.y = Math.round(cy - t.h / 2); f.src = null;
  $("#selBar").hidden = false;
  requestRender();
}
function syncBrushChip() {
  const b = $("#brushChip");
  b.hidden = !S.brush;
  if (S.brush) b.textContent = `Brush ${S.brush.w}×${S.brush.h} ✕`;
}
function pasteClip(clip) {
  if (!clip) return;
  clearSelection();
  setTool("select");
  doc.begin();
  const r = stage.getBoundingClientRect();
  let x = Math.floor((r.width / 2 - S.panX) / S.zoom - clip.w / 2), y = Math.floor((r.height / 2 - S.panY) / S.zoom - clip.h / 2);
  x = Math.max(0, Math.min(doc.w - clip.w, x)); y = Math.max(0, Math.min(doc.h - clip.h, y));
  S.sel = { x, y, w: clip.w, h: clip.h, float: { x, y, w: clip.w, h: clip.h, px: clip.px.slice() } };
  $("#selBar").hidden = false;
  doc.emit();
}

function sprayAt(d) {
  const r = Math.max(2, (S.pSize || S.size) * 2 + 1), n = Math.max(2, Math.round(r * r * 0.12));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, q = Math.sqrt(Math.random()) * r;
    plot(Math.floor(d.x + Math.cos(a) * q), Math.floor(d.y + Math.sin(a) * q), d.color);
  }
}
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function drawGradient(d, ex, ey, snap) {
  let [sx, sy] = d.start;
  let dx = ex - sx, dy = ey - sy;
  if (snap) { const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy); dx = Math.cos(ang) * len; dy = Math.sin(ang) * len; }
  doc.layer.px.set(d.base);
  const L2 = dx * dx + dy * dy;
  if (L2 < 1) { doc.emit(); return; }
  for (let y = 0; y < doc.h; y++) for (let x = 0; x < doc.w; x++) {
    if (!inSel(x, y) || !canPaint(x, y)) continue;
    const t = Math.max(0, Math.min(1, ((x + 0.5 - sx) * dx + (y + 0.5 - sy) * dy) / L2));
    const c = t < (BAYER4[(y % 4) * 4 + (x % 4)] + 0.5) / 16 ? d.a : d.b;
    if (c[3] === 0) continue; // fading to see-through keeps what was there
    doc.paint(x, y, c);
  }
  doc.emit();
}

// ---------------------------------------------------------------- pointer input (2D)
let drag = null;
const pointers = new Map();
// Once an Apple Pencil (or any pen) has touched the screen, fingers stop drawing:
// one finger pans / turns, two pinch-zoom. That keeps a resting palm from painting.
let penSeen = false;
window.addEventListener("pointerdown", (e) => { if (e.pointerType === "pen") penSeen = true; }, true);
const fingerOnly = (e) => e.pointerType === "touch" && penSeen;

// Line lock: after the first pixel of movement the stroke picks across or down and sticks to it.
function lockAxis(d, x, y, shift) {
  if (!(S.lineLock || shift)) return [x, y];
  const [sx, sy] = d.start;
  if (!d.axis) {
    const dx = x - sx, dy = y - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 1) return [sx, sy];
    d.axis = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
  }
  return d.axis === "h" ? [x, sy] : [sx, y];
}
let spaceDown = false, altDown = false;

view.addEventListener("contextmenu", (e) => e.preventDefault());
view.addEventListener("pointerdown", (e) => {
  view.focus({ preventScroll: true });
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (document.body.classList.contains("focus")) { closeFocusMenu(); document.body.classList.add("drawing"); }
  if (pointers.size === 3 && drag && drag.kind === "pinch") drag.three = true;
  try { view.setPointerCapture(e.pointerId); } catch {}
  if (pointers.size === 2) {
    // second finger: stop drawing, switch to pinch zoom / pan
    if (drag && drag.kind === "stroke") { doc.undo(); doc.redoStack.length = 0; }
    const [a, b] = [...pointers.values()];
    drag = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], zoom: S.zoom, panX: S.panX, panY: S.panY, t0: performance.now(), moved: false };
    return;
  }
  if (pointers.size > 2) return;
  if (e.button === 1 || spaceDown || fingerOnly(e)) {
    drag = { kind: "pan", x: e.clientX, y: e.clientY, panX: S.panX, panY: S.panY };
    return;
  }
  const [x, y, fx, fy] = toDoc(e);
  const button = e.button;
  S.pSize = S.pressure && e.pointerType === "pen" && e.pressure > 0 ? Math.max(1, Math.round(S.size * Math.min(1, e.pressure * 1.25))) : 0;
  inkDir = button === 2 ? -1 : 1; brushOwn = button !== 2;
  const tool = (altDown || e.altKey) && ["pencil", "fill", "line", "rect", "ellipse", "shade"].includes(S.tool) ? "picker" : S.tool;

  if (tool === "picker") { pickAt(x, y, button); drag = { kind: "picker", button }; return; }
  if (S.tileStamp && doc.layer.tilemap && !["select", "move"].includes(tool)) {
    doc.begin(); stampTile(x, y, button === 2 ? 0 : S.tilePick);
    drag = { kind: "tiles", idx: button === 2 ? 0 : S.tilePick };
    return;
  }
  if (tool === "pencil" || tool === "eraser" || tool === "shade") {
    doc.begin(); strokeTouched = new Set();
    const color = strokeColor(button);
    if (tool === "pencil") pushRecent(color);
    stamp(x, y, color);
    const perfect = S.perfect && S.size === 1 && tool !== "shade";
    drag = { kind: "stroke", last: [x, y], start: [x, y], axis: null, color, perfect, path: [[x, y]], base: perfect ? doc.layer.px.slice() : null };
    doc.emit();
    return;
  }
  if (tool === "fill") {
    doc.begin(); fillAt(x, y, strokeColor(button), e.shiftKey); doc.cancelIfUnchanged(); doc.emit(); tilemapAfterPaint();
    return;
  }
  if (tool === "line" || tool === "rect" || tool === "ellipse") {
    doc.begin();
    drag = { kind: "shape", start: [x, y], base: doc.layer.px.slice(), color: strokeColor(button) };
    drawShape(x, y, e.shiftKey);
    return;
  }
  if (tool === "move") {
    doc.begin();
    drag = { kind: "move", start: [x, y], base: doc.layer.px.slice() };
    return;
  }
  if (SELECT_TOOLS.has(tool) && button === 0) {
    const h = handleAt(e);
    if (h) { startHandleDrag(h, e); return; }
  }
  if (SELECT_TOOLS.has(tool)) {
    const mode = e.shiftKey ? "add" : e.altKey || e.ctrlKey || e.metaKey || altDown ? "sub" : "new";
    const r = selRect();
    const inside = r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h && (S.sel.float || !S.sel.mask || S.sel.mask[y * doc.w + x]);
    if (mode === "new" && tool !== "wand" && inside) {
      lift();
      drag = { kind: "selmove", start: [x, y], orig: [S.sel.float.x, S.sel.float.y] };
      requestRender();
      return;
    }
    commitFloat();
    const prev = mode === "new" ? null : selMask();
    if (tool === "wand") { showSel(selFromMask(combineMask(prev, wandMask(x, y), mode))); return; }
    if (mode === "new") { S.sel = null; $("#selBar").hidden = true; }
    drag = tool === "lasso" ? { kind: "lasso", pts: [[fx, fy]], prev, mode } : { kind: "select", start: [x, y], prev, mode };
    if (tool === "select" && mode === "new") S.sel = { x, y, w: 1, h: 1, float: null };
    requestRender();
    return;
  }
  if (tool === "spray") {
    doc.begin(); strokeTouched = new Set();
    const color = strokeColor(button);
    drag = { kind: "spray", x: fx, y: fy, color };
    sprayAt(drag);
    drag.timer = setInterval(() => { if (drag && drag.kind === "spray") { sprayAt(drag); doc.emit(); } }, 45);
    doc.emit();
    return;
  }
  if (tool === "gradient") {
    doc.begin();
    drag = { kind: "gradient", start: [fx, fy], base: doc.layer.px.slice(), a: (button === 2 ? S.secondary : S.primary).slice(), b: (button === 2 ? S.primary : S.secondary).slice() };
    return;
  }
  if (tool === "contour") {
    doc.begin(); strokeTouched = new Set();
    drag = { kind: "contour", pts: [[x, y]], base: doc.layer.px.slice(), color: strokeColor(button) };
    plot(x, y, drag.color); doc.emit();
    return;
  }
  if (tool === "slice") {
    const hit = [...doc.slices].reverse().find((sl) => x >= sl.x && y >= sl.y && x < sl.x + sl.w && y < sl.y + sl.h);
    if (hit) { sliceDialog(doc.slices.indexOf(hit)); return; }
    drag = { kind: "slice", start: [x, y], rect: { x, y, w: 1, h: 1 } };
    requestRender();
  }
});

view.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  let [x, y] = toDoc(e);
  const hv = doc.inBounds(x, y) || tileOn() ? [x, y] : null;
  if (!S.hover || !hv || S.hover[0] !== x || S.hover[1] !== y) { S.hover = hv; requestRender(); }
  if (!drag) return;
  if (drag.kind === "pinch") {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    if (Math.abs(dist - drag.dist) > 12 || Math.hypot(mid[0] - drag.mid[0], mid[1] - drag.mid[1]) > 12) drag.moved = true;
    const r = view.getBoundingClientRect();
    const nz = Math.max(0.5, Math.min(96, drag.zoom * dist / drag.dist));
    const cx = drag.mid[0] - r.left, cy = drag.mid[1] - r.top;
    S.zoom = nz;
    S.panX = cx - (cx - drag.panX) * (nz / drag.zoom) + (mid[0] - drag.mid[0]);
    S.panY = cy - (cy - drag.panY) * (nz / drag.zoom) + (mid[1] - drag.mid[1]);
    requestRender();
    return;
  }
  if (drag.kind === "pan") {
    S.panX = drag.panX + e.clientX - drag.x; S.panY = drag.panY + e.clientY - drag.y; requestRender(); return;
  }
  if (drag.kind === "picker") { pickAt(x, y, drag.button); return; }
  if (S.pressure && e.pointerType === "pen" && e.pressure > 0) S.pSize = Math.max(1, Math.round(S.size * Math.min(1, e.pressure * 1.25)));
  if (drag.kind === "spray") { const [, , fx, fy] = toDoc(e); drag.x = fx; drag.y = fy; sprayAt(drag); doc.emit(); return; }
  if (drag.kind === "gradient") { const [, , fx, fy] = toDoc(e); drawGradient(drag, fx, fy, e.shiftKey); return; }
  if (drag.kind === "contour") {
    const last = drag.pts[drag.pts.length - 1];
    if (last[0] === x && last[1] === y) return;
    drag.pts.push([x, y]);
    doc.layer.px.set(drag.base);
    for (let i = 1; i < drag.pts.length; i++) line(drag.pts[i - 1][0], drag.pts[i - 1][1], drag.pts[i][0], drag.pts[i][1], (a, b) => plot(a, b, drag.color));
    doc.emit();
    return;
  }
  if (drag.kind === "lasso") {
    const [, , fx, fy] = toDoc(e), l = drag.pts[drag.pts.length - 1];
    if (Math.hypot(fx - l[0], fy - l[1]) >= 0.35) { drag.pts.push([fx, fy]); requestRender(); }
    return;
  }
  if (drag.kind === "slice") {
    const [sx, sy] = drag.start;
    const cx = Math.max(0, Math.min(doc.w - 1, x)), cy = Math.max(0, Math.min(doc.h - 1, y));
    drag.rect = { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx) + 1, h: Math.abs(cy - sy) + 1 };
    requestRender();
    return;
  }
  if (drag.kind === "tiles") { stampTile(x, y, drag.idx); return; }
  if (drag.kind === "stroke") {
    [x, y] = lockAxis(drag, x, y, e.shiftKey);
    const [lx, ly] = drag.last;
    if (lx === x && ly === y) return;
    if (drag.perfect && !drag.axis) line(lx, ly, x, y, perfectPush);
    else line(lx, ly, x, y, (px, py) => stamp(px, py, drag.color));
    drag.last = [x, y];
    doc.emit();
    return;
  }
  if (drag.kind === "shape") { drawShape(x, y, e.shiftKey); return; }
  if (drag.kind === "move") {
    const dx = x - drag.start[0], dy = y - drag.start[1];
    const px = doc.layer.px, base = drag.base, w = doc.w, h = doc.h;
    px.fill(0);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const tx = i + dx, ty = j + dy;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const s = (j * w + i) * 4, t = (ty * w + tx) * 4;
      px[t] = base[s]; px[t + 1] = base[s + 1]; px[t + 2] = base[s + 2]; px[t + 3] = base[s + 3];
    }
    doc.emit();
    return;
  }
  if (drag.kind === "select") {
    const [sx, sy] = drag.start;
    const cx = Math.max(0, Math.min(doc.w - 1, x)), cy = Math.max(0, Math.min(doc.h - 1, y));
    const ax = Math.max(0, Math.min(doc.w - 1, sx)), ay = Math.max(0, Math.min(doc.h - 1, sy));
    const rx = Math.min(ax, cx), ry = Math.min(ay, cy), rw = Math.abs(cx - ax) + 1, rh = Math.abs(cy - ay) + 1;
    S.sel = drag.prev ? selFromMask(combineMask(drag.prev, rectMask(rx, ry, rw, rh), drag.mode)) || { x: rx, y: ry, w: 0, h: 0, mask: new Uint8Array(doc.w * doc.h), float: null } : { x: rx, y: ry, w: rw, h: rh, float: null };
    requestRender();
    return;
  }
  if (drag.kind === "seltf") { moveHandleDrag(e); return; }
  if (drag.kind === "selmove") {
    S.sel.float.x = drag.orig[0] + x - drag.start[0];
    S.sel.float.y = drag.orig[1] + y - drag.start[1];
    requestRender();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!pointers.size) document.body.classList.remove("drawing");
  if (!drag) return;
  if (drag.kind === "pinch") {
    if (pointers.size === 0) {
      // two-finger tap = undo, like most drawing apps on iPad
      if (!drag.moved && performance.now() - drag.t0 < 400) { clearSelection(); if (drag.three) { doc.redo(); toast("Redo"); } else { doc.undo(); toast("Undo"); } }
      drag = null;
    }
    return;
  }
  if (drag.kind === "stroke" || drag.kind === "shape" || drag.kind === "move") { doc.cancelIfUnchanged(); doc.emit(); tilemapAfterPaint(); }
  if (drag.kind === "tiles") doc.emit("structure");
  if (drag.kind === "spray") { clearInterval(drag.timer); doc.cancelIfUnchanged(); doc.emit(); tilemapAfterPaint(); }
  if (drag.kind === "gradient") { doc.cancelIfUnchanged(); doc.emit(); tilemapAfterPaint(); }
  if (drag.kind === "contour") {
    // close the shape and fill it
    doc.layer.px.set(drag.base);
    const pts = drag.pts.map(([a, b]) => [a + 0.5, b + 0.5]), m = polyMask(pts);
    for (let k = 0; k < m.length; k++) if (m[k]) plot(k % doc.w, Math.floor(k / doc.w), drag.color);
    for (let i = 0; i < drag.pts.length; i++) { const a = drag.pts[i], b = drag.pts[(i + 1) % drag.pts.length]; line(a[0], a[1], b[0], b[1], (u, v) => plot(u, v, drag.color)); }
    doc.cancelIfUnchanged(); doc.emit(); tilemapAfterPaint();
  }
  if (drag.kind === "lasso") {
    const m = polyMask(drag.pts);
    showSel(selFromMask(combineMask(drag.prev, m, drag.mode)) || (drag.mode === "new" ? null : S.sel));
    drag = null; requestRender(); return;
  }
  if (drag.kind === "slice") {
    const r = drag.rect; drag = null; requestRender();
    if (r.w > 1 || r.h > 1) addSlice(r);
    return;
  }
  if (drag.kind === "select") {
    if (S.sel && S.sel.w * S.sel.h <= 1 && drag.start && !drag.prev) { S.sel = null; }
    if (S.sel && S.sel.w === 0) S.sel = null;
    $("#selBar").hidden = !S.sel;
  }
  if (drag.kind === "selmove" || drag.kind === "seltf") $("#selBar").hidden = false;
  if (drag.kind === "seltf") toastHint("");
  drag = null;
  requestRender();
}
view.addEventListener("pointerup", endPointer);
view.addEventListener("pointercancel", endPointer);
view.addEventListener("pointerleave", () => { S.hover = null; requestRender(); });
view.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = view.getBoundingClientRect();
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX) && !e.shiftKey) {
    // trackpad pinch arrives as ctrl+wheel with small deltas
    if (e.ctrlKey && Math.abs(e.deltaY) < 20) zoomAt(S.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
  } else {
    S.panX -= e.deltaX || e.deltaY; requestRender();
  }
}, { passive: false });

function drawShape(x, y, constrain) {
  const [sx, sy] = drag.start;
  doc.layer.px.set(drag.base);
  let ex = x, ey = y;
  if (constrain) {
    const dx = x - sx, dy = y - sy;
    if (S.tool === "line") {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.max(Math.abs(dx), Math.abs(dy));
      ex = sx + Math.round(Math.cos(ang) * len); ey = sy + Math.round(Math.sin(ang) * len);
    } else {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      ex = sx + Math.sign(dx || 1) * m; ey = sy + Math.sign(dy || 1) * m;
    }
  }
  const put = (px, py) => stamp(px, py, drag.color);
  if (S.tool === "line") line(sx, sy, ex, ey, put);
  else if (S.tool === "rect") rectPoints(sx, sy, ex, ey, S.filled, (px, py) => plot(px, py, drag.color));
  else ellipsePoints(sx, sy, ex, ey, S.filled, (px, py) => plot(px, py, drag.color));
  doc.emit();
}

// ---------------------------------------------------------------- 3D preview input
function setupPreview() {
  const cv = $("#preview");
  try { preview = new SkinPreview(cv); }
  catch (err) { cv.replaceWith(Object.assign(document.createElement("p"), { className: "check warn", textContent: "3D preview needs WebGL, which this browser has turned off." })); return; }
  let pdrag = null;
  const touches = new Map();
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("pointerdown", (e) => {
    try { cv.setPointerCapture(e.pointerId); } catch {}
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) {
      // second finger: drop the stroke the first finger started, then pinch to zoom / drag to turn
      if (pdrag && pdrag.kind === "paint") { doc.undo(); doc.redoStack.length = 0; }
      const [a, b] = [...touches.values()];
      pdrag = { kind: "pinch", d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: preview.dist, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], mid0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], t0: performance.now(), moved: false };
      return;
    }
    if (touches.size > 2) return;
    const r = cv.getBoundingClientRect();
    const hit = e.button === 0 && PAINT_ON_3D.has(S.tool) && !e.shiftKey && !fingerOnly(e) ? preview.pick(e.clientX - r.left, e.clientY - r.top) : null;
    if (hit) {
      const [x, y] = hit;
      const button = e.button;
      if (S.tool === "picker" || e.altKey) { pickAt(x, y, button); pdrag = { kind: "pick", button }; return; }
      if (S.tool === "fill") { doc.begin(); fillAt(x, y, strokeColor(button), false); doc.cancelIfUnchanged(); doc.emit(); return; }
      doc.begin(); strokeTouched = new Set();
      const color = strokeColor(button);
      stamp(x, y, color); doc.emit();
      pdrag = { kind: "paint", last: [x, y], start: [x, y], axis: null, color };
      return;
    }
    pdrag = { kind: "orbit", x: e.clientX, y: e.clientY };
    cv.style.cursor = "grabbing";
  });
  cv.addEventListener("pointermove", (e) => {
    const r = cv.getBoundingClientRect();
    if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (pdrag && pdrag.kind === "pinch") {
      if (touches.size < 2) return;
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (Math.abs(d - pdrag.d) > 12 || Math.hypot(mid[0] - pdrag.mid0[0], mid[1] - pdrag.mid0[1]) > 12) pdrag.moved = true;
      preview.dist = Math.max(26, Math.min(160, pdrag.dist * pdrag.d / Math.max(1, d)));
      preview.orbit(mid[0] - pdrag.mid[0], mid[1] - pdrag.mid[1]);
      pdrag.mid = mid;
      return;
    }
    if (!pdrag || pdrag.kind !== "orbit") {
      const hit = PAINT_ON_3D.has(S.tool) ? preview.pick(e.clientX - r.left, e.clientY - r.top) : null;
      const changed = String(hit) !== String(S.hover3d);
      S.hover3d = hit;
      preview.setHover(hit ? mirrored(hit[0], hit[1]) : null);
      cv.style.cursor = hit ? "crosshair" : "grab";
      if (changed) requestRender();
      if (!pdrag) return;
      if (pdrag.kind === "pick" && hit) { pickAt(hit[0], hit[1], pdrag.button); return; }
      if (pdrag.kind === "paint" && hit) {
        const [lx, ly] = pdrag.last, [x, y] = lockAxis(pdrag, hit[0], hit[1], false);
        if (lx === x && ly === y) return;
        // connect with a line only when both points are on the same face, so strokes don't jump across the texture
        const fa = faceAt(doc.model, lx, ly), fb = faceAt(doc.model, x, y);
        if (fa && fb && fa.part === fb.part && fa.face === fb.face && fa.layer === fb.layer) line(lx, ly, x, y, (px, py) => stamp(px, py, pdrag.color));
        else stamp(x, y, pdrag.color);
        pdrag.last = [x, y];
        doc.emit();
      }
      return;
    }
    preview.orbit(e.clientX - pdrag.x, e.clientY - pdrag.y);
    pdrag.x = e.clientX; pdrag.y = e.clientY;
  });
  const end = (e) => {
    touches.delete(e.pointerId);
    if (pdrag && pdrag.kind === "pinch") {
      if (touches.size === 0) {
        if (!pdrag.moved && performance.now() - pdrag.t0 < 350) { doc.undo(); toast("Undo"); }
        pdrag = null;
      }
      return;
    }
    if (pdrag && pdrag.kind === "paint") { doc.cancelIfUnchanged(); doc.emit(); }
    pdrag = null; cv.style.cursor = "grab";
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", () => { preview.setHover(null); if (S.hover3d) { S.hover3d = null; requestRender(); } });
  cv.addEventListener("wheel", (e) => { e.preventDefault(); preview.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  $$(".pv-views button").forEach((b) => b.addEventListener("click", () => preview.view(b.dataset.view)));
  new ResizeObserver(() => preview.requestDraw()).observe(cv);

  $$("#pvTools [data-pv]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.pv === "undo") { clearSelection(); doc.undo(); }
    if (b.dataset.pv === "redo") { clearSelection(); doc.redo(); }
    if (b.dataset.pv === "outer") setOuter(!S.showOuter);
  }));
}

const PART_SHORT = { head: "Head", body: "Torso", rarm: "Right arm", larm: "Left arm", rleg: "Right leg", lleg: "Left leg" };
function buildIsoChips() {
  for (const box of $$("[data-iso-group]")) {
    box.innerHTML = "";
    for (const [id, label] of [[null, "Whole body"], ...PARTS.map((p) => [p.id, PART_SHORT[p.id]])]) {
      const b = document.createElement("button");
      b.textContent = label; b.dataset.iso = id || "";
      b.title = id ? `Show and paint only the ${label.toLowerCase()}` : "Show and paint everything";
      b.addEventListener("click", () => setIsolate(id && S.isolate === id ? null : id));
      box.appendChild(b);
    }
  }
  syncIsoChips();
}
function syncIsoChips() { $$("[data-iso-group] button").forEach((b) => b.classList.toggle("on", b.dataset.iso === (S.isolate || ""))); }
function setIsolate(id) {
  S.isolate = id;
  syncIsoChips();
  if (preview) {
    preview.hidden = new Set(id ? PARTS.filter((p) => p.id !== id).map((p) => p.id) : []);
    preview.focus(id);
  }
  requestRender();
}
function setOuter(on) {
  S.showOuter = on;
  setToggle($("#pvOuter"), on);
  const b = $('#pvTools [data-pv="outer"]'); if (b) setToggle(b, on);
  if (!on && $("#pvTarget").value === "over") { $("#pvTarget").value = "base"; if (preview) preview.pickTarget = "base"; }
  if (preview) { preview.showOverlay = on; preview.requestDraw(); }
  requestRender();
}

// ---------------------------------------------------------------- UI: tools
function buildTools() {
  const box = $("#toolList");
  for (const t of TOOLS) {
    const b = document.createElement("button");
    b.dataset.tool = t.id; b.title = `${t.label} (${t.key})`; b.setAttribute("aria-label", t.label);
    b.innerHTML = iconSVG(t.id);
    b.addEventListener("click", () => setTool(t.id));
    box.appendChild(b);
  }
}
function setTool(id) {
  if (in3D() && !PAINT_ON_3D.has(id)) {
    toast(`${TOOLS.find((t) => t.id === id).label.split(" (")[0]} works in the Flat view. In 3D: pencil, eraser, fill, pick and shade.`);
    return;
  }
  if (SELECT_TOOLS.has(S.tool) && !SELECT_TOOLS.has(id)) { commitFloat(); requestRender(); } // keep the selection: painting stays inside it
  S.tool = id;
  $$("#toolList button").forEach((b) => b.classList.toggle("on", b.dataset.tool === id));
  if (doc) syncFocusBar();
  view.style.cursor = id === "move" ? "move" : SELECT_TOOLS.has(id) || id === "slice" ? "crosshair" : "default";
  requestRender();
}
function setToggle(btn, on) { btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", on); }

// ---------------------------------------------------------------- UI: colours
function swatch(hex, onClick, extra = "") {
  const b = document.createElement("button");
  b.className = `sw ${extra}`; b.style.setProperty("--c", hex); b.title = hex;
  b.addEventListener("click", (e) => onClick(hex, 0, e));
  b.addEventListener("contextmenu", (e) => { e.preventDefault(); onClick(hex, 2, e); });
  return b;
}
function setColor(hex, button = 0) {
  const c = hexToRgba(hex);
  if (button === 2) S.secondary = c; else S.primary = c;
  syncColors();
}
let wheel = null;
const recent = Array.isArray(prefs.recent) ? prefs.recent.filter((h) => typeof h === "string").slice(0, 18) : [];
function pushRecent(c) {
  if (!c || c[3] === 0) return;
  const hex = rgbaToHex(c);
  if (recent[0] === hex) return;
  const i = recent.indexOf(hex); if (i >= 0) recent.splice(i, 1);
  recent.unshift(hex); recent.length = Math.min(recent.length, 18);
  renderRecent(); persistPrefs();
}
function renderRecent() {
  const box = $("#recentColors"); if (!recent.length) return;
  box.innerHTML = "";
  for (const hex of recent) box.appendChild(swatch(hex, setColor));
}
// layer visibility icons (outline, follows the text colour)
const EYE_ON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5c1.6 0 3 .4 4.3 1.1M21.5 12s-3.5 6.5-9.5 6.5c-1.6 0-3-.4-4.3-1.1"/><path d="M4 20 20 4"/></svg>';
function syncColors() {
  const css = (c) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
  $("#cPrimary").style.setProperty("--c", css(S.primary));
  $("#cSecondary").style.setProperty("--c", css(S.secondary));
  $("#fColor").style.setProperty("--c", css(S.primary));
  $("#cInput").value = rgbaToHex(S.primary);
  if (document.activeElement !== $("#cHex")) $("#cHex").value = rgbaToHex(S.primary, true);
  $("#cAlpha").value = S.primary[3];
  if (wheel) wheel.set(S.primary);
  const cur = rgbaToHex(S.primary);
  $$("#palette .sw").forEach((b) => b.classList.toggle("cur", b.title === cur && S.primary[3] === 255));
  persistPrefs();
}
function buildPalette() {
  const sel = $("#palSel");
  sel.innerHTML = "";
  if (doc && doc.palette) sel.add(new Option(DOC_PAL, DOC_PAL, false, S.palette === DOC_PAL));
  else if (S.palette === DOC_PAL) S.palette = "Pixels 32";
  for (const name of Object.keys(PALETTES)) sel.add(new Option(name, name, false, name === S.palette));
  const box = $("#palette");
  box.innerHTML = "";
  if (S.palette === DOC_PAL && doc && doc.palette) {
    doc.palette.forEach((hex, i) => {
      const b = swatch(hex, setColor);
      b.title += " (double-click to change it everywhere)";
      b.addEventListener("dblclick", () => editIndexedColour(i));
      box.appendChild(b);
    });
    syncColors();
    return;
  }
  for (const hex of PALETTES[S.palette] || []) {
    const b = swatch(hex, (h, btn, e) => {
      if (S.palette === "My colours" && e.altKey) { PALETTES["My colours"] = PALETTES["My colours"].filter((x) => x !== h); buildPalette(); persistPrefs(); return; }
      setColor(h, btn);
    });
    if (S.palette === "My colours") b.title += " (Alt+click removes)";
    box.appendChild(b);
  }
  syncColors();
}
let usedTimer = null;
function refreshUsed() {
  clearTimeout(usedTimer);
  usedTimer = setTimeout(() => {
    const counts = new Map(), px = doc.composite();
    for (let k = 0; k < px.length; k += 4) {
      if (px[k + 3] === 0) continue;
      const hex = rgbaToHex([px[k], px[k + 1], px[k + 2], 255]);
      counts.set(hex, (counts.get(hex) || 0) + 1);
    }
    const box = $("#usedColors");
    box.innerHTML = "";
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 48).forEach(([hex]) => box.appendChild(swatch(hex, setColor)));
  }, 250);
}

// ---------------------------------------------------------------- UI: layers
function renderLayers() {
  const box = $("#layers");
  box.innerHTML = "";
  doc.layers.forEach((l, i) => {
    const row = document.createElement("div");
    row.className = "layer" + (i === doc.active ? " on" : "");
    const th = document.createElement("canvas");
    th.width = doc.w; th.height = doc.h;
    th.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(l.px), doc.w, doc.h), 0, 0);
    const eye = document.createElement("button");
    eye.className = "eye" + (l.visible ? "" : " off"); eye.innerHTML = l.visible ? EYE_ON : EYE_OFF; eye.setAttribute("aria-label", l.visible ? "Hide" : "Show"); eye.title = l.visible ? "Hide layer" : "Show layer";
    eye.addEventListener("click", (e) => { e.stopPropagation(); doc.setLayerProp(i, "visible", !l.visible); });
    const nm = document.createElement("span");
    nm.className = "nm"; nm.textContent = l.name; nm.title = "Double-click to rename";
    nm.addEventListener("dblclick", async (e) => {
      e.stopPropagation();
      const v = await promptText("Rename layer", l.name);
      if (v) doc.setLayerProp(i, "name", v.slice(0, 40));
    });
    const op = document.createElement("input");
    op.type = "range"; op.min = 0; op.max = 100; op.value = Math.round(l.opacity * 100); op.title = "Layer opacity";
    op.addEventListener("pointerdown", (e) => e.stopPropagation());
    op.addEventListener("click", (e) => e.stopPropagation());
    let live = null;
    op.addEventListener("input", () => {
      if (!live) { doc.beginStructure(); live = doc.layers[i] = { ...doc.layers[i] }; } // fresh object: the undo copy keeps the old one
      live.opacity = op.value / 100;
      doc._comp = null; requestRender();
    });
    op.addEventListener("change", () => { if (live) { live = null; doc.emit("structure"); } });
    const lock = document.createElement("button");
    lock.className = "eye lock" + (l.alphaLock ? "" : " off");
    lock.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
    lock.title = l.alphaLock ? "Transparency locked: you can only paint over pixels already drawn. Click to unlock." : "Lock transparency: paint only over pixels already drawn";
    lock.addEventListener("click", (e) => { e.stopPropagation(); doc.setLayerProp(i, "alphaLock", !l.alphaLock); toast(!l.alphaLock ? `Transparency locked on ${l.name}.` : `${l.name} unlocked.`); });
    row.append(th, eye, lock, nm, op);
    if (l.blend && l.blend !== "normal") { const bm = document.createElement("span"); bm.className = "bm"; bm.textContent = l.blend.replace("-", " "); nm.after(bm); }
    if (l.tilemap) { const tb = document.createElement("span"); tb.className = "bm"; tb.textContent = "tiles"; nm.after(tb); }
    row.addEventListener("click", () => { if (doc.active !== i) { clearSelection(); doc.active = i; renderLayers(); } });
    const g = l.group && doc.groups.find((x) => x.id === l.group);
    if (g) { row.classList.add("inGroup"); if (g.collapsed && i !== doc.active) row.hidden = true; }
    box.appendChild(row);
    // group header sits above its top member (the list is drawn bottom-up)
    if (g && !doc.layers.slice(i + 1).some((m) => m.group === g.id)) box.appendChild(groupRow(g));
  });
  const bs = $("#lBlend");
  if (!bs.options.length) for (const m of Object.keys(BLEND_MODES)) bs.add(new Option(m[0].toUpperCase() + m.slice(1).replace("-", " "), m));
  bs.value = doc.layer.blend || "normal";
  $("#lUngroup").disabled = !doc.layer.group;
  $("#lTilemap").textContent = doc.layer.tilemap ? "Tilemap ⚙" : "Tilemap…";
  renderTileset();
  $("#lDel").disabled = doc.layers.length <= 1;
  $("#lMerge").disabled = doc.active === 0;
  $("#lUp").disabled = doc.active >= doc.layers.length - 1;
  $("#lDown").disabled = doc.active === 0;
}
function groupRow(g) {
  const row = document.createElement("div");
  row.className = "layer group";
  const arrow = document.createElement("button");
  arrow.className = "eye"; arrow.textContent = g.collapsed ? "▸" : "▾"; arrow.title = g.collapsed ? "Expand group" : "Collapse group";
  arrow.addEventListener("click", (e) => { e.stopPropagation(); g.collapsed = !g.collapsed; renderLayers(); });
  const eye = document.createElement("button");
  eye.className = "eye" + (g.visible ? "" : " off"); eye.innerHTML = g.visible ? EYE_ON : EYE_OFF; eye.setAttribute("aria-label", g.visible ? "Hide" : "Show"); eye.title = g.visible ? "Hide group" : "Show group";
  eye.addEventListener("click", (e) => { e.stopPropagation(); doc.beginStructure(); g.visible = !g.visible; doc.emit("structure"); });
  const nm = document.createElement("span");
  nm.className = "nm"; nm.textContent = `📁 ${g.name}`; nm.title = "Double-click to rename";
  nm.addEventListener("dblclick", async (e) => { e.stopPropagation(); const v = await promptText("Rename group", g.name); if (v) { doc.beginStructure(); g.name = v.slice(0, 40); doc.emit("structure"); } });
  const op = document.createElement("input");
  op.type = "range"; op.min = 0; op.max = 100; op.value = Math.round(g.opacity * 100); op.title = "Group opacity";
  op.addEventListener("pointerdown", (e) => e.stopPropagation());
  let rec = false;
  op.addEventListener("input", () => { if (!rec) { doc.beginStructure(); rec = true; } g.opacity = op.value / 100; doc._comp = null; requestRender(); });
  op.addEventListener("change", () => { if (rec) { rec = false; doc.emit("structure"); } });
  row.append(arrow, eye, nm, op);
  row.addEventListener("click", () => { g.collapsed = !g.collapsed; renderLayers(); });
  return row;
}
async function groupDialog() {
  clearSelection();
  const l = doc.layer;
  const opts = doc.groups.filter((g) => g.id !== l.group).map((g) => [g.id, `Move into “${g.name}”`]);
  const r = opts.length ? await choose("Group layer", `Put ${l.name} in a group. Hiding or fading a group affects every layer in it.`, [["new", "New group"], ...opts, ["cancel", "Cancel"]]) : "new";
  if (!r || r === "cancel") return;
  let id = r;
  if (r === "new") {
    const name = await promptText("Group name", `Group ${doc.groups.length + 1}`);
    if (!name) return;
    doc.beginStructure();
    id = gid(); doc.groups.push({ id, name: name.slice(0, 40), visible: true, opacity: 1, collapsed: false });
  } else doc.beginStructure();
  doc.layers[doc.active] = { ...l, group: id };
  // keep members next to each other: move the layer up beside the group's top member
  const members = doc.layers.map((m, i) => (m.group === id ? i : -1)).filter((i) => i >= 0 && i !== doc.active);
  if (members.length) {
    const target = Math.max(...members);
    const [moved] = doc.layers.splice(doc.active, 1);
    const at = target >= doc.active ? target : target + 1;
    doc.layers.splice(at, 0, moved); doc.active = at;
  }
  doc.emit("structure");
}
function ungroupLayer() {
  const l = doc.layer;
  if (!l.group) return;
  doc.beginStructure();
  doc.layers[doc.active] = { ...l, group: null };
  doc.groups = doc.groups.filter((g) => doc.layers.some((m) => m.group === g.id));
  doc.emit("structure");
}
let layerThumbTimer = null;
function refreshLayerThumbs() {
  clearTimeout(layerThumbTimer);
  layerThumbTimer = setTimeout(() => {
    const rows = $$("#layers .layer canvas");
    doc.layers.forEach((l, i) => { const c = rows[i]; if (c && c.width === doc.w) c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(l.px), doc.w, doc.h), 0, 0); });
  }, 120);
}

// ---------------------------------------------------------------- skin checks
let checkTimer = null;
function refreshSkinCheck() {
  if (doc.mode !== "skin") return;
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    const el = $("#skinCheck");
    const bad = transparentBaseParts(doc.composite(), doc.model);
    el.innerHTML = "";
    if (!bad.length) { el.className = "check"; el.textContent = "✓ Ready for Java and Bedrock."; return; }
    el.className = "check warn";
    el.append(`See-through spots on the inner layer: ${bad.join(", ")}. The game shows those as black or holes. `);
    const b = document.createElement("button");
    b.textContent = "Fill them with the left-click colour";
    b.addEventListener("click", () => {
      const flat = doc.composite().slice();
      fillTransparentBase(flat, doc.model, S.primary);
      // put the fix on a new layer so it's easy to undo or tweak
      doc.addLayer("Gap fill");
      const px = doc.layer.px, comp = doc.composite();
      for (let k = 0; k < flat.length; k += 4) {
        if (comp[k + 3] < 255 && flat[k + 3] === 255) { px[k] = flat[k]; px[k + 1] = flat[k + 1]; px[k + 2] = flat[k + 2]; px[k + 3] = 255; }
      }
      // keep the gap fill underneath everything else
      while (doc.active > 0) { const j = doc.active - 1; [doc.layers[doc.active], doc.layers[j]] = [doc.layers[j], doc.layers[doc.active]]; doc.active = j; }
      doc.emit("structure");
      toast("Filled. Undo if you don't like it.");
    });
    el.appendChild(b);
  }, 300);
}

// ---------------------------------------------------------------- document lifecycle
let saveTimer = null;
function onDocChange(kind) {
  requestRender();
  if (kind === "structure" && doc.mode === "skin" && preview && preview.model !== doc.model) {
    preview.setModel(doc.model); unusedPath = null;
    $$("#modelSeg button").forEach((b) => b.classList.toggle("on", b.dataset.model === doc.model));
  }
  if (kind === "structure" || kind === "frame") renderLayers(); else refreshLayerThumbs();
  if (doc.mode === "art") {
    if (kind === "structure") { animCache = []; renderFrames(); }
    else if (kind === "frame") renderFrames();
    else { if (doc.frames[doc.frame].links) animCache = []; else animCache[doc.frame] = null; refreshFrameThumb(); }
    kickAnim();
  }
  refreshUsed();
  if (doc.mode === "skin" && preview) { preview.setTexture(doc.composite()); refreshSkinCheck(); }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autosave, 1200);
  updateHistoryButtons();
}
function autosave() {
  if (!doc || !doc.dirty) return;
  if (!store.saveDoc(doc)) toast("This browser is out of space for saved drawings. Export a PNG or delete old ones.");
}
function updateHistoryButtons() {
  $("#bUndo").disabled = !doc.undoStack.length;
  $("#bRedo").disabled = !doc.redoStack.length;
}

function setDoc(d, { keepView = false } = {}) {
  if (doc && doc !== d) { autosave(); }
  S.sel = null; $("#selBar").hidden = true;
  doc = d;
  if (!d._wired) { d._wired = true; d.on((kind) => { if (d === doc) onDocChange(kind); }); }
  if (d.mode === "skin") skinDoc = d; else artDoc = d;
  document.body.dataset.mode = d.mode;
  syncFocusBar();
  $$(".modes button").forEach((b) => b.classList.toggle("on", b.dataset.mode === d.mode));
  if (d.mode === "skin") {
    if (!preview) setupPreview();
    $$("#modelSeg button").forEach((b) => b.classList.toggle("on", b.dataset.model === d.model));
    if (preview) { preview.setModel(d.model); preview.setTexture(d.composite()); }
    setSkinView(S.sv);
    refreshSkinCheck();
  }
  unusedPath = null;
  S.playTag = -1;
  if (d.palette) S.palette = DOC_PAL;
  buildPalette();
  renderLayers(); refreshUsed(); updateHistoryButtons();
  animCache = [];
  if (d.mode === "art") { renderFrames(); kickAnim(); }
  requestAnimationFrame(() => { resizeView(); if (!keepView) fit(); });
  localStorage.setItem("pixels:last", d.id);
  document.title = `${d.name} · Pixels`;
}

function newArt(w, h) { return new Doc({ w, h, mode: "art", name: "Untitled" }); }
function newSkin(kind = "mannequin", model = "classic") {
  const d = new Doc({ w: 64, h: 64, mode: "skin", model, name: "My skin" });
  if (kind === "mannequin") d.layers[0].px = mannequin(model);
  return d;
}

async function switchMode(mode) {
  if (doc.mode === mode) return;
  clearSelection();
  autosave();
  let target = mode === "skin" ? skinDoc : artDoc;
  if (!target) {
    const recent = store.listDocs().find((e) => e.mode === mode);
    if (recent) { try { target = await store.openDoc(recent.id); } catch {} }
  }
  if (!target) target = mode === "skin" ? newSkin() : newArt(32, 32);
  setDoc(target);
}

// ---------------------------------------------------------------- import / export
async function importFile(file) {
  if (!file) return;
  try {
    if (/\.(aseprite|ase)$/i.test(file.name)) {
      const d = aseToDoc(await readAse(await file.arrayBuffer()), file.name.replace(/\.[^.]+$/, "").slice(0, 60));
      setDoc(d); autosave();
      toast(`Opened ${d.name}: ${d.layers.length} layer${d.layers.length > 1 ? "s" : ""}, ${d.frames.length} frame${d.frames.length > 1 ? "s" : ""}${d.tags.length ? `, ${d.tags.length} tags` : ""}.`);
      return;
    }
    if (file.name.endsWith(".json") || file.type === "application/json") {
      const d = await store.deserialize(JSON.parse(await file.text()));
      d.id = `d${Date.now().toString(36)}`; d.dirty = true;
      setDoc(d); autosave(); toast(`Opened ${d.name}.`);
      return;
    }
    if (file.size > 8 * 1024 * 1024) throw new Error("That image is over 8 MB.");
    const url = URL.createObjectURL(file);
    const img = await store.loadImage(url);
    URL.revokeObjectURL(url);
    const name = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Imported";
    if (doc.mode === "skin") return importSkinImage(img, name);
    const W0 = img.naturalWidth, H0 = img.naturalHeight;
    if (W0 > 4096 || H0 > 4096) throw new Error("That image is bigger than 4096 pixels.");
    let w = W0, h = H0, note = "";
    if (w > MAX_SIZE || h > MAX_SIZE) {
      const s = MAX_SIZE / Math.max(w, h);
      w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
      note = ` Shrunk to ${w}×${h}, the biggest size the editor works at.`;
    }
    const px = store.imageToPx(img, w, h);
    const choice = await choose(`Import ${file.name}`, `${w}×${h} pixels.${note}`, [
      ["new", "Open as a new drawing"], ["sheet", "Split into animation frames"], ...(w <= doc.w && h <= doc.h ? [["layer", "Add as a layer here"]] : []), ["cancel", "Cancel"],
    ]);
    if (choice === "sheet") return splitSheet(img, name);
    if (choice === "new") {
      const d = new Doc({ w, h, mode: "art", name });
      d.layers[0].px = new Uint8ClampedArray(px); d.layers[0].name = name; d.dirty = true;
      setDoc(d); autosave();
    } else if (choice === "layer") {
      doc.addLayer(name);
      const L = doc.layer.px;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4, t = (y * doc.w + x) * 4;
        L[t] = px[s]; L[t + 1] = px[s + 1]; L[t + 2] = px[s + 2]; L[t + 3] = px[s + 3];
      }
      doc.emit("structure");
    }
  } catch (err) { toast(err.message || String(err)); }
}

async function splitSheet(img, name) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const guess = W % H === 0 ? [H, H] : H % W === 0 ? [W, W] : [Math.min(W, MAX_SIZE), Math.min(H, MAX_SIZE)];
  const r = await dialog(`
    <h2>Split into frames</h2>
    <p>The sheet is ${W}×${H}. Frames are read left to right, then top to bottom.</p>
    <div class="grid2">
      <label>Frame size</label>
      <div class="row"><input type="number" id="sW" min="1" max="${MAX_SIZE}" value="${Math.min(MAX_SIZE, guess[0])}" style="width:80px"> × <input type="number" id="sH" min="1" max="${MAX_SIZE}" value="${Math.min(MAX_SIZE, guess[1])}" style="width:80px"></div>
      <label for="sMs">Frame time</label><div class="row"><input type="number" id="sMs" min="20" max="10000" step="10" value="100" style="width:80px"> ms</div>
    </div>
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Split</button></div>`,
  () => ({ w: +$("#sW").value, h: +$("#sH").value, ms: +$("#sMs").value }));
  if (!r || r.value !== "ok") return;
  const fw = Math.round(r.data.w), fh = Math.round(r.data.h);
  if (!(fw >= 1 && fh >= 1 && fw <= MAX_SIZE && fh <= MAX_SIZE)) { toast(`Frames can be up to ${MAX_SIZE}×${MAX_SIZE}.`); return; }
  const cols = Math.floor(W / fw), rows = Math.floor(H / fh);
  if (!cols || !rows) { toast("The frame size is bigger than the sheet."); return; }
  const src = store.imageToPx(img, W, H);
  const cells = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const px = new Uint8ClampedArray(fw * fh * 4);
    let any = false;
    for (let y = 0; y < fh; y++) {
      const s = ((j * fh + y) * W + i * fw) * 4;
      px.set(src.subarray(s, s + fw * 4), y * fw * 4);
    }
    for (let k = 3; k < px.length; k += 4) if (px[k]) { any = true; break; }
    cells.push({ px, any });
  }
  while (cells.length > 1 && !cells[cells.length - 1].any) cells.pop(); // drop empty slots at the end of the sheet
  if (cells.length > 300) { toast("That would be more than 300 frames. Try a bigger frame size."); return; }
  const d = new Doc({ w: fw, h: fh, mode: "art", name });
  const id = d.layers[0].id;
  d.layers[0].name = name;
  d.frames = cells.map((c) => ({ duration: Math.max(20, r.data.ms || 100), px: { [id]: c.px } }));
  d.loadFrame(0);
  d.dirty = true;
  setDoc(d); autosave();
  toast(`${cells.length} frames. Recolor… under Layers swaps colours on all of them.`);
}

function importSkinImage(img, name, model = null) {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (w !== 64 || (h !== 64 && h !== 32)) { toast(`Skins are 64×64 (or old 64×32). That one is ${w}×${h}.`); return; }
  let px = store.imageToPx(img, 64, h);
  if (h === 32) { px = upgradeLegacy(px); toast("Old 64×32 skin: left arm and leg copied from the right, like the game does."); }
  const m = model || guessModel(px);
  const d = new Doc({ w: 64, h: 64, mode: "skin", model: m, name });
  d.layers[0].px = new Uint8ClampedArray(px); d.dirty = true;
  setDoc(d); autosave();
  if (h === 64) toast(`Loaded with ${m === "slim" ? "slim" : "classic"} arms. Switch on the right if that's wrong.`);
}

async function loadJavaSkin(username) {
  username = username.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) { toast("Java usernames are 3–16 letters, numbers or _."); return; }
  try {
    const res = await fetch(`/api/skin/${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error((await res.text()) || "Couldn't load that skin.");
    const hm = res.headers.get("x-skin-model");
    const model = hm === "slim" ? "slim" : hm === "classic" ? "classic" : null; // null: guess from the pixels
    const url = URL.createObjectURL(await res.blob());
    const img = await store.loadImage(url);
    URL.revokeObjectURL(url);
    importSkinImage(img, `${username} skin`, model);
  } catch (err) { toast(err.message || String(err)); }
}

async function exportDialog() {
  autosave();
  const base = store.safeName(doc.name);
  if (doc.mode === "skin") {
    const bad = transparentBaseParts(doc.composite(), doc.model);
    const arms = doc.model === "slim" ? "Slim" : "Classic";
    const r = await dialog(`
      <h2>Download your skin</h2>
      ${bad.length ? `<p class="check warn">Heads up: see-through spots on the inner layer (${bad.join(", ")}). They'll show as black or holes in game. The fill button on the right fixes it.</p>` : ""}
      <p><b>Java:</b> minecraft.net → Profile → Skins → upload the PNG and pick <b>${arms}</b>. Or the launcher's Skins tab.</p>
      <p><b>Bedrock:</b> Dressing Room → Classic Skins → Owned → Import → Choose New Skin, then pick the <b>${arms.toLowerCase()}</b> arm shape. (Not every console allows imports.)</p>
      <div class="btns">
        <button value="views3" title="Three pictures of the 3D model: front, three-quarter and back">3D model: 3 pictures</button>
        <button value="sheet3" title="Front, three-quarter and back side by side in one picture">3D model: side by side</button>
        <button value="pic" title="The 3D model exactly as it's turned right now">3D as shown</button>
        <button value="ase">Aseprite file</button>
        <button value="json">Project file</button>
        <button value="png" class="primary">Download skin PNG</button>
      </div>`);
    if (r === "png") store.download(store.pxToDataURL(doc.composite(), 64, 64), `${base}.png`);
    if (r === "pic" && preview) store.download(preview.snapshot(), `${base}-3d.png`);
    if ((r === "views3" || r === "sheet3") && !preview) toast("The 3D model needs WebGL, which this browser has turned off.");
    if ((r === "views3" || r === "sheet3") && preview) {
      const names = ["front", "angle", "back"], labels = ["front", "three-quarter", "back"];
      const shots = preview.renderViews(names);
      if (r === "views3") shots.forEach((c, i) => store.download(c.toDataURL("image/png"), `${base}-3d-${labels[i]}.png`));
      else {
        const H = Math.max(...shots.map((c) => c.height)), gap = Math.round(H * 0.06);
        const sheet = document.createElement("canvas");
        sheet.width = shots.reduce((s, c) => s + c.width, 0) + gap * (shots.length + 1); sheet.height = H + gap * 2;
        const g = sheet.getContext("2d");
        let x = gap;
        for (const c of shots) { g.drawImage(c, x, gap + (H - c.height)); x += c.width + gap; }
        store.download(sheet.toDataURL("image/png"), `${base}-3d-turnaround.png`);
      }
    }
    if (r === "json") downloadProject();
    if (r === "ase") downloadAse();
    return;
  }
  const maxScale = Math.max(1, Math.floor(4096 / Math.max(doc.w, doc.h)));
  const scales = [1, 2, 4, 8, 10, 16, 20, 32].filter((s) => s <= maxScale);
  const def = scales.filter((s) => s * Math.max(doc.w, doc.h) <= 1024).pop() || 1;
  const n = doc.frames.length;
  const r = await dialog(`
    <h2>Download</h2>
    <div class="grid2">
      <label for="exScale">Size</label>
      <select id="exScale">${scales.map((s) => `<option value="${s}" ${s === def ? "selected" : ""}>${s}× · ${doc.w * s}×${doc.h * s}</option>`).join("")}</select>
      ${n > 1 ? `<label for="exLayout">Sprite sheet</label>
      <select id="exLayout"><option value="row">All frames in one row</option><option value="grid">Grid</option><option value="col">One column</option></select>` : ""}
    </div>
    ${n > 1 || doc.slices.length ? `<div class="grid2"><label for="exPad">Gap between frames</label><select id="exPad"><option value="0">None</option><option value="1">1 px</option><option value="2">2 px</option></select>
      <label for="exJson">JSON style</label><select id="exJson"><option value="hash">Hash (Phaser, Godot importers)</option><option value="array">Array (Unity, LibGDX, Pixi)</option></select></div>` : ""}
    <p>Bigger sizes keep the pixels sharp for posting online. 1× is the real size.${n > 1 ? ` ${n} frames. The sprite sheet is always 1×, which is what game engines expect. "+ JSON" also downloads the frame rectangles, timings, tags and slices in the same layout Aseprite exports.` : ""}</p>
    <div class="btns"><button value="json">Project file</button><button value="ase">Aseprite file</button>
      ${n > 1 ? `<button value="sheetjson">Sprite sheet + JSON</button><button value="sheet">Sprite sheet PNG</button><button value="gif">Animated GIF</button><button value="png">This frame PNG</button>` : `${doc.slices.length ? '<button value="sheetjson">PNG + JSON (slices)</button>' : ""}<button value="png" class="primary">Download PNG</button>`}</div>`,
  () => ({ scale: +$("#exScale").value, layout: $("#exLayout") ? $("#exLayout").value : "row", pad: $("#exPad") ? +$("#exPad").value : 0, json: $("#exJson") ? $("#exJson").value : "hash" }));
  if (!r) return;
  const sc = r.data.scale;
  if (r.value === "png") store.download(store.pxToDataURL(doc.composite(), doc.w, doc.h, sc), `${base}${n > 1 ? `-frame${doc.frame + 1}` : ""}${sc > 1 ? `-${sc}x` : ""}.png`);
  if (r.value === "json") downloadProject();
  if (r.value === "ase") downloadAse();
  if (r.value === "sheetjson") return exportSheetJSON(r.data);
  if (r.value === "sheet") {
    const cols = r.data.layout === "row" ? n : r.data.layout === "col" ? 1 : Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const sheet = new Uint8ClampedArray(doc.w * cols * doc.h * rows * 4), SW = doc.w * cols;
    for (let i = 0; i < n; i++) {
      const px = doc.compositeFrame(i), fx = (i % cols) * doc.w, fy = Math.floor(i / cols) * doc.h;
      for (let y = 0; y < doc.h; y++) sheet.set(px.subarray(y * doc.w * 4, (y + 1) * doc.w * 4), ((fy + y) * SW + fx) * 4);
    }
    store.download(store.pxToDataURL(sheet, SW, doc.h * rows), `${base}-sheet-${doc.w}x${doc.h}.png`);
  }
  if (r.value === "gif") {
    const gsc = Math.min(sc, Math.max(1, Math.floor(1024 / Math.max(doc.w, doc.h))));
    const bytes = encodeGIF(doc.frames.map((f, i) => ({ px: doc.compositeFrame(i), delay: f.duration })), doc.w, doc.h, gsc);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/gif" }));
    store.download(url, `${base}${gsc > 1 ? `-${gsc}x` : ""}.gif`);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    if (gsc !== sc) toast(`GIF made at ${gsc}× to keep it under 1024 pixels.`);
    if (transparencyIsPartial()) toast("GIFs can't do half-transparent pixels, so those became fully solid or clear.");
  }
}
function exportSheetJSON(o) {
  const n = doc.frames.length, base = store.safeName(doc.name), pad = o.pad || 0;
  const cols = o.layout === "col" ? 1 : o.layout === "grid" ? Math.ceil(Math.sqrt(n)) : n, rows = Math.ceil(n / cols);
  const SW = cols * doc.w + (cols - 1) * pad, SH = rows * doc.h + (rows - 1) * pad;
  const sheet = new Uint8ClampedArray(SW * SH * 4), rects = [];
  for (let i = 0; i < n; i++) {
    const px = doc.compositeFrame(i), fx = (i % cols) * (doc.w + pad), fy = Math.floor(i / cols) * (doc.h + pad);
    for (let y = 0; y < doc.h; y++) sheet.set(px.subarray(y * doc.w * 4, (y + 1) * doc.w * 4), ((fy + y) * SW + fx) * 4);
    rects.push({ x: fx, y: fy, w: doc.w, h: doc.h });
  }
  const image = `${base}-sheet.png`;
  const entry = (i) => ({ frame: rects[i], rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: doc.w, h: doc.h }, sourceSize: { w: doc.w, h: doc.h }, duration: doc.frames[i].duration });
  const frames = o.json === "array" ? rects.map((_, i) => ({ filename: `${base} ${i}.png`, ...entry(i) })) : Object.fromEntries(rects.map((_, i) => [`${base} ${i}.png`, entry(i)]));
  const data = {
    frames,
    meta: {
      app: "https://pixels.brandonj.ink", version: "1.0", image, format: "RGBA8888", size: { w: SW, h: SH }, scale: "1",
      frameTags: doc.tags.map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.dir, color: `${t.color}ff` })),
      layers: doc.layers.map((l) => ({ name: l.name, opacity: Math.round(l.opacity * 255), blendMode: l.blend || "normal" })),
      slices: doc.slices.map((sl) => ({ name: sl.name, color: "#0000ffff", keys: [{ frame: 0, bounds: { x: sl.x, y: sl.y, w: sl.w, h: sl.h }, ...(sl.center ? { center: { ...sl.center } } : {}) }] })),
    },
  };
  store.download(store.pxToDataURL(sheet, SW, SH), image);
  setTimeout(() => downloadText(JSON.stringify(data, null, 1), `${base}-sheet.json`), 400);
  toast("Downloading the sheet PNG and its JSON. Your browser may ask to allow two downloads.");
}
function downloadProject() {
  const blob = new Blob([JSON.stringify(store.serialize(doc))], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  store.download(url, `${store.safeName(doc.name)}.pixels.json`);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- animation
let animCache = [], animRAF = null, animT0 = performance.now();
function animFrameCanvas(i) {
  if (!animCache[i]) {
    const c = document.createElement("canvas");
    c.width = doc.w; c.height = doc.h;
    c.getContext("2d").putImageData(new ImageData(doc.compositeFrame(i), doc.w, doc.h), 0, 0);
    animCache[i] = c;
  }
  return animCache[i];
}
function kickAnim() { if (!animRAF) animRAF = requestAnimationFrame(animTick); }
function animTick(now) {
  animRAF = null;
  if (!doc || doc.mode !== "art") return;
  const pc = $("#animPreview"), d = dpr();
  const W = Math.round(pc.clientWidth * d), H = Math.round(pc.clientHeight * d);
  if (!W || !H) return;
  if (pc.width !== W || pc.height !== H) { pc.width = W; pc.height = H; }
  const seq = playSequence();
  let i = doc.frame;
  const playing = S.playing && seq.length > 1;
  if (playing) {
    const total = seq.reduce((a, k) => a + doc.frames[k].duration, 0);
    let t = (now - animT0) % total, j = 0;
    while (j < seq.length - 1 && t >= doc.frames[seq[j]].duration) { t -= doc.frames[seq[j]].duration; j++; }
    i = seq[j];
  }
  const g = pc.getContext("2d");
  g.clearRect(0, 0, W, H);
  g.imageSmoothingEnabled = false;
  let s = Math.min((W - 8) / doc.w, (H - 8) / doc.h);
  if (s >= 1) s = Math.floor(s);
  const dw = Math.round(doc.w * s), dh = Math.round(doc.h * s);
  g.drawImage(animFrameCanvas(i), Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
  if (playing) animRAF = requestAnimationFrame(animTick);
}
// frame order the preview plays: every frame, or the picked tag with its loop direction
function playSequence() {
  const n = doc.frames.length, t = doc.tags[S.playTag];
  if (!t) return [...Array(n).keys()];
  const a = Math.max(0, Math.min(n - 1, t.from)), b = Math.max(a, Math.min(n - 1, t.to));
  const fwd = []; for (let k = a; k <= b; k++) fwd.push(k);
  if (t.dir === "reverse") return fwd.reverse();
  if (t.dir === "pingpong") return fwd.concat(fwd.slice(1, -1).reverse());
  return fwd;
}
function renderTags() {
  const sel = $("#aTag"), cur = S.playTag;
  sel.innerHTML = '<option value="">All frames</option>' + doc.tags.map((t, i) => `<option value="${i}">${esc(t.name)} (${t.from + 1}–${t.to + 1}, ${t.dir === "pingpong" ? "ping-pong" : t.dir})</option>`).join("");
  if (!doc.tags[cur]) S.playTag = -1;
  sel.value = S.playTag >= 0 ? String(S.playTag) : "";
  $("#aTagEdit").disabled = S.playTag < 0;
}
async function tagDialog(i = -1) {
  const t = doc.tags[i] || { name: `Tag ${doc.tags.length + 1}`, from: doc.frame, to: doc.frame, dir: "forward", color: ["#e05a5a", "#e0a43a", "#4cc9a6", "#3aa0e8", "#9b6cff", "#d64f9c"][doc.tags.length % 6] };
  const n = doc.frames.length;
  const r = await dialog(`<h2>${i >= 0 ? "Edit tag" : "New tag"}</h2>
    <p class="dim">A tag names a run of frames (idle, walk, attack) so the preview can loop just that part, and game engines get it in the sprite sheet data and .aseprite files.</p>
    <div class="grid2">
      <label for="tgName">Name</label><input type="text" id="tgName" maxlength="40" value="${esc(t.name)}">
      <label for="tgFrom">From frame</label><input type="number" id="tgFrom" min="1" max="${n}" value="${t.from + 1}">
      <label for="tgTo">To frame</label><input type="number" id="tgTo" min="1" max="${n}" value="${t.to + 1}">
      <label for="tgDir">Plays</label><select id="tgDir"><option value="forward">Forward</option><option value="reverse" ${t.dir === "reverse" ? "selected" : ""}>Reverse</option><option value="pingpong" ${t.dir === "pingpong" ? "selected" : ""}>Ping-pong (there and back)</option></select>
      <label for="tgCol">Colour</label><input type="color" id="tgCol" value="${t.color}">
    </div>
    <div class="btns">${i >= 0 ? '<button value="delete">Delete tag</button>' : ""}<button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">${i >= 0 ? "Save" : "Add tag"}</button></div>`,
  () => ({ name: $("#tgName").value.trim() || "Tag", from: +$("#tgFrom").value - 1, to: +$("#tgTo").value - 1, dir: $("#tgDir").value, color: $("#tgCol").value }));
  if (!r || r.value === "cancel") return;
  doc.beginStructure();
  if (r.value === "delete") { doc.tags.splice(i, 1); S.playTag = -1; }
  else {
    const d = r.data, from = Math.max(0, Math.min(n - 1, Math.min(d.from, d.to))), to = Math.max(0, Math.min(n - 1, Math.max(d.from, d.to)));
    const nt = { name: d.name.slice(0, 40), from, to, dir: d.dir, color: d.color };
    if (i >= 0) doc.tags[i] = nt; else { doc.tags.push(nt); i = doc.tags.length - 1; }
    S.playTag = i;
  }
  doc.emit("structure");
  animT0 = performance.now(); kickAnim();
}
function renderFrames() {
  const box = $("#frames");
  box.innerHTML = "";
  doc.frames.forEach((f, i) => {
    const el = document.createElement("div");
    el.className = "fr" + (i === doc.frame ? " on" : "");
    el.title = `Frame ${i + 1} · ${f.duration} ms`;
    const c = document.createElement("canvas");
    c.width = doc.w; c.height = doc.h;
    c.getContext("2d").putImageData(new ImageData(doc.compositeFrame(i), doc.w, doc.h), 0, 0);
    el.append(c, String(i + 1));
    const tg = doc.tags.filter((t) => i >= t.from && i <= t.to);
    if (tg.length) { el.style.boxShadow = `inset 0 -4px 0 ${tg[tg.length - 1].color}`; el.title += ` · ${tg.map((t) => t.name).join(", ")}`; }
    if (doc.isLinked(i)) { const b = document.createElement("span"); b.className = "lnk"; b.textContent = "🔗"; b.title = "This layer's cel is linked"; el.appendChild(b); }
    el.addEventListener("click", () => { clearSelection(); doc.setFrame(i); });
    box.appendChild(el);
  });
  const cur = box.children[doc.frame];
  if (cur) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
  const n = doc.frames.length;
  $("#aCount").textContent = n > 1 ? `${doc.frame + 1} / ${n}` : "";
  if (document.activeElement !== $("#aMs")) $("#aMs").value = doc.frames[doc.frame].duration;
  $("#aDel").disabled = n <= 1;
  $("#aLeft").disabled = doc.frame === 0;
  $("#aRight").disabled = doc.frame >= n - 1;
  syncFocusBar();
  $("#aLink").disabled = doc.frame === 0 || !!doc.layer.tilemap;
  $("#aUnlink").disabled = !doc.isLinked();
  renderTags();
}
let frameThumbTimer = null;
function refreshFrameThumb() {
  clearTimeout(frameThumbTimer);
  frameThumbTimer = setTimeout(() => {
    const c = $$("#frames .fr canvas")[doc.frame];
    if (c && c.width === doc.w && c.height === doc.h) c.getContext("2d").putImageData(new ImageData(doc.composite(), doc.w, doc.h), 0, 0);
  }, 150);
}
function wireAnimation() {
  $("#aAdd").addEventListener("click", () => { clearSelection(); doc.addFrame(false); });
  $("#aDup").addEventListener("click", () => { clearSelection(); doc.addFrame(true); });
  $("#aDel").addEventListener("click", () => { clearSelection(); doc.deleteFrame(); });
  $("#aLeft").addEventListener("click", () => { clearSelection(); doc.moveFrame(-1); });
  $("#aRight").addEventListener("click", () => { clearSelection(); doc.moveFrame(1); });
  $("#aMs").addEventListener("change", (e) => doc.setDuration(+e.target.value || 100));
  $("#aAll").addEventListener("click", () => { doc.setDuration(+$("#aMs").value || 100, true); toast("Every frame uses that time now."); });
  $("#aOnion").addEventListener("click", (e) => { S.onion = !S.onion; setToggle(e.currentTarget, S.onion); requestRender(); });
  $("#aPlay").addEventListener("click", (e) => {
    S.playing = !S.playing; setToggle(e.currentTarget, S.playing);
    e.currentTarget.textContent = S.playing ? "❚❚ Pause" : "▶ Play";
    animT0 = performance.now(); kickAnim();
  });
  $("#aPlay").textContent = "❚❚ Pause";
  $("#aTag").addEventListener("change", (e) => { S.playTag = e.target.value === "" ? -1 : +e.target.value; $("#aTagEdit").disabled = S.playTag < 0; animT0 = performance.now(); kickAnim(); });
  $("#aTagAdd").addEventListener("click", () => tagDialog(-1));
  $("#aTagEdit").addEventListener("click", () => tagDialog(S.playTag));
  $("#aLink").addEventListener("click", () => { clearSelection(); if (doc.linkWithPrevious()) toast(`Frames ${doc.frame} and ${doc.frame + 1} now share ${doc.layer.name}'s image.`); });
  $("#aUnlink").addEventListener("click", () => { clearSelection(); doc.unlinkCel(); });
}
function transparencyIsPartial() {
  for (let i = 0; i < doc.frames.length; i++) {
    const px = doc.compositeFrame(i);
    for (let k = 3; k < px.length; k += 4) if (px[k] > 0 && px[k] < 255) return true;
  }
  return false;
}

// ---------------------------------------------------------------- recolor
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
async function recolorDialog() {
  clearSelection();
  doc.syncFrame();
  const st = { scope: "all", over: new Map(), hue: 0, sat: 100, light: 0, pal: "" };
  const inScope = (l) => st.scope === "all" || l.id === doc.layer.id;
  const gather = () => {
    const counts = new Map();
    for (const f of doc.frames) for (const l of doc.layers) {
      if (!inScope(l)) continue;
      const px = f.px[l.id]; if (!px) continue;
      for (let k = 0; k < px.length; k += 4) {
        if (!px[k + 3]) continue;
        const hex = rgbaToHex([px[k], px[k + 1], px[k + 2]]);
        counts.set(hex, (counts.get(hex) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 64).map(([h]) => h);
  };
  const transform = (r, g, b, a) => {
    const o = st.over.get(rgbaToHex([r, g, b]));
    if (o) [r, g, b] = hexToRgba(o);
    if (st.hue || st.sat !== 100 || st.light) {
      let [h, s, l] = rgbToHsl(r, g, b);
      h += st.hue; s = Math.min(1, s * st.sat / 100); l = Math.max(0, Math.min(1, l + st.light / 100));
      [r, g, b] = hslToRgb(h, s, l);
    }
    if (st.pal && PALETTES[st.pal] && PALETTES[st.pal].length) {
      let best = null, bd = Infinity;
      for (const hex of PALETTES[st.pal]) {
        const c = hexToRgba(hex), d = 0.3 * (c[0] - r) ** 2 + 0.59 * (c[1] - g) ** 2 + 0.11 * (c[2] - b) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      [r, g, b] = best;
    }
    return [r, g, b, a];
  };
  const before = doc.composite().slice();
  const drawPrev = (cv, px) => { cv.width = doc.w; cv.height = doc.h; cv.getContext("2d").putImageData(new ImageData(px, doc.w, doc.h), 0, 0); };
  const preview = () => {
    const out = new Uint8ClampedArray(doc.w * doc.h * 4), cache = new Map();
    for (const l of doc.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      let src = l.px;
      if (inScope(l)) {
        const m = new Uint8ClampedArray(src.length);
        for (let k = 0; k < src.length; k += 4) {
          if (!src[k + 3]) continue;
          const key = (src[k] << 16) | (src[k + 1] << 8) | src[k + 2];
          let c = cache.get(key); if (!c) { c = transform(src[k], src[k + 1], src[k + 2], 255); cache.set(key, c); }
          m[k] = c[0]; m[k + 1] = c[1]; m[k + 2] = c[2]; m[k + 3] = src[k + 3];
        }
        src = m;
      }
      blendOver(out, src, l.opacity);
    }
    drawPrev($("#rcAfter"), out);
  };
  const html = `
    <h2>Recolor</h2>
    <p>Change any colour and it changes everywhere it's used${doc.frames.length > 1 ? `, in all ${doc.frames.length} frames` : ""}. One undo puts it all back.</p>
    <div class="row">
      <select id="rcScope"><option value="all">Whole drawing</option><option value="layer">Only the layer "${esc(doc.layer.name)}"</option></select>
      <span class="spacer"></span><button type="button" id="rcReset">Reset</button>
    </div>
    <div class="rcPrev"><canvas id="rcBefore" title="Before"></canvas><canvas id="rcAfter" title="After"></canvas></div>
    <div class="recolor" id="rcList"></div>
    <div class="sliders">
      <span>Hue</span><input type="range" id="rcHue" min="-180" max="180" value="0"><span id="rcHueV">0°</span>
      <span>Saturation</span><input type="range" id="rcSat" min="0" max="200" value="100"><span id="rcSatV">100%</span>
      <span>Brightness</span><input type="range" id="rcLight" min="-50" max="50" value="0"><span id="rcLightV">0</span>
    </div>
    <div class="grid2"><label for="rcPal">Snap to palette</label>
      <select id="rcPal"><option value="">Off</option>${Object.keys(PALETTES).filter((p) => PALETTES[p].length).map((p) => `<option>${esc(p)}</option>`).join("")}</select></div>
    <div class="btns"><button value="cancel">Cancel</button><button value="apply" class="primary">Apply</button></div>`;
  const r = await dialog(html, null, (f) => {
    drawPrev(f.querySelector("#rcBefore"), before);
    const list = () => {
      const box = f.querySelector("#rcList");
      box.innerHTML = "";
      for (const hex of gather()) {
        const row = document.createElement("label");
        row.className = "rc";
        const sw = document.createElement("span"); sw.className = "sw"; sw.style.setProperty("--c", hex);
        const inp = document.createElement("input"); inp.type = "color"; inp.value = st.over.get(hex) || hex; inp.title = `Replace ${hex}`;
        inp.addEventListener("input", () => { if (inp.value === hex) st.over.delete(hex); else st.over.set(hex, inp.value); preview(); });
        row.append(sw, "→", inp, hex);
        box.appendChild(row);
      }
    };
    list(); preview();
    f.querySelector("#rcScope").addEventListener("change", (e) => { st.scope = e.target.value; list(); preview(); });
    const slider = (id, key, fmt) => f.querySelector(id).addEventListener("input", (e) => { st[key] = +e.target.value; f.querySelector(id + "V").textContent = fmt(st[key]); preview(); });
    slider("#rcHue", "hue", (v) => `${v}°`); slider("#rcSat", "sat", (v) => `${v}%`); slider("#rcLight", "light", (v) => `${v > 0 ? "+" : ""}${v}`);
    f.querySelector("#rcPal").addEventListener("change", (e) => { st.pal = e.target.value; preview(); });
    f.querySelector("#rcReset").addEventListener("click", () => {
      st.over.clear(); st.hue = 0; st.sat = 100; st.light = 0; st.pal = "";
      for (const [id, v] of [["#rcHue", 0], ["#rcSat", 100], ["#rcLight", 0]]) f.querySelector(id).value = v;
      f.querySelector("#rcHueV").textContent = "0°"; f.querySelector("#rcSatV").textContent = "100%"; f.querySelector("#rcLightV").textContent = "0";
      f.querySelector("#rcPal").value = ""; list(); preview();
    });
  });
  if (r !== "apply") return;
  if (!st.over.size && !st.hue && st.sat === 100 && !st.light && !st.pal) return;
  doc.recolor(transform, st.scope === "layer" ? doc.layer.id : null);
  toast("Recolored. Ctrl+Z undoes it.");
}

// ---------------------------------------------------------------- RPG assets
let assetCat = "Tiles";
async function assetDialog() {
  if (doc.mode !== "art") return;
  const rpg = rpgAssets(), rpgCats = new Set(rpg.map((a) => a.cat));
  const all = [...rpg, ...(await packAssets())];
  const cats = [...new Set(all.map((a) => a.cat))];
  let sel = null, raf = null;
  const thumb = (a, frame = 0) => {
    const c = document.createElement("canvas");
    c.width = a.w; c.height = a.h;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(a.frames[frame]), a.w, a.h), 0, 0);
    return c;
  };
  const html = `
    <h2>Assets</h2>
    <p>The RPG tabs are original 16×16 tiles, items and characters made for this app, free to use in anything. Import adds packs you've downloaded (a PNG sprite sheet or a .zip of PNGs). Paste one into your drawing to build a scene, or open it on its own.</p>
    <div class="assetTabs">${cats.map((c) => `<button type="button" data-cat="${esc(c)}"${rpgCats.has(c) ? "" : ' class="pack"'}>${esc(c)}</button>`).join("")}<button value="import" id="aImport" title="Import a downloaded asset pack">+ Import pack</button></div>
    <div class="assetGrid" id="assetGrid"></div>
    <div class="assetPick"><canvas id="assetPrev"></canvas><div id="assetInfo" class="dim">Pick something above.</div></div>
    <div class="btns">
      <button value="cancel">Close</button>
      <button value="removepack" id="aRemove" hidden>Remove this pack</button>
      <button value="sheet" id="aSheet">Whole set as sprite sheet</button>
      <button value="open" id="aOpen" disabled>Open as new drawing</button>
      <button value="paste" id="aPaste" class="primary" disabled>Paste into drawing</button>
    </div>`;
  const r = await dialog(html, null, (f) => {
    const grid = f.querySelector("#assetGrid"), prev = f.querySelector("#assetPrev");
    const animate = () => {
      cancelAnimationFrame(raf);
      if (!sel || !dlg.open) return;
      const n = sel.frames.length, i = n > 1 ? Math.floor(performance.now() / sel.duration) % n : 0;
      prev.width = sel.w; prev.height = sel.h;
      prev.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(sel.frames[i]), sel.w, sel.h), 0, 0);
      if (n > 1) raf = requestAnimationFrame(animate);
    };
    const show = (cat) => {
      assetCat = cat;
      f.querySelectorAll(".assetTabs button").forEach((b) => b.classList.toggle("on", b.dataset.cat === cat));
      grid.innerHTML = "";
      f.querySelector("#aSheet").disabled = cat === "Maps";
      f.querySelector("#aSheet").hidden = !rpgCats.has(cat);
      f.querySelector("#aRemove").hidden = rpgCats.has(cat);
      for (const a of all.filter((x) => x.cat === cat)) {
        const el = document.createElement("div");
        el.className = "asset" + (sel === a ? " on" : "");
        el.append(thumb(a), a.name + (a.frames.length > 1 ? ` · ${a.frames.length}f` : ""));
        el.addEventListener("click", () => {
          sel = a;
          grid.querySelectorAll(".asset").forEach((x) => x.classList.toggle("on", x === el));
          const fits = a.w <= doc.w && a.h <= doc.h;
          f.querySelector("#aOpen").disabled = false;
          f.querySelector("#aPaste").disabled = !fits;
          f.querySelector("#assetInfo").textContent = `${a.name}: ${a.w}×${a.h}${a.frames.length > 1 ? `, ${a.frames.length} frames` : ""}.` +
            (fits ? (a.frames.length > 1 ? " Pasting uses the first frame; open it on its own to keep the animation." : "") : ` Bigger than this ${doc.w}×${doc.h} drawing, so open it on its own.`);
          animate();
        });
        el.addEventListener("dblclick", () => { if (a.w <= doc.w && a.h <= doc.h) f.querySelector("#aPaste").click(); });
        grid.appendChild(el);
      }
    };
    f.querySelectorAll(".assetTabs button[data-cat]").forEach((b) => b.addEventListener("click", () => show(b.dataset.cat)));
    show(cats.includes(assetCat) ? assetCat : cats[0]);
  });
  cancelAnimationFrame(raf);
  if (r === "import") { await importPackDialog(); return assetDialog(); }
  if (r === "removepack") {
    const pk = (packCache || []).find((p) => p.name === assetCat);
    if (pk && (await choose("Remove pack?", `Removes “${pk.name}” (${pk.assets.length} assets) from this browser. Drawings you already made with it stay as they are.`, [["yes", "Remove"], ["no", "Keep it"]])) === "yes") {
      await packs.deletePack(pk.id); packCache = null; assetCat = "Tiles";
    }
    return assetDialog();
  }
  if (r === "paste" && sel) {
    pasteClip({ w: sel.w, h: sel.h, px: new Uint8ClampedArray(sel.frames[0]) });
    toast("Drag it where you want it, then press Enter. Ctrl+V pastes another.");
    S.clip = { w: sel.w, h: sel.h, px: new Uint8ClampedArray(sel.frames[0]) };
  } else if (r === "open" && sel) {
    const d = new Doc({ w: sel.w, h: sel.h, mode: "art", name: sel.name });
    const id = d.layers[0].id;
    d.layers[0].name = sel.name;
    d.frames = sel.frames.map((px) => ({ duration: sel.duration, px: { [id]: new Uint8ClampedArray(px) } }));
    d.loadFrame(0); d.dirty = true;
    setDoc(d); autosave();
  } else if (r === "sheet") {
    const sh = categorySheet(assetCat);
    const d = new Doc({ w: sh.w, h: sh.h, mode: "art", name: `RPG ${assetCat.toLowerCase()} sheet` });
    d.layers[0].px = new Uint8ClampedArray(sh.px); d.layers[0].name = assetCat; d.dirty = true;
    setDoc(d); autosave();
    toast(`${sh.count} ${assetCat.toLowerCase()} on a 16×16 grid. Export → PNG at 1× for a game engine.`);
  }
}


// ---------------------------------------------------------------- .aseprite
const gid = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function aseToDoc(r, name) {
  const d = new Doc({ w: r.w, h: r.h, mode: "art", name });
  const groupOf = new Map(), layers = [], idOf = new Map();
  r.layers.forEach((L, idx) => {
    if (L.type === 1) {
      if (L.level === 0) { const g = { id: gid(), name: L.name.slice(0, 40), visible: L.visible, opacity: L.opacity, collapsed: L.collapsed }; d.groups.push(g); groupOf.set(idx, g.id); }
      return;
    }
    const l = newLayer(r.w, r.h, L.name.slice(0, 60) || "Layer");
    const hiddenParent = L.parents.slice(1).some((pi) => r.layers[pi] && !r.layers[pi].visible);
    l.visible = L.visible && !hiddenParent; l.opacity = L.opacity;
    l.blend = BLEND_MODES[L.blend] ? L.blend : "normal";
    l.group = L.parents.length ? groupOf.get(L.parents[0]) || null : null;
    l._ase = L;
    idOf.set(idx, l.id); layers.push(l);
  });
  if (!layers.length) return d;
  d.frames = r.frames.map((f) => ({ duration: Math.max(20, f.duration), px: {} }));
  r.frames.forEach((f, fi) => { for (const c of f.cels) if (c.px && idOf.has(c.li)) d.frames[fi].px[idOf.get(c.li)] = c.px; });
  r.frames.forEach((f, fi) => {
    for (const c of f.cels) {
      if (c.link === undefined || !idOf.has(c.li)) continue;
      const id = idOf.get(c.li), src = d.frames[c.link];
      if (!src) continue;
      src.links = src.links || {}; d.frames[fi].links = d.frames[fi].links || {};
      const g = src.links[id] || gid();
      src.links[id] = g; d.frames[fi].links[id] = g;
      if (src.px[id]) d.frames[fi].px[id] = src.px[id];
    }
  });
  for (const l of layers) {
    const L = l._ase; delete l._ase;
    const ti = L.tileInfo;
    if (L.type === 2 && ti && ti.ox % ti.tw === 0 && ti.oy % ti.th === 0) {
      const px = d.frames[0].px[l.id] || new Uint8ClampedArray(r.w * r.h * 4);
      l.tilemap = buildTilemap(px, r.w, r.h, ti.tw, ti.th);
      l.px = renderTilemap(l.tilemap, r.w, r.h);
    }
  }
  d.layers = layers;
  d.tags = r.tags.filter((t) => t.to < d.frames.length);
  d.slices = r.slices;
  d.palette = r.palette && r.palette.length ? r.palette.slice(0, 256) : null;
  d.loadFrame(0);
  d.active = layers.length - 1;
  d.undoStack = []; d.redoStack = [];
  d.dirty = true;
  return d;
}
async function downloadAse() {
  try {
    const bytes = await writeAse(doc);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    store.download(url, `${store.safeName(doc.name)}.aseprite`);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    if (doc.layers.some((l) => l.tilemap)) toast("Tilemap layers were saved as normal pixel layers in the .aseprite file.");
  } catch (e) { toast(`Couldn't make the .aseprite file: ${e.message}`); }
}

// ---------------------------------------------------------------- tilemap layers
function tilemapAfterPaint() {
  const l = doc.layer;
  if (!l || !l.tilemap) return;
  const tm = syncTilemap(l.tilemap, l.px, doc.w, doc.h);
  doc.layers[doc.active] = { ...l, tilemap: tm, px: renderTilemap(tm, doc.w, doc.h) };
  doc.emit("structure");
}
async function tilemapDialog() {
  clearSelection();
  const l = doc.layer;
  if (l.tilemap) {
    const r = await choose(`Tilemap: ${l.name}`, `${l.tilemap.tiles.length - 1} tiles of ${l.tilemap.tw}×${l.tilemap.th} in a ${l.tilemap.cols}×${l.tilemap.rows} grid.`, [["prune", "Remove unused tiles"], ["sheet", "Open tileset as a drawing"], ["flatten", "Turn back into a normal layer"], ["cancel", "Close"]]);
    if (r === "prune") { doc.beginStructure(); doc.layers[doc.active] = { ...l, tilemap: pruneTiles(l.tilemap) }; doc.emit("structure"); }
    if (r === "flatten") {
      doc.beginStructure();
      const px = l.px.slice(), nl = { ...l, px }; delete nl.tilemap;
      doc.layers[doc.active] = nl;
      doc.frames.forEach((f) => { f.px[l.id] = px.slice(); });
      doc.loadFrame(doc.frame); doc.emit("structure");
    }
    if (r === "sheet") {
      const tm = l.tilemap, n = tm.tiles.length - 1, cols = Math.min(8, Math.max(1, n)), rows = Math.max(1, Math.ceil(n / cols));
      const d = new Doc({ w: cols * tm.tw, h: rows * tm.th, mode: "art", name: `${l.name} tileset` });
      const px = d.layers[0].px;
      tm.tiles.slice(1).forEach((t, i) => { const cx = (i % cols) * tm.tw, cy = Math.floor(i / cols) * tm.th; for (let j = 0; j < tm.th; j++) px.set(t.subarray(j * tm.tw * 4, (j + 1) * tm.tw * 4), ((cy + j) * d.w + cx) * 4); });
      d.dirty = true; setDoc(d); autosave();
    }
    return;
  }
  const r = await dialog(`<h2>Make a tilemap layer</h2>
    <p>Cuts <b>${esc(l.name)}</b> into a grid of tiles and keeps one copy of each different tile. Paint inside any cell and every cell using that tile changes too. "Place tiles" stamps tiles from the tileset.</p>
    <div class="grid2"><label for="tmW">Tile size</label><span><input type="number" id="tmW" min="2" max="128" value="16" style="width:64px"> × <input type="number" id="tmH" min="2" max="128" value="16" style="width:64px"></span></div>
    ${doc.frames.length > 1 ? "<p class=\"dim\">Tilemap layers stay the same in every frame. This frame's pixels are used.</p>" : ""}
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Make tilemap</button></div>`,
  () => ({ tw: +$("#tmW").value | 0, th: +$("#tmH").value | 0 }));
  if (!r || r.value !== "ok") return;
  const tw = Math.max(2, Math.min(128, r.data.tw || 16)), th = Math.max(2, Math.min(128, r.data.th || 16));
  doc.beginStructure();
  const tm = buildTilemap(l.px, doc.w, doc.h, tw, th), px = renderTilemap(tm, doc.w, doc.h);
  doc.layers[doc.active] = { ...l, tilemap: tm, px };
  doc.frames.forEach((f) => { f.px[l.id] = px; if (f.links) delete f.links[l.id]; });
  S.tilePick = Math.min(1, tm.tiles.length - 1);
  doc.emit("structure");
  toast(`${tm.tiles.length - 1} different tiles found.`);
}
function renderTileset() {
  const l = doc.layer, box = $("#tilesetBox");
  box.hidden = !(l && l.tilemap) || doc.mode !== "art";
  if (box.hidden) { if (S.tileStamp) { S.tileStamp = false; setToggle($("#tsStamp"), false); } return; }
  const tm = l.tilemap, grid = $("#tsGrid");
  $("#tsInfo").textContent = ` ${tm.tiles.length - 1} tiles · ${tm.tw}×${tm.th}`;
  grid.innerHTML = "";
  tm.tiles.forEach((t, i) => {
    const c = document.createElement("canvas");
    c.width = tm.tw; c.height = tm.th; c.title = i ? `Tile ${i}` : "Empty (clears a cell)";
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(t), tm.tw, tm.th), 0, 0);
    c.className = i === S.tilePick ? "on" : "";
    c.addEventListener("click", () => { S.tilePick = i; if (!S.tileStamp) { S.tileStamp = true; setToggle($("#tsStamp"), true); } renderTileset(); });
    grid.appendChild(c);
  });
}
function stampTile(x, y, idx) {
  const l = doc.layer, tm = l.tilemap;
  [x, y] = wrapXY(x, y);
  const next = placeTile(tm, Math.floor(x / tm.tw), Math.floor(y / tm.th), idx);
  if (next === tm) return;
  doc.layers[doc.active] = { ...l, tilemap: next, px: renderTilemap(next, doc.w, doc.h) };
  doc.emit();
}

// ---------------------------------------------------------------- outline
async function outlineDialog() {
  commitFloat();
  const hex = rgbaToHex(S.primary);
  const r = await dialog(`<h2>Outline</h2>
    <p>Draws a one-pixel line around everything on <b>${esc(doc.layer.name)}</b>${S.sel ? " inside the selection" : ""}, in your left-click colour <span class="sw inline" style="--c:${hex}"></span> ${hex}.</p>
    <div class="grid2">
      <label for="olWhere">Where</label><select id="olWhere"><option value="out">Outside the shape</option><option value="in">Inside the edge</option></select>
      <label for="olCorners">Corners</label><select id="olCorners"><option value="0">Sides only (rounder)</option><option value="1">Include corners (squarer)</option></select>
      <label for="olLayer">Put it on</label><select id="olLayer"><option value="same">This layer</option><option value="new">A new layer below</option></select>
    </div>
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Add outline</button></div>`,
  () => ({ where: $("#olWhere").value, corners: $("#olCorners").value === "1", layer: $("#olLayer").value }));
  if (!r || r.value !== "ok") return;
  const { w, h } = doc, src = doc.layer.px.slice(), c = S.primary.slice();
  const R = selRect() || { x: 0, y: 0, w, h };
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  const nb = r.data.corners ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const hits = [];
  for (let y = R.y; y < R.y + R.h; y++) for (let x = R.x; x < R.x + R.w; x++) {
    if (r.data.where === "out" ? solid(x, y) : !solid(x, y)) continue;
    if (nb.some(([dx, dy]) => (r.data.where === "out" ? solid(x + dx, y + dy) : !solid(x + dx, y + dy)))) hits.push([x, y]);
  }
  if (!hits.length) { toast("Nothing on this layer to outline."); return; }
  if (r.data.layer === "new" && r.data.where === "out") {
    const name = `${doc.layer.name} outline`;
    doc.addLayer(name); doc.moveLayer(-1);
    for (const [x, y] of hits) doc.set(x, y, c);
    doc.emit("structure");
  } else {
    doc.begin();
    for (const [x, y] of hits) doc.set(x, y, c);
    doc.emit();
  }
  toast(`Outlined ${hits.length} pixels.`);
}

// ---------------------------------------------------------------- reference image
async function referenceDialog() {
  const cur = S.ref;
  const r = await dialog(`<h2>Reference image</h2>
    <p>Shows a photo or sketch with the canvas so you can trace it. It's only a guide: it isn't saved in the drawing or exported.</p>
    <div class="grid2">
      <label for="rfFile">Image</label><input type="file" id="rfFile" accept="image/*">
      <label for="rfOp">Opacity</label><input type="range" id="rfOp" min="5" max="100" value="${Math.round((cur ? cur.opacity : 0.5) * 100)}">
      <label for="rfTop">Show it</label><select id="rfTop"><option value="0">Behind the drawing</option><option value="1" ${cur && cur.top ? "selected" : ""}>On top (see-through)</option></select>
      <label for="rfFit">Size</label><select id="rfFit"><option value="fit">Fit inside the canvas</option><option value="stretch" ${cur && cur.fit === "stretch" ? "selected" : ""}>Stretch to the canvas</option></select>
    </div>
    <div class="btns">${cur ? `<button value="remove">Remove</button><button value="toggle">${cur.show ? "Hide" : "Show"}</button>` : ""}<button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">OK</button></div>`,
  () => ({ file: $("#rfFile").files[0], op: +$("#rfOp").value / 100, top: $("#rfTop").value === "1", fit: $("#rfFit").value }),
  (form) => {
    // live opacity while the dialog is open
    form.querySelector("#rfOp").addEventListener("input", (e) => { if (S.ref) { S.ref.opacity = e.target.value / 100; requestRender(); } });
  });
  if (!r) return;
  if (r.value === "remove") { if (S.ref) URL.revokeObjectURL(S.ref.url); S.ref = null; requestRender(); return; }
  if (r.value === "toggle" && S.ref) { S.ref.show = !S.ref.show; requestRender(); return; }
  if (r.value !== "ok") return;
  if (r.data.file) {
    const url = URL.createObjectURL(r.data.file);
    try {
      const img = await store.loadImage(url);
      if (S.ref) URL.revokeObjectURL(S.ref.url);
      S.ref = { img, url, show: true, opacity: r.data.op, top: r.data.top, fit: r.data.fit };
    } catch { URL.revokeObjectURL(url); toast("Couldn't open that image."); return; }
  } else if (S.ref) Object.assign(S.ref, { opacity: r.data.op, top: r.data.top, fit: r.data.fit, show: true });
  else { toast("Pick an image first."); return; }
  requestRender();
}

// ---------------------------------------------------------------- palettes: import, export, ramps
function parsePalette(text) {
  const out = [];
  const add = (r, g, b) => { const h = rgbaToHex([r, g, b, 255]); if (!out.includes(h)) out.push(h); };
  const lines = text.split(/\r?\n/);
  if (/^GIMP Palette/i.test(lines[0]) || /^JASC-PAL/i.test(lines[0])) {
    for (const ln of lines.slice(1)) {
      const m = ln.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/);
      if (m) add(+m[1], +m[2], +m[3]);
    }
  } else {
    for (const m of text.matchAll(/#?\b([0-9a-f]{6}|[0-9a-f]{8})\b/gi)) {
      const v = m[1].length === 8 ? m[1].slice(2) : m[1]; // Paint.NET writes AARRGGBB
      add(parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16));
    }
  }
  return out.slice(0, 256);
}
function addPalette(name, list) {
  let n = name.slice(0, 40) || "Imported", k = 2;
  while (PALETTES[n] && !customPalettes[n]) n = `${name.slice(0, 36)} ${k++}`;
  PALETTES[n] = list; customPalettes[n] = list;
  S.palette = n; buildPalette(); persistPrefs();
  return n;
}
function pickFile(accept, multiple = false) {
  return new Promise((res) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept; i.multiple = multiple;
    i.addEventListener("change", () => res(multiple ? [...i.files] : i.files[0] || null), { once: true });
    i.click();
  });
}
function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  store.download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function paletteMenu() {
  const list = PALETTES[S.palette] || [];
  const custom = !!customPalettes[S.palette];
  const r = await choose(`Palette: ${S.palette}`, `${list.length} colours. Import works with .hex, .gpl, .pal and .txt files (Lospec downloads, GIMP, Aseprite, Paint.NET) or a PNG of swatches.`, [
    ["ramp", "Colour ramp…"], ["import", "Import palette file"], ["drawing", "Make one from this drawing"],
    ...(list.length ? [["hex", "Download .hex"], ["gpl", "Download .gpl"]] : []),
    ...(custom ? [["delete", "Delete this palette"]] : []), ["cancel", "Close"],
  ]);
  const base = store.safeName(S.palette);
  if (r === "ramp") return rampDialog();
  if (r === "hex") downloadText(list.map((h) => h.slice(1)).join("\n") + "\n", `${base}.hex`);
  if (r === "gpl") downloadText(`GIMP Palette\nName: ${S.palette}\nColumns: 8\n#\n` + list.map((h) => { const [a, b, c] = hexToRgba(h); return `${String(a).padStart(3)} ${String(b).padStart(3)} ${String(c).padStart(3)}\t${h}`; }).join("\n") + "\n", `${base}.gpl`);
  if (r === "delete") { delete customPalettes[S.palette]; delete PALETTES[S.palette]; S.palette = "Pixels 32"; buildPalette(); persistPrefs(); }
  if (r === "drawing") {
    const seen = new Set(), px = doc.composite();
    for (let k = 0; k < px.length && seen.size < 256; k += 4) if (px[k + 3]) seen.add(rgbaToHex([px[k], px[k + 1], px[k + 2], 255]));
    if (!seen.size) return toast("This drawing has no colours yet.");
    const n = addPalette(doc.name || "From drawing", [...seen]);
    toast(`Saved ${seen.size} colours as “${n}”.`);
  }
  if (r === "import") {
    const f = await pickFile(".hex,.gpl,.pal,.txt,image/png");
    if (!f) return;
    let cols = [];
    if (/\.png$/i.test(f.name) || f.type === "image/png") {
      const im = await packs.decodePNG(new Uint8Array(await f.arrayBuffer()));
      const seen = new Set();
      for (let k = 0; k < im.px.length && seen.size < 256; k += 4) if (im.px[k + 3] > 127) seen.add(rgbaToHex([im.px[k], im.px[k + 1], im.px[k + 2], 255]));
      cols = [...seen];
    } else cols = parsePalette(await f.text());
    if (!cols.length) return toast("Couldn't find any colours in that file.");
    const n = addPalette(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), cols);
    toast(`Imported ${cols.length} colours as “${n}”.`);
  }
}
// Shades of one colour: darker steps drift toward blue, lighter toward yellow, like hand-made ramps.
function makeRamp(hex, n, shift, spread) {
  const [r, g, b] = hexToRgba(hex), [h, s, l] = rgbToHsl(r, g, b);
  const toward = (from, to, amt) => { let d = ((to - from + 540) % 360) - 180; return from + Math.sign(d) * Math.min(Math.abs(d), amt); };
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const L = t < 0 ? l * (1 + t * spread) : l + (1 - l) * t * spread;
    const H = s < 0.04 ? h : toward(h, t < 0 ? 245 : 55, Math.abs(t) * shift);
    const Sa = Math.min(1, s * (1 + 0.15 * (1 - Math.abs(t)) - 0.2 * Math.abs(t)));
    out.push(rgbaToHex([...hslToRgb(H, Sa, Math.max(0, Math.min(1, L))), 255]));
  }
  return out;
}
function blendRamp(a, b, n) {
  const A = hexToRgba(a), B = hexToRgba(b), out = [];
  for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); out.push(rgbaToHex([0, 1, 2].map((k) => Math.round(A[k] + (B[k] - A[k]) * t)).concat(255))); }
  return out;
}
async function rampDialog() {
  const sec = S.secondary[3] ? rgbaToHex(S.secondary) : "#1a1424";
  let ramp = [];
  const r = await dialog(`<h2>Colour ramp</h2>
    <div class="grid2">
      <label for="rpMode">Kind</label><select id="rpMode"><option value="shade">Shades of one colour</option><option value="blend">Blend between two colours</option></select>
      <label for="rpA">Colour</label><input type="color" id="rpA" value="${rgbaToHex(S.primary)}">
      <label for="rpB" class="rpBlend">To</label><input type="color" id="rpB" class="rpBlend" value="${sec}">
      <label for="rpN">Steps</label><input type="range" id="rpN" min="3" max="12" value="7">
      <label for="rpShift" class="rpShade">Hue shift</label><input type="range" id="rpShift" class="rpShade" min="0" max="60" value="24">
      <label for="rpSpread" class="rpShade">Contrast</label><input type="range" id="rpSpread" class="rpShade" min="30" max="95" value="80">
    </div>
    <div class="palette" id="rpOut"></div>
    <p class="dim">Hue shift tilts shadows toward blue and highlights toward yellow, so they don't look grey or muddy. Click a swatch to use it.</p>
    <div class="btns"><button value="cancel" formnovalidate>Close</button><button value="mine">Add to My colours</button><button value="save" class="primary">Save as palette</button></div>`,
  () => ramp.slice(),
  (form) => {
    const q = (id) => form.querySelector(id);
    const update = () => {
      const blend = q("#rpMode").value === "blend";
      form.querySelectorAll(".rpBlend").forEach((e) => (e.hidden = !blend));
      form.querySelectorAll(".rpShade").forEach((e) => (e.hidden = blend));
      const n = +q("#rpN").value;
      ramp = blend ? blendRamp(q("#rpA").value, q("#rpB").value, n) : makeRamp(q("#rpA").value, n, +q("#rpShift").value, +q("#rpSpread").value / 100);
      const box = q("#rpOut"); box.innerHTML = "";
      ramp.forEach((h) => box.appendChild(swatch(h, setColor)));
    };
    form.querySelectorAll("input,select").forEach((e) => e.addEventListener("input", update));
    update();
  });
  if (!r || !r.data.length) return;
  if (r.value === "mine") { const m = PALETTES["My colours"]; for (const h of r.data) if (!m.includes(h)) m.push(h); PALETTES["My colours"] = m.slice(-60); S.palette = "My colours"; buildPalette(); persistPrefs(); toast(`Added ${r.data.length} colours to My colours.`); }
  if (r.value === "save") { const n = addPalette(`Ramp ${r.data[Math.floor(r.data.length / 2)]}`, r.data); toast(`Saved as “${n}”.`); }
}

// ---------------------------------------------------------------- imported asset packs
let packCache = null;
async function packAssets() {
  if (!packCache) packCache = await packs.listPacks();
  return packCache.flatMap((p) => p.assets.map((a, i) => ({ id: `${p.id}:${i}`, name: a.name, cat: p.name, pack: p.id, w: a.w, h: a.h, frames: [a.px], duration: 150 })));
}
async function importPackDialog() {
  const files = await pickFile(".zip,image/png", true);
  if (!files || !files.length) return false;
  toast("Reading files…");
  let read;
  try { read = await packs.readFiles(files, (m) => toast(m)); } catch (e) { toast(e.message); return false; }
  if (!read.images.length) { toast("No PNG images found in that."); return false; }
  const big = read.images.filter((im) => im.w > 32 || im.h > 32).length;
  const guessName = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") : "My pack";
  let preview = [];
  const r = await dialog(`<h2>Import asset pack</h2>
    <p>Found ${read.images.length} image${read.images.length > 1 ? "s" : ""}${big ? `, ${big} of them big enough to be sprite sheets` : ""}. Packs stay in this browser.</p>
    <div class="grid2">
      <label for="pkName">Name</label><input type="text" id="pkName" maxlength="40" value="${esc(guessName)}">
      <label for="pkSlice">Sprite sheets</label><select id="pkSlice"><option value="1" ${big ? "selected" : ""}>Cut into tiles</option><option value="0" ${big ? "" : "selected"}>Keep each image whole</option></select>
      <label for="pkTW">Tile size</label><span><input type="number" id="pkTW" min="4" max="256" value="16" style="width:64px"> × <input type="number" id="pkTH" min="4" max="256" value="16" style="width:64px"></span>
      <label for="pkSp">Gap between tiles</label><input type="number" id="pkSp" min="0" max="16" value="0">
      <label for="pkMg">Margin around sheet</label><input type="number" id="pkMg" min="0" max="16" value="0">
    </div>
    <p class="dim" id="pkCount"></p>
    <p class="dim">Free packs (Kenney is CC0; OpenGameArt varies) each have their own license. ${read.license ? `This pack says: “${esc(read.license.slice(0, 220))}${read.license.length > 220 ? "…" : ""}”` : "Check the pack's page before using it in something you publish."}</p>
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Import</button></div>`,
  () => ({ name: $("#pkName").value.trim() }),
  (form) => {
    const q = (id) => form.querySelector(id);
    const update = () => {
      preview = packs.sliceImages(read.images, { slice: q("#pkSlice").value === "1", tw: +q("#pkTW").value || 16, th: +q("#pkTH").value || 16, spacing: +q("#pkSp").value || 0, margin: +q("#pkMg").value || 0 });
      q("#pkCount").textContent = `${preview.length} assets${preview.length >= 3000 ? " (the most one pack can hold)" : ""}.`;
    };
    form.querySelectorAll("input,select").forEach((e) => e.addEventListener("change", update));
    update();
  });
  if (!r || r.value !== "ok" || !preview.length) return false;
  const pack = { id: `p${Date.now().toString(36)}`, name: (r.data.name || guessName).slice(0, 40), license: read.license, added: Date.now(), assets: preview };
  try { await packs.savePack(pack); } catch (e) { toast(e.message || "Couldn't save the pack."); return false; }
  packCache = null;
  assetCat = pack.name;
  toast(`Imported ${preview.length} assets into “${pack.name}”.`);
  return true;
}


// ---------------------------------------------------------------- slices and 9-patch
async function addSlice(r) {
  const name = await promptText("Name this slice", `Slice ${doc.slices.length + 1}`);
  if (!name) return;
  doc.beginStructure();
  doc.slices.push({ name: name.slice(0, 40), x: r.x, y: r.y, w: r.w, h: r.h, center: null });
  doc.emit("structure");
  toast("Slice added. Click it with the slice tool to set 9-patch borders.");
}
function ninePatch(px, W, sl, outW, outH) {
  // stretch a 9-patch: corners stay, edges and centre stretch
  const c = sl.center, out = new Uint8ClampedArray(outW * outH * 4);
  const L = c.x, T = c.y, R = sl.w - c.x - c.w, B = sl.h - c.y - c.h;
  const mapAxis = (o, size, a, b, outSize) => (o < a ? o : o >= outSize - b ? size - (outSize - o) : a + Math.floor(((o - a) * (size - a - b)) / Math.max(1, outSize - a - b)));
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const sx = sl.x + mapAxis(x, sl.w, L, R, outW), sy = sl.y + mapAxis(y, sl.h, T, B, outH);
    out.set(px.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * outW + x) * 4);
  }
  return out;
}
async function sliceDialog(i) {
  const sl = doc.slices[i];
  const c = sl.center || { x: Math.floor(sl.w / 3), y: Math.floor(sl.h / 3), w: Math.max(1, sl.w - 2 * Math.floor(sl.w / 3)), h: Math.max(1, sl.h - 2 * Math.floor(sl.h / 3)) };
  const r = await dialog(`<h2>Slice: ${esc(sl.name)}</h2>
    <div class="grid2">
      <label for="slN">Name</label><input type="text" id="slN" maxlength="40" value="${esc(sl.name)}">
      <label>Area</label><span><input type="number" id="slX" value="${sl.x}" style="width:56px"> <input type="number" id="slY" value="${sl.y}" style="width:56px"> <input type="number" id="slW" min="1" value="${sl.w}" style="width:56px"> × <input type="number" id="slH" min="1" value="${sl.h}" style="width:56px"></span>
      <label for="sl9">9-patch</label><input type="checkbox" id="sl9" ${sl.center ? "checked" : ""}>
      <label>Borders</label><span>left <input type="number" id="slL" min="0" value="${c.x}" style="width:48px"> top <input type="number" id="slT" min="0" value="${c.y}" style="width:48px"> right <input type="number" id="slR" min="0" value="${sl.w - c.x - c.w}" style="width:48px"> bottom <input type="number" id="slB" min="0" value="${sl.h - c.y - c.h}" style="width:48px"></span>
    </div>
    <p class="dim">A 9-patch keeps its corners and stretches the edges and middle, for UI panels and buttons. Preview at 3× the size:</p>
    <canvas id="slPrev" class="slPrev"></canvas>
    <div class="btns"><button value="delete">Delete slice</button><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Save</button></div>`,
  () => ({ name: $("#slN").value.trim() || sl.name, x: +$("#slX").value, y: +$("#slY").value, w: +$("#slW").value, h: +$("#slH").value, nine: $("#sl9").checked, L: +$("#slL").value, T: +$("#slT").value, R: +$("#slR").value, B: +$("#slB").value }),
  (form) => {
    const draw = () => {
      const q = (id) => +form.querySelector(id).value;
      const t = { x: q("#slX"), y: q("#slY"), w: Math.max(1, q("#slW")), h: Math.max(1, q("#slH")) };
      const cv = form.querySelector("#slPrev"), comp = doc.composite();
      if (t.x < 0 || t.y < 0 || t.x + t.w > doc.w || t.y + t.h > doc.h) return;
      const ow = t.w * 3, oh = t.h * 3;
      t.center = form.querySelector("#sl9").checked ? { x: q("#slL"), y: q("#slT"), w: Math.max(1, t.w - q("#slL") - q("#slR")), h: Math.max(1, t.h - q("#slT") - q("#slB")) } : null;
      const out = t.center ? ninePatch(comp, doc.w, t, ow, oh) : transformPx(regionFrom(comp, t), t.w, t.h, ow, oh, 0).px;
      cv.width = ow; cv.height = oh;
      cv.getContext("2d").putImageData(new ImageData(out, ow, oh), 0, 0);
    };
    form.querySelectorAll("input").forEach((e) => e.addEventListener("input", draw));
    draw();
  });
  if (!r || r.value === "cancel") return;
  doc.beginStructure();
  if (r.value === "delete") doc.slices.splice(i, 1);
  else {
    const d = r.data, w = Math.max(1, d.w | 0), h = Math.max(1, d.h | 0);
    doc.slices[i] = { name: d.name.slice(0, 40), x: d.x | 0, y: d.y | 0, w, h, center: d.nine ? { x: Math.max(0, d.L | 0), y: Math.max(0, d.T | 0), w: Math.max(1, w - (d.L | 0) - (d.R | 0)), h: Math.max(1, h - (d.T | 0) - (d.B | 0)) } : null };
  }
  doc.emit("structure");
}
function regionFrom(px, r) {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let j = 0; j < r.h; j++) out.set(px.subarray(((r.y + j) * doc.w + r.x) * 4, ((r.y + j) * doc.w + r.x + r.w) * 4), j * r.w * 4);
  return out;
}

// ---------------------------------------------------------------- indexed colour mode
const DOC_PAL = "This drawing (indexed)";
let nearCache = { pal: null, key: "", fn: null };
function nearPal() {
  const key = doc.palette.join("");
  if (nearCache.key !== key) nearCache = { key, fn: nearestIn(doc.palette) };
  return nearCache.fn;
}
function nearestIn(list) {
  const cols = list.map((h) => hexToRgba(h)), cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let c = cache.get(key);
    if (!c) {
      let best = 0, bd = Infinity;
      cols.forEach((q, i) => { const dr = q[0] - r, dg = q[1] - g, db = q[2] - b, dd = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (dd < bd) { bd = dd; best = i; } });
      c = cols[best]; cache.set(key, c);
    }
    return c;
  };
}
// median cut: split the colour box with the widest range until there are n boxes
function medianCut(px, n) {
  const all = [];
  for (let k = 0; k < px.length; k += 4) if (px[k + 3] > 127) all.push([px[k], px[k + 1], px[k + 2]]);
  if (!all.length) return [];
  let boxes = [all];
  while (boxes.length < n) {
    let bi = -1, bc = 0, br = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; for (let c = 0; c < 3; c++) { let lo = 255, hi = 0; for (const p of b) { lo = Math.min(lo, p[c]); hi = Math.max(hi, p[c]); } if (hi - lo > br) { br = hi - lo; bi = i; bc = c; } } });
    if (bi < 0 || br === 0) break;
    const b = boxes[bi].sort((p, q) => p[bc] - q[bc]), mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return [...new Set(boxes.map((b) => rgbaToHex([0, 1, 2].map((c) => Math.round(b.reduce((a, p) => a + p[c], 0) / b.length)).concat(255))))];
}
async function colourModeDialog() {
  clearSelection();
  const isIdx = !!doc.palette;
  const r = await dialog(`<h2>Colour mode</h2>
    <p>${isIdx ? `This drawing is <b>indexed</b> with ${doc.palette.length} colours. Every pixel uses one of them, and changing a palette colour changes every pixel that uses it.` : "This drawing is <b>RGB</b>: any colour anywhere."}</p>
    ${isIdx ? "" : `<div class="grid2">
      <label for="cmFrom">Palette</label><select id="cmFrom">
        <option value="exact">The colours already in the drawing</option>
        <option value="cut">Reduce the drawing to fewer colours</option>
        <option value="pal">The palette picked in the colour panel (${esc(S.palette)})</option></select>
      <label for="cmN">Colours (reduce)</label><input type="number" id="cmN" min="2" max="256" value="16">
    </div>
    <p class="dim">Indexed pixels are fully solid or fully clear, like most retro hardware and Aseprite's indexed mode.</p>`}
    <div class="btns"><button value="cancel" formnovalidate>Close</button>${isIdx ? '<button value="rgb" class="primary">Switch to RGB</button>' : '<button value="idx" class="primary">Make indexed</button>'}</div>`,
  () => ({ from: $("#cmFrom") ? $("#cmFrom").value : "", n: $("#cmN") ? +$("#cmN").value : 16 }));
  if (!r) return;
  if (r.value === "rgb") { doc.beginStructure(); doc.palette = null; if (S.palette === DOC_PAL) S.palette = "Pixels 32"; doc.emit("structure"); buildPalette(); toast("RGB mode."); return; }
  if (r.value !== "idx") return;
  doc.syncFrame();
  const all = [];
  doc.frames.forEach((_, i) => all.push(doc.compositeFrame(i)));
  const joined = new Uint8ClampedArray(all.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of all) { joined.set(p, o); o += p.length; }
  let pal;
  if (r.data.from === "pal") pal = (PALETTES[S.palette] || []).slice(0, 256);
  else {
    const seen = new Set();
    for (let k = 0; k < joined.length; k += 4) if (joined[k + 3] > 127) seen.add(rgbaToHex([joined[k], joined[k + 1], joined[k + 2], 255]));
    pal = r.data.from === "exact" && seen.size <= 256 ? [...seen] : medianCut(joined, Math.max(2, Math.min(256, r.data.n || 16)));
    if (r.data.from === "exact" && seen.size > 256) toast(`The drawing had ${seen.size} colours, so it was reduced to 256.`);
  }
  if (!pal.length) pal = ["#000000", "#ffffff"];
  const near = nearestIn(pal);
  doc.recolor((rr, g, b, a) => (a < 128 ? [0, 0, 0, 0] : [...near(rr, g, b).slice(0, 3), 255]));
  doc.palette = pal;
  S.palette = DOC_PAL;
  doc.emit("structure");
  buildPalette();
  toast(`Indexed with ${pal.length} colours. Double-click a swatch to change that colour everywhere.`);
}
async function editIndexedColour(i) {
  const old = doc.palette[i];
  const r = await dialog(`<h2>Change palette colour</h2><p>Every pixel using <span class="sw inline" style="--c:${old}"></span> ${old} changes, in every frame and layer.</p>
    <div class="grid2"><label for="ecC">New colour</label><input type="color" id="ecC" value="${old}"></div>
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Change</button></div>`, () => $("#ecC").value);
  if (!r || r.value !== "ok" || r.data === old) return;
  const [nr, ng, nb] = hexToRgba(r.data), [or, og, ob] = hexToRgba(old);
  doc.recolor((rr, g, b, a) => (rr === or && g === og && b === ob ? [nr, ng, nb, a] : [rr, g, b, a]));
  doc.palette[i] = r.data;
  buildPalette();
}

// ---------------------------------------------------------------- adjustments
async function adjustDialog() {
  commitFloat();
  doc.begin();
  const orig = doc.layer.px.slice(), id = doc.layer.id;
  const curve = [[0, 0], [64, 64], [192, 192], [255, 255]];
  const st = { mode: "bc", b: 0, c: 0, from: rgbaToHex(S.primary), to: rgbaToHex(S.secondary[3] ? S.secondary : [255, 255, 255, 255]), tol: 0, levels: 4 };
  const lut = () => {
    // monotone-ish curve through the points (piecewise linear is honest and predictable at 8 bits)
    const pts = curve.slice().sort((a, b) => a[0] - b[0]), t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) { let k = 0; while (k < pts.length - 2 && v > pts[k + 1][0]) k++; const [x0, y0] = pts[k], [x1, y1] = pts[k + 1]; t[v] = x1 === x0 ? y1 : y0 + ((v - x0) * (y1 - y0)) / (x1 - x0); }
    return t;
  };
  const fnFor = () => {
    if (st.mode === "bc") {
      const f = (259 * (st.c + 255)) / (255 * (259 - st.c));
      return (r, g, b, a) => [f * (r + st.b - 128) + 128, f * (g + st.b - 128) + 128, f * (b + st.b - 128) + 128, a];
    }
    if (st.mode === "curves") { const t = lut(); return (r, g, b, a) => [t[r], t[g], t[b], a]; }
    if (st.mode === "replace") {
      const [fr, fg, fb] = hexToRgba(st.from), [tr, tg, tb] = hexToRgba(st.to), tol = st.tol * 4.42;
      return (r, g, b, a) => (Math.hypot(r - fr, g - fg, b - fb) <= tol ? [tr, tg, tb, a] : [r, g, b, a]);
    }
    if (st.mode === "invert") return (r, g, b, a) => [255 - r, 255 - g, 255 - b, a];
    if (st.mode === "grey") return (r, g, b, a) => { const v = Math.round(0.299 * r + 0.587 * g + 0.114 * b); return [v, v, v, a]; };
    if (st.mode === "posterize") { const n = Math.max(2, st.levels) - 1; return (r, g, b, a) => [r, g, b].map((v) => Math.round(Math.round((v / 255) * n) * (255 / n))).concat(a); }
    return (r, g, b, a) => [r, g, b, a];
  };
  const applyTo = (src, fn) => {
    const out = src.slice(), m = S.sel ? selMask() : null;
    for (let k = 0, i = 0; k < out.length; k += 4, i++) {
      if (!src[k + 3] || (m && !m[i])) continue;
      const c = fn(src[k], src[k + 1], src[k + 2], src[k + 3]);
      out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2]; out[k + 3] = c[3];
    }
    return out;
  };
  const preview = () => { doc.layer.px.set(applyTo(orig, fnFor())); doc.emit(); };
  const r = await dialog(`<h2>Adjust colours</h2>
    <div class="grid2">
      <label for="adMode">Adjustment</label><select id="adMode">
        <option value="bc">Brightness / contrast</option><option value="curves">Curves</option><option value="replace">Replace colour</option>
        <option value="invert">Invert</option><option value="grey">Greyscale</option><option value="posterize">Posterize (fewer shades)</option></select>
      <label class="ad-bc" for="adB">Brightness</label><input class="ad-bc" type="range" id="adB" min="-128" max="128" value="0">
      <label class="ad-bc" for="adC">Contrast</label><input class="ad-bc" type="range" id="adC" min="-128" max="128" value="0">
      <label class="ad-replace" for="adFrom">Replace</label><input class="ad-replace" type="color" id="adFrom" value="${st.from}">
      <label class="ad-replace" for="adTo">With</label><input class="ad-replace" type="color" id="adTo" value="${st.to}">
      <label class="ad-replace" for="adTol">Tolerance</label><input class="ad-replace" type="range" id="adTol" min="0" max="100" value="0">
      <label class="ad-posterize" for="adLv">Shades per channel</label><input class="ad-posterize" type="range" id="adLv" min="2" max="8" value="4">
    </div>
    <canvas id="adCurve" class="ad-curves curveBox" width="256" height="256" title="Drag the points. Click to add one, double-click to remove."></canvas>
    <label class="opt ad-all"><span><input type="checkbox" id="adAll"> Every frame (${doc.frames.length})</span></label>
    <p class="dim">Changes <b>${esc(doc.layer.name)}</b>${S.sel ? " inside the selection" : ""}. The canvas shows a live preview.</p>
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Apply</button></div>`,
  () => ({ all: $("#adAll").checked }),
  (form) => {
    const q = (sel) => form.querySelector(sel);
    const cv = q("#adCurve"), g = cv.getContext("2d");
    const drawCurve = () => {
      g.clearRect(0, 0, 256, 256); g.fillStyle = "#16141c"; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = "#353042"; for (let i = 64; i < 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
      const t = lut(); g.strokeStyle = "#ffd166"; g.lineWidth = 2; g.beginPath(); for (let v = 0; v < 256; v++) (v ? g.lineTo : g.moveTo).call(g, v, 255 - t[v]); g.stroke();
      g.fillStyle = "#ff7a59"; for (const [x, y] of curve) { g.beginPath(); g.arc(x, 255 - y, 5, 0, 7); g.fill(); }
    };
    let hold = -1;
    const at = (e) => { const b = cv.getBoundingClientRect(); return [Math.max(0, Math.min(255, Math.round(((e.clientX - b.left) / b.width) * 255))), Math.max(0, Math.min(255, Math.round(255 - ((e.clientY - b.top) / b.height) * 255)))]; };
    cv.addEventListener("pointerdown", (e) => {
      const [x, y] = at(e);
      hold = curve.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 12);
      if (hold < 0) { curve.push([x, y]); hold = curve.length - 1; }
      cv.setPointerCapture(e.pointerId); drawCurve(); preview();
    });
    cv.addEventListener("pointermove", (e) => { if (hold < 0) return; curve[hold] = at(e); drawCurve(); preview(); });
    cv.addEventListener("pointerup", () => { hold = -1; });
    cv.addEventListener("dblclick", (e) => { const [x, y] = at(e); const i = curve.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 12); if (i >= 0 && curve.length > 2) { curve.splice(i, 1); drawCurve(); preview(); } });
    const sync = () => {
      st.mode = q("#adMode").value; st.b = +q("#adB").value; st.c = +q("#adC").value; st.from = q("#adFrom").value; st.to = q("#adTo").value; st.tol = +q("#adTol").value; st.levels = +q("#adLv").value;
      for (const m of ["bc", "curves", "replace", "posterize"]) form.querySelectorAll(`.ad-${m}`).forEach((e) => (e.hidden = st.mode !== m));
      if (st.mode === "curves") drawCurve();
      preview();
    };
    form.querySelectorAll("input,select").forEach((e) => e.addEventListener("input", sync));
    sync();
  });
  if (!r || r.value !== "ok") { doc.layer.px.set(orig); doc.cancelIfUnchanged(); doc.emit(); return; }
  const fn = fnFor();
  doc.layer.px.set(applyTo(orig, fn));
  if (r.data.all && doc.frames.length > 1) {
    doc.frames.forEach((f, i) => { if (i !== doc.frame && f.px[id] && !(f.links && f.links[id] && doc.frames[doc.frame].links && doc.frames[doc.frame].links[id] === f.links[id])) f.px[id] = applyTo(f.px[id], fn); });
  }
  doc.cancelIfUnchanged(); doc.emit("structure"); tilemapAfterPaint();
}

// ---------------------------------------------------------------- sprite sheet templates
const TEMPLATES = [
  { id: "walk16", name: "Top-down walk, 16×16", note: "4 directions × 4 frames", w: 16, h: 16, ms: 150, tags: [["walk_down", 4], ["walk_left", 4], ["walk_right", 4], ["walk_up", 4]], guides: { ground: 15, center: true } },
  { id: "walk32", name: "Top-down walk, 32×32", note: "4 directions × 4 frames", w: 32, h: 32, ms: 150, tags: [["walk_down", 4], ["walk_left", 4], ["walk_right", 4], ["walk_up", 4]], guides: { ground: 30, center: true } },
  { id: "rpg3", name: "3-frame, 4-direction character, 48×48", note: "classic RPG layout, ping-pong steps", w: 48, h: 48, ms: 180, tags: [["down", 3, "pingpong"], ["left", 3, "pingpong"], ["right", 3, "pingpong"], ["up", 3, "pingpong"]], guides: { ground: 45, center: true } },
  { id: "plat", name: "Platformer hero, 32×32", note: "idle, run, jump, fall, attack, hurt", w: 32, h: 32, ms: 100, tags: [["idle", 4, "pingpong"], ["run", 6], ["jump", 2], ["fall", 2], ["attack", 4], ["hurt", 2]], guides: { ground: 31, center: true } },
  { id: "turn", name: "Character turnaround, 32×32", note: "front, ¾, side, back", w: 32, h: 32, ms: 400, tags: [["front", 1], ["three_quarter", 1], ["side", 1], ["back", 1]], guides: { ground: 31, center: true } },
  { id: "fx", name: "Effect / explosion, 32×32", note: "8 frames, plays once", w: 32, h: 32, ms: 70, tags: [["fx", 8]], guides: { center: true } },
  { id: "tiles", name: "Tileset, 16×16 tiles", note: "8×8 grid on 128×128", w: 128, h: 128, guides: { cols: 8, rows: 8 }, tile: false },
  { id: "icons", name: "Item icons, 16×16", note: "8×4 grid on 128×64", w: 128, h: 64, guides: { cols: 8, rows: 4 } },
  { id: "ui9", name: "UI panel, 9-slice", note: "24×24 with 8 px borders", w: 24, h: 24, slices: [{ name: "panel", x: 0, y: 0, w: 24, h: 24, center: { x: 8, y: 8, w: 8, h: 8 } }], guides: null },
  { id: "seamless", name: "Seamless tile, 32×32", note: "tile mode on, for grass, water, walls", w: 32, h: 32, tile: true },
];
function makeTemplate(t) {
  const d = new Doc({ w: t.w, h: t.h, mode: "art", name: t.name.replace(/,.*$/, "") });
  if (t.tags) {
    const n = t.tags.reduce((a, x) => a + x[1], 0);
    d.frames = Array.from({ length: n }, () => ({ duration: t.ms || 100, px: {} }));
    let f = 0;
    d.tags = t.tags.map(([name, k, dir], i) => { const tg = { name, from: f, to: f + k - 1, dir: dir || "forward", color: ["#e05a5a", "#e0a43a", "#4cc9a6", "#3aa0e8", "#9b6cff", "#d64f9c"][i % 6] }; f += k; return tg; });
    d.loadFrame(0);
  }
  d.guides = t.guides || null;
  d.slices = (t.slices || []).map((x) => ({ ...x, center: x.center ? { ...x.center } : null }));
  d.layers[0].name = "Sketch"; d.addLayer("Line art"); d.addLayer("Colour"); d.moveLayer(-1);
  d.undoStack = []; d.redoStack = [];
  d.dirty = true;
  return d;
}

// ---------------------------------------------------------------- character starter
const charChoice = { tone: SKIN_TONES[3], eyes: EYE_COLOURS[0], hair: "crop", hairColour: HAIR_COLOURS[2], shirt: SHIRT_COLOURS[1], pants: PANTS_COLOURS[0], shoes: SHOE_COLOURS[0], sleeves: "short", model: "classic", facial: "none" };
async function characterDialog(model) {
  const isSkin = doc.mode === "skin";
  charChoice.model = model || (isSkin ? doc.model : charChoice.model);
  const sw = (key, list) => `<div class="csRow" data-key="${key}">${list.map((h) => `<button type="button" class="sw${charChoice[key] === h ? " cur" : ""}" style="--c:${h}" data-v="${h}" title="${h}" aria-label="${h}"></button>`).join("")}</div>`;
  const chips = (key, list) => `<div class="csChips" data-key="${key}">${list.map(([v, l]) => `<button type="button" data-v="${v}" class="${charChoice[key] === v ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
  const html = `
    <h2>Character starter</h2>
    <div class="cs">
      <canvas id="csPrev" aria-label="Preview"></canvas>
      <div class="csCtl">
        <h3>Skin tone</h3>${sw("tone", SKIN_TONES)}
        <h3>Eyes</h3>${sw("eyes", EYE_COLOURS)}
        <h3>Hair style</h3>${chips("hair", HAIR_STYLES.map((s) => [s.id, s.label]))}
        <h3>Hair colour</h3>${sw("hairColour", HAIR_COLOURS)}
        <h3>Facial hair</h3>${chips("facial", FACIAL_HAIR.map((s) => [s.id, s.label]))}
        <h3>Shirt</h3>${sw("shirt", SHIRT_COLOURS)}
        <h3>Pants</h3>${sw("pants", PANTS_COLOURS)}
        <h3>Shoes</h3>${sw("shoes", SHOE_COLOURS)}
        <h3>Sleeves and arms</h3>${chips("sleeves", [["short", "Short sleeves"], ["long", "Long sleeves"]])}${chips("model", [["classic", "Classic arms"], ["slim", "Slim arms"]])}
      </div>
    </div>
    <p>Comes in as separate layers (Body, Face, Facial hair, Hair), so each one can be recolored, hidden or painted over. Facial hair uses the hair colour.</p>
    <div class="btns"><button value="cancel">Cancel</button>${isSkin ? `<button value="add" title="Keeps your current skin and puts the face and hair on top as new layers">Add face + hair to this skin</button>` : ""}<button value="new" class="primary">Create skin</button></div>`;
  let pv = null;
  const composeLayers = (layers) => { const out = new Uint8ClampedArray(64 * 64 * 4); for (const l of layers) blendOver(out, l.px, 1); return out; };
  const r = await dialog(html, null, (f) => {
    try { pv = new SkinPreview(f.querySelector("#csPrev")); pv.dist = 66; pv.setWalk(true); } catch { pv = null; }
    const update = () => {
      if (!pv) return;
      if (pv.model !== charChoice.model) pv.setModel(charChoice.model);
      pv.setTexture(composeLayers(buildCharacter(charChoice)));
    };
    f.querySelectorAll("[data-key]").forEach((row) => row.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      charChoice[row.dataset.key] = b.dataset.v;
      row.querySelectorAll("button").forEach((x) => x.classList.toggle(x.classList.contains("sw") ? "cur" : "on", x === b));
      update();
    }));
    update();
  });
  if (pv) { pv.setWalk(false); const lose = pv.gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); }
  if (r === "new") {
    const layers = buildCharacter(charChoice).map((l) => ({ ...newLayer(64, 64, l.name), px: l.px }));
    const d = new Doc({ w: 64, h: 64, mode: "skin", model: charChoice.model, name: "My character", layers });
    d.dirty = true;
    setDoc(d); autosave();
    toast("Body, Face, Hair (and Facial hair) are separate layers. Recolor… or paint over any of them.");
  } else if (r === "add" && doc.mode === "skin") {
    doc.beginStructure();
    for (const l of buildCharacter({ ...charChoice, model: doc.model }).filter((x) => x.name !== "Body")) doc.layers.push({ ...newLayer(64, 64, l.name), px: l.px });
    doc.active = doc.layers.length - 1;
    doc.emit("structure");
    toast("Added the face and hair layers on top. Hide or delete them under Layers.");
  }
}

// ---------------------------------------------------------------- dialogs
const dlg = $("#dlg"), dlgForm = $("#dlgForm");
function dialog(html, collect = null, onOpen = null) {
  return new Promise((resolve) => {
    dlgForm.innerHTML = html;
    let extra = null;
    const onSubmit = (e) => {
      const v = e.submitter ? e.submitter.value : "";
      if (collect) extra = { value: v, data: collect() };
      else extra = v;
    };
    dlgForm.addEventListener("submit", onSubmit, { once: true });
    dlg.addEventListener("close", () => { dlgForm.removeEventListener("submit", onSubmit); resolve(extra); }, { once: true });
    dlgForm.onkeydown = (e) => {
      if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
      e.preventDefault();
      const row = e.target.closest(".row");
      const btn = (row && row.querySelector("button[value]")) || dlgForm.querySelector("button.primary");
      if (btn) btn.click();
    };
    dlg.showModal();
    if (onOpen) onOpen(dlgForm, (v) => { extra = collect ? { value: v, data: collect() } : v; dlg.close(); });
  });
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function promptText(title, value = "") {
  const r = await dialog(`<h2>${esc(title)}</h2><input type="text" id="ptIn" value="${esc(value)}" maxlength="80" autofocus>
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">OK</button></div>`,
  () => $("#ptIn").value.trim(), (f) => { const i = f.querySelector("#ptIn"); i.select(); });
  return r && r.value === "ok" ? r.data : null;
}
async function choose(title, text, options) {
  return dialog(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="btns">${options.map(([v, l], i) => `<button value="${v}" ${i === 0 ? 'class="primary"' : ""}>${esc(l)}</button>`).join("")}</div>`);
}

async function newDialog() {
  autosave();
  if (doc.mode === "skin") {
    const r = await dialog(`
      <h2>New skin</h2>
      <div class="seg" id="nModel"><button type="button" data-m="classic" class="on">Classic arms</button><button type="button" data-m="slim">Slim arms</button></div>
      <div class="presets">
        <button value="char" class="primary">Character starter…</button>
        <button value="mannequin">Plain mannequin</button>
        <button value="blank">Blank</button>
        <button value="file">From a PNG…</button>
      </div>
      <div class="grid2"><label for="nUser">Java username</label><div class="row"><input type="text" id="nUser" maxlength="16" placeholder="e.g. a family member's name"><button value="user">Load</button></div></div>
      <p>Loads that player's current skin to edit. Bedrock-only skins can't be fetched; export it as a PNG and use "From a PNG".</p>
      <div class="btns"><button value="cancel">Cancel</button></div>`,
    () => ({ model: $("#nModel .on").dataset.m, user: $("#nUser").value }),
    (f) => f.querySelectorAll("#nModel button").forEach((b) => b.addEventListener("click", () => f.querySelectorAll("#nModel button").forEach((x) => x.classList.toggle("on", x === b)))));
    if (!r) return;
    if (r.value === "mannequin" || r.value === "blank") setDoc(newSkin(r.value, r.data.model));
    if (r.value === "file") { $("#fileIn").click(); }
    if (r.value === "char") characterDialog(r.data.model);
    if (r.value === "user") loadJavaSkin(r.data.user);
    return;
  }
  const sizes = [16, 24, 32, 48, 64, 128];
  const r = await dialog(`
    <h2>New drawing</h2>
    <div class="presets">${sizes.map((s) => `<button value="${s}">${s}×${s}</button>`).join("")}</div>
    <div class="grid2">
      <label>Custom</label>
      <div class="row"><input type="number" id="nW" min="1" max="${MAX_SIZE}" value="${doc.w}" style="width:80px"> × <input type="number" id="nH" min="1" max="${MAX_SIZE}" value="${doc.h}" style="width:80px"><button value="custom" class="primary">Create</button></div>
    </div>
    <p>Up to ${MAX_SIZE}×${MAX_SIZE}. Your current drawing is kept in My drawings.</p>
    <h3>Sprite sheet templates</h3>
    <div class="tplGrid">${TEMPLATES.map((t) => `<button value="tpl:${t.id}"><b>${esc(t.name)}</b><span>${esc(t.note)}</span></button>`).join("")}</div>
    <p class="dim">Templates come with the frames, tags and guide lines set up (guides show with the grid and aren't exported). Export → Sprite sheet + JSON gives game engines the frames and tags.</p>
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button></div>`,
  () => ({ w: +$("#nW").value, h: +$("#nH").value }));
  if (!r || r.value === "cancel" || !r.value) return;
  if (r.value.startsWith("tpl:")) {
    const t = TEMPLATES.find((x) => x.id === r.value.slice(4));
    if (!t) return;
    setDoc(makeTemplate(t)); autosave();
    if (t.tile && !S.tile) $("#optTile").click();
    toast(t.tags ? `${doc.frames.length} frames with ${doc.tags.length} tags. Pick a tag in Animation to preview just that move.` : `${t.name} ready.`);
    return;
  }
  let w, h;
  if (r.value === "custom") { w = r.data.w; h = r.data.h; } else w = h = +r.value;
  w = Math.max(1, Math.min(MAX_SIZE, Math.round(w) || 32)); h = Math.max(1, Math.min(MAX_SIZE, Math.round(h) || 32));
  setDoc(newArt(w, h));
}

async function resizeDialog() {
  const r = await dialog(`
    <h2>Canvas size</h2>
    <div class="grid2">
      <label>Size</label><div class="row"><input type="number" id="rW" min="1" max="${MAX_SIZE}" value="${doc.w}" style="width:80px"> × <input type="number" id="rH" min="1" max="${MAX_SIZE}" value="${doc.h}" style="width:80px"></div>
      <label for="rA">Keep drawing at</label>
      <select id="rA"><option value="tl">Top left</option><option value="cm" selected>Centre</option><option value="br">Bottom right</option></select>
    </div>
    <p>Makes the canvas bigger or crops it. Pixels don't get stretched.</p>
    <div class="btns"><button value="cancel" formnovalidate>Cancel</button><button value="ok" class="primary">Resize</button></div>`,
  () => ({ w: +$("#rW").value, h: +$("#rH").value, a: $("#rA").value }));
  if (!r || r.value !== "ok") return;
  const w = Math.max(1, Math.min(MAX_SIZE, Math.round(r.data.w))), h = Math.max(1, Math.min(MAX_SIZE, Math.round(r.data.h)));
  if (w === doc.w && h === doc.h) return;
  clearSelection();
  doc.resize(w, h, r.data.a);
  fit();
}

async function galleryDialog() {
  autosave();
  const items = store.listDocs();
  const when = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  dlgForm.innerHTML = "";
  const html = `
    <h2>My drawings</h2>
    <p>Saved in this browser only. Export a PNG or project file to move one to another device.</p>
    <div class="gallery">${items.length ? items.map((e) => `
      <div class="gitem" data-id="${esc(e.id)}">
        <img src="${esc(e.thumb)}" alt="" data-act="open">
        <div class="nm" title="${esc(e.name)}">${esc(e.name)}</div>
        <div class="meta"><span>${e.mode === "skin" ? "Skin" : `${e.w}×${e.h}`}</span><span>${when(e.updated)}</span></div>
        <div class="acts"><button type="button" data-act="open">Open</button><button type="button" data-act="del">Delete</button></div>
      </div>`).join("") : `<p>Nothing saved yet. Drawings save here on their own as you work.</p>`}</div>
    <div class="btns"><button value="close">Close</button></div>`;
  await dialog(html, null, (f, done) => {
    f.querySelectorAll("[data-act]").forEach((el) => el.addEventListener("click", async () => {
      const id = el.closest(".gitem").dataset.id;
      if (el.dataset.act === "open") {
        try { const d = await store.openDoc(id); setDoc(d); done("open"); } catch (err) { toast(err.message); }
      } else if (el.dataset.act === "del") {
        if (el.textContent !== "Sure?") { el.textContent = "Sure?"; return; }
        store.deleteDoc(id);
        el.closest(".gitem").remove();
        if (doc.id === id) doc.dirty = false;
      }
    }));
  });
}

async function saveNow() {
  const name = await promptText("Save as", doc.name === "Untitled" || doc.name === "My skin" ? "" : doc.name);
  if (name === null) return;
  if (name) doc.name = name.slice(0, 80);
  doc.dirty = true;
  document.title = `${doc.name} · Pixels`;
  if (store.saveDoc(doc)) toast(`Saved "${doc.name}" in My drawings.`); else toast("Couldn't save: this browser is out of space.");
}

function helpDialog() {
  const k = [
    ["B", "Pencil"], ["E", "Eraser"], ["F", "Fill"], ["I", "Pick colour"], ["L", "Line"], ["R", "Rectangle"], ["O", "Circle"], ["D", "Shade"],
    ["S", "Select"], ["V", "Move layer"], ["Alt", "Pick colour while drawing"], ["Right click", "Draw with 2nd colour"],
    ["X", "Swap colours"], ["[ ]", "Brush size"], ["M", "Mirror"], ["T", "Cycle dither pattern"], ["P", "Pixel perfect on/off"], ["A", "Spray"], ["U", "Gradient"], ["C", "Contour"], ["Q", "Lasso"], ["W", "Magic wand"], ["J", "Slice"],
    ["Shift / Alt + select", "Add to / take from the selection"], ["K or hold Shift", "Line lock (straight strokes)"], ["2-finger tap", "Undo (touch)"], ["G", "Grid"], ["Space+drag", "Pan"], ["Wheel / pinch", "Zoom"],
    ["0", "Fit to screen"], ["Ctrl+Z", "Undo"], ["Ctrl+Shift+Z", "Redo"], ["Ctrl+S", "Save"], ["Ctrl+C / V", "Copy / paste"], ["Ctrl+A", "Select all"],
    ["Tab", "Focus mode (full-screen canvas)"], ["3-finger tap", "Redo (touch)"], ["Delete", "Clear selection"], ["Enter / Esc", "Drop selection"], ["N", "New"], ["3", "Skin: flat / 3D view"], [", .", "Previous / next frame"], ["Arrows", "Turn the model (3D view)"],
  ];
  dialog(`<h2>Shortcuts</h2><div class="keys">${k.map(([a, b]) => `<kbd>${esc(a)}</kbd><span>${esc(b)}</span>`).join("")}</div>
    <p>Skins: the faded areas of the texture aren't used by the game. Yellow outlines are the inner layer, blue the outer layer (hat, jacket, sleeves, pants). "Mirror" on a skin copies across each body part, so both sides of the face match.</p>
    <div class="btns"><button value="ok" class="primary">Got it</button></div>`);
}

// iPad/phone fallback when the share sheet can't open: show the picture to press and hold (Save to Photos),
// with a plain download link for each file as well.
function saveFilesDialog(files) {
  const urls = files.map((f) => URL.createObjectURL(f));
  const parts = files.map((f, i) => f.type.startsWith("image/")
    ? `<figure class="saveImg"><img src="${urls[i]}" alt="${esc(f.name)}"><figcaption>${esc(f.name)}</figcaption></figure>`
    : `<p><a href="${urls[i]}" download="${esc(f.name)}">${esc(f.name)}</a></p>`).join("");
  dialog(`<h2>Save your file</h2>
    <p class="dim">Press and hold the picture, then choose <b>Save to Photos</b> (or <b>Share</b> for Files and AirDrop).</p>
    ${parts}
    <p class="dim">Or tap here: ${files.map((f, i) => `<a href="${urls[i]}" download="${esc(f.name)}">download ${esc(f.name)}</a>`).join(", ")}. Downloads land in the Files app under Downloads.</p>
    <div class="btns"><button value="ok" class="primary">Done</button></div>`).then(() => setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000));
}

// ---------------------------------------------------------------- focus mode (tablets)
// A phone or tablet: the main pointer is a finger (iPads report a desktop Mac, so check for touch points too).
const TOUCH_FIRST = matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
if (TOUCH_FIRST) document.body.classList.add("touch");
function setFocus(on, { auto = false } = {}) {
  document.body.classList.toggle("focus", on);
  closeFocusMenu();
  if (TOUCH_FIRST && !auto) { prefs.touchFocus = on; persistPrefs(); } // remember the choice for next time
  if (on && auto) {
    syncFocusBar();
    toast("Touch screen: full-screen canvas. Everything is in the bar at the top. Two-finger tap undoes.");
  } else if (on) {
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement && !document.webkitFullscreenElement) { try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch {} }
    syncFocusBar();
    toast("Focus mode: everything is in the bar at the top. The square grid button (or Tab) brings the full menus back.");
  } else {
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (ex && (document.fullscreenElement || document.webkitFullscreenElement)) { try { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } catch {} }
  }
  setToggle($("#bFocus"), on);
  requestAnimationFrame(() => { resizeView(); if (!in3D()) fit(); });
}
function syncFocusBar() {
  if (!doc) return;
  const n = doc.frames.length;
  $("#fFrameNo").textContent = `${doc.frame + 1}/${n}`;
  $(".fFrames").style.display = n > 1 ? "" : "none";
  const t = $(`#toolList button[data-tool="${S.tool}"]`);
  $("#fTool").innerHTML = t ? t.innerHTML : "";
  const skin = doc.mode === "skin";
  $("#fMode").innerHTML = `${MODE_ICONS[skin ? "skin" : "art"]}<span class="fmLbl">${skin ? "Skin" : "Pixel art"}</span><span class="fmCaret">▾</span>`;
  $("#fMode").title = skin ? "Minecraft skin editor. Tap to switch to pixel art." : "Pixel art editor. Tap to switch to the Minecraft skin editor.";
  const info = TOOLS.find((x) => x.id === S.tool);
  const sized = ["pencil", "eraser", "shade", "spray", "line", "rect", "ellipse", "contour"].includes(S.tool) && !S.brush;
  $("#fToolName").textContent = info ? info.label.split(" (")[0] + (S.brush && ["pencil", "eraser"].includes(S.tool) ? " · custom brush" : sized && S.size > 1 ? ` · ${S.size}px` : "") : "";
  $("#fUndo").disabled = $("#bUndo").disabled; $("#fRedo").disabled = $("#bRedo").disabled;
  if (FMENU.open && !FMENU.moved.length) renderFocusMenu(FMENU.open); // keep toggle ticks fresh
}
// Focus mode menus. Panels that already exist (tools, layers, colour, animation, 3D preview) are moved into
// the drop-down while it's open and put back when it closes, so every control keeps working.
const FMENU = { open: null, moved: [] };
const FOCUS_ITEMS = {
  file: [["New drawing", "#bNew"], ["My drawings", "#bOpen"], ["Save", "#bSave"], ["Import a PNG or .aseprite", "#bImport"], ["Export / download", "#bExport"], ["Free asset packs", "#bAssets"], ["Character starter", "#bChar2"], ["Shortcuts and help", "#bHelp"]],
  edit: [["Copy selection", () => S.sel && selAction("copy"), () => !!S.sel], ["Paste", () => S.clip && pasteClip(S.clip), () => !!S.clip], ["Select all", "selectAll"],
    "-", ["Adjust colours…", "#dAdjust"], ["Recolour…", "#dRecolor"], ["Outline…", "#dOutline"], ["Colour mode…", "#dColourMode"],
    "-", ["Resize layer…", "#dResizeLayer"], ["Canvas size…", "#dResize"], ["Flip layer ↔", "#dFlipH"], ["Flip layer ↕", "#dFlipV"], ["Reference image…", "#dRef"]],
  view: [["Grid", "#optGrid"], ["Mirror ↔", "#optMirrorX"], ["Mirror ↕", "#optMirrorY"], ["Tile mode", "#optTile"], ["Onion skin", "#aOnion"], ["Part outlines", "#optGuides"], "-", ["Fit to screen", "#zFit"]],
};
FOCUS_ITEMS.mode = () => [
  [(doc.mode !== "skin" ? "✓ " : "    ") + "Pixel art", () => $('.modes button[data-mode="art"]').click()],
  [(doc.mode === "skin" ? "✓ " : "    ") + "Minecraft skin", () => $('.modes button[data-mode="skin"]').click()],
];
const MODE_ICONS = {
  art: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/></svg>',
  skin: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="14" rx="1.5"/><path d="M8 9h2.5v2H8zM13.5 9H16v2h-2.5zM10.5 13h3v3h-3z" fill="currentColor"/><path d="M8 18v2.5M16 18v2.5"/></svg>',
};
const FOCUS_PANELS = { tools: ["#toolList", ".toolOpts"], layers: ["#layersCard"], colour: ["#colourCard"], anim: ["#animCard"], skin: ["#skinCard"] };
function visibleSrc(sel) { const el = $(sel); return el && getComputedStyle(el).display !== "none" ? el : el && el.closest(".art-only, .skin-only") ? null : el; }
function closeFocusMenu() {
  for (const { el, ph } of FMENU.moved) { ph.replaceWith(el); }
  FMENU.moved = []; FMENU.open = null;
  const pop = $("#fpop"); pop.hidden = true; pop.innerHTML = ""; pop.className = "fpop";
  $$("#fbar [data-fmenu]").forEach((b) => b.classList.remove("on"));
}
function renderFocusMenu(name) {
  const pop = $("#fpop"); pop.innerHTML = "";
  const art = doc.mode !== "skin";
  const items = typeof FOCUS_ITEMS[name] === "function" ? FOCUS_ITEMS[name]() : FOCUS_ITEMS[name];
  for (const it of items) {
    if (it === "-") { pop.appendChild(document.createElement("hr")); continue; }
    const [label, act, enabled] = it;
    const src = typeof act === "string" && act.startsWith("#") ? $(act) : null;
    if (src && ((src.classList.contains("art-only") && !art) || (src.classList.contains("skin-only") && art) || (src.closest(".art-only") && !art))) continue;
    const b = document.createElement("button");
    b.className = "fitem"; b.textContent = label;
    const toggle = src && src.classList.contains("tog");
    if (toggle) { b.classList.add("check"); b.classList.toggle("on", src.classList.contains("on")); }
    if (src) b.disabled = src.disabled; else if (enabled) b.disabled = !enabled();
    b.addEventListener("click", () => {
      if (toggle) { src.click(); b.classList.toggle("on", src.classList.contains("on")); return; }
      closeFocusMenu();
      if (src) src.click();
      else if (act === "selectAll") window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
      else act();
    });
    pop.appendChild(b);
  }
}
function openFocusMenu(name, btn) {
  const was = FMENU.open;
  closeFocusMenu();
  if (was === name) return;
  FMENU.open = name;
  const pop = $("#fpop");
  pop.className = `fpop fp-${name}`;
  if (FOCUS_PANELS[name]) {
    for (const sel of FOCUS_PANELS[name]) {
      const el = $(sel); if (!el) continue;
      const ph = document.createComment("fpop"); el.replaceWith(ph); pop.appendChild(el);
      FMENU.moved.push({ el, ph });
    }
    if (name === "colour") buildPalette();
    if (name === "skin" && typeof resizePreview === "function") resizePreview();
  } else renderFocusMenu(name);
  btn.classList.add("on");
  // drop down under the button, kept on screen
  pop.hidden = false;
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + "px";
  requestAnimationFrame(() => requestRender());
}

// ---------------------------------------------------------------- toast, status
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3800);
}
function updateStatus() {
  const parts = [];
  const h = S.hover ? wrapXY(S.hover[0], S.hover[1]) : S.hover3d;
  if (h) parts.push(`${h[0]}, ${h[1]}`);
  parts.push(`${doc.w}×${doc.h}`);
  if (!in3D()) parts.push(`${Math.round(S.zoom * 100)}%`);
  if (doc.mode === "skin" && h) {
    const f = faceAt(doc.model, h[0], h[1]);
    parts.push(f ? `${f.part.label} · ${f.face}${f.layer === "over" ? " · outer layer" : ""}` : "unused");
  }
  const sel = selRect();
  if (sel) parts.push(`selection ${sel.w}×${sel.h}`);
  $("#status").textContent = parts.join("  ·  ");
}

let prefsTimer = null;
function persistPrefs() { clearTimeout(prefsTimer); prefsTimer = setTimeout(savePrefsNow, 250); }
addEventListener("pagehide", () => { if (prefsTimer) savePrefsNow(); });
function savePrefsNow() {
  prefsTimer = null;
  store.savePrefs({ primary: S.primary, secondary: S.secondary, palette: S.palette, grid: S.grid, sv: S.sv, myColours: PALETTES["My colours"], customPalettes, perfect: S.perfect, touchFocus: prefs.touchFocus, recent });
}

// ---------------------------------------------------------------- wiring
function wire() {
  buildTools();
  $$(".modes button").forEach((b) => b.addEventListener("click", () => switchMode(b.dataset.mode)));
  $("#bNew").addEventListener("click", newDialog);
  $("#bOpen").addEventListener("click", galleryDialog);
  $("#bSave").addEventListener("click", saveNow);
  $("#bImport").addEventListener("click", () => $("#fileIn").click());
  $("#bExport").addEventListener("click", exportDialog);
  $("#bUndo").addEventListener("click", () => { clearSelection(); doc.undo(); });
  $("#bRedo").addEventListener("click", () => { clearSelection(); doc.redo(); });
  $("#bHelp").addEventListener("click", helpDialog);
  $("#fileIn").addEventListener("change", (e) => { importFile(e.target.files[0]); e.target.value = ""; });

  $("#optSize").addEventListener("change", (e) => { S.size = +e.target.value; requestRender(); });
  $("#optMirrorX").addEventListener("click", (e) => { S.mirrorX = !S.mirrorX; setToggle(e.currentTarget, S.mirrorX); requestRender(); });
  $("#optMirrorY").addEventListener("click", (e) => { S.mirrorY = !S.mirrorY; setToggle(e.currentTarget, S.mirrorY); requestRender(); });
  $("#optDither").addEventListener("change", (e) => { S.dither = e.target.value; });
  $("#optPerfect").addEventListener("click", (e) => { S.perfect = !S.perfect; setToggle(e.currentTarget, S.perfect); persistPrefs(); });
  setToggle($("#optPerfect"), S.perfect);
  $("#optTile").addEventListener("click", (e) => {
    S.tile = !S.tile; setToggle(e.currentTarget, S.tile);
    if (S.tile) {
      const r = stage.getBoundingClientRect();
      if (doc.w * S.zoom * 2 > r.width || doc.h * S.zoom * 2 > r.height) { const z = Math.max(1, Math.floor(Math.min(r.width / (doc.w * 2.2), r.height / (doc.h * 2.2)))); zoomAt(z, r.width / 2, r.height / 2); S.panX = Math.round((r.width - doc.w * S.zoom) / 2); S.panY = Math.round((r.height - doc.h * S.zoom) / 2); }
      toast("Tile mode: strokes that cross an edge come back on the other side.");
    }
    requestRender();
  });
  $("#palMenu").addEventListener("click", paletteMenu);
  $("#bFocus").addEventListener("click", () => setFocus(!document.body.classList.contains("focus")));
  document.body.append($("#fbar"), $("#fpop")); // outside the stage, so stage-only styles don't reach panels moved into the drop-down
  $("#fExit").addEventListener("click", () => setFocus(false));
  $$("#fbar [data-fmenu]").forEach((b) => b.addEventListener("click", () => openFocusMenu(b.dataset.fmenu, b)));
  $("#fUndo").addEventListener("click", () => $("#bUndo").click());
  $("#fRedo").addEventListener("click", () => $("#bRedo").click());
  $("#fPrev").addEventListener("click", () => { clearSelection(); doc.setFrame((doc.frame - 1 + doc.frames.length) % doc.frames.length); });
  $("#fNext").addEventListener("click", () => { clearSelection(); doc.setFrame((doc.frame + 1) % doc.frames.length); });
  // tap outside the drop-down closes it; picking a tool closes the tools panel
  document.addEventListener("pointerdown", (e) => { if (FMENU.open && !e.target.closest("#fpop, #fbar, dialog")) closeFocusMenu(); }, true);
  $("#toolList").addEventListener("click", (e) => { if (FMENU.open === "tools" && e.target.closest("button[data-tool]")) setTimeout(() => { syncFocusBar(); closeFocusMenu(); }, 0); });
  $("#optInk").addEventListener("change", (e) => { S.ink = e.target.value; });
  $("#optPressure").addEventListener("click", (e) => { S.pressure = !S.pressure; setToggle(e.currentTarget, S.pressure); toast(S.pressure ? "Pen pressure on: pressing harder paints up to the brush size you've set. Pick a size above 1." : "Pen pressure off."); });
  $("#brushChip").addEventListener("click", () => { S.brush = null; syncBrushChip(); requestRender(); });
  $("#optSize").addEventListener("change", () => { if (S.brush) { S.brush = null; syncBrushChip(); } setTimeout(syncFocusBar, 0); });
  $("#dAdjust").addEventListener("click", adjustDialog);
  $("#dResizeLayer").addEventListener("click", resizeLayer);
  $("#dColourMode").addEventListener("click", colourModeDialog);
  $("#dOutline").addEventListener("click", outlineDialog);
  $("#dRef").addEventListener("click", referenceDialog);
  $("#optFilled").addEventListener("click", (e) => { S.filled = !S.filled; setToggle(e.currentTarget, S.filled); });
  $("#optLock").addEventListener("click", (e) => { S.lineLock = !S.lineLock; setToggle(e.currentTarget, S.lineLock); });
  $("#optGrid").addEventListener("click", (e) => { S.grid = !S.grid; setToggle(e.currentTarget, S.grid); persistPrefs(); if (preview) preview.setGrid(in3D() && S.grid); requestRender(); });
  $$("#viewSeg button").forEach((b) => b.addEventListener("click", () => setSkinView(b.dataset.sv)));
  $("#flat").addEventListener("click", () => setSkinView("2d"));
  $("#flat").title = "Click to paint the flat texture";
  $("#optGuides").addEventListener("click", (e) => { S.guides = !S.guides; setToggle(e.currentTarget, S.guides); requestRender(); });
  setToggle($("#optGrid"), S.grid);

  $("#zIn").addEventListener("click", () => in3D() ? preview.zoom(1 / 1.2) : zoomStep(1));
  $("#zOut").addEventListener("click", () => in3D() ? preview.zoom(1.2) : zoomStep(-1));
  $("#zFit").addEventListener("click", () => in3D() ? preview.resetView() : fit());
  $$("#selBar button").forEach((b) => b.addEventListener("click", () => selAction(b.dataset.sel)));

  // colours
  store.setDownloadFallback(saveFilesDialog);
  wheel = createWheel($("#cWheel"), (rgb) => { S.primary = [...rgb, S.primary[3] || 255]; syncColors(); });
  renderRecent();
  $("#cInput").addEventListener("input", (e) => { S.primary = [...hexToRgba(e.target.value).slice(0, 3), S.primary[3] || 255]; syncColors(); });
  $("#cHex").addEventListener("change", (e) => {
    const v = e.target.value.trim();
    if (/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) { S.primary = hexToRgba(v.startsWith("#") ? v : "#" + v); }
    syncColors();
  });
  $("#cAlpha").addEventListener("input", (e) => { S.primary = [...S.primary.slice(0, 3), +e.target.value]; syncColors(); });
  $("#cSwap").addEventListener("click", () => { [S.primary, S.secondary] = [S.secondary, S.primary]; syncColors(); });
  $("#cSecondary").addEventListener("click", () => { [S.primary, S.secondary] = [S.secondary, S.primary]; syncColors(); });
  $("#cSecondary").addEventListener("click", () => $("#cSwap").click());
  $("#palSel").addEventListener("change", (e) => { S.palette = e.target.value; buildPalette(); persistPrefs(); });
  $("#palAdd").addEventListener("click", () => {
    const hex = rgbaToHex(S.primary);
    const mine = PALETTES["My colours"];
    if (!mine.includes(hex)) mine.push(hex);
    S.palette = "My colours"; buildPalette(); persistPrefs();
    toast(`Added ${hex} to My colours.`);
  });

  // layers
  $("#lAdd").addEventListener("click", () => { clearSelection(); doc.addLayer(); });
  $("#lDup").addEventListener("click", () => { clearSelection(); doc.duplicateLayer(); });
  $("#lDel").addEventListener("click", () => { clearSelection(); doc.deleteLayer(); });
  $("#lUp").addEventListener("click", () => { clearSelection(); doc.moveLayer(1); });
  $("#lDown").addEventListener("click", () => { clearSelection(); doc.moveLayer(-1); });
  $("#lMerge").addEventListener("click", () => { clearSelection(); doc.mergeDown(); });
  $("#dResize").addEventListener("click", resizeDialog);
  $("#lBlend").addEventListener("change", (e) => doc.setLayerProp(doc.active, "blend", e.target.value));
  $("#lGroup").addEventListener("click", groupDialog);
  $("#lUngroup").addEventListener("click", ungroupLayer);
  $("#lTilemap").addEventListener("click", tilemapDialog);
  $("#tsStamp").addEventListener("click", (e) => { S.tileStamp = !S.tileStamp; setToggle(e.currentTarget, S.tileStamp); });
  $("#dFlipH").addEventListener("click", () => { clearSelection(); doc.flipLayer("h"); });
  $("#dFlipV").addEventListener("click", () => { clearSelection(); doc.flipLayer("v"); });

  // skin controls
  $$("#modelSeg button").forEach((b) => b.addEventListener("click", () => {
    if (doc.model === b.dataset.model) return;
    doc.beginStructure();
    doc.model = b.dataset.model;
    $$("#modelSeg button").forEach((x) => x.classList.toggle("on", x === b));
    unusedPath = null;
    if (preview) preview.setModel(doc.model);
    doc.emit("structure");
  }));
  $("#pvOuter").addEventListener("click", () => setOuter(!S.showOuter));
  $("#pvWalk").addEventListener("click", (e) => { S.walk = !S.walk; setToggle(e.currentTarget, S.walk); if (preview) preview.setWalk(S.walk); });
  $("#pvTarget").addEventListener("change", (e) => { if (e.target.value === "over" && !S.showOuter) setOuter(true); if (preview) preview.pickTarget = e.target.value; });
  buildIsoChips();
  wireAnimation();
  $("#dRecolor").addEventListener("click", recolorDialog);
  $("#bAssets").addEventListener("click", assetDialog);
  $("#bChar").addEventListener("click", () => characterDialog());
  $("#bChar2").addEventListener("click", () => characterDialog());

  // keyboard
  window.addEventListener("keydown", (e) => {
    if (dlg.open) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (k === "Alt") { altDown = true; e.preventDefault(); return; }
    if (k === " ") { spaceDown = true; view.style.cursor = "grab"; e.preventDefault(); return; }
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === "z" && !e.shiftKey) { e.preventDefault(); clearSelection(); doc.undo(); }
      else if ((lk === "z" && e.shiftKey) || lk === "y") { e.preventDefault(); clearSelection(); doc.redo(); }
      else if (lk === "s") { e.preventDefault(); saveNow(); }
      else if (lk === "o") { e.preventDefault(); galleryDialog(); }
      else if (lk === "c" && S.sel) { e.preventDefault(); selAction("copy"); }
      else if (lk === "x" && S.sel) { e.preventDefault(); selAction("copy"); selAction("delete"); }
      else if (lk === "v" && S.clip) { e.preventDefault(); pasteClip(S.clip); }
      else if (lk === "a") { e.preventDefault(); clearSelection(); setTool("select"); S.sel = { x: 0, y: 0, w: doc.w, h: doc.h, float: null }; $("#selBar").hidden = false; requestRender(); }
      return;
    }
    if (k === "Tab") { e.preventDefault(); setFocus(!document.body.classList.contains("focus")); return; }
    const tool = TOOLS.find((x) => x.key.toLowerCase() === k.toLowerCase());
    if (tool) { setTool(tool.id); return; }
    switch (k) {
      case "x": case "X": [S.primary, S.secondary] = [S.secondary, S.primary]; syncColors(); break;
      case "[": S.size = Math.max(1, S.size - 1); $("#optSize").value = String([1, 2, 3, 4, 6, 8].reduce((a, b) => Math.abs(b - S.size) < Math.abs(a - S.size) ? b : a)); S.size = +$("#optSize").value; requestRender(); break;
      case "]": { const opts = [1, 2, 3, 4, 6, 8]; S.size = opts.find((o) => o > S.size) || 8; $("#optSize").value = String(S.size); requestRender(); break; }
      case "m": case "M": $("#optMirrorX").click(); break;
      case "k": case "K": $("#optLock").click(); break;
      case "t": case "T": { const o = $("#optDither"); o.selectedIndex = (o.selectedIndex + 1) % o.options.length; S.dither = o.value; toast(`Dither: ${o.options[o.selectedIndex].text}`); break; }
      case "p": case "P": $("#optPerfect").click(); toast(S.perfect ? "Pixel perfect on" : "Pixel perfect off"); break;
      case "g": case "G": $("#optGrid").click(); break;
      case "0": in3D() ? preview.resetView() : fit(); break;
      case "+": case "=": in3D() ? preview.zoom(1 / 1.2) : zoomStep(1); break;
      case "-": case "_": in3D() ? preview.zoom(1.2) : zoomStep(-1); break;
      case "3": if (doc.mode === "skin") setSkinView(S.sv === "3d" ? "2d" : "3d"); break;
      case ",": if (doc.mode === "art") { clearSelection(); doc.setFrame((doc.frame - 1 + doc.frames.length) % doc.frames.length); } break;
      case ".": if (doc.mode === "art") { clearSelection(); doc.setFrame((doc.frame + 1) % doc.frames.length); } break;
      case "n": case "N": newDialog(); break;
      case "?": helpDialog(); break;
      case "Delete": case "Backspace": if (S.sel) { e.preventDefault(); selAction("delete"); } break;
      case "Enter": case "Escape": if (S.sel) { e.preventDefault(); clearSelection(); } break;
      case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown":
        if (in3D()) {
          e.preventDefault();
          const a = e.shiftKey ? 45 : 15;
          preview.orbit(k === "ArrowLeft" ? -a : k === "ArrowRight" ? a : 0, k === "ArrowUp" ? -a : k === "ArrowDown" ? a : 0);
        } else if (S.sel) {
          e.preventDefault(); lift();
          const f = S.sel.float, step = e.shiftKey ? 4 : 1;
          if (k === "ArrowLeft") f.x -= step; if (k === "ArrowRight") f.x += step; if (k === "ArrowUp") f.y -= step; if (k === "ArrowDown") f.y += step;
          requestRender();
        }
        break;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Alt") altDown = false;
    if (e.key === " ") { spaceDown = false; setTool(S.tool); }
  });
  window.addEventListener("blur", () => { altDown = false; spaceDown = false; });

  // paste images straight from the clipboard
  window.addEventListener("paste", async (e) => {
    if (dlg.open) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    const url = URL.createObjectURL(file);
    try {
      const img = await store.loadImage(url);
      if (doc.mode === "skin" && img.naturalWidth === 64 && (img.naturalHeight === 64 || img.naturalHeight === 32)) return importSkinImage(img, "Pasted skin");
      const w = Math.min(img.naturalWidth, doc.w), h = Math.min(img.naturalHeight, doc.h);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      pasteClip({ w, h, px: g.getImageData(0, 0, w, h).data });
    } catch (err) { toast(err.message); } finally { URL.revokeObjectURL(url); }
  });

  // drag and drop files
  stage.addEventListener("dragover", (e) => { e.preventDefault(); });
  stage.addEventListener("drop", (e) => { e.preventDefault(); importFile(e.dataTransfer.files[0]); });

  new ResizeObserver(resizeView).observe(stage);
  window.addEventListener("beforeunload", autosave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) autosave(); });
}

// ---------------------------------------------------------------- start
async function start() {
  if (new URLSearchParams(location.search).has("debug")) window.__pixels = { get doc() { return doc; }, S };
  wire();
  buildPalette();
  setTool("pencil");
  let d = null;
  const params = new URLSearchParams(location.search);
  const wantSkin = params.has("skin") || location.pathname.startsWith("/skin");
  const last = store.lastDocId();
  if (last && !wantSkin) { try { d = await store.openDoc(last); } catch {} }
  if (!d && wantSkin) {
    const recent = store.listDocs().find((e) => e.mode === "skin");
    if (recent) { try { d = await store.openDoc(recent.id); } catch {} }
  }
  if (!d) d = wantSkin ? newSkin() : newArt(32, 32);
  setDoc(d);
  // phones and tablets open straight into focus mode (unless the person turned it off last time)
  if (TOUCH_FIRST && prefs.touchFocus !== false && !params.has("nofocus")) {
    setFocus(true, { auto: true });
  } else if (!store.listDocs().length && !localStorage.getItem("pixels:seenHelp")) {
    localStorage.setItem("pixels:seenHelp", "1");
    toast("Left click draws, right click uses the 2nd colour. Press ? for shortcuts.");
  }
}
start();
