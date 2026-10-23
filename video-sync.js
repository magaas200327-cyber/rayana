/* Непрерывность фонового видео между страницами.
   Переход между HTML-страницами всегда создаёт новый <video>, поэтому перед уходом мы запоминаем
   позицию воспроизведения (sessionStorage), а на новой странице продолжаем примерно с того же кадра.
   Если что-то не работает (приватный режим, нет sessionStorage) — видео просто играет с начала. */
(() => {
  'use strict';
  const KEY = 'surprise-video-sync';
  const MAX_AGE_S = 20;                      // старые отметки игнорируем
  const video = document.querySelector('.bg-dance-video');
  if (!video) return;

  let saved = null, restored = false;
  try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }

  const save = () => {
    const t = video.currentTime;
    if (!isFinite(t)) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ t, at: Date.now() })); } catch (e) { /* ignore */ }
  };

  const restore = () => {
    if (restored || !saved) return;
    const d = video.duration, age = (Date.now() - saved.at) / 1000;
    if (!d || !isFinite(d) || age < 0 || age > MAX_AGE_S) return;
    restored = true;
    try { video.currentTime = (saved.t + age) % d; } catch (e) { /* ignore */ }
  };

  if (video.readyState >= 1) restore();
  else video.addEventListener('loadedmetadata', restore, { once: true });

  video.addEventListener('timeupdate', save);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('a[href]')) save();
  }, true);
})();
