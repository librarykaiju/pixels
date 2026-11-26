// Minimal animated GIF encoder for pixel art: one shared palette, index 0 is
// transparent, nearest-neighbour upscaling, loops forever.
// frames: [{ px: Uint8ClampedArray (w*h*4), delay: ms }]

export function encodeGIF(frames, w, h, scale = 1) {
  const { palette, indexOf } = buildPalette(frames);
  let bits = 1;
  while ((1 << bits) < palette.length) bits++;
  const size = 1 << bits;
  const W = w * scale, H = h * scale;
  const out = [];
  const u16 = (v) => out.push(v & 255, (v >> 8) & 255);
  const str = (s) => { for (const c of s) out.push(c.charCodeAt(0)); };

  str("GIF89a");
  u16(W); u16(H);
  out.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0); // global colour table, bg 0, aspect 0
  for (let i = 0; i < size; i++) { const c = palette[i] || [0, 0, 0]; out.push(c[0], c[1], c[2]); }
  // loop forever
  out.push(0x21, 0xff, 11); str("NETSCAPE2.0"); out.push(3, 1, 0, 0, 0);

  for (const f of frames) {
    const delay = Math.max(2, Math.round((f.delay || 100) / 10));
    // graphic control: dispose to background (so transparent frames don't stack), transparent index 0
    out.push(0x21, 0xf9, 4, (2 << 2) | 1); u16(delay); out.push(0, 0);
    out.push(0x2c); u16(0); u16(0); u16(W); u16(H); out.push(0);
    const idx = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const sy = (y / scale) | 0;
      for (let x = 0; x < W; x++) {
        const k = (sy * w + ((x / scale) | 0)) * 4;
        idx[y * W + x] = f.px[k + 3] < 128 ? 0 : indexOf(f.px[k], f.px[k + 1], f.px[k + 2]);
      }
    }
    const minCode = Math.max(2, bits);
    out.push(minCode);
    const data = lzw(idx, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      out.push(n);
      for (let j = 0; j < n; j++) out.push(data[i + j]);
    }
    out.push(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

// Up to 255 colours (plus transparent). Drawings with more get their colours
// bucketed (fewer bits per channel) until they fit, using each bucket's average.
function buildPalette(frames) {
  const counts = new Map();
  for (const f of frames) {
    const px = f.px;
    for (let k = 0; k < px.length; k += 4) {
      if (px[k + 3] < 128) continue;
      const key = (px[k] << 16) | (px[k + 1] << 8) | px[k + 2];
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  if (counts.size <= 255) {
    const palette = [[0, 0, 0]], map = new Map();
    for (const key of counts.keys()) { map.set(key, palette.length); palette.push([key >> 16, (key >> 8) & 255, key & 255]); }
    return { palette, indexOf: (r, g, b) => map.get((r << 16) | (g << 8) | b) };
  }
  for (let shift = 1; shift <= 5; shift++) {
    const buckets = new Map();
    const bk = (r, g, b) => ((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift);
    for (const [key, n] of counts) {
      const r = key >> 16, g = (key >> 8) & 255, b = key & 255, k = bk(r, g, b);
      const e = buckets.get(k) || [0, 0, 0, 0];
      e[0] += r * n; e[1] += g * n; e[2] += b * n; e[3] += n;
      buckets.set(k, e);
    }
    if (buckets.size <= 255 || shift === 5) {
      const palette = [[0, 0, 0]], map = new Map();
      for (const [k, e] of buckets) {
        if (palette.length >= 256) { map.set(k, nearest(palette, e[0] / e[3], e[1] / e[3], e[2] / e[3])); continue; }
        map.set(k, palette.length);
        palette.push([Math.round(e[0] / e[3]), Math.round(e[1] / e[3]), Math.round(e[2] / e[3])]);
      }
      return { palette, indexOf: (r, g, b) => map.get(bk(r, g, b)) };
    }
  }
}

function nearest(palette, r, g, b) {
  let best = 1, bd = Infinity;
  for (let i = 1; i < palette.length; i++) {
    const c = palette[i], d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function lzw(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  const dict = new Map();
  const out = [];
  let cur = 0, nbits = 0;
  const emit = (code) => {
    cur |= code << nbits; nbits += codeSize;
    while (nbits >= 8) { out.push(cur & 255); cur >>>= 8; nbits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      dict.clear(); next = eoi + 1; codeSize = minCode + 1;
    } else {
      if (next >= (1 << codeSize)) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (nbits > 0) out.push(cur & 255);
  return out;
}
