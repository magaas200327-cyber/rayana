/* ==========================================================================
   Вступительная заставка «Eye of Creation» — управляющий скрипт («шлюз»).
   Подключается в <head> index.html синхронно, ДО первой отрисовки страницы.

   Что делает:
     1. Решает, нужна ли заставка: она показывается при первом открытии сайта
        (в каждой новой вкладке/сессии). При переходах внутри сайта
        («← Назад», «В начало», кнопка «Назад» браузера) и после того как заставка
        уже была досмотрена в этой вкладке, сразу открывается главная страница.
     2. Пока идёт заставка (класс html.eoc-active), главная страница полностью скрыта
        (display:none в intro/eye-of-creation.css), её фоновое видео стоит на паузе,
        а её собственная анимация частиц ждёт.
     3. После окончания заставки (EyeIntro.finish()) главная страница открывается так же,
        как при обычной загрузке: плавное появление, видеофон, частицы, кнопка.

   Принудительно показать заставку:  index.html?intro      Отключить:  index.html?intro=0
   Сама анимация — intro/eye-of-creation.js, стили — intro/eye-of-creation.css.
   ========================================================================== */
(function () {
  'use strict';

  // false -> заставка играет всегда (как и остальные анимации сайта: RESPECT_REDUCED_MOTION = false)
  // true  -> её пропускают те, у кого в системе включено «уменьшение движения»
  var RESPECT_REDUCED_MOTION = false;

  var KEY = 'eye-of-creation-intro-seen';
  var root = document.documentElement;
  var callbacks = [];

  var api = {
    active: false,     // true, пока идёт заставка (главная страница скрыта)
    attached: false,   // анимация (eye-of-creation.js) загрузилась и взяла показ на себя
    /* fn вызывается, когда главную страницу можно запускать (сразу, если заставки нет) */
    onFinish: function (fn) {
      if (typeof fn !== 'function') return;
      if (api.active) callbacks.push(fn); else fn();
    },
    attach: function () { api.attached = true; },
    finish: finish
  };
  window.EyeIntro = api;

  function param() {
    try { return new URLSearchParams(window.location.search).get('intro'); } catch (e) { return null; }
  }

  function alreadySeen() {
    try { return window.sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  function navigationType() {
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav && nav.type) return nav.type;
    } catch (e) { /* ignore */ }
    try { if (performance.navigation && performance.navigation.type === 2) return 'back_forward'; } catch (e) { /* ignore */ }
    return 'navigate';
  }

  /* пришли с другой страницы этого же сайта (та же папка на том же сервере)? */
  function cameFromThisSite() {
    var ref = document.referrer;
    if (!ref) return false;
    try {
      var from = new URL(ref), here = new URL(window.location.href);
      if (from.protocol !== here.protocol || from.host !== here.host) return false;
      var dir = function (p) { return p.slice(0, p.lastIndexOf('/') + 1); };
      return dir(from.pathname) === dir(here.pathname);
    } catch (e) { return false; }
  }

  function shouldPlay() {
    var p = param();
    if (p === '0' || p === 'off' || p === 'false') return false;
    var forced = p !== null;
    if (!forced) {
      if (RESPECT_REDUCED_MOTION && window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      if (alreadySeen()) return false;
      if (navigationType() === 'back_forward') return false;
      if (cameFromThisSite()) return false;
    }
    var test = document.createElement('canvas');
    return !!(test && test.getContext);
  }

  function video() { return document.querySelector('.landing-bg-video'); }

  /* Конец заставки: открываем прежнюю главную страницу «с нуля» */
  function finish() {
    if (!api.active) return;
    api.active = false;
    try { window.sessionStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }

    // 1) слои главной страницы снова видимы — их CSS-анимации стартуют с начала
    root.classList.remove('eoc-active');

    // 2) повторяем собственное плавное появление страницы (body.page-enter → landingPageFade)
    var body = document.body;
    if (body && body.classList.contains('page-enter')) {
      body.classList.remove('page-enter');
      void body.offsetWidth;                 // перезапуск CSS-анимации
      body.classList.add('page-enter');
    }

    // 3) фоновое видео
    var v = video();
    if (v) {
      try {
        v.muted = true;
        var pr = v.play();
        if (pr && pr.catch) pr.catch(function () { /* ignore */ });
      } catch (e) { /* ignore */ }
    }

    // 4) отложенный запуск главной страницы (частицы → кнопка)
    var list = callbacks.splice(0, callbacks.length);
    for (var i = 0; i < list.length; i++) {
      try { list[i](); } catch (e) { if (window.console) console.error(e); }
    }
  }

  if (!shouldPlay()) return;

  api.active = true;
  root.classList.add('eoc-active');

  // Пока идёт заставка, фоновое видео главной страницы не играет (оно спокойно подгружается)
  document.addEventListener('play', function (event) {
    var el = event.target;
    if (api.active && el && el.classList && el.classList.contains('landing-bg-video')) {
      try { el.pause(); } catch (e) { /* ignore */ }
    }
  }, true);

  // Страховка: если скрипт анимации не загрузился, главная страница открывается сразу
  document.addEventListener('DOMContentLoaded', function () {
    if (api.active && !api.attached) finish();
  });
})();
