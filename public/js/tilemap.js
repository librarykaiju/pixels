// Tilemap layers: the layer is a grid of cells, each pointing at a tile in the layer's tileset.
// Edit the pixels of one cell and every cell using that tile changes with it.
// tm = { tw, th, cols, rows, tiles: [Uint8ClampedArray(tw*th*4)], map: Int32Array(cols*rows) }
// tiles[0] is always the empty tile.

const blank = (tw, th) => new Uint8ClampedArray(tw * th * 4);
const keyOf = (px) => { let h = 2166136261; for (let k = 0; k < px.length; k++) h = Math.imul(h ^ px[k], 16777619); return h >>> 0; };
const same = (a, b) => { if (a.length !== b.length) return false; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false; return true; };
const isEmpty = (px) => { for (let k = 3; k < px.length; k += 4) if (px[k]) return false; return true; };

function cellPx(px, w, x0, y0, tw, th, h) {
  const out = blank(tw, th);
  for (let j = 0; j < th; j++) {
    const y = y0 + j; if (y >= h) break;
    const n = Math.min(tw, w - x0);
    out.set(px.subarray((y * w + x0) * 4, (y * w + x0 + n) * 4), j * tw * 4);
  }
  return out;
}

// cut a picture into a tileset + map, merging identical tiles
export function buildTilemap(px, w, h, tw, th) {
  const cols = Math.ceil(w / tw), rows = Math.ceil(h / th);
  const tiles = [blank(tw, th)], map = new Int32Array(cols * rows), index = new Map();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const t = cellPx(px, w, c * tw, r * th, tw, th, h);
    if (isEmpty(t)) continue;
    const k = keyOf(t);
    let found = (index.get(k) || []).find((i) => same(tiles[i], t));
    if (found === undefined) { found = tiles.length; tiles.push(t); index.set(k, [...(index.get(k) || []), found]); }
    map[r * cols + c] = found;
  }
  return { tw, th, cols, rows, tiles, map };
}

export function renderTilemap(tm, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < tm.rows; r++) for (let c = 0; c < tm.cols; c++) {
    const t = tm.tiles[tm.map[r * tm.cols + c]];
    if (!t) continue;
    for (let j = 0; j < tm.th; j++) {
      const y = r * tm.th + j; if (y >= h) break;
      const n = Math.min(tm.tw, w - c * tm.tw);
      if (n <= 0) continue;
      out.set(t.subarray(j * tm.tw * 4, (j * tm.tw + n) * 4), (y * w + c * tm.tw) * 4);
    }
  }
  return out;
}

// After pixels were painted on the layer: cells that changed update their tile (and so every
// cell sharing it). A changed empty cell gets a new tile. Returns a new tilemap object.
export function syncTilemap(tm, px, w, h) {
  const next = { ...tm, tiles: tm.tiles.slice(), map: tm.map.slice() };
  const done = new Map(); // tile index -> the new content it got this pass
  for (let r = 0; r < tm.rows; r++) for (let c = 0; c < tm.cols; c++) {
    const i = r * tm.cols + c, t = cellPx(px, w, c * tm.tw, r * tm.th, tm.tw, tm.th, h);
    const cur = tm.map[i];
    if (same(t, tm.tiles[cur])) continue; // compare with the tiles as they were, so shared cells aren't "changed" by the first edit
    if (cur !== 0 && !done.has(cur)) { next.tiles[cur] = t; done.set(cur, t); continue; }
    if (cur !== 0 && same(done.get(cur), t)) continue;
    if (isEmpty(t)) { next.map[i] = 0; continue; }
    next.map[i] = next.tiles.length; next.tiles.push(t);
  }
  return next;
}

export function placeTile(tm, c, r, idx) {
  if (c < 0 || r < 0 || c >= tm.cols || r >= tm.rows) return tm;
  const i = r * tm.cols + c;
  if (tm.map[i] === idx) return tm;
  const map = tm.map.slice(); map[i] = idx;
  return { ...tm, map };
}

// tiles no cell uses any more
export function pruneTiles(tm) {
  const used = new Set(tm.map);
  const keep = [0], remap = new Map([[0, 0]]);
  tm.tiles.forEach((t, i) => { if (i && used.has(i)) { remap.set(i, keep.length); keep.push(i); } });
  return { ...tm, tiles: keep.map((i) => tm.tiles[i]), map: Int32Array.from(tm.map, (v) => remap.get(v) || 0) };
}
