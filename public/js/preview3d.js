// Small WebGL renderer for the 3D skin preview. No libraries.
// Draws each part as a textured box, supports orbit/zoom, a walk cycle,
// and picking: which skin texel is under the pointer, so you can paint on the model.

import { partsFor, faceRects } from "./skin.js";

const VS = `
attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aNorm;
uniform mat4 uProj, uView, uModel;
varying vec2 vUV; varying float vLight;
void main() {
  vec3 n = normalize(mat3(uModel) * aNorm);
  vec3 L = normalize(vec3(0.35, 0.8, 0.6));
  vLight = 0.58 + 0.42 * max(dot(n, L), 0.0);
  vUV = aUV;
  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
}`;

const FS_HEAD_DERIV = `#extension GL_OES_standard_derivatives : enable
#define HAS_DERIV 1
`;
const FS = `
precision mediump float;
uniform sampler2D uTex; uniform float uOverlay; uniform float uPick; uniform float uGrid;
uniform vec4 uHover; // two texel coords (x1, y1, x2, y2); -1 means none
varying vec2 vUV; varying float vLight;
void main() {
  vec4 c = texture2D(uTex, vUV);
  if (uPick > 0.5) {
    // encode the texel coordinate. Overlay picking keeps transparent texels so you can paint new ones.
    vec2 t = floor(vUV * 64.0);
    gl_FragColor = vec4(t.x / 255.0, t.y / 255.0, uOverlay, 1.0);
    return;
  }
  if (uOverlay > 0.5) {
    if (c.a < 0.5) discard;
  } else {
    // the game shows see-through base pixels as dark; preview the same so holes are obvious
    if (c.a < 0.5) c = vec4(0.07, 0.07, 0.09, 1.0);
  }
  vec3 col = c.rgb * vLight;
  vec2 t = vUV * 64.0;
  vec2 cell = floor(t);
  if ((cell.x == uHover.x && cell.y == uHover.y) || (cell.x == uHover.z && cell.y == uHover.w)) {
    col = mix(col, vec3(1.0), 0.45);
  }
#ifdef HAS_DERIV
  if (uGrid > 0.5) {
    vec2 f = fract(t);
    vec2 w = fwidth(t) * 1.1;
    vec2 g = smoothstep(vec2(0.0), w, f) * smoothstep(vec2(0.0), w, 1.0 - f);
    float edge = 1.0 - min(g.x, g.y);
    col = mix(col, col * 0.45, edge * 0.75);
  }
#endif
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- tiny matrix library (column-major, like GL) ----
const M = {
  ident: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  persp(fov, asp, n, f) {
    const t = 1 / Math.tan(fov / 2);
    return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0];
  },
  trans: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
};

// Build a box's vertex data. Box from (x0,y0,z0) to (x1,y1,z1), texture box UV at (u,v), size w,h,d.
function boxData(x0, y0, z0, x1, y1, z1, u, v, w, h, d) {
  const R = faceRects(u, v, w, h, d);
  const pos = [], uv = [], nrm = [], idx = [];
  // each face: 4 corners (tl, tr, bl, br as seen from outside) + rect + normal
  const faces = [
    { r: R.front, n: [0, 0, 1], c: [[x0, y1, z1], [x1, y1, z1], [x0, y0, z1], [x1, y0, z1]] },
    { r: R.back, n: [0, 0, -1], c: [[x1, y1, z0], [x0, y1, z0], [x1, y0, z0], [x0, y0, z0]] },
    { r: R.right, n: [-1, 0, 0], c: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z0], [x0, y0, z1]] },
    { r: R.left, n: [1, 0, 0], c: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z1], [x1, y0, z0]] },
    { r: R.top, n: [0, 1, 0], c: [[x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1]] },
    // bottom: texture top edge sits at the back, left edge at -x
    { r: R.bottom, n: [0, -1, 0], c: [[x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1]] },
  ];
  for (const f of faces) {
    const [rx, ry, rw, rh] = f.r;
    const base = pos.length / 3;
    const tuv = [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]];
    for (let i = 0; i < 4; i++) {
      pos.push(...f.c[i]); nrm.push(...f.n);
      uv.push(tuv[i][0] / 64, tuv[i][1] / 64);
    }
    // winding doesn't matter much (no culling for overlays), keep consistent CCW from outside
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  return { pos, uv, nrm, idx };
}

export class SkinPreview {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error("WebGL is not available in this browser.");
    this.gl = gl;
    this.yaw = -0.55; this.pitch = 0.18; this.dist = 74;
    this.model = "classic";
    this.showOverlay = true;
    this.showBase = true;
    this.walk = false; this.t = 0;
    this.pickTarget = "base";
    this.grid = false;
    this.hover = [-1, -1, -1, -1];
    this.hidden = new Set();
    this.target = [0, 16, 0];
    this.focusId = null;
    this._initGL();
    this.setModel("classic");
    this._raf = null;
    this.requestDraw();
  }

  _initGL() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const deriv = gl.getExtension("OES_standard_derivatives");
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, (deriv ? FS_HEAD_DERIV : "") + FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.loc = {};
    for (const n of ["aPos", "aUV", "aNorm"]) this.loc[n] = gl.getAttribLocation(p, n);
    for (const n of ["uProj", "uView", "uModel", "uTex", "uOverlay", "uPick", "uGrid", "uHover"]) this.loc[n] = gl.getUniformLocation(p, n);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(64 * 64 * 4));

    // picking framebuffer, resized with the canvas
    this.fb = gl.createFramebuffer();
    this.fbTex = gl.createTexture();
    this.fbDepth = gl.createRenderbuffer();
    this.fbSize = [0, 0];
  }

  setModel(model) {
    this.model = model;
    const gl = this.gl;
    this.meshes = [];
    for (const p of partsFor(model)) {
      const [w, h, d] = p.size;
      const [px, py, pz] = p.pos;
      for (const layer of ["base", "over"]) {
        const g = layer === "over" ? p.inflate : 0;
        const [u, v] = p[layer];
        const data = boxData(px - g, py - g, pz - g, px + w + g, py + h + g, pz + d + g, u, v, w, h, d);
        const mk = (arr, T = Float32Array, target = gl.ARRAY_BUFFER) => {
          const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, new T(arr), gl.STATIC_DRAW); return b;
        };
        if (this.focusId) this.focus(this.focusId, true);
        this.meshes.push({
          part: p, layer,
          pos: mk(data.pos), uv: mk(data.uv), nrm: mk(data.nrm),
          idx: mk(data.idx, Uint16Array, gl.ELEMENT_ARRAY_BUFFER), count: data.idx.length,
        });
      }
    }
    this.requestDraw();
  }

  setTexture(rgba) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba.buffer, rgba.byteOffset, 64 * 64 * 4));
    this.requestDraw();
  }

  setHover(pts) {
    const h = [-1, -1, -1, -1];
    (pts || []).slice(0, 2).forEach((p, i) => { h[i * 2] = p[0]; h[i * 2 + 1] = p[1]; });
    if (h.join() === this.hover.join()) return;
    this.hover = h; this.requestDraw();
  }
  setGrid(on) { this.grid = on; this.requestDraw(); }
  resetView() { this.view("angle"); this.focus(this.focusId); }
  // Centre the camera on one part (or the whole body with null).
  focus(id, keepDist = false) {
    this.focusId = id;
    const p = id && partsFor(this.model).find((q) => q.id === id);
    this.target = p ? [p.pos[0] + p.size[0] / 2, p.pos[1] + p.size[1] / 2, p.pos[2] + p.size[2] / 2] : [0, 16, 0];
    if (!keepDist) this.dist = p ? (id === "head" ? 30 : 38) : 74;
    this.requestDraw();
  }

  setWalk(on) { this.walk = on; if (!on) this.t = 0; this.requestDraw(); }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame((now) => {
      this._raf = null;
      if (this.walk) { this.t = now / 1000; }
      this.draw();
      if (this.walk) this.requestDraw();
    });
  }

  _resize() {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return [w, h];
  }

  _partMatrix(p) {
    if (!this.walk) return M.ident();
    const s = Math.sin(this.t * 5) * 0.6;
    let pivot, ang;
    if (p.id === "rarm") { pivot = [p.pos[0] + p.size[0], 22, 0]; ang = s; }
    else if (p.id === "larm") { pivot = [p.pos[0], 22, 0]; ang = -s; }
    else if (p.id === "rleg") { pivot = [0, 12, 0]; ang = -s; }
    else if (p.id === "lleg") { pivot = [0, 12, 0]; ang = s; }
    else if (p.id === "head") { return M.mul(M.trans(0, 24, 0), M.mul(M.rotY(Math.sin(this.t * 1.3) * 0.25), M.trans(0, -24, 0))); }
    else return M.ident();
    return M.mul(M.trans(pivot[0], pivot[1], pivot[2]), M.mul(M.rotX(ang), M.trans(-pivot[0], -pivot[1], -pivot[2])));
  }

  _matrices(w, h) {
    const proj = M.persp(0.62, w / h, 1, 400);
    const view = M.mul(M.trans(0, 0, -this.dist), M.mul(M.rotX(this.pitch), M.mul(M.rotY(this.yaw), M.trans(-this.target[0], -this.target[1], -this.target[2]))));
    return { proj, view };
  }

  _drawMeshes(pick) {
    const gl = this.gl, L = this.loc;
    // base first (opaque), overlays after
    for (const pass of ["base", "over"]) {
      for (const m of this.meshes) {
        if (m.layer !== pass) continue;
        if (this.hidden.has(m.part.id)) continue;
        if (pick) { if (m.layer !== this.pickTarget) continue; }
        else {
          if (m.layer === "over" && !this.showOverlay) continue;
          if (m.layer === "base" && !this.showBase) continue;
        }
        gl.uniformMatrix4fv(L.uModel, false, this._partMatrix(m.part));
        gl.uniform1f(L.uOverlay, m.layer === "over" ? 1 : 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.uv); gl.vertexAttribPointer(L.aUV, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm); gl.vertexAttribPointer(L.aNorm, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
      }
    }
  }

  _setup(w, h, pick) {
    const gl = this.gl, L = this.loc;
    gl.useProgram(this.prog);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const { proj, view } = this._matrices(w, h);
    gl.uniformMatrix4fv(L.uProj, false, proj);
    gl.uniformMatrix4fv(L.uView, false, view);
    gl.uniform1f(L.uPick, pick ? 1 : 0);
    gl.uniform1f(L.uGrid, this.grid && !pick ? 1 : 0);
    gl.uniform4fv(L.uHover, pick ? [-1, -1, -1, -1] : this.hover);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(L.uTex, 0);
    gl.enableVertexAttribArray(L.aPos); gl.enableVertexAttribArray(L.aUV); gl.enableVertexAttribArray(L.aNorm);
  }

  draw() {
    const [w, h] = this._resize();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._setup(w, h, false);
    this._drawMeshes(false);
  }

  // Returns [x, y] texel under canvas-relative CSS point, or null.
  pick(cssX, cssY) {
    const gl = this.gl;
    const [w, h] = this._resize();
    if (this.fbSize[0] !== w || this.fbSize[1] !== h) {
      gl.bindTexture(gl.TEXTURE_2D, this.fbTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.fbDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fbDepth);
      this.fbSize = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.disable(gl.BLEND);
    this._setup(w, h, true);
    this._drawMeshes(true);
    const dpr = w / this.canvas.clientWidth;
    const px = Math.floor(cssX * dpr), py = Math.floor(h - 1 - cssY * dpr);
    const out = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.requestDraw();
    if (out[3] === 0) return null;
    return [out[0], out[1]];
  }

  orbit(dx, dy) {
    this.yaw += dx * 0.01;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dy * 0.01));
    this.requestDraw();
  }
  zoom(f) { this.dist = Math.max(26, Math.min(160, this.dist * f)); this.requestDraw(); }
  view(name) {
    const views = { front: [0, 0.1], back: [Math.PI, 0.1], left: [-Math.PI / 2, 0.1], right: [Math.PI / 2, 0.1], top: [0, 1.35], angle: [-0.55, 0.18] };
    [this.yaw, this.pitch] = views[name] || views.angle;
    this.requestDraw();
  }

  // PNG of the current view (for a share thumbnail / "save picture of the model")
  snapshot() { this.draw(); return this.canvas.toDataURL("image/png"); }
}
