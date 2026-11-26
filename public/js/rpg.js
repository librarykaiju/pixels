// Original pixel RPG starter assets, drawn in code (no outside art, free to use).
// Every asset: { id, name, cat, w, h, frames: [Uint8ClampedArray], duration }

export const RPG_PALETTE = {
  k: "#1a1420", w: "#f4f0e8", g: "#a8a8b8", G: "#5a5a6e", s: "#d0d4e0", y: "#f2c230", Y: "#b07a18",
  r: "#d83a3a", R: "#8a1e2a", b: "#3a7ad8", B: "#1e3a8a", c: "#7fd8f0", n: "#8a5a32", N: "#5a3418",
  e: "#4caa3c", E: "#2a6a2a", p: "#9a4ad8", P: "#5a2a8a", o: "#f08a30", l: "#fff6c8", f: "#f0c8a0",
};
export const RPG_COLOURS = Object.values(RPG_PALETTE);

const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; };
const C = Object.fromEntries(Object.entries(RPG_PALETTE).map(([k, v]) => [k, rgb(v)]));
const shade = (c, f) => [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f)), c[3]];
const noise = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

class Pix {
  constructor(w = 16, h = 16) { this.w = w; this.h = h; this.px = new Uint8ClampedArray(w * h * 4); }
  set(x, y, c) { if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return; const k = (y * this.w + x) * 4; this.px[k] = c[0]; this.px[k + 1] = c[1]; this.px[k + 2] = c[2]; this.px[k + 3] = c[3] ?? 255; }
  get(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null; const k = (y * this.w + x) * 4; return this.px[k + 3] ? [this.px[k], this.px[k + 1], this.px[k + 2], this.px[k + 3]] : null; }
  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); }
  fill(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, fn(x, y)); }
  ellipse(cx, cy, rx, ry, fn) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      if (d <= 1) this.set(x, y, fn(x, y, d));
    }
  }
  // dark 1px outline around everything drawn so far
  outline(c = C.k) {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y)) continue;
      if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
    }
    for (const [x, y] of add) this.set(x, y, c);
    return this;
  }
  blit(src, ox, oy) { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const c = src.get(x, y); if (c) this.set(ox + x, oy + y, c); } }
  mirror() { const o = new Pix(this.w, this.h); for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) o.set(this.w - 1 - x, y, this.get(x, y)); return o; }
  copy() { const o = new Pix(this.w, this.h); o.px.set(this.px); return o; }
}

function fromGrid(rows, map = C) {
  const p = new Pix(16, 16);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== "." && map[ch]) p.set(x, y, map[ch]); }));
  return p;
}

// ---------------------------------------------------------------- tiles
function grass(seed = 0) {
  const p = new Pix();
  const g0 = rgb("#5aa83c"), g1 = rgb("#4a9030"), g2 = rgb("#7cc850");
  p.fill((x, y) => (noise(x, y, seed) < 0.18 ? g1 : g0));
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(noise(i, 1, seed + 3) * 16), y = 1 + Math.floor(noise(i, 2, seed + 3) * 14);
    p.set(x, y, g2); p.set(x, y - 1, g2);
  }
  return p;
}
function tallGrass() {
  const p = grass(5), d = rgb("#3a7a26"), l = rgb("#8ad860");
  for (const [x, y] of [[2, 6], [9, 4], [5, 12], [12, 11], [13, 3]]) {
    p.set(x, y, d); p.set(x - 1, y - 1, l); p.set(x + 1, y - 1, l); p.set(x, y - 1, d); p.set(x, y - 2, l); p.set(x - 1, y - 2, l); p.set(x + 1, y - 2, l);
  }
  return p;
}
function speckled(base, dark, light, seed) {
  const p = new Pix(), b = rgb(base), d = rgb(dark), l = rgb(light);
  p.fill((x, y) => { const n = noise(x, y, seed); return n < 0.12 ? d : n > 0.93 ? l : b; });
  return p;
}
function water(frame) {
  const p = new Pix(), b = rgb("#3a7ad8"), d = rgb("#2a5ab0"), l = rgb("#9fd0f8");
  p.fill((x, y) => (noise(x >> 2, y >> 2, 9) < 0.3 ? d : b));
  for (const [wx, wy] of [[2, 3], [9, 7], [4, 12], [12, 13]]) {
    const x = (wx + frame * 2) % 16;
    p.set(x, wy, l); p.set((x + 1) % 16, wy, l); p.set((x + 2) % 16, wy - 1, l);
  }
  return p;
}
function stoneFloor() {
  const p = new Pix(), m = rgb("#5a5a6e");
  p.fill((x, y) => {
    if (x % 8 === 7 || y % 8 === 7) return m;
    const n = noise(x, y, 4);
    return shade(rgb("#9a9aaa"), 0.92 + n * 0.14 + ((x % 8 === 0 || y % 8 === 0) ? 0.08 : 0));
  });
  return p;
}
function brickWall() {
  const p = new Pix(), m = rgb("#6a5a50");
  p.fill((x, y) => {
    const row = Math.floor(y / 4), off = row % 2 ? 4 : 0;
    if (y % 4 === 3 || (x + off) % 8 === 7) return m;
    const brick = Math.floor((x + off) / 8) + row * 3;
    let c = shade(rgb("#a84a3a"), 0.9 + noise(brick, row, 2) * 0.2);
    if (y % 4 === 0) c = shade(c, 1.12);
    return c;
  });
  return p;
}
function woodPlanks() {
  const p = new Pix(), dk = rgb("#6a4020");
  p.fill((x, y) => {
    if (x % 4 === 3) return dk;
    const plank = x >> 2, seam = (plank * 5 + 3) % 16;
    if (y === seam) return dk;
    return shade(rgb("#a87040"), 0.92 + noise(plank, y >> 1, 6) * 0.14);
  });
  for (let pl = 0; pl < 4; pl++) { const seam = (pl * 5 + 3) % 16; p.set(pl * 4 + 1, (seam + 1) % 16, rgb("#4a2a10")); }
  return p;
}
function tree() {
  const p = new Pix();
  p.rect(7, 12, 2, 3, C.N);
  p.ellipse(8, 7.5, 7, 6.5, (x, y) => {
    const lx = x - 5, ly = y - 4;
    const n = noise(x, y, 11);
    if (lx + ly < 0 && n < 0.6) return rgb("#6cc04a");
    if (x + y > 17) return rgb("#2e7a2a");
    return n < 0.2 ? rgb("#3a8e30") : rgb("#4caa3c");
  });
  return p.outline();
}
function bush() {
  const p = new Pix();
  p.ellipse(8, 10, 6, 4.5, (x, y) => (x + y < 15 && noise(x, y, 12) < 0.6 ? rgb("#6cc04a") : x + y > 20 ? rgb("#2e7a2a") : rgb("#4caa3c")));
  p.set(5, 9, C.r); p.set(10, 8, C.r); p.set(8, 12, C.r);
  return p.outline();
}
function rock() {
  const p = new Pix();
  p.ellipse(8, 10, 6, 4.5, (x, y) => (x + y < 15 ? rgb("#b8b8c8") : x + y > 20 ? rgb("#6a6a7e") : rgb("#9a9aaa")));
  p.set(6, 8, rgb("#d8d8e4")); p.set(7, 8, rgb("#d8d8e4"));
  return p.outline();
}
function flowers() {
  const p = grass(7);
  const put = (x, y, c) => { p.set(x, y, rgb("#f6e070")); p.set(x - 1, y, c); p.set(x + 1, y, c); p.set(x, y - 1, c); p.set(x, y + 1, c); };
  put(3, 4, C.r); put(11, 3, C.w); put(7, 9, C.p); put(13, 12, C.r); put(3, 13, C.w);
  return p;
}
function torch(frame) {
  const p = new Pix();
  p.rect(7, 9, 2, 6, C.n); p.set(7, 9, C.N); p.set(8, 14, C.N);
  const h = frame ? 6 : 5, top = 9 - h;
  p.ellipse(8, top + h / 2 + 0.5, 2.6, h / 2 + 0.6, (x, y) => (y > top + h * 0.55 ? C.y : C.o));
  p.set(8 + (frame ? -1 : 1), top, C.o);
  p.set(8, top + h - 1, C.l);
  return p.outline();
}

const CHEST = [
  "................", "................", "..kkkkkkkkkkkk..", ".knnnnnnnnnnnNk.", ".knyyyyyyyyyyNk.", ".knnnnnnnnnnnNk.",
  ".kNNNNNNNNNNNNk.", ".kkkkkkykkkkkkk.", ".knnnnnyYnnnnNk.", ".knnnnnkknnnnNk.", ".knnnnnnnnnnnNk.", ".kyyyyyyyyyyyNk.",
  ".knnnnnnnnnnnNk.", ".kkkkkkkkkkkkkk.",
];
const DOOR = [
  "..kkkkkkkkkkkk..", "..kGGGGGGGGGGk..", "..kGkkkkkkkkGk..", "..kGknnnnnNkGk..", "..kGknNnnNNkGk..", "..kGknnnnnNkGk..",
  "..kGknNnnNNkGk..", "..kGknnnnyNkGk..", "..kGknNnyYNkGk..", "..kGknnnnnNkGk..", "..kGknNnnNNkGk..", "..kGknnnnnNkGk..",
  "..kGknNnnNNkGk..", "..kGknnnnnNkGk..", "..kGkkkkkkkkGk..", "..kkkkkkkkkkkk..",
];

// ---------------------------------------------------------------- items
const ITEMS = {
  sword: ["..............kk", ".............kwk", "............kwsk", "...........kwsk.", "..........kwsk..", ".........kwsk...", "........kwsk....", ".......kwsk.....",
    "..kk..kwsk......", "..kYkkwsk.......", "...kYysk........", "....kyYk........", "...kNkkYk.......", "..kNk..kYk......", ".kNk....kk......", ".kk............."],
  shield: ["................", "...kkkkkkkkkk...", "..kssssssssssk..", "..ksbbbbbbbbsk..", "..ksbbbyybbbsk..", "..ksbbbyybbbsk..", "..ksbyyyyyybsk..", "..ksbyyyyyybsk..",
    "..ksbbbyybbbsk..", "..ksbbbyybbbsk..", "...ksbbyybbsk...", "...ksbbbbbbsk...", "....ksbbbbsk....", ".....ksbbsk.....", "......kssk......", ".......kk......."],
  potionRed: ["................", "......kkkk......", "......knnk......", ".......kk.......", "......kwgk......", "......kwgk......", ".....kwgggk.....", "....kwrrrrgk....",
    "...kwrrlrrrrk...", "...krrlrrrrRk...", "...krrrrrrrRk...", "...krrrrrrRRk...", "....kRrrrRRk....", ".....kkkkkk....."],
  key: ["................", "................", "...kkkk.........", "..kyyyyk........", ".kyykkyyk.......", ".kyk..kyk.......", ".kyk..kykkkkkkk.", ".kyykkyyyyyyyyYk",
    "..kyyyyYkkkkYYk.", "...kkkk....kYk..", "...........kYk..", "............k..."],
  coin: ["................", "................", ".....kkkkkk.....", "....kyyyyyyk....", "...kyylyyyyYk...", "...kylyyyyyYk...", "...kyyyYYyyYk...", "...kyyyYYyyYk...",
    "...kyyyYYyyYk...", "...kyyyyyyyYk...", "...kyyyyyyYYk...", "....kYYYYYYk....", ".....kkkkkk....."],
  heart: ["................", "................", "..kkk....kkk....", ".krrrk..krrrk...", "krlrrrkkrrrrRk..", "krlrrrrrrrrrRk..", "krrrrrrrrrrrRk..", ".krrrrrrrrrRk...",
    "..krrrrrrrRk....", "...krrrrrRk.....", "....krrrRk......", ".....krRk.......", "......kk........"],
  gem: ["................", "................", "....kkkkkkk.....", "...kcwccbbBk....", "..kcwcccbbbBk...", ".kkkkkkkkkkkkk..", ".kcwccccbbbbBk..", "..kcccccbbbBk...",
    "...kcccbbbBk....", "....kccbbBk.....", ".....kcbBk......", "......kBk.......", ".......k........"],
  staff: ["..........kkk...", ".........kpcpk..", ".........kcwck..", ".........kpcpk..", "........kkkkk...", ".......kNnk.....", "......kNnk......", ".....kNnk.......",
    "....kNnk........", "...kNnk.........", "..kNnk..........", ".kNnk...........", ".kkk............"],
  scroll: ["................", "..kkkkkkkkkkk...", ".kwwwwwwwwwwgk..", ".kgkkkkkkkkkgk..", "..kwwwwwwwwwk...", "..kwGGGGGGwwk...", "..kwwwwwwwwwk...", "..kwGGGGGwwwk...",
    "..kwwwwwwwwwk...", "..kwGGGGGGGwk...", "..kwwwwwwwwwk...", ".kgkkkkkkkkkgk..", ".kwwwwwwwwwwgk..", "..kkkkkkkkkkk..."],
  apple: ["................", ".......kk.......", "......kNk.kk....", "......kNkkEEk...", "....kkkNkEEk....", "...krrrkrrrk....", "..krlrrrrrrRk...", "..krlrrrrrrRk...",
    "..krrrrrrrrRk...", "..krrrrrrrRRk...", "...krrrrrRRk....", "....kRkkRRk.....", ".....k..kk......"],
};
const itemNames = { sword: "Sword", shield: "Shield", potionRed: "Health potion", potionBlue: "Mana potion", key: "Key", coin: "Coin", heart: "Heart", gem: "Gem", staff: "Magic staff", scroll: "Scroll", apple: "Apple" };

// ---------------------------------------------------------------- characters
// top-down walker, 16x16. dir: down / up / right. step: 0 idle, 1 left foot, 2 right foot.
function walker(o, dir, step) {
  const p = new Pix();
  const skin = rgb(o.skin), hair = rgb(o.hair), shirt = rgb(o.shirt), pants = rgb(o.pants), boots = rgb(o.boots);
  const shirtD = shade(shirt, 0.78);
  const bob = step ? 1 : 0; // body drops a pixel mid-stride
  const Y = (y) => y + bob;
  if (dir === "right") {
    // legs
    const front = step === 1 ? 2 : step === 2 ? -1 : 0, back = -front;
    p.rect(8 + front, Y(12), 2, 2, pants); p.rect(8 + front, Y(14) - (step ? 0 : 0), 2, 1, boots);
    p.rect(6 + back, Y(12), 2, 2, shade(pants, 0.8)); p.rect(6 + back, Y(14), 2, 1, shade(boots, 0.8));
    // body
    p.rect(6, Y(8), 4, 4, shirt); p.rect(6, Y(11), 4, 1, shirtD);
    // arm swings opposite to the front leg
    const arm = step === 1 ? -1 : step === 2 ? 1 : 0;
    p.rect(7 + arm, Y(8), 2, 3, shirtD); p.set(7 + arm, Y(11), skin); p.set(8 + arm, Y(11), skin);
    // head
    p.rect(5, Y(2), 6, 6, skin);
    p.rect(5, Y(1), 6, 2, hair); p.rect(5, Y(3), 3, 3, hair); p.set(5, Y(6), hair);
    p.set(9, Y(4), C.k); p.set(10, Y(6), shade(skin, 0.85));
    return p.outline();
  }
  // legs (down / up)
  const l = step === 1 ? 1 : 0, r = step === 2 ? 1 : 0;
  p.rect(6, Y(12), 2, 2 - r, pants); p.rect(6, Y(14) - r, 2, 1, boots);
  p.rect(8, Y(12), 2, 2 - l, pants); p.rect(8, Y(14) - l, 2, 1, boots);
  // body + arms
  p.rect(5, Y(8), 6, 4, shirt); p.rect(5, Y(11), 6, 1, shirtD);
  const la = step === 2 ? 1 : 0, ra = step === 1 ? 1 : 0;
  p.rect(4, Y(8), 1, 3 - la, shirtD); p.set(4, Y(11) - la, skin);
  p.rect(11, Y(8), 1, 3 - ra, shirtD); p.set(11, Y(11) - ra, skin);
  // head
  p.rect(5, Y(2), 6, 6, skin);
  if (dir === "down") {
    p.rect(5, Y(1), 6, 2, hair); p.set(5, Y(3), hair); p.set(10, Y(3), hair); p.set(5, Y(4), hair); p.set(10, Y(4), hair);
    p.set(6, Y(5), C.k); p.set(9, Y(5), C.k);
    p.set(7, Y(7), shade(skin, 0.82)); p.set(8, Y(7), shade(skin, 0.82));
  } else {
    p.rect(5, Y(1), 6, 6, hair); p.rect(6, Y(7), 4, 1, shade(hair, 0.85));
  }
  return p.outline();
}
function knight(dir, step) {
  const p = walker({ skin: "#d0d4e0", hair: "#a8a8b8", shirt: "#8a8aa0", pants: "#5a5a6e", boots: "#3a3a46" }, dir, step);
  // visor slit and plume
  const bob = step ? 1 : 0;
  if (dir === "down") { p.rect(6, 5 + bob, 4, 1, C.k); p.set(8, 0 + bob, C.r); p.set(7, 0 + bob, C.r); }
  if (dir === "right") { p.rect(8, 4 + bob, 3, 1, C.k); p.set(6, 0 + bob, C.r); p.set(7, 0 + bob, C.r); }
  if (dir === "up") { p.set(8, 0 + bob, C.r); p.set(7, 0 + bob, C.r); }
  return p;
}
function slime(frame) {
  const p = new Pix();
  const ry = frame ? 4 : 5, rx = frame ? 7 : 6, cy = 15 - ry;
  p.ellipse(8, cy + 0.5, rx, ry, (x, y) => (y < cy - ry / 3 && x < 8 ? rgb("#8ae070") : y > cy + ry / 2 ? rgb("#2e8a2a") : rgb("#4cc03c")));
  p.set(6, cy, C.k); p.set(10, cy, C.k); p.set(6, cy - 1, C.w); p.set(10, cy - 1, C.w);
  p.set(5, cy - ry + 2, C.w);
  return p.outline();
}
function bat(frame) {
  const p = new Pix(), body = rgb("#5a2a8a"), wing = rgb("#3a1a5a");
  p.ellipse(8, 8, 2.5, 3, () => body);
  const up = frame === 0;
  for (let i = 0; i < 5; i++) {
    const y = up ? 7 - i + (i > 2 ? 1 : 0) : 8 + Math.floor(i / 2);
    p.rect(5 - i, y, 1, up ? 2 + (i % 2) : 2, wing);
    p.rect(10 + i, y, 1, up ? 2 + (i % 2) : 2, wing);
  }
  p.set(7, 7, C.r); p.set(9, 7, C.r); p.set(7, 10, C.w); p.set(9, 10, C.w);
  p.set(6, 5, body); p.set(10, 5, body);
  return p.outline();
}

// ---------------------------------------------------------------- the library
const HERO = { skin: "#f0c8a0", hair: "#5a3418", shirt: "#3a7ad8", pants: "#5a4a3a", boots: "#3a2418" };
const VILLAGER = { skin: "#c08660", hair: "#dcbf74", shirt: "#4caa3c", pants: "#8a5a32", boots: "#3a2418" };

let cache = null;
export function rpgAssets() {
  if (cache) return cache;
  const A = [];
  const add = (id, name, cat, frames, duration = 150) => A.push({ id, name, cat, w: frames[0].w, h: frames[0].h, frames: frames.map((f) => f.px), duration });
  // tiles
  add("grass", "Grass", "Tiles", [grass()]);
  add("tallgrass", "Tall grass", "Tiles", [tallGrass()]);
  add("flowers", "Flowers", "Tiles", [flowers()]);
  add("dirt", "Dirt path", "Tiles", [speckled("#a07040", "#8a5a30", "#c09060", 1)]);
  add("sand", "Sand", "Tiles", [speckled("#e8d08a", "#d0b070", "#f4e2a8", 2)]);
  add("water", "Water", "Tiles", [water(0), water(1), water(2)], 300);
  add("stone", "Stone floor", "Tiles", [stoneFloor()]);
  add("brick", "Brick wall", "Tiles", [brickWall()]);
  add("wood", "Wood floor", "Tiles", [woodPlanks()]);
  add("tree", "Tree", "Tiles", [tree()]);
  add("bush", "Berry bush", "Tiles", [bush()]);
  add("rock", "Rock", "Tiles", [rock()]);
  add("chest", "Chest", "Tiles", [fromGrid(CHEST)]);
  add("door", "Door", "Tiles", [fromGrid(DOOR)]);
  add("torch", "Torch", "Tiles", [torch(0), torch(1)], 200);
  // items
  for (const id of Object.keys(ITEMS)) add(id, itemNames[id], "Items", [fromGrid(ITEMS[id])]);
  add("potionBlue", itemNames.potionBlue, "Items", [fromGrid(ITEMS.potionRed, { ...C, r: C.b, R: C.B })]);
  const coin2 = fromGrid(["................", "................", "......kkkk......", ".....kyyyYk.....", ".....kylyYk.....", ".....kyyyYk.....", ".....kyYyYk.....",
    ".....kyYyYk.....", ".....kyYyYk.....", ".....kyyyYk.....", ".....kyyYYk.....", ".....kYYYYk.....", "......kkkk......"]);
  add("coinspin", "Spinning coin", "Items", [fromGrid(ITEMS.coin), coin2], 160);
  // characters: walk cycles are idle, step, idle, step
  const cycle = (fn) => [fn(0), fn(1), fn(0), fn(2)];
  for (const [who, o, label] of [["hero", HERO, "Hero"], ["villager", VILLAGER, "Villager"]]) {
    add(`${who}-down`, `${label} walk down`, "Characters", cycle((s) => walker(o, "down", s)));
    add(`${who}-up`, `${label} walk up`, "Characters", cycle((s) => walker(o, "up", s)));
    add(`${who}-right`, `${label} walk right`, "Characters", cycle((s) => walker(o, "right", s)));
    add(`${who}-left`, `${label} walk left`, "Characters", cycle((s) => walker(o, "right", s).mirror()));
  }
  add("knight-down", "Knight walk down", "Characters", cycle((s) => knight("down", s)));
  add("knight-right", "Knight walk right", "Characters", cycle((s) => knight("right", s)));
  add("slime", "Slime", "Characters", [slime(0), slime(1)], 300);
  add("bat", "Bat", "Characters", [bat(0), bat(1)], 140);
  // scenes
  add("village", "Starter village", "Maps", [0, 1, 2].map((f) => village(f)), 300);
  cache = A;
  return A;
}

// 10x9 tiles (160x144), water and torches animate
function village(f) {
  const T = 16, W = 10, H = 9, map = new Pix(W * T, H * T);
  const g = [grass(0), grass(1), grass(2)], dirt = speckled("#a07040", "#8a5a30", "#c09060", 1);
  const wat = water(f), fl = flowers(), tg = tallGrass(), br = brickWall(), wd = woodPlanks();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let t = g[(x * 7 + y * 3) % 3];
    if (y === 5 || x === 4) t = dirt;
    if (x >= 7 && y >= 6) t = wat;
    if ((x === 1 && y === 7) || (x === 8 && y === 2)) t = fl;
    if ((x === 2 && y === 7) || (x === 6 && y === 7)) t = tg;
    map.blit(t, x * T, y * T);
  }
  // little house: brick walls, wood roof strip, door on the path
  for (let x = 1; x <= 3; x++) { map.blit(wd, x * T, 1 * T); map.blit(br, x * T, 2 * T); map.blit(br, x * T, 3 * T); }
  for (let x = 1; x <= 3; x++) for (let i = 0; i < T; i++) { map.set(x * T + i, 1 * T, C.N); map.set(x * T + i, 2 * T - 1, C.N); }
  map.blit(fromGrid(DOOR), 3 * T, 3 * T);
  map.blit(torch(f % 2), 2 * T, 4 * T - 6);
  // trees along the top and right, a few rocks and a chest
  for (const [x, y] of [[0, 0], [5, 0], [6, 0], [7, 0], [9, 0], [9, 1], [9, 3], [0, 4], [0, 8], [5, 8]]) map.blit(tree(), x * T, y * T);
  map.blit(bush(), 6 * T, 3 * T); map.blit(rock(), 8 * T, 4 * T); map.blit(rock(), 2 * T, 6 * T);
  map.blit(fromGrid(CHEST), 6 * T, 2 * T);
  map.blit(slime(f % 2), 7 * T, 4 * T);
  map.blit(walker(HERO, "down", f === 1 ? 1 : 0), 4 * T, 6 * T);
  return map;
}

// Every asset in a category laid out as one sprite sheet (first frame of each).
export function categorySheet(cat, cols = 8) {
  const list = rpgAssets().filter((a) => a.cat === cat && a.w === 16 && a.h === 16);
  const rows = Math.ceil(list.length / cols), sheet = new Pix(cols * 16, rows * 16);
  list.forEach((a, i) => { const p = new Pix(16, 16); p.px.set(a.frames[0]); sheet.blit(p, (i % cols) * 16, Math.floor(i / cols) * 16); });
  return { w: sheet.w, h: sheet.h, px: sheet.px, count: list.length };
}
