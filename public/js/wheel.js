// Colour wheel: a hue ring with a saturation/brightness square inside it.
// createWheel(host, onChange) -> { set([r,g,b]) }. onChange gets [r,g,b] while dragging, and (rgb, true) on release.

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
export function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return [f(5), f(3), f(1)];
}

export function createWheel(host, onChange) {
  const cv = document.createElement("canvas");
  cv.className = "wheel";
  cv.setAttribute("aria-label", "Colour wheel: drag the ring for the colour, the square for how light or strong it is");
  host.appendChild(cv);
  const ctx = cv.getContext("2d");
  let hsv = [0, 1, 1], size = 0, dpr = 1, drag = null;
  const ringBase = document.createElement("canvas"); // the ring never changes, so draw it once per size

  function geom() {
    const R = size / 2, ring = Math.max(14, R * 0.17), inner = R - ring - 6;
    const half = Math.floor(inner * Math.SQRT1_2) - 2;
    return { c: R, R, rIn: R - ring, rMid: R - ring / 2, ring, half };
  }
  function layout() {
    const w = Math.round(host.clientWidth || 220);
    const s = Math.min(w, 300);
    if (s === size && dpr === (window.devicePixelRatio || 1)) return;
    size = s; dpr = window.devicePixelRatio || 1;
    cv.style.width = cv.style.height = size + "px";
    cv.width = cv.height = Math.round(size * dpr);
    ringBase.width = ringBase.height = cv.width;
    const g = geom(), rc = ringBase.getContext("2d");
    rc.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let a = 0; a < 360; a += 1) {
      rc.beginPath();
      rc.strokeStyle = `hsl(${a},100%,50%)`; rc.lineWidth = g.ring;
      rc.arc(g.c, g.c, g.rMid, ((a - 90.6) * Math.PI) / 180, ((a - 89) * Math.PI) / 180);
      rc.stroke();
    }
  }
  function draw() {
    layout();
    if (!size) return;
    const g = geom();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(ringBase, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // square: white -> pure hue across, then fade to black downwards
    const x0 = g.c - g.half, y0 = g.c - g.half, w = g.half * 2;
    const [hr, hg, hb] = hsvToRgb(hsv[0], 1, 1);
    let gr = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    gr.addColorStop(0, "#fff"); gr.addColorStop(1, `rgb(${hr},${hg},${hb})`);
    ctx.fillStyle = gr; roundRect(x0, y0, w, w, 6); ctx.fill();
    gr = ctx.createLinearGradient(0, y0, 0, y0 + w);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "#000");
    ctx.fillStyle = gr; roundRect(x0, y0, w, w, 6); ctx.fill();
    // markers
    const a = ((hsv[0] - 90) * Math.PI) / 180;
    marker(g.c + Math.cos(a) * g.rMid, g.c + Math.sin(a) * g.rMid, g.ring / 2 + 3, `rgb(${hr},${hg},${hb})`);
    const [r, gg, b] = hsvToRgb(...hsv);
    marker(x0 + hsv[1] * w, y0 + (1 - hsv[2]) * w, 9, `rgb(${r},${gg},${b})`);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function marker(x, y, r, fill) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = "#0008"; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.stroke();
  }
  function pick(e, end = false) {
    const rect = cv.getBoundingClientRect(), g = geom();
    const x = e.clientX - rect.left, y = e.clientY - rect.top, dx = x - g.c, dy = y - g.c;
    if (drag === "ring") {
      hsv[0] = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    } else if (drag === "sq") {
      const w = g.half * 2;
      hsv[1] = Math.max(0, Math.min(1, (x - (g.c - g.half)) / w));
      hsv[2] = Math.max(0, Math.min(1, 1 - (y - (g.c - g.half)) / w));
    }
    draw();
    onChange(hsvToRgb(...hsv), end);
  }
  cv.addEventListener("pointerdown", (e) => {
    const rect = cv.getBoundingClientRect(), g = geom();
    const dx = e.clientX - rect.left - g.c, dy = e.clientY - rect.top - g.c, d = Math.hypot(dx, dy);
    if (d >= g.rIn - 6 && d <= g.R + 4) drag = "ring";
    else if (Math.abs(dx) <= g.half + 8 && Math.abs(dy) <= g.half + 8) drag = "sq";
    else return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    pick(e);
  });
  cv.addEventListener("pointermove", (e) => { if (drag) pick(e); });
  const up = (e) => { if (drag) { pick(e, true); drag = null; } };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", () => { drag = null; });
  new ResizeObserver(() => draw()).observe(host);

  return {
    set(rgb) {
      if (drag) return;
      const n = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      if (n[1] === 0 || n[2] === 0) n[0] = hsv[0]; // greys and black have no hue: keep the ring where it was
      if (n[2] === 0) n[1] = hsv[1];
      hsv = n; draw();
    },
    get dragging() { return !!drag; },
  };
}
