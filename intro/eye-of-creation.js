/*!
 * EYE OF CREATION — an infinite, procedural ASCII zoom.
 *   EYE -> (pupil) -> CREATION -> (spark) -> BIG BANG -> GALAXY -> BLACK HOLE -> (horizon) -> EYE ...
 *
 * Веб-версия оригинальной программы eye_of_creation.py из архива eye-of-creation-main
 * (Python + numpy + pygame). Браузер не умеет запускать Python, поэтому код перенесён
 * на JavaScript построчно: те же миры, формулы (SDF, шум, «физика»), тайминги, порталы,
 * поворот камеры, глитч-склейки, звёздное поле, подбор ASCII-глифов по яркости, блум,
 * 5 цветовых режимов, CRT-развёртка, HUD и управление мышью/клавишами.
 * Векторные операции numpy выполняются здесь поэлементно, вывод pygame заменён на WebGL
 * (запасной вариант — Canvas 2D). Названия функций и порядок вычислений совпадают с оригиналом.
 *
 * Original work: MIT License, Copyright (c) 2026 Mohammd Asadi — см. intro/LICENSE
 * (исходник оригинала: intro/original/eye_of_creation.py).
 *
 * На сайте это вступительная заставка: показывается один полный круг
 * (EYE → … → BLACK HOLE → EYE), после чего плавно открывается главная страница.
 * Запуском управляет intro/intro-gate.js (window.EyeIntro).
 *
 * Глаз (мир EYE) по умолчанию перерисован по образцу preview.gif / 1_eye.jpg из архива —
 * карий женский глаз с ресницами, стрелкой, тенями и бровью (Eye.renderBrown). Механика та же,
 * что в оригинале; глаз оригинальной программы — CONFIG.EYE_STYLE = 'original' (Eye.renderOriginal).
 */
(function () {
  'use strict';

  /* ======================================================================
     Настройки заставки
     ====================================================================== */
  const CONFIG = {
    EYE_STYLE: 'brown',   // 'brown' — карий женский глаз (как на preview.gif / 1_eye.jpg из архива);
                          // 'original' — глаз из кода оригинальной программы (бирюзово-янтарный, без ресниц)
    FONT: 10,             // размер глифа в px, как «--font 10» в оригинале (меньше = детальнее, но тяжелее)
    FONT_SMALL: 7,        // на телефонах (меньшая сторона экрана < 520 px) — мельче, чтобы были видны ресницы
    FPS: 60,              // ограничение частоты кадров, как «--fps 60»
    MAX_CELLS: 32000,     // на очень больших экранах глифы чуть крупнее, чтобы анимация оставалась плавной
    MAX_DPR: 2,           // предел плотности пикселей холста
    HUD: false,           // true — сразу показывать HUD, как в оригинальной программе (во время показа: клавиша H)
    BLOOM: true,          // свечение (клавиша B), как в оригинале
    CRT: false,           // CRT-развёртка (клавиша G), как в оригинале
    PALETTE: 0,           // 0 COSMIC, 1 MATRIX, 2 AMBER, 3 INFERNO, 4 PRISM (клавиша C), как в оригинале
    HOLD_AFTER_LOOP: 2.0, // сек: после полного круга глаз ещё немного смотрит, затем заставка гаснет
    FADE_OUT_MS: 1600,    // длительность затухания заставки перед главной страницей
    ADAPTIVE: true,       // на медленных устройствах глифы укрупняются (как клавиша «-» в оригинале)
    MAX_WALL_S: 180       // страховка: заставка не дольше 3 минут показа
  };

  /* ======================================================================
     small math toolbox
     ====================================================================== */
  const TAU = 2.0 * Math.PI;
  const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
  const PALETTES = ['COSMIC', 'MATRIX', 'AMBER', 'INFERNO', 'PRISM'];
  const FONT_STACK = 'Consolas, "DejaVu Sans Mono", Menlo, "Courier New", "Liberation Mono", monospace';

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  function smoothstep(e0, e1, x) {
    let t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3.0 - 2.0 * t);
  }
  const sstep = smoothstep;                                  // scalar version (same formula)
  const pmod = (a, n) => ((a % n) + n) % n;                   // Python/numpy modulo
  const HASH_K = Math.fround(1.0 / 65535.0);

  function _hash(ix, iy) {
    let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    n = (n ^ (n >>> 16)) >>> 0;
    return Math.fround((n & 0xffff) * HASH_K);
  }

  /* 2-D value noise in [0,1]. `period` makes it tile along x (for angles). */
  function vnoise(x, y, period) {
    const fx0 = Math.floor(x), fy0 = Math.floor(y);
    const fx = x - fx0, fy = y - fy0;
    let ix = fx0, ix1 = fx0 + 1;
    const iy = fy0;
    if (period) { ix = pmod(ix, period); ix1 = pmod(ix1, period); }
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = _hash(ix, iy), b = _hash(ix1, iy), c = _hash(ix, iy + 1), d = _hash(ix1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  function fbm(x, y, octaves, period) {
    let total = 0.0, amp = 0.5, norm = 0.0;
    for (let i = 0; i < octaves; i++) {
      total += amp * vnoise(x, y, period);
      norm += amp;
      amp *= 0.5;
      if (period) {            // exact doubling keeps it tileable
        x = x * 2.0;
        y = y * 2.0 + 7.3;
        period *= 2;
      } else {
        x = x * 2.03 + 17.1;
        y = y * 2.03 - 9.2;
      }
    }
    return total / norm;
  }

  /* signed-distance helpers ------------------------------------------------ */
  function capsule(ax, ay, bx, by, ra, rb) {
    const bax = bx - ax, bay = by - ay;
    return { ax: ax, ay: ay, bax: bax, bay: bay, bb: bax * bax + bay * bay, ra: ra, dr: rb - ra };
  }

  /* tapered capsule from (ax,ay) radius ra to (bx,by) radius rb */
  function sdCapsule(C, x, y) {
    const pax = x - C.ax, pay = y - C.ay;
    let h = (pax * C.bax + pay * C.bay) / C.bb;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const qx = pax - C.bax * h, qy = pay - C.bay * h;
    return Math.sqrt(qx * qx + qy * qy) - (C.ra + C.dr * h);
  }

  function smin(a, b, k) {
    let h = 0.5 + 0.5 * (b - a) / k;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    return b + (a - b) * h - k * h * (1.0 - h);
  }

  /* reusable scratch buffers (no allocations per frame) */
  const scratchPool = Object.create(null);
  function scratch(name, n) {
    let b = scratchPool[name];
    if (!b || b.length < n) { b = new Float64Array(Math.max(16, n)); scratchPool[name] = b; }
    return b;
  }

  /* ======================================================================
     WORLDS
     each world:  render(X, Y, n, bw, bh, t, pt, zoom, out, sm, skip)
       X, Y  : world coordinates of every glyph cell (bh rows × bw columns, row-major)
       out   : rgb per cell (3·n), sm : starmask per cell (n)
       skip  : optional per-cell flags — cells whose colour is not used this frame
               (fully hidden by a portal); they are left black instead of computed
       t     : global time      pt : time since this world became active
               (pt < 0 while it is still only visible through a portal)
     portal(t, pt) -> [x, y, r]: where the next world is hiding
     mode : "mask" = next world seen through a hard circular hole
            "fade" = next world fades in over the whole screen
     ====================================================================== */

  /* ── 1. THE EYE ─────────────────────────────────────────────────────── */
  class Eye {
    constructor() {
      this.name = 'EYE'; this.dur = 12.0; this.hold = 5.5; this.mode = 'mask';
      this.roll = 0.45; this.peek = 0.0; this.fade = [0.35, 1.0];
      this.gaze = [0, 0];
      this.blink_t = -99.0;
    }
    dive(pt) { return sstep(this.hold, this.dur, pt); }
    gazeAt(pt) {
      const k = sstep(0.0, 1.6, pt) * (1.0 - this.dive(pt));
      return [this.gaze[0] * 0.30 * k, this.gaze[1] * 0.17 * k];
    }
    pupil(t, pt) {
      const base = CONFIG.EYE_STYLE === 'original' ? 0.115 : FEM.PUPIL;
      return base * (1.0 + 0.07 * Math.sin(t * 0.8)) * (1.0 + 0.55 * this.dive(pt));
    }
    openness(t, pt) {
      const arrive = sstep(-1.5, 0.25, pt);
      if (this.dive(pt) > 0.0) return arrive;
      const ph = pmod(t, 5.3);
      const za = (ph - 5.0) / 0.08, zc = (t - this.blink_t - 0.12) / 0.08;
      const auto = 1.0 - Math.exp(-(za * za));
      const click = 1.0 - Math.exp(-(zc * zc));
      return arrive * Math.min(auto, click);
    }
    /* framing (like S of CREATION): the brown eye is shown a little bigger on tall screens */
    frameS() { return CONFIG.EYE_STYLE === 'original' ? 1.0 : (this.S || 1.0); }
    portal(t, pt) {
      const g = this.gazeAt(pt), S = this.frameS();
      return [g[0] * S, g[1] * S, this.pupil(t, pt) * S];
    }

    render(X, Y, n, bw, bh, t, pt, zoom, out, sm, skip) {
      if (CONFIG.EYE_STYLE === 'original') { this.renderOriginal(X, Y, n, bw, bh, t, pt, zoom, out, sm, skip); return; }
      const S = this.frameS();
      if (S !== 1.0) {
        const XS = scratch('eyeX', n), YS = scratch('eyeY', n);
        for (let i = 0; i < n; i++) { XS[i] = X[i] / S; YS[i] = Y[i] / S; }
        X = XS; Y = YS; zoom *= S;
      }
      this.renderBrown(X, Y, n, bw, bh, t, pt, zoom, out, sm, skip);
    }

    /* the eye exactly as eye_of_creation.py draws it */
    renderOriginal(X, Y, n, bw, bh, t, pt, zoom, out, sm, skip) {
      const g = this.gazeAt(pt), gx = g[0], gy = g[1];
      const op = this.openness(t, pt), opl = Math.min(1.0, op * 1.25);
      const Ri = 0.40, Rp = this.pupil(t, pt);
      const iris0 = Ri + 0.012, iris1 = Ri - 0.012, pup0 = Rp + 0.006, pup1 = Rp - 0.006;
      const tdrift = t * 0.03;
      for (let i = 0; i < n; i++) {
        if (skip && skip[i]) { out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = 0; sm[i] = 0; continue; }
        const x = X[i], y = Y[i];
        // ── eyelids (almond) ──
        let xn = x / 1.32;
        xn = xn < -1.6 ? -1.6 : xn > 1.6 ? 1.6 : xn;
        let lid = 1.0 - xn * xn;
        if (lid < 0) lid = 0;
        const closed = -0.06 * lid - 0.02;
        const upper = closed + (0.66 * Math.pow(lid, 0.7) + 0.04 * xn - closed) * op;
        const lower = closed + (-0.46 * Math.pow(lid, 0.85) + 0.02 * xn - closed) * opl;
        const du = upper - y, dl = y - lower;
        const inside = lid > 0 ? smoothstep(0.0, 0.022, du) * smoothstep(0.0, 0.022, dl) : 0.0;

        // ── skin ──
        const sk = fbm(x * 2.2, y * 2.2 + 4.0, 3, 0);
        const cz = (y - (0.66 * Math.pow(lid, 0.55) + 0.17)) / 0.035;
        const crease = Math.exp(-(cz * cz)) * lid;
        const adu = du < 0 ? -du : du, adl = dl < 0 ? -dl : dl;
        const near = smoothstep(0.0, 0.13, adu < adl ? adu : adl);
        const fall = Math.exp(-(x * x / 5.0 + y * y / 1.5));
        const sv = (0.42 + 0.75 * sk) * (0.22 + 0.78 * near) * (1.0 - 0.7 * crease) * fall;
        const rz = (dl + 0.014) / 0.012;
        const rim = Math.exp(-(rz * rz)) * lid * op * 0.8;      // wet lower rim
        let o0 = sv * 0.62 + rim * 0.9;
        let o1 = sv * 0.36 + rim * 0.42;
        let o2 = sv * 0.26 + rim * 0.42;

        if (inside > 0) {
          // ── sclera ──
          const dx = x - gx, dy = y - gy;
          const r = Math.sqrt(dx * dx + dy * dy) + 1e-6;
          const edge = du < dl ? du : dl;
          const ao = 0.22 + 0.78 * smoothstep(0.0, 0.24, edge);
          const axn = xn < 0 ? -xn : xn;
          const corner = 1.0 - 0.5 * smoothstep(0.5, 1.0, axn);
          const v = fbm(x * 3.3 + 3.1, y * 3.3 - 1.7, 3, 0);
          const av = v > 0.5 ? v - 0.5 : 0.5 - v;
          const veins = (1.0 - smoothstep(0.0, 0.03, av)) * smoothstep(0.48, 1.0, r);
          const aoc = ao * corner, vm = veins * 0.75;
          let b0 = aoc * 0.93, b1 = aoc * 0.88, b2 = aoc * 0.84;
          b0 += (ao * 0.8 - b0) * vm; b1 += (ao * 0.12 - b1) * vm; b2 += (ao * 0.10 - b2) * vm;
          const kx = x + 1.13, ky = y + 0.01;
          let car = Math.exp(-(kx * kx / 0.006 + ky * ky / 0.004));          // caruncle
          car = (car > 1 ? 1 : car) * 0.8;
          b0 += (0.85 - b0) * car; b1 += (0.35 - b1) * car; b2 += (0.38 - b2) * car;

          // ── iris ──
          const im = smoothstep(iris0, iris1, r);
          if (im > 0) {
            let tt = (r - Rp) / (Ri - Rp);
            tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
            const a = Math.atan2(dy, dx);
            const u = (a / TAU + 0.5) * 48.0;
            const f = fbm(u, r * 7.0 - tdrift, 3, 48);
            const f2 = fbm(u * 0.25, r * 3.0 + 5.0, 2, 12);
            let fib = 0.22 + 1.15 * Math.pow(f, 1.6) + 0.35 * (f2 - 0.5);
            fib = fib < 0 ? 0 : fib > 2 ? 2 : fib;
            const icm = smoothstep(0.18, 0.85, tt + 0.15 * (f2 - 0.5));
            const ic0 = 1.0 + (0.10 - 1.0) * icm, ic1 = 0.60 + (0.52 - 0.60) * icm, ic2 = 0.16 + (0.48 - 0.16) * icm;
            const cc = (tt - 0.27) / 0.07;
            const coll = 0.55 * Math.exp(-(cc * cc));                         // collarette
            const limbus = 1.0 - 0.88 * smoothstep(0.78, 1.0, tt);
            const pring = smoothstep(0.0, 0.07, tt);
            const shade = 0.42 + 0.58 * smoothstep(0.0, 0.22, du);           // lid shadow
            const iv = (fib + coll * f) * limbus * pring * shade;
            b0 += (iv * ic0 - b0) * im; b1 += (iv * ic1 - b1) * im; b2 += (iv * ic2 - b2) * im;
          }
          const npm = 1.0 - smoothstep(pup0, pup1, r);
          const sx1 = dx + 0.14, sy1 = dy - 0.14, sx2 = dx - 0.10, sy2 = dy + 0.10;
          const spec = (Math.exp(-(sx1 * sx1 + sy1 * sy1) / 0.0018) * 1.9 +
                        Math.exp(-(sx2 * sx2 + sy2 * sy2) / 0.0005) * 0.9) * npm;
          b0 = b0 * npm + spec; b1 = b1 * npm + spec; b2 = b2 * npm + spec;

          o0 += (b0 - o0) * inside; o1 += (b1 - o1) * inside; o2 += (b2 - o2) * inside;
        }
        const j = 3 * i;
        out[j] = o0; out[j + 1] = o1; out[j + 2] = o2;
        sm[i] = 0.0;
      }
    }

    /* ── the brown, feminine eye (as on preview.gif / 1_eye.jpg of the archive) ──
       Same mechanics as the original: it opens at the start, blinks (by itself and on click),
       follows the mouse, and its pupil is the portal of the infinite zoom.
       New look: almond shape with a lifted outer corner, brown iris, curled upper lashes that
       fan out towards the outer corner, lower lashes, winged eyeliner, golden-bronze eyeshadow,
       lid crease, brow. Everything is still procedural, so it stays sharp at any zoom. */
    renderBrown(X, Y, n, bw, bh, t, pt, zoom, out, sm, skip) {
      const g = this.gazeAt(pt), gx = g[0], gy = g[1];
      const op = this.openness(t, pt), opl = Math.min(1.0, op * 1.25);
      const W = FEM.W, Ri = FEM.RI, Rp = this.pupil(t, pt);
      const iris0 = Ri + 0.012, iris1 = Ri - 0.012, pup0 = Rp + 0.006, pup1 = Rp - 0.006;
      const tdrift = t * 0.03, ks = Ri / 0.40;
      // anti-aliasing width ≈ half a glyph cell in world units (works under zoom and camera roll)
      let aa = 0.012;
      if (bw > 1 && n > bw) {
        const ax = X[1] - X[0], ay = Y[1] - Y[0], bx = X[bw] - X[0], by = Y[bw] - Y[0];
        aa = 0.5 * Math.max(Math.sqrt(ax * ax + ay * ay), Math.sqrt(bx * bx + by * by));
      }
      this._buildLashes(op, opl);
      const NL = this.lashN, PX = this.lashPX, PY = this.lashPY, PR = this.lashR, BB = this.lashBox, ALL = this.lashAll;
      const WG = this.wing;
      const inkOut = this.inkOut || null;      // cells under lashes / liner / brow (they get no bloom)
      const carX = -0.88 * W, carY = FEM.TILT * -0.88 + FEM.Y0 - 0.035;
      for (let i = 0; i < n; i++) {
        if (skip && skip[i]) { out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = 0; sm[i] = 0; continue; }
        const x = X[i], y = Y[i];
        let u = x / W;
        u = u < -1.6 ? -1.6 : u > 1.6 ? 1.6 : u;
        let lid = 1.0 - u * u;
        if (lid < 0) lid = 0;
        const au = u < 0 ? -u : u;
        // ── eyelids: almond, outer corner (right) lifted ──
        femShape(u, lid);
        const uo = FS.uo, lo = FS.lo, cl = FS.cl;
        const upper = cl + (uo - cl) * op;
        const lower = cl + (lo - cl) * opl;
        const du = upper - y, dl = y - lower;
        const inside = lid > 0 ? smoothstep(0.0, 0.022, du) * smoothstep(0.0, 0.022, dl) : 0.0;

        // ── skin: warm medium brown, lighter around the eye (dark lashes must stand out on it) ──
        const sk = fbm(x * 2.2, y * 2.2 + 4.0, 3, 0);
        const adu = du < 0 ? -du : du, adl = dl < 0 ? -dl : dl;
        const near = smoothstep(0.0, 0.10, adu < adl ? adu : adl);
        const fall = Math.exp(-(x * x / 4.5 + y * y / 1.9));
        const sv = (0.70 + 0.35 * sk) * (0.62 + 0.38 * near) * fall * 0.60;
        let o0 = sv * 0.70, o1 = sv * 0.38, o2 = sv * 0.26;
        // soft light on the lid / brow bone above the eye and under it: the dark lashes sweep over it
        const lx = (x - 0.15) / 1.35, ly = (y - 0.36) / 0.42, mx2 = x / 1.2, my2 = (y + 0.50) / 0.25;
        const pl = (0.17 * Math.exp(-(lx * lx + ly * ly)) + 0.08 * Math.exp(-(mx2 * mx2 + my2 * my2))) * fall;
        o0 += pl * 1.0; o1 += pl * 0.70; o2 += pl * 0.50;
        const rz = (dl + 0.016) / 0.011;
        const rim = Math.exp(-(rz * rz)) * lid * op * 0.6;                      // wet lower rim
        o0 += rim * 0.9; o1 += rim * 0.48; o2 += rim * 0.42;

        // ── eyeshadow on the mobile lid (lash line → crease): golden, smoky bronze at the outer corner ──
        const crease = uo + 0.10 + 0.06 * lid - 0.05 * (1.0 - op);
        if (y > upper - 0.02 && au < 1.35) {
          const zl = (y - upper) / Math.max(crease - upper, 0.02);
          const a = smoothstep(1.35, 0.9, zl) * smoothstep(1.35, 0.95, au) * smoothstep(-0.02, 0.01, y - upper);
          if (a > 0) {
            const zz = (zl - 0.45) / 0.36, uu = (u + 0.08) / 0.65;
            const shine = Math.exp(-(zz * zz) - uu * uu);
            const lum = (0.30 + 0.92 * shine) * fall * (0.9 + 0.2 * sk);
            const smoke = smoothstep(0.2, 1.1, u) * 0.75;
            const e0 = (1.00 + (0.46 - 1.00) * smoke) * lum;                // peach-copper → smoky bronze
            const e1 = (0.58 + (0.22 - 0.58) * smoke) * lum;
            const e2 = (0.38 + (0.12 - 0.38) * smoke) * lum;
            o0 += (e0 - o0) * a; o1 += (e1 - o1) * a; o2 += (e2 - o2) * a;
          }
        }
        const cz = (y - crease) / 0.026;
        const crs = 1.0 - Math.exp(-(cz * cz)) * lid * 0.45;                     // lid crease
        o0 *= crs; o1 *= crs; o2 *= crs;

        // ── brow: an arch above the eye, light on the brow bone below it ──
        let dark = 0;
        const sb = (x + 1.35) / 2.85;
        if (sb > -0.08 && sb < 1.08) {
          const sc = sb < 0 ? 0 : sb > 1 ? 1 : sb;
          const yb = 0.64 + 0.22 * Math.sin(Math.PI * Math.pow(sc, 1.3)) - 0.04 * sc;
          const hz = (y - (yb - 0.15)) / 0.11;
          const hl = Math.exp(-(hz * hz)) * 0.32 * smoothstep(-0.05, 0.25, sc) * smoothstep(1.05, 0.7, sc) * fall;
          o0 += hl * 1.0; o1 += hl * 0.74; o2 += hl * 0.55;
          const th = 0.075 * Math.pow(1.0 - sc, 0.5) + 0.025;
          const db = y > yb ? y - yb : yb - y;
          let cov = smoothstep(th + aa, th - aa, db) * smoothstep(-0.08, 0.06, sb) * smoothstep(1.08, 0.92, sb);
          if (cov > 0) {
            const ang = 1.2 - 0.95 * sc;                     // hairs point up at the head, along the brow at the tail
            const hair = 0.5 + 0.5 * Math.sin(150.0 * (y * Math.cos(ang) - x * Math.sin(ang)) + 6.0 * vnoise(x * 16.0, y * 16.0, 0));
            cov *= 0.80 + 0.20 * hair;
            const kb = cov * 0.92;
            o0 += (0.10 - o0) * kb; o1 += (0.06 - o1) * kb; o2 += (0.04 - o2) * kb;
            dark = kb * 0.8;
          }
        }

        // ── eyeball: sclera, brown iris, pupil (the portal), highlights ──
        if (inside > 0) {
          const dx = x - gx, dy = y - gy;
          const r = Math.sqrt(dx * dx + dy * dy) + 1e-6;
          const edge = du < dl ? du : dl;
          const ao = 0.22 + 0.78 * smoothstep(0.0, 0.20, edge);
          const corner = 1.0 - 0.5 * smoothstep(0.5, 1.0, au);
          const v = fbm(x * 3.3 + 3.1, y * 3.3 - 1.7, 3, 0);
          const av = v > 0.5 ? v - 0.5 : 0.5 - v;
          const vm = (1.0 - smoothstep(0.0, 0.03, av)) * smoothstep(0.55, 1.0, r) * 0.18;   // only a hint of veins
          const aoc = ao * corner;
          let b0 = aoc * 0.72, b1 = aoc * 0.68, b2 = aoc * 0.66;                 // soft greyish white, as on the sample
          b0 += (ao * 0.8 - b0) * vm; b1 += (ao * 0.12 - b1) * vm; b2 += (ao * 0.10 - b2) * vm;
          const kx = x - carX, ky = y - carY;
          let car = Math.exp(-(kx * kx / 0.005 + ky * ky / 0.0035));             // caruncle (inner corner)
          car = (car > 1 ? 1 : car) * 0.8;
          b0 += (0.85 - b0) * car; b1 += (0.40 - b1) * car; b2 += (0.40 - b2) * car;
          const im = smoothstep(iris0, iris1, r);
          if (im > 0) {
            let tt = (r - Rp) / (Ri - Rp);
            tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
            const a = Math.atan2(dy, dx);
            const uu = (a / TAU + 0.5) * 48.0;
            const f = fbm(uu, r * 7.0 - tdrift, 3, 48);
            const f2 = fbm(uu * 0.25, r * 3.0 + 5.0, 2, 12);
            let fib = 0.22 + 1.15 * Math.pow(f, 1.6) + 0.35 * (f2 - 0.5);
            fib = fib < 0 ? 0 : fib > 2 ? 2 : fib;
            // brown: golden amber around the pupil → warm chestnut → dark limbal ring
            const icm = smoothstep(0.10, 0.80, tt + 0.15 * (f2 - 0.5));
            const ic0 = 0.92 + (0.42 - 0.92) * icm, ic1 = 0.55 + (0.22 - 0.55) * icm, ic2 = 0.27 + (0.10 - 0.27) * icm;
            const cc = (tt - 0.27) / 0.07;
            const coll = 0.55 * Math.exp(-(cc * cc));
            const limbus = 1.0 - 0.9 * smoothstep(0.74, 1.0, tt);
            const pring = smoothstep(0.0, 0.07, tt);
            const shade = 0.35 + 0.65 * smoothstep(0.0, 0.20, du);           // shadow of the lid and lashes
            const iv = (fib + coll * f) * limbus * pring * shade * 0.75;
            b0 += (iv * ic0 - b0) * im; b1 += (iv * ic1 - b1) * im; b2 += (iv * ic2 - b2) * im;
          }
          const npm = 1.0 - smoothstep(pup0, pup1, r);
          const sx1 = dx + 0.14 * ks, sy1 = dy - 0.14 * ks, sx2 = dx - 0.10 * ks, sy2 = dy + 0.10 * ks;
          const spec = (Math.exp(-(sx1 * sx1 + sy1 * sy1) / 0.0022) * 1.9 +
                        Math.exp(-(sx2 * sx2 + sy2 * sy2) / 0.0006) * 0.9) * npm;
          b0 = b0 * npm + spec; b1 = b1 * npm + spec; b2 = b2 * npm + spec;
          o0 += (b0 - o0) * inside; o1 += (b1 - o1) * inside; o2 += (b2 - o2) * inside;
        }

        // ── eyeliner (with a wing) and lashes, on top of everything ──
        let ink = 0;
        if (lid > 0) {
          const dU = y - upper;
          const w = 0.020 + 0.045 * smoothstep(-0.3, 1.0, u);
          ink = smoothstep(-0.012, 0.0, dU) * smoothstep(w + aa, w - aa, dU);
        }
        if (x > WG[0] - 0.05 && x < WG[2] + 0.05) {
          const dw = sdTaper(x, y, WG[0], WG[1], WG[2], WG[3], WG[4], WG[5]);
          const cw = smoothstep(aa, -aa, dw);
          if (cw > ink) ink = cw;
        }
        if (x >= ALL[0] && x <= ALL[1] && y >= ALL[2] && y <= ALL[3]) {
          let dmin = 1e9;
          for (let k = 0; k < NL; k++) {
            const b = 4 * k;
            if (x < BB[b] || x > BB[b + 1] || y < BB[b + 2] || y > BB[b + 3]) continue;
            for (let s = 0; s < 3; s++) {
              const p = b + s;
              const d = sdTaper(x, y, PX[p], PY[p], PX[p + 1], PY[p + 1], PR[p], PR[p + 1]);
              if (d < dmin) dmin = d;
            }
          }
          const cl2 = smoothstep(aa, -aa, dmin);
          if (cl2 > ink) ink = cl2;
        }
        if (ink > 0) {
          const k = ink * 0.96;
          o0 += (0.03 - o0) * k; o1 += (0.02 - o1) * k; o2 += (0.015 - o2) * k;
        }
        if (inkOut) inkOut[i] = ink > dark ? ink : dark;
        const j = 3 * i;
        out[j] = o0; out[j + 1] = o1; out[j + 2] = o2;
        sm[i] = 0.0;
      }
    }

    /* the closed (or blinking) lids cover the pupil — the next world is not seen through them */
    portalCover(X, Y, M, n, t, pt) {
      if (CONFIG.EYE_STYLE === 'original') return;
      if (this.dive(pt) > 0) return;                       // diving: the eye is wide open, as in the original
      const op = this.openness(t, pt), opl = Math.min(1.0, op * 1.25), S = this.frameS();
      for (let i = 0; i < n; i++) {
        if (M[i] === 0) continue;
        let u = X[i] / S / FEM.W;
        u = u < -1.6 ? -1.6 : u > 1.6 ? 1.6 : u;
        let lid = 1.0 - u * u;
        if (lid <= 0) { M[i] = 0; continue; }
        femShape(u, lid);
        const y = Y[i] / S, cl = FS.cl;
        M[i] *= smoothstep(0.0, 0.022, cl + (FS.uo - cl) * op - y) * smoothstep(0.0, 0.022, y - (cl + (FS.lo - cl) * opl));
      }
    }

    /* (brown eye) the pupil looks black; the world inside it lights up while the camera dives in */
    portalGain(t, pt) {
      if (CONFIG.EYE_STYLE === 'original') return 1.0;
      return 0.22 + 0.78 * smoothstep(0.0, 0.5, this.dive(pt));
    }

    /* lashes for this frame: each one a curled stroke of 3 tapered segments; roots move with the lids,
       and when the eye closes the upper lashes swing down */
    _buildLashes(op, opl) {
      if (!this.lashPX) {
        const m = 4 * 64;
        this.lashPX = new Float64Array(m); this.lashPY = new Float64Array(m);
        this.lashR = new Float64Array(m); this.lashBox = new Float64Array(m);
        this.lashAll = new Float64Array(4); this.wing = new Float64Array(6);
      }
      const W = FEM.W, deg = Math.PI / 180;
      const PX = this.lashPX, PY = this.lashPY, PR = this.lashR, BB = this.lashBox, ALL = this.lashAll;
      let k = 0;
      ALL[0] = Infinity; ALL[1] = -Infinity; ALL[2] = Infinity; ALL[3] = -Infinity;
      const add = (x0, y0, len, ang, curl, r0, r1) => {
        const b = 4 * k;
        let px = x0, py = y0;
        PX[b] = px; PY[b] = py; PR[b] = r0;
        let minx = px, maxx = px, miny = py, maxy = py;
        for (let s = 0; s < 3; s++) {
          const a = ang + curl * (s + 0.5) / 3;
          px += Math.cos(a) * len / 3; py += Math.sin(a) * len / 3;
          PX[b + s + 1] = px; PY[b + s + 1] = py; PR[b + s + 1] = r0 + (r1 - r0) * (s + 1) / 3;
          if (px < minx) minx = px; if (px > maxx) maxx = px;
          if (py < miny) miny = py; if (py > maxy) maxy = py;
        }
        const pad = r0 + 0.03;
        BB[b] = minx - pad; BB[b + 1] = maxx + pad; BB[b + 2] = miny - pad; BB[b + 3] = maxy + pad;
        if (BB[b] < ALL[0]) ALL[0] = BB[b];
        if (BB[b + 1] > ALL[1]) ALL[1] = BB[b + 1];
        if (BB[b + 2] < ALL[2]) ALL[2] = BB[b + 2];
        if (BB[b + 3] > ALL[3]) ALL[3] = BB[b + 3];
        k++;
      };
      // upper lashes: short at the inner corner, long and swept outwards at the outer corner (as on preview.gif)
      const NU = FEM.UPPER_N;
      for (let i = 0; i < NU; i++) {
        const q = i / (NU - 1);
        const h1 = _hash(i, 101), h2 = _hash(i, 202), h3 = _hash(i, 303);
        const u = -0.85 + 1.92 * q + (h1 - 0.5) * 0.03;
        const x0 = u * W;
        const y0 = u <= 1.0 ? femUpper(u, op) : femUpper(1.0, op) + (u - 1.0) * W * 0.42;   // past the corner: along the wing
        let len = (0.13 + 0.40 * smoothstep(-0.7, 1.0, u)) * (0.82 + 0.33 * h2);
        const aOpen = (98 - 62 * smoothstep(-0.4, 1.05, u) + 14 * (1 - smoothstep(-1.0, -0.2, u)) + (h3 - 0.5) * 10) * deg;
        const aShut = (-100 + 40 * smoothstep(0.0, 1.0, u)) * deg;
        // curled: the middle and outer lashes sweep towards the outer corner, their tips droop a little
        const curl = (-15 - 40 * smoothstep(-0.3, 1.0, u) + 25 * (1 - smoothstep(-1.0, -0.35, u))) * deg;
        len *= 0.62 + 0.38 * Math.abs(2 * op - 1);          // foreshortened while the lid turns
        add(x0, y0, len, aShut + (aOpen - aShut) * op, curl * (2 * op - 1), 0.030 * (0.9 + 0.2 * h1), 0.006);
      }
      // lower lashes: shorter, pointing down, longer and swept outwards towards the outer corner
      const NLo = FEM.LOWER_N;
      for (let i = 0; i < NLo; i++) {
        const q = i / (NLo - 1);
        const h1 = _hash(i, 404), h2 = _hash(i, 505), h3 = _hash(i, 606);
        const u = -0.35 + 1.33 * Math.pow(q, 0.8) + (h1 - 0.5) * 0.04;
        const len = (0.09 + 0.24 * smoothstep(-0.3, 1.0, u)) * (0.75 + 0.45 * h2);
        const ang = (-102 + 58 * smoothstep(-0.3, 1.05, u) + (h3 - 0.5) * 22) * deg;
        add(u * W, femLower(u, opl) - 0.03, len, ang, (16 + 14 * h1) * deg, 0.017, 0.004);
      }
      this.lashN = k;
      // eyeliner wing: from the outer corner of the open eye, up and out (it stays when the eye blinks)
      const WG = this.wing;
      WG[0] = 0.92 * W; WG[1] = femUpper(0.92, 1.0) + 0.006;
      WG[2] = 1.32 * W; WG[3] = FEM.TILT + FEM.Y0 + 0.17;
      WG[4] = 0.032; WG[5] = 0.005;
    }
  }

  /* geometry of the brown eye, measured on preview.gif (world units: the screen is 2 high) */
  const FEM = {
    W: 1.0,             // half-width of the eye opening
    TILT: 0.068,        // the outer corner (right) sits higher than the inner one (left)
    Y0: -0.09,          // the lids sit a little below the iris centre: the upper lid covers the top of the iris
    UP: 0.44, LO: 0.29, // open lid heights (from the corner line)
    RI: 0.43,           // iris radius
    PUPIL: 0.15,        // pupil radius (the pupil is the portal of the zoom)
    UPPER_N: 34, LOWER_N: 13
  };
  /* lid curves at u = x / W (lid = 1 - u², 0 outside the eye): open upper lid (uo), open lower lid (lo),
     the line where the closed lids meet (cl). Upper arch peaks towards the inner side, outer corner lifted. */
  const FS = { uo: 0, lo: 0, cl: 0 };
  function femShape(u, lid) {                           // fitted to the lid lines of preview.gif
    const yc = FEM.TILT * u + FEM.Y0;
    FS.uo = yc + FEM.UP * Math.pow(lid, 0.75 - 0.25 * u) * (1.0 + 0.05 * u);   // pointed inner corner, full outer part
    FS.lo = yc - FEM.LO * Math.pow(lid, 0.80) * (1.0 + 0.15 * u);
    FS.cl = yc - 0.07 * lid - 0.03;
  }
  function femUpper(u, op) {
    const uc = u < -1 ? -1 : u > 1 ? 1 : u;
    let lid = 1.0 - uc * uc;
    if (lid < 0) lid = 0;
    femShape(uc, lid);
    return FS.cl + (FS.uo - FS.cl) * op;
  }
  function femLower(u, opl) {
    const uc = u < -1 ? -1 : u > 1 ? 1 : u;
    let lid = 1.0 - uc * uc;
    if (lid < 0) lid = 0;
    femShape(uc, lid);
    return FS.cl + (FS.lo - FS.cl) * opl;
  }
  function sdTaper(px, py, ax, ay, bx, by, ra, rb) {      // tapered capsule (like sd_capsule of the original)
    const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
    let h = (pax * bax + pay * bay) / (bax * bax + bay * bay);
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const qx = pax - bax * h, qy = pay - bay * h;
    return Math.sqrt(qx * qx + qy * qy) - (ra + (rb - ra) * h);
  }

  /* ── 2. CREATION (Michelangelo, 1512 — two hands, one spark) ─────────── */
  function makeHand(palm, fingers) {
    return {
      palm: palm.map((p) => capsule(p[0], p[1], p[2], p[3], p[4], p[5])),
      fingers: fingers.map((f) => {
        const pts = f[0], rad = f[1];
        return [capsule(pts[0][0], pts[0][1], pts[1][0], pts[1][1], rad[0], rad[1]),
                capsule(pts[1][0], pts[1][1], pts[2][0], pts[2][1], rad[1], rad[2])];
      })
    };
  }
  const ADAM = makeHand(
    [[-2.9, -0.55, -1.12, -0.20, 0.19, 0.135],            // forearm
     [-1.12, -0.20, -0.66, -0.10, 0.135, 0.12],           // hand
     [-1.00, -0.24, -0.70, -0.17, 0.11, 0.09]],
    [[[[-0.64, -0.05], [-0.36, -0.005], [-0.07, 0.0]], [0.052, 0.045, 0.036]],   // index
     [[[-0.65, -0.11], [-0.43, -0.16], [-0.29, -0.25]], [0.050, 0.044, 0.036]],  // middle
     [[[-0.69, -0.15], [-0.51, -0.23], [-0.41, -0.32]], [0.046, 0.041, 0.034]],  // ring
     [[[-0.73, -0.19], [-0.61, -0.27], [-0.55, -0.34]], [0.040, 0.036, 0.030]],  // pinky
     [[[-0.90, -0.06], [-0.66, 0.06], [-0.47, 0.075]], [0.060, 0.048, 0.038]]]); // thumb
  const GOD = makeHand(
    [[2.9, 0.62, 1.15, 0.22, 0.21, 0.145],                // forearm
     [1.15, 0.22, 0.68, 0.09, 0.145, 0.12],
     [1.02, 0.25, 0.72, 0.16, 0.11, 0.09]],
    [[[[0.66, 0.06], [0.37, 0.03], [0.07, 0.02]], [0.054, 0.046, 0.037]],        // index — pointing
     [[[0.67, 0.13], [0.45, 0.17], [0.34, 0.09]], [0.050, 0.044, 0.038]],        // curled
     [[[0.71, 0.18], [0.53, 0.22], [0.45, 0.14]], [0.047, 0.041, 0.035]],
     [[[0.76, 0.22], [0.62, 0.26], [0.56, 0.19]], [0.041, 0.037, 0.031]],
     [[[0.88, 0.04], [0.66, -0.05], [0.50, -0.065]], [0.060, 0.048, 0.039]]]);   // thumb

  /* hand SDF: palm + 5 fingers (each a chain of 2 tapered capsules), smoothly welded.
     Also returns the sum of squares of the two closest parts (for the creases). */
  const HAND = { d: 0, q: 0 };
  function handSDF(H, x, y) {
    let d = sdCapsule(H.palm[0], x, y);
    d = smin(d, sdCapsule(H.palm[1], x, y), 0.06);
    d = smin(d, sdCapsule(H.palm[2], x, y), 0.05);
    let m1 = d, m2 = Infinity;
    for (let k = 0; k < 5; k++) {
      const F = H.fingers[k];
      const f = smin(sdCapsule(F[0], x, y), sdCapsule(F[1], x, y), 0.012);
      if (f < m1) { m2 = m1; m1 = f; } else if (f < m2) { m2 = f; }
      d = smin(d, f, 0.03);
    }
    HAND.d = d;
    HAND.q = m1 * m1 + m2 * m2;
  }

  function heightOf(dist) {
    let q = -dist / 0.075;
    q = q < 0 ? 0 : q > 1 ? 1 : q;
    const k = 1.0 - q;
    return 0.075 * Math.sqrt(1.0 - k * k);
  }

  /* shade_hand(): SDF → height field → normals → light (np.gradient on the cell grid) */
  const SH = new Float64Array(4);
  function shadeHand(h, i, r, c, bw, bh, dist, q, pores, G, b0, b1, b2) {
    let hr, hc;
    if (r === 0) hr = h[i + bw] - h[i];
    else if (r === bh - 1) hr = h[i] - h[i - bw];
    else hr = (h[i + bw] - h[i - bw]) * 0.5;
    if (c === 0) hc = h[i + 1] - h[i];
    else if (c === bw - 1) hc = h[i] - h[i - 1];
    else hc = (h[i + 1] - h[i - 1]) * 0.5;
    // solve [rv; cv] · (gx, gy) = (hr, hc) for the world-space gradient
    let gx = (hr * G.cvy - hc * G.rvy) / G.det;
    gx = gx < -4 ? -4 : gx > 4 ? 4 : gx;
    let gy = (hc * G.rvx - hr * G.cvx) / G.det;
    gy = gy < -4 ? -4 : gy > 4 ? 4 : gy;
    const nz = 1.0 / Math.sqrt(1.0 + gx * gx + gy * gy);
    const nx = -gx * nz, ny = -gy * nz;
    const diff = clamp01(nx * G.L0 + ny * G.L1 + nz * G.L2);
    const fill = clamp01(nx * 0.35 - ny * 0.65 + nz * 0.4) * 0.35;             // warm bounce
    const s1 = clamp01(nx * -0.3 + ny * 0.55 + nz * 0.78), s2 = s1 * s1, s4 = s2 * s2, s8 = s4 * s4;
    const spec = s8 * s8 * s8 * 0.6;                                          // ** 24
    // creases: where two parts (finger/finger, finger/palm) meet at their surfaces
    const crease = Math.exp(-q / G.cw2) * smoothstep(0.0, -G.cw, dist);
    const light = (0.12 + 1.25 * Math.pow(diff, 1.4) + fill) * pores * (1.0 - 0.7 * crease);
    const sp = spec * (1.0 - crease);
    SH[0] = light * b0 + sp * 1.0;
    SH[1] = light * b1 + sp * 0.95;
    SH[2] = light * b2 + sp * 0.85;
    SH[3] = diff;
  }

  class Creation {
    constructor() {
      this.name = 'CREATION'; this.dur = 13.0; this.hold = 7.0; this.mode = 'fade';
      this.roll = -0.25; this.peek = 0.0; this.fade = [0.72, 1.0];
      this.hand = [0, 0];      // mouse steering for God's hand
      this.S = 1.5;            // framing: how close the camera sits to the hands
      this.G = { rvx: 0, rvy: 0, cvx: 0, cvy: 0, det: 1, cw: 0, cw2: 0, L0: 0, L1: 0, L2: 0 };
    }
    dive(pt) { return sstep(this.hold, this.dur, pt); }
    /* returns [God dx, dy, Adam dx, dy] */
    offsets(t, pt) {
      const d = this.dive(pt);
      const approach = 0.34 * (1.0 - sstep(-1.0, 6.0, pt));
      const live = 1.0 - d;
      const gdx = approach + this.hand[0] * 0.10 * live + 0.006 * Math.sin(t * 1.3) * live;
      const gdy = this.hand[1] * 0.08 * live + 0.008 * Math.sin(t * 0.9) * live;
      const ady = 0.010 * Math.sin(t * 0.7 + 1.0) * live + 0.02 * (sstep(3.0, 6.5, pt) - 1.0) * live;
      return [gdx, gdy, 0.0, ady];
    }
    tips(t, pt) {
      const o = this.offsets(t, pt);
      return [0.07 + o[0], 0.02 + o[1], -0.07 + o[2], 0.0 + o[3]];
    }
    portal(t, pt) {
      const p = this.tips(t, pt);
      return [(p[0] + p[2]) * 0.5 * this.S, (p[1] + p[3]) * 0.5 * this.S, 0.03 * this.S];
    }

    render(X0, Y0, n, bw, bh, t, pt, zoom0, out, sm, skip) {
      const S = this.S, zoom = zoom0 * S;
      const X = scratch('crX', n), Y = scratch('crY', n);
      for (let i = 0; i < n; i++) { X[i] = X0[i] / S; Y[i] = Y0[i] / S; }
      const s = this.dive(pt);
      const o = this.offsets(t, pt), gdx = o[0], gdy = o[1], adx = o[2], ady = o[3];
      // world-space step of one grid row / one grid column (works under roll + zoom)
      const G = this.G;
      G.rvx = X[bw] - X[0]; G.rvy = Y[bw] - Y[0];
      G.cvx = X[1] - X[0]; G.cvy = Y[1] - Y[0];
      let det = G.rvx * G.cvy - G.rvy * G.cvx;
      if (!(Math.abs(det) > 1e-12)) det = 1e-12;
      G.det = det;
      const cell = Math.max(Math.sqrt(G.rvx * G.rvx + G.rvy * G.rvy), 1e-5);
      const Ln = Math.sqrt(0.45 * 0.45 + 0.75 * 0.75 + 0.48 * 0.48);
      G.L0 = -0.45 / Ln; G.L1 = 0.75 / Ln; G.L2 = 0.48 / Ln;
      G.cw = 0.005 + cell * 0.8; G.cw2 = G.cw * G.cw;

      // pass 1: both hands as SDFs + their height fields (needed for np.gradient)
      const dA = scratch('crdA', n), dG = scratch('crdG', n);
      const qA = scratch('crqA', n), qG = scratch('crqG', n);
      const hA = scratch('crhA', n), hG = scratch('crhG', n);
      for (let i = 0; i < n; i++) {
        handSDF(ADAM, X[i] - adx, Y[i] - ady);
        dA[i] = HAND.d; qA[i] = HAND.q; hA[i] = heightOf(HAND.d);
        handSDF(GOD, X[i] - gdx, Y[i] - gdy);
        dG[i] = HAND.d; qG[i] = HAND.q; hG[i] = heightOf(HAND.d);
      }

      const be0 = cell * 0.6, be1 = -cell * 0.6, rimDen = 0.014 + cell;
      // ── the spark ──
      const tp = this.tips(t, pt), gx = tp[0], gy = tp[1], ax = tp[2], ay = tp[3];
      const mx = (gx + ax) * 0.5, my = (gy + ay) * 0.5;
      const gap = Math.max(gx - ax, 1e-3);
      const charge = sstep(2.5, 6.5, pt) * (1.0 - 0.0 * s);
      const flicker = 0.75 + 0.25 * Math.sin(t * 37.0) * Math.sin(t * 23.0);
      const lineW = 0.0025 + cell * 0.55;
      const glowR = 0.03 + 0.07 * charge;
      const flash = sstep(0.6, 1.0, s);              // the flash that becomes the Big Bang
      const flashR = 0.25 + 2.0 * flash;
      const rayY = t * 0.15, nebX = t * 0.03;

      for (let r = 0; r < bh; r++) {
        for (let c = 0; c < bw; c++) {
          const i = r * bw + c;
          // (pass 1 above still covers every cell: np.gradient needs the neighbours)
          if (skip && skip[i]) { out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = 0; sm[i] = 0; continue; }
          const x = X[i], y = Y[i];
          // background: dark heaven, god-rays from the upper right, drifting nebula
          const bx = x - 1.15, by = y - 0.85;
          const ra = Math.atan2(by, bx);
          const rw = 0.5 + 0.5 * Math.cos(ra * 14.0 + 2.0 * fbm(ra * 3.0, rayY, 2, 0)), rw2 = rw * rw;
          let rays = rw2 * rw2 * rw2;                                          // ** 6
          rays *= Math.exp(-Math.sqrt(bx * bx + by * by) / 1.6) * 0.35;
          const neb = smoothstep(0.45, 0.85, fbm(x * 1.2 + nebX, y * 1.2, 4, 0)) * 0.22;
          let o0 = rays * 1.0 + neb * 0.35;
          let o1 = rays * 0.78 + neb * 0.22;
          let o2 = rays * 0.42 + neb * 0.55;
          const pores = 0.92 + 0.16 * vnoise(x * 45.0, y * 45.0, 0);

          // Adam's hand
          let dist = dA[i];
          const bA = smoothstep(be0, be1, dist);
          if (bA > 0) {
            shadeHand(hA, i, r, c, bw, bh, dist, qA[i], pores, G, 1.0, 0.70, 0.48);
            o0 += (SH[0] - o0) * bA; o1 += (SH[1] - o1) * bA; o2 += (SH[2] - o2) * bA;
          }
          if (dist > 0) {
            const z = dist / rimDen, rA = Math.exp(-(z * z)) * 0.35;
            o0 += rA * 1.0; o1 += rA * 0.85; o2 += rA * 0.55;
          }
          // God's hand (with the sleeve of his robe)
          dist = dG[i];
          const bG = smoothstep(be0, be1, dist);
          if (bG > 0) {
            shadeHand(hG, i, r, c, bw, bh, dist, qG[i], pores, G, 1.0, 0.76, 0.55);
            let c0 = SH[0], c1 = SH[1], c2 = SH[2];
            let robe = smoothstep(1.02, 1.10, x - gdx + 0.3 * (y - gdy));
            if (robe > 0) robe *= 0.6 + 0.6 * fbm((x - gdx) * 9.0, (y - gdy) * 3.0, 3, 0);
            robe = clamp01(robe);
            if (robe > 0) {
              const sl = 0.2 + 1.0 * Math.pow(SH[3], 1.2);
              c0 += (0.78 * sl - c0) * robe; c1 += (0.30 * sl - c1) * robe; c2 += (0.50 * sl - c2) * robe;
            }
            o0 += (c0 - o0) * bG; o1 += (c1 - o1) * bG; o2 += (c2 - o2) * bG;
          }
          if (dist > 0) {
            const z = dist / rimDen, rG = Math.exp(-(z * z)) * 0.45;
            o0 += rG * 1.0; o1 += rG * 0.82; o2 += rG * 0.5;
          }

          // the spark: lightning crackling between the fingertips
          if (charge > 0 && x > ax && x < gx) {
            let q = (x - ax) / gap;
            q = q < 0 ? 0 : q > 1 ? 1 : q;
            const env = Math.sin(Math.PI * q);
            let bolt = 0;
            for (let k = 0; k < 3; k++) {
              const jy = (vnoise(x * 70.0 + k * 13.0, t * 14.0 + k * 5.0, 0) - 0.5) * 0.022 * env;
              const yb = ay + (gy - ay) * q + jy;
              const z = (y - yb) / lineW;
              const line = Math.exp(-(z * z));
              bolt = k === 0 ? line : Math.max(bolt, line * 0.7);
            }
            const bv = bolt * charge * flicker * 1.6;
            o0 += bv * 0.75; o1 += bv * 0.9; o2 += bv * 1.0;
          }
          const ex = x - mx, ey = y - my;
          const rr = Math.sqrt(ex * ex + ey * ey);
          if (charge > 0) {
            const glow = Math.exp(-rr * zoom / glowR) * charge * 1.3;          // screen-sized
            o0 += glow * 1.0; o1 += glow * 0.9; o2 += glow * 0.7;
          }
          if (flash > 0) {
            const fl = Math.exp(-rr * zoom / flashR) * flash * 1.6;
            o0 += fl * 1.0; o1 += fl * 0.97; o2 += fl * 0.9;
          }
          const j = 3 * i;
          out[j] = o0; out[j + 1] = o1; out[j + 2] = o2;
          sm[i] = 0.45 * (1.0 - bG) * (1.0 - bA);
        }
      }
    }
  }

  /* ── 3. BIG BANG / HYPERSPACE ───────────────────────────────────────── */
  const F32_080 = Math.fround(0.80);
  const BB_LAYERS = [
    [90, 1.0, 1, 0.7, 0.85, 1.0],
    [150, 1.6, 2, 1.0, 0.75, 0.95],
    [240, 2.4, 3, 0.85, 1.0, 1.0]
  ];
  class BigBang {
    constructor() {
      this.name = 'BIG BANG'; this.dur = 8.0; this.hold = 1.0; this.mode = 'fade';
      this.roll = 0.6; this.peek = 0.55; this.fade = [0.35, 1.0];
    }
    dive(pt) { return sstep(this.hold, this.dur, pt); }
    portal() { return [0.0, 0.0, 0.05]; }
    render(X, Y, n, bw, bh, t, pt, zoom, out, sm, skip) {
      const p = Math.max(pt, 0.0);
      const speed = 0.6 + 2.6 * p;                      // accelerating
      const dist = 0.6 * pt + 1.3 * p * p;
      const length = Math.min(0.48, 0.04 + speed * 0.05);
      const plasmaK = 0.10 + 0.07 * Math.min(p, 3.0);
      const heat = Math.exp(-Math.max(pt + 0.3, 0.0) * 1.6);   // birth flash, cooling off
      const flashR = 0.12 + 1.0 * heat, flashA = 0.25 + 1.3 * heat;
      for (let i = 0; i < n; i++) {
        if (skip && skip[i]) { out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = 0; sm[i] = 0; continue; }
        const x = X[i], y = Y[i];
        const r = Math.sqrt(x * x + y * y) + 1e-4;
        const a = Math.atan2(y, x);
        const fadeIn = smoothstep(0.03, 0.35, r);
        let o0 = 0, o1 = 0, o2 = 0;
        for (let L = 0; L < 3; L++) {
          const P = BB_LAYERS[L], N = P[0], K = P[1], seed = P[2];
          const u = (a / TAU + 0.5) * N + seed * 0.37;
          const v = K / r + dist * 1.5;
          const fu0 = Math.floor(u), fv0 = Math.floor(v);
          const cu = pmod(fu0, N), cv = fv0;
          const h = _hash(cu + seed * 7919, cv);
          if (!(h > F32_080)) continue;                 // numpy compares float32 h with float32(0.80)
          const h2 = _hash(cu + 31, cv + seed * 104729);
          const fu = (u - fu0) - (0.3 + 0.4 * h2);
          const fv = (v - fv0) - 0.5;
          const arc = fu * TAU * r / N;
          const radial = clamp01(1.0 - Math.abs(fv) / length);
          const za = arc / 0.010;
          const star = Math.exp(-(za * za)) * radial * fadeIn * (0.5 + 0.9 * h2) * 1.4;
          o0 += star * P[3]; o1 += star * P[4]; o2 += star * P[5];
        }
        // primordial plasma tunnel
        const nu = (a / TAU + 0.5) * 10.0;
        const neb = fbm(nu, 2.0 / (r + 0.08) + dist * 2.0, 3, 10);
        const plasma = smoothstep(0.55, 0.95, neb) * smoothstep(0.05, 0.6, r) * plasmaK;
        const p2 = plasma * plasma * 0.8;
        o0 += plasma * 0.55 + p2 * 0.2; o1 += plasma * 0.25 + p2 * 0.6; o2 += plasma * 0.85 + p2 * 1.0;
        const fl = Math.exp(-r / flashR) * flashA;
        o0 += fl * 1.0; o1 += fl * 0.92; o2 += fl * 0.8;
        const j = 3 * i;
        out[j] = o0; out[j + 1] = o1; out[j + 2] = o2;
        sm[i] = 0.0;
      }
    }
  }

  /* ── 4. GALAXY ──────────────────────────────────────────────────────── */
  class Galaxy {
    constructor() {
      this.name = 'GALAXY'; this.dur = 10.0; this.hold = 3.0; this.mode = 'fade';
      this.roll = -0.5; this.peek = 0.0; this.fade = [0.2, 0.85];
    }
    dive(pt) { return sstep(this.hold, this.dur, pt); }
    portal() { return [0.0, 0.0, 0.035]; }
    render(X, Y, n, bw, bh, t, pt, zoom, out, sm, skip) {
      const c = Math.cos(0.45), s_ = Math.sin(0.45);
      const armRot = t * 0.10, shear = t * 0.25;
      for (let i = 0; i < n; i++) {
        if (skip && skip[i]) { out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = 0; sm[i] = 0; continue; }
        const x = X[i], y = Y[i];
        const xr = x * c - y * s_;
        const yr = (x * s_ + y * c) / 0.58;                // tilted disc
        const r = Math.sqrt(xr * xr + yr * yr) + 1e-4;
        const a = Math.atan2(yr, xr);
        const th = a + armRot;                             // arms = density wave, rotates rigidly
        const ts = a + shear / (r + 0.35);                 // the gas/stars shear past it
        const xx = r * Math.cos(ts), yy = r * Math.sin(ts);
        const spiral = th - 2.3 * Math.log(r);
        const aw = 0.5 + 0.5 * Math.cos(2.0 * spiral);
        const arm = aw * aw * aw;                                              // ** 3
        const nn = fbm(xx * 4.0, yy * 4.0, 4, 0);
        const dw = 0.5 + 0.5 * Math.cos(2.0 * spiral - 0.55), dw2 = dw * dw, dw4 = dw2 * dw2;
        const dust = dw4 * dw4 * smoothstep(0.06, 0.3, r);                     // ** 8
        const disk = Math.exp(-r / 0.45);
        let dens = disk * (0.18 + 1.25 * arm * (0.35 + 0.95 * nn)) * (1.0 - 0.65 * dust * nn);
        const rb = r / 0.13;
        const bulge = Math.exp(-(rb * rb)) * 1.1 + Math.exp(-r / 0.02) * 0.9;
        const knots = smoothstep(0.80, 0.95, vnoise(xx * 26.0, yy * 26.0, 0)) * arm * disk * 2.5;
        dens = dens * 1.5;
        const halo = Math.exp(-Math.sqrt(x * x + y * y) / 0.9) * 0.08;
        const j = 3 * i;
        out[j] = dens * 0.45 + bulge * 1.0 + knots * 1.0 + halo * 0.5;
        out[j + 1] = dens * 0.62 + bulge * 0.82 + knots * 0.32 + halo * 0.4;
        out[j + 2] = dens * 1.0 + bulge * 0.52 + knots * 0.62 + halo * 0.9;
        sm[i] = 1.0;
      }
    }
  }

  /* ── 5. BLACK HOLE ──────────────────────────────────────────────────── */
  function fireInto(I, out, j) {        // black-body-ish ramp: black → red → orange → yellow → white
    out[j] = clamp01(I * 1.9);
    out[j + 1] = Math.pow(clamp01(I * 1.6 - 0.45), 1.1);
    out[j + 2] = clamp01(I * 2.2 - 1.35);
  }
  class BlackHole {
    constructor() {
      this.name = 'BLACK HOLE'; this.dur = 11.0; this.hold = 3.5; this.mode = 'mask';
      this.roll = 0.35; this.peek = 0.0; this.fade = [0.35, 1.0];
      this.Rh = 0.26;
    }
    dive(pt) { return sstep(this.hold, this.dur, pt); }
    portal() { return [0.0, 0.0, this.Rh * 0.97]; }
    render(X, Y, n, bw, bh, t, pt, zoom, out, sm, skip) {
      const Rh = this.Rh;
      const c = Math.cos(0.1), s_ = Math.sin(0.1);
      const spin = t * 0.9, swirl = t * 0.5;
      for (let i = 0; i < n; i++) {
        if (skip && skip[i]) { out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = 0; sm[i] = 0; continue; }
        const x = X[i], y = Y[i];
        const Xt = x * c - y * s_, Yt = x * s_ + y * c;
        const r = Math.sqrt(Xt * Xt + Yt * Yt) + 1e-5;
        const a = Math.atan2(Yt, Xt);
        // accretion disc (seen almost edge-on)
        const dx = Xt, dy = Yt / 0.19;
        const rd = Math.sqrt(dx * dx + dy * dy) + 1e-5;
        const ad = Math.atan2(dy, dx);
        const rot = ad - spin / (Math.pow(rd, 1.5) + 0.1);
        const nn = fbm((rot / TAU) * 24.0, rd * 9.0, 3, 24);
        const band = smoothstep(Rh * 1.25, Rh * 1.7, rd) * smoothstep(1.6, 0.75, rd);
        const dop = 1.0 + 0.7 * (-dx / rd);                          // approaching side brighter
        let disk = band * (0.3 + 1.2 * nn * nn) * Math.pow(0.55 / rd, 1.2) * dop;
        if (Yt > 0 && r < Rh * 1.02) disk = 0;                       // far side hidden by the hole
        // gravitationally-lensed image of the far side, wrapped around the shadow
        const lr = r - Rh * 1.12;
        const hn = fbm((a / TAU) * 20.0 - swirl, r * 10.0, 2, 20);
        const zl = lr / 0.05;
        let halo = r > Rh ? Math.exp(-(zl * zl)) + 0.3 * Math.exp(-(lr > 0 ? lr : 0) / 0.12) : 0;
        halo = halo * (0.35 + 0.9 * hn) * (1.0 + 0.5 * (-Xt / r)) * (0.55 + 0.45 * Math.abs(Math.sin(a)));
        const zr = (r - Rh * 1.03) / 0.012;
        const ring = Math.exp(-(zr * zr)) * 1.4;                      // photon ring
        const shadow = smoothstep(Rh * 0.97, Rh * 1.02, r);
        const I = (halo * 0.9 + ring) * shadow + disk;
        const j = 3 * i;
        fireInto(I * 0.9, out, j);
        const rs = ring * shadow * 0.25;
        out[j] += rs * 0.6; out[j + 1] += rs * 0.8; out[j + 2] += rs * 1.0;
        sm[i] = shadow * clamp01(1.0 - I);
      }
    }
  }

  /* ======================================================================
     backdrop starfield (screen space, streams outward as we zoom forever)
     ====================================================================== */
  const SF_LAYERS = [[120, 8.0, 0.22, 1], [220, 14.0, 0.45, 5]];
  function addStarfield(X, Y, n, logz, t, sm, col) {
    for (let i = 0; i < n; i++) {
      const w = sm[i];
      if (w === 0) continue;
      const x = X[i], y = Y[i];
      const r = Math.sqrt(x * x + y * y) + 1e-5;
      const a = Math.atan2(y, x);
      const lr = Math.log(r);
      let o0 = 0, o1 = 0, o2 = 0;
      for (let L = 0; L < 2; L++) {
        const P = SF_LAYERS[L], N = P[0], K = P[1], par = P[2], seed = P[3];
        const u = (a / TAU + 0.5) * N;
        const v = (lr - par * logz) * K;
        const fu = Math.floor(u), fv = Math.floor(v);
        const cu = pmod(fu, N), cv = fv;
        let p = 26.0 * TAU * r * r / (N * K);
        p = Math.fround(p < 0 ? 0 : p > 0.9 ? 0.9 : p);        // float32, as in numpy
        const h = _hash(cu + seed * 1013, cv);
        if (!(h < p)) continue;
        const h2 = _hash(cu + 77, cv + seed * 389);
        const arc = ((u - fu) - (0.25 + 0.5 * h2)) * TAU * r / N;
        const rad = ((v - fv) - 0.5) * r / K;
        const tw = 0.65 + 0.35 * Math.sin(t * (1.5 + 4.0 * h2) + h2 * 60.0);
        const b = Math.exp(-(arc * arc + rad * rad) / 0.00022) * (0.35 + 0.9 * h2) * tw;
        o0 += b * (0.65 + 0.35 * h2);
        o1 += b * (0.78 + 0.07 * h2);
        o2 += b * (1.0 - 0.3 * h2);
      }
      const j = 3 * i;
      col[j] += o0 * w; col[j + 1] += o1 * w; col[j + 2] += o2 * w;
    }
  }

  /* ======================================================================
     ENGINE — runs the infinite zoom and turns colour into glyphs
     ====================================================================== */
  function makeRng(seed) {                 // small deterministic PRNG (numpy uses default_rng(7))
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  class Engine {
    constructor() {
      this.eye = new Eye();
      this.creation = new Creation();
      this.worlds = [this.eye, this.creation, new BigBang(), new Galaxy(), new BlackHole()];
      this.cur = 0;
      this.pt = -1.6;          // start with the eye still closed
      this.t = 0.0;
      this.logz_total = 0.0;
      this.glitch = 0.0;
      this.palette = 0;
      this.rng = makeRng(7);
      this.loops = 0;          // (web) completed full circles EYE → … → BLACK HOLE → EYE
      this.loopClosedAt = -1;
    }

    // grid ---------------------------------------------------------------
    setGrid(cols, rows, cellW, cellH) {
      this.cols = cols; this.rows = rows;
      const n = cols * rows; this.n = n;
      const aspect = (cols * cellW) / (rows * cellH);
      const fit = Math.max(1.0, 1.45 / aspect);          // portrait: zoom out so the eye fits
      const xs = new Float64Array(cols), ys = new Float64Array(rows);
      let mxs = 0;
      for (let c = 0; c < cols; c++) {
        xs[c] = ((c + 0.5) - cols / 2.0) * cellW / (rows * cellH / 2.0);
        mxs = Math.max(mxs, Math.abs(xs[c]));
      }
      for (let r = 0; r < rows; r++) ys[r] = -((r + 0.5) - rows / 2.0) / (rows / 2.0);
      this.X = new Float64Array(n); this.Y = new Float64Array(n); this.vig = new Float64Array(n);
      const f32 = Math.fround, ffit = f32(fit), den = Math.max(mxs, 1e-6);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          this.X[i] = f32(f32(xs[c]) * ffit);
          this.Y[i] = f32(f32(ys[r]) * ffit);
          const vx = xs[c] / den;
          const vig = 1.0 - 0.55 * (vx * vx * 0.6 + ys[r] * ys[r] * 0.5);
          this.vig[i] = f32(vig < 0.25 ? 0.25 : vig > 1.0 ? 1.0 : vig);
        }
      }
      this.RHO = Math.hypot(aspect * fit, fit) * 1.06;
      this.eye.S = 1.0 + 0.15 * smoothstep(1.45, 1.0, aspect);   // (brown eye) tall screens: a bit closer
      const F = () => new Float64Array(n), F3 = () => new Float64Array(3 * n);
      this.RX = F(); this.RY = F(); this.WX = F(); this.WY = F(); this.IX = F(); this.IY = F();
      this.M = F(); this.sm = F(); this.ism = F(); this.BX = F(); this.BY = F(); this.bsm = F();
      this.col = F3(); this.icol = F3(); this.bcol = F3();
      this.skipCur = new Uint8Array(n); this.skipBox = new Uint8Array(n);
      this.ink = F();          // (brown eye) cells covered by lashes / eyeliner / brow: they get no bloom
    }

    // time ---------------------------------------------------------------
    advance(dt) {
      this.t += dt;
      this.pt += dt;
      this.glitch = Math.max(0.0, this.glitch - dt);
      const w = this.worlds[this.cur];
      if (this.pt >= w.dur) this._switch();
    }
    skip() {
      this.pt = this.worlds[this.cur].dur;
      this._switch();
    }
    _switch() {
      const w = this.worlds[this.cur];
      const pr = w.portal(this.t, w.dur)[2];
      this.logz_total += Math.log(this.RHO / pr);
      this.pt -= w.dur;
      this.cur = (this.cur + 1) % this.worlds.length;
      this.glitch = 0.35;
      if (this.cur === 0) { this.loops += 1; this.loopClosedAt = this.t; }
    }
    get world() { return this.worlds[this.cur]; }
    zoomExponent() {
      const w = this.world;
      const pr = w.portal(this.t, this.pt)[2];
      const e = w.dive(this.pt);
      return (this.logz_total + e * Math.log(this.RHO / pr)) / Math.log(10.0);
    }

    // one frame of colour ------------------------------------------------
    colour() {
      const t = this.t, pt = this.pt, n = this.n, cols = this.cols, rows = this.rows;
      const w = this.worlds[this.cur];
      const nxt = this.worlds[(this.cur + 1) % this.worlds.length];
      const s = pt < w.hold ? 0.0 : Math.min(1.0, (pt - w.hold) / (w.dur - w.hold));
      const e = s * s * (3.0 - 2.0 * s);
      const P = w.portal(t, pt), px = P[0], py = P[1], pr = P[2];
      const lnZ = Math.log(this.RHO / pr);
      const zoom = Math.exp(e * lnZ);
      const th = w.roll * Math.sin(Math.PI * e);
      const ct = Math.cos(th), st = Math.sin(th);
      const ec = 1.0 - Math.pow(1.0 - e, 3);                // camera centres on the portal early
      const cx = px * ec, cy = py * ec;
      const X0 = this.X, Y0 = this.Y, RX = this.RX, RY = this.RY, WX = this.WX, WY = this.WY;
      for (let i = 0; i < n; i++) {
        const x = X0[i] * ct - Y0[i] * st, y = X0[i] * st + Y0[i] * ct;
        RX[i] = x; RY[i] = y;
        WX[i] = cx + x / zoom; WY[i] = cy + y / zoom;
      }
      const col = this.col, sm = this.sm, ink = this.ink;
      ink.fill(0, 0, n);
      this.eye.inkOut = w === this.eye ? ink : null;
      const sx = (px - cx) * zoom, sy = (py - cy) * zoom;
      const rho = pr * zoom;
      const k = this.RHO / rho;
      if (w.mode === 'mask') {
        const ed = 0.006 + 0.015 * rho;
        const M = this.M;
        let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const dx = RX[i] - sx, dy = RY[i] - sy;
            const m = smoothstep(rho + ed, rho - ed, Math.sqrt(dx * dx + dy * dy));
            M[i] = m;
            if (m > 0) {
              if (r < r0) r0 = r;
              if (r > r1) r1 = r;
              if (c < c0) c0 = c;
              if (c > c1) c1 = c;
            }
          }
        }
        if (w.portalCover) w.portalCover(WX, WY, M, n, t, pt);     // (brown eye) closed lids hide the pupil
        let box = false;
        if (r1 >= 0) {
          r0 = Math.max(r0 - 1, 0); r1 = Math.min(r1 + 2, rows);
          c0 = Math.max(c0 - 1, 0); c1 = Math.min(c1 + 2, cols);
          box = r1 - r0 >= 2 && c1 - c0 >= 2;
        }
        // cells fully inside the portal show only the next world: the current one is not computed there
        const skipCur = this.skipCur;
        for (let i = 0; i < n; i++) skipCur[i] = box && M[i] >= 1.0 ? 1 : 0;
        w.render(WX, WY, n, cols, rows, t, pt, zoom, col, sm, box ? skipCur : null);
        if (box) {
          {
            const bw = c1 - c0, bh = r1 - r0, bn = bw * bh;
            const BX = this.BX, BY = this.BY, bcol = this.bcol, bsm = this.bsm, skipBox = this.skipBox;
            for (let r = 0; r < bh; r++) {
              for (let c = 0; c < bw; c++) {
                const i = (r + r0) * cols + (c + c0), j = r * bw + c;
                BX[j] = (RX[i] - sx) * k; BY[j] = (RY[i] - sy) * k;
                skipBox[j] = M[i] === 0 ? 1 : 0;           // corners of the box outside the hole are not shown
              }
            }
            nxt.render(BX, BY, bn, bw, bh, t, pt - w.dur, 1.0, bcol, bsm, skipBox);
            const pg = w.portalGain ? w.portalGain(t, pt) : 1.0;
            for (let r = 0; r < bh; r++) {
              for (let c = 0; c < bw; c++) {
                const i = (r + r0) * cols + (c + c0), j = r * bw + c;
                const mb = M[i];
                if (mb === 0) continue;
                const a = 3 * i, b = 3 * j;
                col[a] += (bcol[b] * pg - col[a]) * mb;
                col[a + 1] += (bcol[b + 1] * pg - col[a + 1]) * mb;
                col[a + 2] += (bcol[b + 2] * pg - col[a + 2]) * mb;
                sm[i] = sm[i] * (1.0 - mb) + bsm[j] * mb;
                ink[i] *= 1.0 - mb;
              }
            }
          }
        }
      } else {
        const alpha = sstep(w.fade[0], w.fade[1], s);
        const wi = alpha + (1.0 - alpha) * w.peek;
        // once the next world has fully taken over (alpha = 1) the current one contributes nothing
        if (alpha >= 1.0) { col.fill(0, 0, 3 * n); sm.fill(0, 0, n); }
        else w.render(WX, WY, n, cols, rows, t, pt, zoom, col, sm, null);
        if (wi > 0.0) {
          const IX = this.IX, IY = this.IY, icol = this.icol, ism = this.ism;
          for (let i = 0; i < n; i++) { IX[i] = (RX[i] - sx) * k; IY[i] = (RY[i] - sy) * k; }
          nxt.render(IX, IY, n, cols, rows, t, pt - w.dur, 1.0, icol, ism, null);
          const ka = 1.0 - alpha;
          for (let i = 0; i < n; i++) {
            const a = 3 * i;
            col[a] = col[a] * ka + icol[a] * wi;
            col[a + 1] = col[a + 1] * ka + icol[a + 1] * wi;
            col[a + 2] = col[a + 2] * ka + icol[a + 2] * wi;
            sm[i] = sm[i] * ka + ism[i] * alpha;
          }
        }
      }
      const logz = this.logz_total + e * lnZ;
      addStarfield(RX, RY, n, logz, t, sm, col);
      return col;
    }

    // palette + glyph selection -----------------------------------------
    /* idx (glyph per cell), fg (rgb 0..255 per cell), glow (clamp01(bloom*0.5)*255 per cell),
       glowMul (optional, 0..255 per cell): how much bloom a cell receives — dark lashes of the brown eye get none */
    frame(levels, idx, fg, glow, glowMul) {
      const col = this.colour();
      if (glowMul) {
        const ink = this.ink;
        for (let i = 0, n = this.n; i < n; i++) glowMul[i] = (255.0 * (1.0 - 0.92 * ink[i]) + 0.5) | 0;
      }
      const n = this.n, vig = this.vig, nl = levels.length, rnd = this.rng;
      const pal = PALETTES[this.palette];
      let m00 = 1, m01 = 0, m02 = 0, m10 = 0, m11 = 1, m12 = 0, m20 = 0, m21 = 0, m22 = 1;
      if (pal === 'PRISM') {                 // rotate hue around the grey axis over time
        const a = this.t * 0.6, c = Math.cos(a), s = Math.sin(a), k = 1.0 / 3.0, sq = Math.sqrt(k);
        m00 = c + (1 - c) * k; m01 = k * (1 - c) - sq * s; m02 = k * (1 - c) + sq * s;
        m10 = k * (1 - c) + sq * s; m11 = c + k * (1 - c); m12 = k * (1 - c) - sq * s;
        m20 = k * (1 - c) - sq * s; m21 = k * (1 - c) + sq * s; m22 = c + k * (1 - c);
      }
      for (let i = 0; i < n; i++) {
        const j = 3 * i, v = vig[i];
        const c0 = col[j] * v, c1 = col[j + 1] * v, c2 = col[j + 2] * v;
        let t0 = 1.0 - Math.exp(-(c0 > 0 ? c0 : 0) * 1.6);            // tone map
        let t1 = 1.0 - Math.exp(-(c1 > 0 ? c1 : 0) * 1.6);
        let t2 = 1.0 - Math.exp(-(c2 > 0 ? c2 : 0) * 1.6);
        if (pal !== 'COSMIC') {
          const Lp = t0 * 0.3 + t1 * 0.55 + t2 * 0.15;
          if (pal === 'MATRIX') { t0 = Lp * 0.25; t1 = Lp * 1.0; t2 = Lp * 0.45; }
          else if (pal === 'AMBER') { t0 = Lp * 1.0; t1 = Lp * 0.64; t2 = Lp * 0.18; }
          else if (pal === 'INFERNO') {
            const I = Lp * 1.3;
            t0 = clamp01(I * 1.9); t1 = Math.pow(clamp01(I * 1.6 - 0.45), 1.1); t2 = clamp01(I * 2.2 - 1.35);
          } else {
            const a0 = t0, a1 = t1, a2 = t2;
            t0 = clamp01((a0 * m00 + a1 * m01 + a2 * m02) * 1.15);
            t1 = clamp01((a0 * m10 + a1 * m11 + a2 * m12) * 1.15);
            t2 = clamp01((a0 * m20 + a1 * m21 + a2 * m22) * 1.15);
          }
        }
        let L = t0 * 0.30 + t1 * 0.55 + t2 * 0.15;
        L = Math.pow(clamp01((L - 0.035) * 1.2), 0.72);                 // black point kills grey haze
        // pick the glyph whose ink coverage best matches the brightness (np.searchsorted)
        let lo = 0, hi = nl;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (levels[mid] < L) lo = mid + 1; else hi = mid; }
        let g = lo < nl ? lo : nl - 1;
        // living text: neighbouring glyphs shimmer like the video
        if (g > 1 && rnd() < 0.10) {
          g += ((rnd() * 3) | 0) - 1;
          if (g < 0) g = 0; else if (g > nl - 1) g = nl - 1;
        }
        idx[i] = g;
        let mx = t0 > t1 ? t0 : t1;
        if (t2 > mx) mx = t2;
        const gain = (0.62 + 0.7 * mx) / (mx > 1e-3 ? mx : 1e-3);     // glyph ink carries the brightness
        fg[j] = (clamp01(t0 * gain) * 255.0) | 0;
        fg[j + 1] = (clamp01(t1 * gain) * 255.0) | 0;
        fg[j + 2] = (clamp01(t2 * gain) * 255.0) | 0;
        glow[j] = (clamp01(t0 * 0.5) * 255.0) | 0;
        glow[j + 1] = (clamp01(t1 * 0.5) * 255.0) | 0;
        glow[j + 2] = (clamp01(t2 * 0.5) * 255.0) | 0;
      }
      if (this.glitch > 0) this._glitch(idx, fg);
    }

    _glitch(idx, fg) {
      const rows = this.rows, cols = this.cols, rnd = this.rng, n = this.n;
      const count = Math.floor(rows * 0.25 * (this.glitch / 0.35));
      const ti = this._tmpI || (this._tmpI = new Uint8Array(4096));
      const tf = this._tmpF || (this._tmpF = new Uint8Array(3 * 4096));
      for (let q = 0; q < count; q++) {
        const row = (rnd() * rows) | 0;
        const sh = ((rnd() * 25) | 0) - 12;
        const base = row * cols;
        for (let c = 0; c < cols; c++) {                     // np.roll
          const from = base + pmod(c - sh, cols);
          ti[c] = idx[from];
          tf[3 * c] = fg[3 * from]; tf[3 * c + 1] = fg[3 * from + 1]; tf[3 * c + 2] = fg[3 * from + 2];
        }
        for (let c = 0; c < cols; c++) {
          idx[base + c] = ti[c];
          fg[3 * (base + c)] = tf[3 * c]; fg[3 * (base + c) + 1] = tf[3 * c + 1]; fg[3 * (base + c) + 2] = tf[3 * c + 2];
        }
        if (rnd() < 0.3) {
          let mx = 0;
          for (let i = 0; i < n; i++) if (idx[i] > mx) mx = idx[i];
          for (let c = 0; c < cols; c++) {
            idx[base + c] = (rnd() * (mx + 1)) | 0;
            const a = 3 * (base + c), r0 = fg[a], g0 = fg[a + 1], b0 = fg[a + 2];
            fg[a] = b0; fg[a + 1] = r0; fg[a + 2] = g0;     // fg[row][:, [2, 0, 1]]
          }
        }
      }
    }
  }

  /* ======================================================================
     glyph atlas (canvas text instead of pygame.font), sorted by ink coverage
     ====================================================================== */
  const atlasCache = Object.create(null);
  function buildAtlas(size, dpr) {
    const key = size + '@' + dpr;
    if (atlasCache[key]) return atlasCache[key];
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = 'bold ' + size + 'px ' + FONT_STACK;
    const cw = Math.max(3, Math.round(probe.measureText('M').width + 0.25));
    const ch = Math.max(6, Math.ceil(size * 1.164 - 0.01));        // ≈ pygame font.get_linesize()
    const cwD = Math.max(1, Math.round(cw * dpr)), chD = Math.max(1, Math.round(ch * dpr));
    const N = RAMP.length;
    const raw = document.createElement('canvas');
    raw.width = N * cwD; raw.height = chD;
    const g = raw.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, raw.width, raw.height);
    g.font = 'bold ' + (size * dpr) + 'px ' + FONT_STACK;
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const m = g.measureText('M');
    const asc = m.fontBoundingBoxAscent || size * dpr * 0.8;
    const desc = m.fontBoundingBoxDescent || size * dpr * 0.2;
    const base = Math.round((chD - (asc + desc)) / 2 + asc);
    for (let k = 0; k < N; k++) {
      g.save();
      g.beginPath(); g.rect(k * cwD, 0, cwD, chD); g.clip();
      g.fillText(RAMP[k], k * cwD + cwD / 2, base);
      g.restore();
    }
    const data = g.getImageData(0, 0, raw.width, chD).data;
    const cov = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let y = 0; y < chD; y++) {
        let p = 4 * (y * raw.width + k * cwD);
        for (let x = 0; x < cwD; x++, p += 4) sum += data[p];
      }
      cov[k] = sum / (cwD * chD);
    }
    const order = Array.from({ length: N }, (_, k) => k).sort((a, b) => (cov[a] - cov[b]) || (a - b));
    const sorted = document.createElement('canvas');
    sorted.width = raw.width; sorted.height = chD;
    const sg = sorted.getContext('2d');
    order.forEach((src, dst) => sg.drawImage(raw, src * cwD, 0, cwD, chD, dst * cwD, 0, cwD, chD));
    const c0 = cov[order[0]], c1 = cov[order[N - 1]], span = Math.max(c1 - c0, 1e-6);
    const levels = new Float64Array(N);
    for (let k = 0; k < N - 1; k++) {        // thresholds half-way between successive coverage levels
      levels[k] = Math.fround((((cov[order[k + 1]] - c0) / span) + ((cov[order[k]] - c0) / span)) * 0.5);
    }
    levels[N - 1] = 2.0;
    const atlas = {
      canvas: sorted, cw: cw, ch: ch, cwD: cwD, chD: chD, n: N, levels: levels,
      chars: order.map((k) => RAMP[k]).join(''), blank0: cov[order[0]] === 0
    };
    atlasCache[key] = atlas;
    return atlas;
  }

  /* area-average shrink (pygame.transform.smoothscale, shrinking) — for the bloom */
  function areaWeights(srcN, dstN) {
    const scale = srcN / dstN, idx = [], wts = [], start = new Int32Array(dstN + 1);
    for (let d = 0; d < dstN; d++) {
      start[d] = idx.length;
      const a = d * scale, b = (d + 1) * scale;
      for (let s = Math.floor(a); s < Math.ceil(b) && s < srcN; s++) {
        const w = Math.min(b, s + 1) - Math.max(a, s);
        if (w > 1e-9) { idx.push(s); wts.push(w / scale); }
      }
    }
    start[dstN] = idx.length;
    return { idx: Int32Array.from(idx), wts: Float64Array.from(wts), start: start };
  }

  /* ======================================================================
     renderers: WebGL (main) and Canvas 2D (fallback)
     Pipeline of the original: glyph ink (grey) × cell colour (BLEND_MULT),
     then bloom: colour field → cols/3 × rows/3 → smoothscale up → BLEND_ADD,
     optional CRT scanlines (every 3rd line, black α 70).
     ====================================================================== */
  function createGLRenderer(canvas) {
    const opts = { alpha: false, antialias: false, depth: false, stencil: false,
                   premultipliedAlpha: false, preserveDrawingBuffer: false };
    let gl = null;
    try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch (e) { gl = null; }
    if (!gl) return null;
    const VS = 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.0,1.0);}';
    const FS = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'uniform sampler2D uAtlas, uCells, uGlow, uGlowMul;',
      'uniform vec2 uCanvas, uOrigin, uCell, uGrid, uAtlasSize, uGlowSize;',
      'uniform float uBloom, uCrt, uDpr;',
      'void main(){',
      '  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);',
      '  vec2 p = frag - uOrigin;',
      '  vec2 gridPx = uGrid * uCell;',
      '  vec3 col = vec3(0.0);',
      '  if (p.x >= 0.0 && p.y >= 0.0 && p.x < gridPx.x && p.y < gridPx.y) {',
      '    vec2 cell = floor(p / uCell);',
      '    vec2 local = p - cell * uCell;',
      '    vec4 cd = texture2D(uCells, (cell + 0.5) / uGrid);',
      '    float g = floor(cd.a * 255.0 + 0.5);',
      '    float ink = texture2D(uAtlas, vec2((g * uCell.x + local.x) / uAtlasSize.x, local.y / uAtlasSize.y)).r;',
      '    col = ink * cd.rgb;',
      '    if (uBloom > 0.5) {',
      '      vec2 sp = floor(p) * (uGlowSize - 1.0) / gridPx;',          // pygame smoothscale (expand) mapping
      '      col += texture2D(uGlow, (sp + 0.5) / uGlowSize).rgb * texture2D(uGlowMul, (cell + 0.5) / uGrid).r;',
      '    }',
      '    col = min(col, vec3(1.0));',
      '  }',
      '  if (uCrt > 0.5 && mod(floor(frag.y / uDpr), 3.0) < 0.5) col *= (1.0 - 70.0 / 255.0);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');
    function shader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    }
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    } catch (e) {
      if (window.console) console.warn('[intro] WebGL недоступен, используется Canvas 2D:', e.message);
      return null;
    }
    gl.useProgram(prog);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uAtlas', 'uCells', 'uGlow', 'uGlowMul', 'uCanvas', 'uOrigin', 'uCell', 'uGrid', 'uAtlasSize', 'uGlowSize', 'uBloom', 'uCrt', 'uDpr']
      .forEach((name) => { U[name] = gl.getUniformLocation(prog, name); });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    function texture(unit, filter) {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      return tex;
    }
    const tAtlas = texture(0, gl.NEAREST), tCells = texture(1, gl.NEAREST), tGlow = texture(2, gl.LINEAR);
    const tGlowMul = texture(3, gl.NEAREST);
    gl.uniform1i(U.uAtlas, 0); gl.uniform1i(U.uCells, 1); gl.uniform1i(U.uGlow, 2); gl.uniform1i(U.uGlowMul, 3);
    let atlas = null, cols = 0, rows = 0, sw = 0, sh = 0;
    return {
      kind: 'webgl',
      gl: gl,
      setAtlas(a) {
        atlas = a;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tAtlas);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a.canvas);
      },
      setGrid(c, r, w, h) {
        cols = c; rows = r; sw = w; sh = h;
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tCells);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, c, r, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tGlow);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tGlowMul);
        const ones = new Uint8Array(c * r); ones.fill(255);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, c, r, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, ones);
      },
      resize(w, h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); },
      draw(cells, glowRGBA, p) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tCells);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, cells);
        if (p.bloom) {
          gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tGlow);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, glowRGBA);
          if (p.glowMul) {
            gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tGlowMul);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.LUMINANCE, gl.UNSIGNED_BYTE, p.glowMul);
          }
        }
        gl.uniform2f(U.uCanvas, canvas.width, canvas.height);
        gl.uniform2f(U.uOrigin, p.ox, p.oy);
        gl.uniform2f(U.uCell, atlas.cwD, atlas.chD);
        gl.uniform2f(U.uGrid, cols, rows);
        gl.uniform2f(U.uAtlasSize, atlas.canvas.width, atlas.canvas.height);
        gl.uniform2f(U.uGlowSize, sw, sh);
        gl.uniform1f(U.uBloom, p.bloom ? 1 : 0);
        gl.uniform1f(U.uCrt, p.crt ? 1 : 0);
        gl.uniform1f(U.uDpr, p.dpr);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      destroy() {
        try { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* ignore */ }
      }
    };
  }

  function create2DRenderer(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const colorCanvas = document.createElement('canvas'), cctx = colorCanvas.getContext('2d');
    const glowCanvas = document.createElement('canvas'), gctx = glowCanvas.getContext('2d');
    const maskCanvas = document.createElement('canvas'), mctx = maskCanvas.getContext('2d');
    const tmpCanvas = document.createElement('canvas'), tctx = tmpCanvas.getContext('2d');
    let atlas = null, cols = 0, rows = 0, colorImg = null, glowImg = null, maskImg = null;
    return {
      kind: '2d',
      setAtlas(a) { atlas = a; },
      setGrid(c, r, w, h) {
        cols = c; rows = r;
        colorCanvas.width = c; colorCanvas.height = r; colorImg = cctx.createImageData(c, r);
        glowCanvas.width = w; glowCanvas.height = h; glowImg = gctx.createImageData(w, h);
        maskCanvas.width = c; maskCanvas.height = r; maskImg = mctx.createImageData(c, r);
        tmpCanvas.width = Math.max(1, c * atlas.cwD); tmpCanvas.height = Math.max(1, r * atlas.chD);
      },
      resize(w, h) { canvas.width = w; canvas.height = h; },
      draw(cells, glowRGBA, p) {
        const W = canvas.width, H = canvas.height, cw = atlas.cwD, ch = atlas.chD, src = atlas.canvas;
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        for (let r = 0, i = 0; r < rows; r++) {
          const y = p.oy + r * ch;
          for (let c = 0; c < cols; c++, i++) {
            const g = cells[4 * i + 3];
            if (g === 0 && atlas.blank0) continue;
            ctx.drawImage(src, g * cw, 0, cw, ch, p.ox + c * cw, y, cw, ch);
          }
        }
        const d = colorImg.data;
        for (let i = 0, n = cols * rows; i < n; i++) {
          d[4 * i] = cells[4 * i]; d[4 * i + 1] = cells[4 * i + 1]; d[4 * i + 2] = cells[4 * i + 2]; d[4 * i + 3] = 255;
        }
        cctx.putImageData(colorImg, 0, 0);
        ctx.globalCompositeOperation = 'multiply';
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(colorCanvas, p.ox, p.oy, cols * cw, rows * ch);
        if (p.bloom) {
          glowImg.data.set(glowRGBA);
          gctx.putImageData(glowImg, 0, 0);
          if (p.glowMul && p.inkUsed) {
            // bloom × per-cell mask (the brown eye's lashes stay dark), then added
            const md = maskImg.data, gm = p.glowMul;
            for (let i = 0, n = cols * rows; i < n; i++) { const v = gm[i]; md[4 * i] = v; md[4 * i + 1] = v; md[4 * i + 2] = v; md[4 * i + 3] = 255; }
            mctx.putImageData(maskImg, 0, 0);
            tctx.globalCompositeOperation = 'copy'; tctx.imageSmoothingEnabled = true;
            tctx.drawImage(glowCanvas, 0, 0, tmpCanvas.width, tmpCanvas.height);
            tctx.globalCompositeOperation = 'multiply'; tctx.imageSmoothingEnabled = false;
            tctx.drawImage(maskCanvas, 0, 0, tmpCanvas.width, tmpCanvas.height);
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(tmpCanvas, p.ox, p.oy);
          } else {
            ctx.globalCompositeOperation = 'lighter';
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(glowCanvas, p.ox, p.oy, cols * cw, rows * ch);
          }
        }
        ctx.globalCompositeOperation = 'source-over';
        if (p.crt) {
          ctx.fillStyle = 'rgba(0,0,0,' + (70 / 255) + ')';
          const step = 3 * p.dpr, lh = Math.max(1, Math.round(p.dpr));
          for (let y = 0; y < H; y += step) ctx.fillRect(0, Math.round(y), W, lh);
        }
      },
      destroy() { /* nothing to release */ }
    };
  }

  /* ======================================================================
     web front-end (replaces the pygame window loop)
     ====================================================================== */
  const HELP_LINES = [
    "   mouse        the eye follows you · in CREATION you steer God's hand",
    '   click        blink',
    '   SPACE        pause            RIGHT    skip to next world',
    '   UP / DOWN    time speed       + / -    glyph size (detail)',
    '   C            colour mode      B        bloom on/off',
    '   G            CRT scanlines    H        hide/show HUD',
    '   S            screenshot',
    '   F1           this help        ESC / Q  quit (open the site)'
  ];

  function startIntro(gate) {
    const doc = document;
    const overlay = doc.createElement('div');
    overlay.className = 'eoc-intro';
    overlay.setAttribute('role', 'img');
    overlay.setAttribute('aria-label', 'Вступительная анимация «Eye of Creation»');
    overlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;background:#000;overflow:hidden;opacity:1';
    const makeCanvas = () => {
      const c = doc.createElement('canvas');
      c.className = 'eoc-canvas';
      c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block';
      return c;
    };
    let canvas = makeCanvas();
    const hud = doc.createElement('div');
    hud.className = 'eoc-hud';
    const hudWorlds = doc.createElement('div'); hudWorlds.className = 'eoc-hud-worlds';
    const hudInfo = doc.createElement('div'); hudInfo.className = 'eoc-hud-info';
    hud.appendChild(hudWorlds); hud.appendChild(hudInfo);
    const help = doc.createElement('div');
    help.className = 'eoc-help';
    help.textContent = HELP_LINES.join('\n');
    help.hidden = true;
    overlay.appendChild(canvas); overlay.appendChild(hud); overlay.appendChild(help);
    doc.body.appendChild(overlay);

    let renderer = null;
    try { renderer = createGLRenderer(canvas); } catch (e) { renderer = null; }
    if (!renderer) {
      // WebGL unavailable: Canvas 2D on a fresh canvas (a canvas that already has a WebGL context can't go 2D)
      const fresh = makeCanvas();
      overlay.replaceChild(fresh, canvas);
      canvas = fresh;
      try { renderer = create2DRenderer(canvas); } catch (e) { renderer = null; }
    }
    if (!renderer) {
      overlay.parentNode.removeChild(overlay);
      gate.finish();
      return;
    }

    const eng = new Engine();
    eng.palette = CONFIG.PALETTE % PALETTES.length;
    let fontSize = CONFIG.FONT;      // glyph size in use (like «--font»)
    let manualFont = 0;              // after + / - the visitor's choice is kept as is
    let fontBump = 0;                // slow device: glyphs made bigger by this much
    let paused = false, showHud = !!CONFIG.HUD, showHelp = false, useBloom = !!CONFIG.BLOOM, crt = !!CONFIG.CRT;
    let speed = 1.0;
    let W = 0, H = 0, dpr = 1, atlas = null, ox = 0, oy = 0, sw = 2, sh = 2;
    let idx = null, fg = null, glowSrc = null, glowMul = null, cells = null, glowRGBA = null, glowTmp = null, wx = null, wy = null;
    let mouse = [0, 0], lastMouse = [0, 0], idle = 0.0;
    let raf = 0, tPrev = 0, nextDue = 0, wall = 0, outroAt = 0, done = false, wantShot = false;
    const fpsTimes = [];
    let costEma = 0, slowFrames = 0, adaptCooldown = 0, adaptations = 0;
    let lastHudWorld = -1, lastInfo = '';

    function rebuild() {
      dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
      W = Math.max(1, overlay.clientWidth || window.innerWidth);
      H = Math.max(1, overlay.clientHeight || window.innerHeight);
      // phones: finer glyphs (more detail on a small screen); very large screens: slightly bigger
      // glyphs so the frame stays smooth; the visitor's own choice (+ / -) wins
      let size = manualFont || ((Math.min(W, H) < 520 ? CONFIG.FONT_SMALL : CONFIG.FONT) + fontBump);
      atlas = buildAtlas(size, dpr);
      while (!manualFont && Math.floor(W / atlas.cw) * Math.floor(H / atlas.ch) > CONFIG.MAX_CELLS && size < 28) {
        size += 1;
        atlas = buildAtlas(size, dpr);
      }
      fontSize = size;
      const cols = Math.max(20, Math.floor(W / atlas.cw));
      const rows = Math.max(10, Math.floor(H / atlas.ch));
      eng.setGrid(cols, rows, atlas.cw, atlas.ch);
      const Wd = Math.max(1, Math.round(W * dpr)), Hd = Math.max(1, Math.round(H * dpr));
      renderer.resize(Wd, Hd);
      ox = Math.floor((Wd - cols * atlas.cwD) / 2);
      oy = Math.floor((Hd - rows * atlas.chD) / 2);
      sw = Math.max(2, Math.floor(cols / 3)); sh = Math.max(2, Math.floor(rows / 3));
      const n = cols * rows;
      idx = new Uint8Array(n); fg = new Uint8Array(3 * n); glowSrc = new Uint8Array(3 * n); glowMul = new Uint8Array(n);
      cells = new Uint8Array(4 * n);
      glowRGBA = new Uint8Array(4 * sw * sh); glowTmp = new Float64Array(3 * sw * rows);
      for (let i = 3; i < glowRGBA.length; i += 4) glowRGBA[i] = 255;
      wx = areaWeights(cols, sw); wy = areaWeights(rows, sh);
      renderer.setAtlas(atlas);
      renderer.setGrid(cols, rows, sw, sh);
    }

    function shrinkGlow() {
      const cols = eng.cols, rows = eng.rows;
      for (let r = 0; r < rows; r++) {                 // along x
        for (let d = 0; d < sw; d++) {
          let a = 0, b = 0, c = 0;
          for (let k = wx.start[d]; k < wx.start[d + 1]; k++) {
            const s = 3 * (r * cols + wx.idx[k]), w = wx.wts[k];
            a += glowSrc[s] * w; b += glowSrc[s + 1] * w; c += glowSrc[s + 2] * w;
          }
          const o = 3 * (r * sw + d);
          glowTmp[o] = a; glowTmp[o + 1] = b; glowTmp[o + 2] = c;
        }
      }
      for (let d = 0; d < sh; d++) {                   // along y
        for (let x = 0; x < sw; x++) {
          let a = 0, b = 0, c = 0;
          for (let k = wy.start[d]; k < wy.start[d + 1]; k++) {
            const s = 3 * (wy.idx[k] * sw + x), w = wy.wts[k];
            a += glowTmp[s] * w; b += glowTmp[s + 1] * w; c += glowTmp[s + 2] * w;
          }
          const o = 4 * (d * sw + x);
          glowRGBA[o] = a + 0.5; glowRGBA[o + 1] = b + 0.5; glowRGBA[o + 2] = c + 0.5;
        }
      }
    }

    function updateHud(fps) {
      hud.hidden = !showHud;
      help.hidden = !showHelp;
      if (!showHud) return;
      if (lastHudWorld !== eng.cur) {
        lastHudWorld = eng.cur;
        hudWorlds.textContent = '';
        eng.worlds.forEach((w, i) => {
          const span = doc.createElement('span');
          const on = i === eng.cur;
          span.textContent = (on ? '> ' : '  ') + w.name;
          if (on) span.className = 'is-on';
          hudWorlds.appendChild(span);
        });
      }
      const info = 'ZOOM x10^' + eng.zoomExponent().toFixed(1).padStart(5) + '   ' + PALETTES[eng.palette] + '   ' +
        String(Math.round(fps)).padStart(4) + ' fps   speed ' + speed.toFixed(2) +
        (paused ? '   || PAUSED' : '') + '   [F1] help';
      if (info !== lastInfo) { lastInfo = info; hudInfo.textContent = info; }
    }

    function screenshot() {
      const d = new Date(), z = (v) => String(v).padStart(2, '0');
      const name = 'eye_of_creation_' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' +
        z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()) + '.png';
      try {
        canvas.toBlob((blob) => {
          if (!blob) return;
          const a = doc.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = name;
          doc.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }, 'image/png');
      } catch (e) { /* ignore */ }
    }

    function beginOutro() { if (!outroAt && !done) outroAt = performance.now(); }

    function complete() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      try { renderer.destroy(); } catch (e) { /* ignore */ }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (gate.runtime) gate.runtime.done = true;
      gate.finish();
    }

    function pointerPos(e) {
      const r = overlay.getBoundingClientRect();
      mouse = [e.clientX - r.left, e.clientY - r.top];
    }
    overlay.addEventListener('pointermove', pointerPos, { passive: true });
    overlay.addEventListener('pointerdown', (e) => { pointerPos(e); eng.eye.blink_t = eng.t; });
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());

    function onKey(e) {
      if (done || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key, code = e.code;
      if (code === 'Escape' || k === 'Escape' || code === 'KeyQ') beginOutro();
      else if (code === 'Space' || k === ' ') paused = !paused;
      else if (code === 'ArrowRight' || k === 'ArrowRight') eng.skip();
      else if (code === 'ArrowUp' || k === 'ArrowUp') speed = Math.min(4.0, speed * 1.25);
      else if (code === 'ArrowDown' || k === 'ArrowDown') speed = Math.max(0.1, speed / 1.25);
      else if (k === '+' || k === '=' || code === 'NumpadAdd' || code === 'Equal') {          // smaller glyphs = more detail
        manualFont = Math.max(6, fontSize - 1); rebuild();
      } else if (k === '-' || k === '_' || code === 'NumpadSubtract' || code === 'Minus') {
        manualFont = Math.min(28, fontSize + 1); rebuild();
      }
      else if (code === 'KeyC') eng.palette = (eng.palette + 1) % PALETTES.length;
      else if (code === 'KeyB') useBloom = !useBloom;
      else if (code === 'KeyG') crt = !crt;
      else if (code === 'KeyH') showHud = !showHud;
      else if (code === 'F1' || k === 'F1' || k === '?') showHelp = !showHelp;
      else if (code === 'KeyS') wantShot = true;
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey, true);

    let resizeQueued = false;
    function onResize() {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => { resizeQueued = false; if (!done) rebuild(); });
    }
    window.addEventListener('resize', onResize);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); complete(); });

    const interval = 1000 / CONFIG.FPS;

    function tick(now) {
      if (done) return;
      raf = requestAnimationFrame(tick);
      if (nextDue && now < nextDue - 1.0) return;              // clock.tick(fps): at most FPS frames per second
      nextDue = (nextDue || now) + interval;
      if (nextDue < now) nextDue = now + interval * 0.5;       // fell behind: resync, no bursts
      const real = tPrev ? (now - tPrev) / 1000 : 0;
      let dt = Math.min(real, 0.1);
      tPrev = now;
      wall += Math.min(real, 1.0);
      fpsTimes.push(now); if (fpsTimes.length > 11) fpsTimes.shift();
      const fps = fpsTimes.length > 1 ? 1000 * (fpsTimes.length - 1) / (fpsTimes[fpsTimes.length - 1] - fpsTimes[0]) : 0;

      try {
        // mouse → gaze / God's hand (wanders by itself when idle)
        if (mouse[0] !== lastMouse[0] || mouse[1] !== lastMouse[1]) { idle = 0.0; lastMouse = [mouse[0], mouse[1]]; }
        else idle += dt;
        let tx = (mouse[0] / Math.max(W, 1)) * 2 - 1;
        let ty = -((mouse[1] / Math.max(H, 1)) * 2 - 1);
        if (idle > 3.0) {
          tx = 0.8 * Math.sin(eng.t * 0.37) * Math.cos(eng.t * 0.11);
          ty = 0.7 * Math.sin(eng.t * 0.53 + 1.0);
        }
        tx = tx < -1 ? -1 : tx > 1 ? 1 : tx;
        ty = ty < -1 ? -1 : ty > 1 ? 1 : ty;
        const sx = Math.sin(eng.t * 7.1) * Math.sin(eng.t * 2.3) * 0.03, sy = Math.cos(eng.t * 5.3) * 0.03;
        const ke = Math.min(1.0, dt * 7.0), kh = Math.min(1.0, dt * 2.5);
        eng.eye.gaze[0] += (tx + sx - eng.eye.gaze[0]) * ke;
        eng.eye.gaze[1] += (ty + sy - eng.eye.gaze[1]) * ke;
        eng.creation.hand[0] += (tx - eng.creation.hand[0]) * kh;
        eng.creation.hand[1] += (ty - eng.creation.hand[1]) * kh;

        if (!paused) eng.advance(dt * speed);

        const c0 = performance.now();
        eng.frame(atlas.levels, idx, fg, glowSrc, glowMul);
        const n = eng.n;
        for (let i = 0; i < n; i++) {
          cells[4 * i] = fg[3 * i]; cells[4 * i + 1] = fg[3 * i + 1]; cells[4 * i + 2] = fg[3 * i + 2]; cells[4 * i + 3] = idx[i];
        }
        if (useBloom) shrinkGlow();
        renderer.draw(cells, glowRGBA, { ox: ox, oy: oy, bloom: useBloom, crt: crt, dpr: dpr, glowMul: glowMul,
                                         inkUsed: eng.cur === 0 && CONFIG.EYE_STYLE !== 'original' });
        const cost = performance.now() - c0;
        if (wantShot) { wantShot = false; screenshot(); }
        updateHud(fps);
        if (!gate.started) { gate.started = true; overlay.setAttribute('data-renderer', renderer.kind); }

        // slow device: bigger glyphs (like pressing «-» in the original), only early and a few times
        costEma = costEma ? costEma * 0.9 + cost * 0.1 : cost;
        if (adaptCooldown > 0) adaptCooldown -= dt;
        else if (CONFIG.ADAPTIVE && !manualFont && !outroAt && adaptations < 4 && fontSize < 16) {
          slowFrames = costEma > 45 ? slowFrames + 1 : 0;
          if (slowFrames > 24) { fontBump += 1; adaptations += 1; slowFrames = 0; adaptCooldown = 2.0; costEma = 0; rebuild(); }
        }
      } catch (err) {
        if (window.console) console.error('[intro]', err);
        complete();
        return;
      }

      // one full circle EYE → CREATION → BIG BANG → GALAXY → BLACK HOLE → EYE, then the site
      if (!outroAt && eng.loops >= 1 && eng.t - eng.loopClosedAt >= CONFIG.HOLD_AFTER_LOOP) beginOutro();
      if (!outroAt && wall > CONFIG.MAX_WALL_S) beginOutro();
      if (outroAt) {
        const k = Math.max(0, Math.min(1, (now - outroAt) / CONFIG.FADE_OUT_MS));
        const e = k * k * (3 - 2 * k);
        overlay.style.opacity = String(1 - e);
        if (k >= 1) complete();
      }
    }

    try { rebuild(); } catch (err) {
      if (window.console) console.error('[intro]', err);
      complete();
      return;
    }
    mouse = [W / 2, H / 2]; lastMouse = [W / 2, H / 2];
    raf = requestAnimationFrame(tick);

    // small API for debugging / tests
    gate.runtime = {
      engine: eng, overlay: overlay, renderer: renderer.kind,
      skip: () => eng.skip(), quit: beginOutro,
      state: () => ({ world: eng.world.name, t: eng.t, pt: eng.pt, loops: eng.loops, fontSize: fontSize,
                      cols: eng.cols, rows: eng.rows, outro: !!outroAt, done: done, costMs: costEma })
    };
  }

  /* export (engine is also handy for tests) */
  window.EyeOfCreation = {
    Engine: Engine, RAMP: RAMP, PALETTES: PALETTES, CONFIG: CONFIG, buildAtlas: buildAtlas,
    _hash: _hash, vnoise: vnoise, fbm: fbm
  };

  const gate = window.EyeIntro;
  if (!gate || !gate.active) return;
  gate.attach();
  const boot = () => {
    try { startIntro(gate); } catch (err) {
      if (window.console) console.error('[intro]', err);
      const o = document.querySelector('.eoc-intro');
      if (o && o.parentNode) o.parentNode.removeChild(o);
      gate.finish();
    }
  };
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
