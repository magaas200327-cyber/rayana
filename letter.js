/* ==========================================================================
   message.html — кнопка из частиц → конверт → письмо.

   Частицы: тот же алгоритм, что в index.html (контур вокруг кнопки + «пыль» внутри, те же спрайты,
   те же тайминги). Отличия: после появления кнопки контур не гаснет, а переходит в спокойный режим
   (дыхание света, редкие частицы), а при нажатии разлетается светящимся шлейфом.
   Конверт/письмо анимируются через Web Animations API (element.animate): такие анимации не зависят
   от общего правила prefers-reduced-motion в style.css, поэтому ведут себя одинаково у всех.
   ========================================================================== */
(() => {
  'use strict';

  // false -> анимация играет всегда (как на первой странице, там то же значение)
  // true  -> при включённом в системе «уменьшении движения» всё показывается сразу, без анимации
  const RESPECT_REDUCED_MOTION = false;

  const root = document.documentElement;
  const body = document.body;
  const $ = (id) => document.getElementById(id);

  const video = document.querySelector('.bg-dance-video');
  const canvas = $('letterParticles');
  const gate = $('gate'), button = $('openLetter');
  const scene = $('scene'), rig = $('rig'), halo = $('letterHalo');
  const envBack = $('envBack'), envFront = $('envFront'), envFlap = $('envFlap');
  const envGlow = $('envGlow'), envShadow = $('envShadow'), envSeal = $('envSeal');
  const sheet = $('sheet'), paper = $('sheetPaper'), creases = sheet.querySelector('.sheet-creases');
  const text = $('letterText');
  const actions = $('letterActions'), again = $('again');

  const FAST = RESPECT_REDUCED_MOTION && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const D = (ms) => (FAST ? 1 : ms);

  /* ---------- фоновое видео: гарантируем воспроизведение ---------- */
  if (video) {
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    const tryPlay = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };
    tryPlay();
    video.addEventListener('loadeddata', tryPlay);
    ['pointerdown', 'keydown', 'touchstart'].forEach((t) =>
      window.addEventListener(t, tryPlay, { once: true, passive: true }));
  }

  /* ---------- навигация со сценическим переходом (как на первой странице) ---------- */
  actions.querySelectorAll('a[href]').forEach((a) => a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    if (body.classList.contains('page-leaving')) return;
    body.classList.add('page-leaving');
    window.setTimeout(() => { window.location.href = a.href; }, 650);
  }));

  /* ==========================================================================
     Движок частиц
     ========================================================================== */
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const easeInOut = (p) => (p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  // тайминги вступления — те же, что в index.html
  const TRAVEL_MS = 2300, MAX_DELAY = 750, TRACE_FROM = 500, TRACE_MS = 2300;
  const REVEAL_AT = 3200, FADE_MS = 1300;
  const OUTLINE_PTS = 560, FILL_PTS = 260, PAD = 9;

  const PALETTE = [[255, 224, 160], [255, 246, 220], [220, 174, 255], [255, 255, 255]];
  const sprites = PALETTE.map(([r, g, b]) => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(.16, `rgba(${r},${g},${b},.92)`);
    grad.addColorStop(.42, `rgba(${r},${g},${b},.30)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = grad; x.fillRect(0, 0, 64, 64);
    return c;
  });

  let w = 0, h = 0, dpr = 1;
  let mode = 'off';            // gate | burst | envelope | letter | off
  let raf = 0, last = 0;
  let dots = [], outline = [], motes = [];
  let introAt = 0, revealed = false, gateReady = false, fallbackTimer = 0, breathTimer = 0;
  let emitAcc = 0;

  function measureButton() {      // геометрия по layout (offset*), как в index.html: скрытая кнопка трансформирована CSS
    let x = 0, y = 0, el = button;
    while (el) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    return { left: x - window.scrollX, top: y - window.scrollY, width: button.offsetWidth, height: button.offsetHeight };
  }

  function makeOutline(rect, count) {
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const r = rect.height / 2 + PAD;
    const half = Math.max(0, rect.width / 2 - rect.height / 2);
    const straight = half * 2, arc = Math.PI * r, total = straight * 2 + arc * 2;
    const pts = [];
    for (let i = 0; i < count; i++) {
      let s = (i / count) * total;
      if (s < straight) { pts.push({ x: cx - half + s, y: cy - r }); continue; }
      s -= straight;
      if (s < arc) { const a = -Math.PI / 2 + s / r; pts.push({ x: cx + half + r * Math.cos(a), y: cy + r * Math.sin(a) }); continue; }
      s -= arc;
      if (s < straight) { pts.push({ x: cx + half - s, y: cy + r }); continue; }
      s -= straight;
      const a = Math.PI / 2 + s / r;
      pts.push({ x: cx - half + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function retarget() {
    if (!dots.length) return;
    const rect = measureButton();
    outline = makeOutline(rect, OUTLINE_PTS);
    dots.forEach((p, i) => {
      if (p.contour) { p.tx = outline[i % outline.length].x; p.ty = outline[i % outline.length].y; }
      else { p.tx = rect.left + p.fx * rect.width; p.ty = rect.top + p.fy * rect.height; }
    });
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = root.clientWidth || window.innerWidth;
    h = root.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    retarget();
  }

  function buildDots() {
    dots = [];
    const total = OUTLINE_PTS + FILL_PTS;
    for (let i = 0; i < total; i++) {
      const outside = Math.random() < .3;
      const sx = outside ? (Math.random() < .5 ? rand(-60, 0) : rand(w, w + 60)) : rand(0, w);
      const sy = outside ? rand(-60, h + 60) : rand(0, h);
      dots.push({
        sx, sy, tx: 0, ty: 0, cx: sx, cy: sy,
        contour: i < OUTLINE_PTS, fx: rand(.06, .94), fy: rand(.14, .86),
        delay: rand(0, MAX_DELAY), size: rand(1.1, 2.4),
        phase: rand(0, TAU), swirl: rand(30, 130), speed: rand(.0016, .0038),
        sprite: i < OUTLINE_PTS ? sprites[Math.random() < .62 ? 0 : 1] : sprites[Math.floor(Math.random() * sprites.length)],
        twinkle: rand(.0045, .009)
      });
    }
    retarget();
  }

  /* ---- «мотыльки»: свободные частицы (шлейф, искры вокруг конверта и письма) ---- */
  function addMote(o) {
    if (motes.length > 900) return;
    motes.push(Object.assign({
      x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 2, size: 1.6, alpha: 1, phase: rand(0, TAU),
      sprite: sprites[Math.floor(Math.random() * sprites.length)], sway: 0, trail: false,
      tx: null, ty: null, k: 0, attractAt: 0, fade: 'sin'
    }, o));
  }

  function rectPoint(r, outward) {          // случайная точка на периметре прямоугольника, смещённая наружу
    const per = (r.width + r.height) * 2;
    let s = Math.random() * per, x, y;
    if (s < r.width) { x = r.left + s; y = r.top; }
    else if ((s -= r.width) < r.height) { x = r.right; y = r.top + s; }
    else if ((s -= r.height) < r.width) { x = r.right - s; y = r.bottom; }
    else { s -= r.width; x = r.left; y = r.bottom - s; }
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1;
    return { x: x + dx / l * outward, y: y + dy / l * outward };
  }

  function emit(dt) {
    let rate = 0, region = null, outward = [4, 26];
    if (mode === 'gate' && revealed) {              // спокойный режим кнопки: редкие частицы у контура
      rate = 3.2;
      const r = measureButton();
      region = { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height, width: r.width, height: r.height };
      outward = [8, 34];
    } else if (mode === 'envelope') {
      rate = 20; const b = scene.getBoundingClientRect(); region = b; outward = [-4, 30];
    } else if (mode === 'letter') {
      rate = 5.5; const b = sheet.getBoundingClientRect(); region = b; outward = [2, 34];
    }
    if (!rate || !region || region.width < 10) return;
    emitAcc += rate * dt;
    while (emitAcc >= 1) {
      emitAcc -= 1;
      const p = rectPoint(region, rand(outward[0], outward[1]));
      addMote({
        x: p.x, y: p.y, vx: rand(-6, 6), vy: -rand(10, 34), life: rand(2.6, 5.2),
        size: rand(.9, 2.1), alpha: rand(.55, .95), sway: rand(6, 20),
        sprite: sprites[Math.random() < .55 ? 0 : Math.floor(Math.random() * sprites.length)]
      });
    }
  }

  function updateMotes(dt, now) {
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.age += dt;
      if (m.age >= m.life) { motes.splice(i, 1); continue; }
      if (m.tx !== null && m.age > m.attractAt) {
        m.vx = m.vx * (1 - 2.4 * dt) + (m.tx - m.x) * m.k * dt;
        m.vy = m.vy * (1 - 2.4 * dt) + (m.ty - m.y) * m.k * dt;
      }
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.sway) m.x += Math.sin(now * .0012 + m.phase) * m.sway * dt;
      const u = m.age / m.life;
      const env = m.fade === 'out' ? Math.pow(1 - u, 1.3) : Math.sin(Math.PI * u);
      const a = clamp(env * m.alpha * (.8 + .2 * Math.sin(now * .01 + m.phase)), 0, 1);
      if (a < .01) continue;
      const s = m.size * 2.7;
      if (m.trail) {
        for (let j = 4; j >= 1; j--) {
          ctx.globalAlpha = a * (1 - j / 5) * .55;
          const ts = s * (1 - j * .13);
          ctx.drawImage(m.sprite, m.x - m.vx * .02 * j - ts, m.y - m.vy * .02 * j - ts, ts * 2, ts * 2);
        }
      }
      ctx.globalAlpha = a;
      ctx.drawImage(m.sprite, m.x - s, m.y - s, s * 2, s * 2);
    }
  }

  function drawDots(now) {
    if (!introAt) introAt = now;
    const elapsed = now - introAt;
    const calm = clamp((elapsed - REVEAL_AT) / FADE_MS, 0, 1);       // 0 -> вступление, 1 -> спокойный режим
    const breath = .86 + .14 * Math.sin(now * .0023);

    for (const p of dots) {
      const t = clamp((elapsed - p.delay) / TRAVEL_MS, 0, 1);
      const e = easeInOut(t);
      const drift = (1 - e) * p.swirl;
      const a = p.phase + now * p.speed;
      const x = p.sx + (p.tx - p.sx) * e + Math.cos(a) * drift + (t >= 1 ? Math.cos(a * 3) * .7 : 0);
      const y = p.sy + (p.ty - p.sy) * e + Math.sin(a) * drift + (t >= 1 ? Math.sin(a * 3) * .7 : 0);
      p.cx = x; p.cy = y;
      const pulse = .72 + .28 * Math.sin(now * p.twinkle + p.phase);
      let alpha = p.contour
        ? (.30 + .42 * t) * (1 - .42 * calm) * (calm ? breath : 1)
        : .85 * (1 - clamp((t - .7) / .3, 0, 1) * .9) * (1 - calm);
      alpha *= pulse;
      if (alpha < .004) continue;
      const s = p.size * (p.contour ? 2.9 : 3.4);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.drawImage(p.sprite, p.cx - s, p.cy - s, s * 2, s * 2);
    }

    // светящийся контур вокруг кнопки
    const trace = clamp((elapsed - TRACE_FROM) / TRACE_MS, 0, 1);
    const shown = Math.floor(outline.length * trace);
    if (shown > 1) {
      const closed = trace >= 1;
      const glow = (.75 + .25 * Math.sin(now * .006)) * (1 - calm) + (.62 + .38 * Math.sin(now * .0022)) * .55 * calm;
      const k = 1 - .35 * calm;
      ctx.lineJoin = ctx.lineCap = 'round';
      const path = () => {
        ctx.beginPath(); ctx.moveTo(outline[0].x, outline[0].y);
        for (let i = 1; i < shown; i++) ctx.lineTo(outline[i].x, outline[i].y);
        if (closed) ctx.closePath();
      };
      ctx.globalAlpha = 1;
      path(); ctx.lineWidth = 8; ctx.strokeStyle = `rgba(243,207,133,${.09 * k})`; ctx.stroke();
      path(); ctx.lineWidth = 3.4; ctx.strokeStyle = `rgba(255,205,125,${.20 * k})`; ctx.stroke();
      path(); ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(255,232,185,${.85 * glow})`; ctx.stroke();

      const sparks = Math.round(12 - 8 * calm);          // искры, бегущие по контуру (в спокойном режиме — реже и медленнее)
      const speed = .16 - .1 * calm;
      for (let i = 0; i < sparks; i++) {
        const idx = Math.floor((elapsed * speed + i * outline.length / sparks) % shown);
        const q = outline[idx];
        ctx.globalAlpha = 1 - .35 * calm;
        ctx.drawImage(sprites[1], q.x - 11, q.y - 11, 22, 22);
      }
    }

    // мягкое «дыхание» света за кнопкой
    if (calm > 0) {
      const r = measureButton();
      const gw = r.width * 1.05, gh = r.height * 2.6;
      ctx.globalAlpha = calm * (.10 + .07 * Math.sin(now * .0021));
      ctx.drawImage(sprites[0], r.left + r.width / 2 - gw, r.top + r.height / 2 - gh, gw * 2, gh * 2);
    }

    if (!revealed && elapsed >= REVEAL_AT) reveal();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, (now - (last || now)) / 1000);
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    if (dots.length) drawDots(now);
    emit(dt);
    updateMotes(dt, now);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function setMode(m) {
    mode = m;
    emitAcc = 0;
    if (!ctx || FAST) return;
    if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  }

  function sceneCenter() {
    const b = scene.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }

  /* нажатие: контур и «пыль» разлетаются, часть частиц затем стекается к месту конверта (шлейф) */
  function burst() {
    if (!ctx || FAST) return;
    const r = measureButton();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const target = sceneCenter();
    let n = 0;
    for (const p of dots) {
      if (!p.contour && Math.random() < .5) continue;
      const ang = Math.atan2(p.cy - cy, p.cx - cx) + rand(-.4, .4);
      const sp = rand(70, 300) * (p.contour ? 1 : .6);
      const pull = Math.random() < .45;
      addMote({
        x: p.cx, y: p.cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - rand(0, 30),
        life: pull ? rand(1.8, 2.7) : rand(1.0, 2.0), size: p.size * (p.contour ? 1.05 : 1.2),
        sprite: p.sprite, trail: (n++ % 3) === 0, fade: pull ? 'sin' : 'out',
        tx: pull ? target.x + rand(-50, 50) : null, ty: pull ? target.y + rand(-30, 30) : null,
        k: rand(2.5, 5), attractAt: rand(.35, .7)
      });
    }
    for (let i = 0; i < 90; i++) {                      // яркие искры из центра кнопки
      const ang = rand(0, TAU), sp = rand(120, 420);
      addMote({
        x: r.left + rand(.1, .9) * r.width, y: r.top + rand(.2, .8) * r.height,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 20, life: rand(.8, 1.6), size: rand(1.2, 2.6),
        sprite: sprites[Math.random() < .5 ? 1 : 0], trail: true, fade: 'out'
      });
    }
    dots = []; outline = [];
    setMode('burst');
  }

  /* ---------- вступление: кнопка появляется из частиц ---------- */
  function reveal() {
    if (revealed) return;
    revealed = true; gateReady = true;
    button.classList.add('is-visible');
    root.classList.remove('js-intro');
    if (!FAST) startBreathing();
  }

  let breathAnim = null;
  function startBreathing() {
    if (breathAnim) breathAnim.cancel();
    breathAnim = button.animate([
      { boxShadow: '0 0 22px rgba(232,194,122,.42), 0 0 48px rgba(205,160,230,.16)' },
      { boxShadow: '0 0 38px rgba(255,230,177,.85), 0 0 92px rgba(205,160,230,.42)' }
    ], { duration: 2600, delay: 1300, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    live.add(breathAnim);
  }

  function startGate() {
    cancelAnimationFrame(raf); raf = 0; clearTimeout(fallbackTimer);
    resetScene();
    gate.getAnimations().concat(button.getAnimations()).forEach((a) => a.cancel());
    gate.style.visibility = ''; gate.style.pointerEvents = '';
    button.disabled = false; button.removeAttribute('aria-disabled');
    button.classList.remove('is-visible');
    revealed = false; gateReady = false; introAt = 0; motes = []; state = 'gate';
    actions.classList.remove('is-ready');
    again.disabled = true;
    if (!ctx || FAST) { dots = []; revealed = false; reveal(); return; }
    root.classList.add('js-intro');
    resizeCanvas();
    buildDots();
    setMode('gate');
    // страховка (например, фоновая вкладка, где rAF приостановлен): кнопка не должна остаться скрытой
    fallbackTimer = window.setTimeout(() => { if (!revealed) reveal(); }, REVEAL_AT + FADE_MS + 1500);
  }

  /* ==========================================================================
     Конверт и письмо
     ========================================================================== */
  const live = new Set();                      // все созданные анимации — чтобы сбросить сцену целиком
  const anim = (el, frames, ms, easing = 'ease', delay = 0) => {
    const a = el.animate(frames, { duration: D(ms), delay: D(delay), easing, fill: 'both' });
    live.add(a);
    return a.finished.then(() => a, () => a);
  };

  let state = 'gate';                          // gate | opening | read
  let busy = false, runId = 0;
  let geo = null;                              // размеры, посчитанные в prepareScene()

  const T = (y, s, rz = 0, rx = 0) => `translate(-50%, ${y}px) rotateX(${rx}deg) rotateZ(${rz}deg) scale(${s})`;
  const clip = (cut) => `inset(0px 0px ${Math.max(0, cut)}px 0px round 3px)`;

  function finalY() { return scene.offsetHeight / 2 - sheet.offsetHeight / 2; }

  /* исходное состояние: сложенное письмо спрятано внутри закрытого конверта */
  function prepareScene() {
    const ew = scene.offsetWidth, eh = scene.offsetHeight;
    const sw = sheet.offsetWidth, sh = sheet.offsetHeight;
    const s0 = Math.min(1, (ew * .84) / sw);
    const foldedLocal = (eh * .62) / s0;                 // видимая высота сложенного листа (в пикселях листа)
    const cut = Math.max(0, sh - foldedLocal);
    const visH = (sh - cut) * s0;
    geo = { ew, eh, sw, sh, s0, cut, yIn: eh * .12, yUp: -visH - eh * .10, dy: 0 };
    // запас сверху: открытый клапан и поднятый лист не должны уходить за край экрана
    const r = scene.getBoundingClientRect(), vh = root.clientHeight || window.innerHeight;
    const need = 66 - (r.top + geo.yUp - 10);
    geo.dy = Math.round(Math.max(0, Math.min(need, vh - 150 - r.bottom)));
    sheet.style.zIndex = '3';
    sheet.style.transform = T(geo.yIn, s0);
    paper.style.clipPath = clip(cut);
    creases.style.opacity = '1';
  }

  function resetScene() {
    live.forEach((a) => { try { a.cancel(); } catch (e) { /* ignore */ } });
    live.clear(); breathAnim = null;
    [rig, envBack, envFront, envFlap, envGlow, envShadow, envSeal, sheet, paper, creases, halo, scene]
      .forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    scene.classList.remove('is-on', 'is-read');
    envFlap.classList.remove('is-open');
    text.classList.remove('is-shown');
    sheet.style.cssText = ''; paper.style.cssText = ''; creases.style.cssText = '';
    [envBack, envFront, envFlap, envGlow, envShadow].forEach((el) => { el.style.visibility = ''; });
    paper.scrollTop = 0;
    prepareScene();
  }

  /* оборачиваем слова в <span class="w">, чтобы проявлять текст по строкам */
  function wrapWords(el) {
    if (el.dataset.wrapped) return;
    el.dataset.wrapped = '1';
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const sp = document.createElement('span'); sp.className = 'w'; sp.textContent = part; frag.appendChild(sp);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(el);
  }

  function revealText() {
    const blocks = [...text.querySelectorAll('[data-rv]')];
    blocks.forEach(wrapWords);
    let delay = 150;
    const jobs = [];
    const deco = [...text.querySelectorAll('[data-deco]')];
    const fadeIn = [{ opacity: 0 }, { opacity: 1 }];
    if (deco[0]) jobs.push(anim(deco[0], fadeIn, 900, 'ease-out', 0));
    blocks.forEach((block, bi) => {
      const words = [...block.querySelectorAll('.w')];
      const lines = [];
      words.forEach((wd) => {
        const top = Math.round(wd.offsetTop / 6);
        const cur = lines[lines.length - 1];
        if (cur && cur.top === top) cur.words.push(wd); else lines.push({ top, words: [wd] });
      });
      lines.forEach((ln) => {
        ln.words.forEach((wd, i) => jobs.push(anim(wd,
          [{ opacity: 0, transform: 'translateY(9px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' }],
          bi === 0 ? 900 : 760, 'ease-out', delay + i * 26)));
        delay += bi === 0 ? 300 : 380;                  // строка за строкой
      });
      if (bi === 0) {
        if (deco[1]) jobs.push(anim(deco[1], fadeIn, 900, 'ease-out', delay));
        delay += 520;                                   // пауза после приветствия
      }
    });
    return Promise.all(jobs);
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, D(ms)));

  async function run(fromGate) {
    if (busy) return;
    busy = true; state = 'opening';
    const my = ++runId;
    const alive = () => my === runId;
    const guard = () => { if (!alive()) throw new Error('aborted'); };

    try {
      actions.classList.remove('is-ready');
      again.disabled = true;

      /* ---- Этап 1. Реакция на нажатие ---- */
      if (fromGate) {
        gateReady = false;
        button.disabled = true; button.setAttribute('aria-disabled', 'true');
        if (breathAnim) { breathAnim.cancel(); breathAnim = null; }
        const flash = anim(button, [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.07)', filter: 'brightness(1.4)',
            boxShadow: '0 0 54px rgba(255,238,200,1), 0 0 130px rgba(215,170,255,.7)' }
        ], 300, 'ease-out');
        await wait(130); guard();
        burst();                                          // частицы расходятся, образуя шлейф
        await flash; guard();
        const dissolve = [
          anim(button, [
            { opacity: 1, transform: 'scale(1.07)', filter: 'brightness(1.4) blur(0px)', boxShadow: '0 0 54px rgba(255,238,200,1), 0 0 130px rgba(215,170,255,.7)' },
            { opacity: 0, transform: 'scale(.88)', filter: 'brightness(1.1) blur(7px)', boxShadow: '0 0 0 rgba(255,238,200,0)' }
          ], 800, 'ease-in'),
          anim(gate, [{ opacity: 1 }, { opacity: 0 }], 800, 'ease-in')
        ];
        await wait(520); guard();
        // (конверт появляется, пока кнопка ещё растворяется)
        void dissolve;
      } else {
        // «Читать ещё раз»: письмо мягко гаснет, затем сцена собирается заново
        await anim(scene, [{ opacity: 1 }, { opacity: 0 }], 650, 'ease-in'); guard();
        resetScene();
      }

      /* ---- Этап 2. Появление закрытого конверта ---- */
      prepareScene();
      scene.classList.add('is-on');
      setMode('envelope');
      const tiltRest = `translateY(${geo.dy}px) rotateX(18deg) rotateY(-6deg) scale(1)`;
      await Promise.all([
        anim(rig, [
          { opacity: 0, transform: `translateY(${geo.dy + 34}px) rotateX(26deg) rotateY(-10deg) scale(.86)`, filter: 'blur(9px)' },
          { opacity: 1, transform: tiltRest, filter: 'blur(0px)' }
        ], 1250, 'cubic-bezier(.2,.8,.2,1)'),
        anim(envShadow, [{ opacity: 0 }, { opacity: .7 }], 1250)
      ]);
      guard();
      await wait(350); guard();
      anim(envSeal.firstElementChild, [
        { transform: 'scale(1)', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.6))' },
        { transform: 'scale(1.14)', filter: 'drop-shadow(0 0 16px rgba(255,200,120,.95))', offset: .45 },
        { transform: 'scale(1)', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,.6))' }
      ], 950, 'ease-in-out');
      await wait(700); guard();

      /* ---- Этап 3. Конверт приподнимается, поворачивается к зрителю, открывается клапан ---- */
      const lifted = `translateY(${geo.dy - 14}px) rotateX(0deg) rotateY(0deg) scale(1.04)`;
      await Promise.all([
        anim(rig, [{ transform: tiltRest }, { transform: lifted }], 1100, 'ease-in-out'),
        anim(envShadow, [{ transform: 'scale(1)', opacity: .7 }, { transform: 'scale(1.14)', opacity: .45 }], 1100, 'ease-in-out')
      ]);
      guard();
      await wait(150); guard();

      anim(envGlow, [{ opacity: 0 }, { opacity: .95 }], 900, 'ease-out');
      await anim(envFlap, [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)' }], 520, 'cubic-bezier(.5,0,.8,.6)'); guard();
      envFlap.classList.add('is-open');                   // на ребре: меняем лицевую сторону на внутреннюю и слой клапана
      await anim(envFlap, [{ transform: 'rotateX(-90deg)' }, { transform: 'rotateX(-180deg)' }], 760, 'cubic-bezier(.2,.7,.3,1)'); guard();
      await wait(250); guard();

      /* ---- Лист поднимается из конверта ---- */
      await Promise.all([
        anim(sheet, [
          { transform: T(geo.yIn, geo.s0, 0) },
          { transform: T(geo.yIn + (geo.yUp - geo.yIn) * .55, geo.s0, -1.2), offset: .55 },
          { transform: T(geo.yUp, geo.s0, .6) }
        ], 1600, 'cubic-bezier(.45,.05,.25,1)'),
        anim(envGlow, [{ opacity: .95 }, { opacity: .45 }], 1600)
      ]);
      guard();
      sheet.style.zIndex = '6';                           // лист полностью вышел — теперь он поверх конверта
      await wait(120); guard();

      /* ---- Лист выходит на центр и разворачивается ---- */
      geo.sh = sheet.offsetHeight;
      const fy = finalY();
      const U = 2000;
      anim(halo, [{ opacity: 0 }, { opacity: 1 }], 1800, 'ease-out', 500);
      await Promise.all([
        anim(sheet, [{ transform: T(geo.yUp, geo.s0, .6, 0) }, { transform: T(fy, 1, 0, 0) }], U, 'cubic-bezier(.45,.05,.2,1)'),
        anim(paper, [{ clipPath: clip(geo.cut) }, { clipPath: clip(0) }], U, 'cubic-bezier(.55,0,.2,1)'),
        anim(creases, [{ opacity: 1 }, { opacity: .35 }], U, 'ease-in-out', 300),
        anim(rig, [{ transform: lifted }, { transform: 'translateY(0px) rotateX(0deg) rotateY(0deg) scale(1)' }], U, 'ease-in-out'),
        ...[envBack, envFront, envFlap, envGlow, envShadow].map((el) =>
          anim(el, [{ opacity: el === envShadow ? .45 : el === envGlow ? .45 : 1 }, { opacity: 0 }], 1100, 'ease-in', 250))
      ]);
      guard();

      // фиксируем конечное состояние обычными стилями, анимации листа снимаем
      scene.classList.add('is-read');
      sheet.style.zIndex = '6';
      sheet.style.transform = T(finalY(), 1);
      paper.style.clipPath = 'none';
      creases.style.opacity = '.35';
      [envBack, envFront, envFlap, envGlow, envShadow].forEach((el) => { el.style.visibility = 'hidden'; });
      [rig, envBack, envFront, envFlap, envGlow, envShadow, sheet, paper, creases].forEach((el) =>
        el.getAnimations().forEach((a) => { live.delete(a); a.cancel(); }));
      state = 'read';
      setMode('letter');
      // мягкое дыхание света вокруг письма
      const breathHalo = halo.animate([{ opacity: 1 }, { opacity: .62 }],
        { duration: 4200, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
      live.add(breathHalo);

      /* ---- Этап 4. Проявление текста ---- */
      await wait(250); guard();
      await revealText(); guard();
      text.classList.add('is-shown');
      text.querySelectorAll('.w').forEach((wd) => wd.getAnimations().forEach((a) => { live.delete(a); a.cancel(); }));

      actions.classList.add('is-ready');
      again.disabled = false;
    } catch (err) {
      if (!(err && err.message === 'aborted')) console.error(err);
    } finally {
      if (runId === my) busy = false;
    }
  }

  /* ---------- события ---------- */
  button.addEventListener('click', () => {
    if (!gateReady || busy || state !== 'gate') return;
    run(true);
  });
  again.addEventListener('click', () => {
    if (busy || state !== 'read') return;
    run(false);
  });

  window.addEventListener('resize', () => {
    if (ctx) resizeCanvas();
    if (state === 'read') { sheet.style.transform = T(finalY(), 1); }
    else if (state === 'gate' && !busy) { prepareScene(); }
  }, { passive: true });
  window.addEventListener('load', () => { if (state === 'gate') retarget(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { busy = false; runId++; startGate(); } });

  text.querySelectorAll('[data-rv]').forEach(wrapWords);
  startGate();
})();
