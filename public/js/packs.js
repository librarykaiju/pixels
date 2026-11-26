// Imported asset packs: read PNGs (loose or inside a .zip), slice sheets into tiles,
// and keep them in this browser's IndexedDB so they're there next visit.

// ---------------------------------------------------------------- zip (read only, no libraries)
// Handles "stored" and "deflate" entries, which is what every common zip tool writes.
export async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That doesn't look like a zip file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [], dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || /(^|\/)\._/.test(name)) continue;
    const lstart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(lstart, lstart + csize);
    out.push({ name, method, usize, data });
  }
  return out;
}
export async function inflateEntry(e) {
  if (e.method === 0) return e.data;
  if (e.method !== 8) throw new Error(`Unsupported compression in ${e.name}`);
  const stream = new Blob([e.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------- images
export async function decodePNG(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, px: g.getImageData(0, 0, bmp.width, bmp.height).data };
}

const crop = (img, x, y, w, h) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) out.set(img.px.subarray(((y + j) * img.w + x) * 4, ((y + j) * img.w + x + w) * 4), j * w * 4);
  return out;
};
const isEmpty = (px) => { for (let k = 3; k < px.length; k += 4) if (px[k]) return false; return true; };

// Turn a list of decoded images into assets. Images bigger than the tile size get sliced
// when opts.slice is on (tile size, spacing between tiles, margin around the sheet).
export function sliceImages(images, opts) {
  const { slice = true, tw = 16, th = 16, spacing = 0, margin = 0, skipEmpty = true, limit = 3000 } = opts;
  const assets = [];
  for (const im of images) {
    const base = im.name.replace(/^.*\//, "").replace(/\.png$/i, "");
    if (!slice || (im.w <= tw && im.h <= th) || im.w < tw || im.h < th) {
      if (im.w <= 1024 && im.h <= 1024 && !(skipEmpty && isEmpty(im.px))) assets.push({ name: base, w: im.w, h: im.h, px: im.px });
    } else {
      const cols = Math.floor((im.w - 2 * margin + spacing) / (tw + spacing));
      const rows = Math.floor((im.h - 2 * margin + spacing) / (th + spacing));
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const px = crop(im, margin + c * (tw + spacing), margin + r * (th + spacing), tw, th);
        if (skipEmpty && isEmpty(px)) continue;
        assets.push({ name: `${base} ${c},${r}`, w: tw, h: th, px });
        if (assets.length >= limit) return assets;
      }
    }
    if (assets.length >= limit) break;
  }
  return assets;
}

// Read the files the person picked: PNGs, or zips full of PNGs. Also picks up a license note if the zip has one.
export async function readFiles(files, onProgress = () => {}) {
  const images = [];
  let license = "";
  for (const f of files) {
    if (/\.zip$/i.test(f.name) || f.type === "application/zip") {
      const entries = await unzip(await f.arrayBuffer());
      const pngs = entries.filter((e) => /\.png$/i.test(e.name));
      const lic = entries.find((e) => /(^|\/)(license|licence|readme)[^/]*\.txt$/i.test(e.name));
      if (lic && !license) {
        try { license = new TextDecoder().decode(await inflateEntry(lic)).replace(/\s+/g, " ").trim().slice(0, 300); } catch {}
      }
      let i = 0;
      for (const e of pngs) {
        onProgress(`Reading ${++i} of ${pngs.length}…`);
        try { const im = await decodePNG(await inflateEntry(e)); images.push({ name: e.name, ...im }); } catch {}
      }
    } else if (/\.png$/i.test(f.name) || f.type === "image/png") {
      try { images.push({ name: f.name, ...(await decodePNG(new Uint8Array(await f.arrayBuffer()))) }); } catch {}
    }
  }
  images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { images, license };
}

// ---------------------------------------------------------------- storage
const DB = "pixels-packs", STORE = "packs";
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("Couldn't save the pack. The browser may be out of space."));
  });
}
export const listPacks = () => tx("readonly", (s) => s.getAll()).catch(() => []);
export const savePack = (pack) => tx("readwrite", (s) => s.put(pack));
export const deletePack = (id) => tx("readwrite", (s) => s.delete(id));
