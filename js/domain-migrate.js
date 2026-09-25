// Filmotiv v188: мягкая миграция домена — filmotiv.vercel.app → filmotiv.duckdns.org
//
// ЗАЧЕМ: *.vercel.app живёт на ротационном anycast-пуле {64.29.17.x,216.198.79.x}×
// {3,67,131,195}, который ТСПУ режет по-ISP (подмножества, у каждого провайдера
// своё) — «IP-лотерея». Кастомный домен filmotiv.duckdns.org (A → 76.76.21.21)
// обслуживается С ДРУГОГО пула IP Vercel, чистого из РФ. Посетители, пришедшие
// на СТАРЫЙ хост (старые сообщения бота, закладки), должны быть переведены на
// стабильный домен — но ТОЛЬКО когда цель подтверждённо жива ИЗ ИХ СЕТИ, и
// ТОЛЬКО на входных страницах: НИКОГДА на player/film — редирект там убил бы
// идущее воспроизведение (плеер и так берёт API через ротацию api-origin.js,
// где новый домен стоит первым — контент «переезжает» без смены страницы).
//
// Скрипт no-op, пока filmotiv.duckdns.org не настроен/недоступен.
(function () {
  'use strict';

  var TARGET_ORIGIN = 'https://filmotiv.duckdns.org';

  // Только прод-хостнейм vercel.app — preview-деплои (случайные имена) и
  // сама цель остаются как есть.
  if (window.location.hostname !== 'filmotiv.vercel.app') return;

  // Не мигрируем, если пользователь пришёл с явным намерением остаться
  // (отладка старого хоста): ?nomigrate=1 в URL.
  try {
    if (window.location.search.indexOf('nomigrate=1') !== -1) return;
  } catch (e) { /* continue */ }

  // Максимум один раз за сессию: если цель окажется нестабильной,
  // пинг-понг туда-обратно хуже, чем остаться на месте.
  try {
    if (sessionStorage.getItem('fm_migrated_once')) return;
    sessionStorage.setItem('fm_migrated_once', '1');
  } catch (e) { /* приватный режим — работаем без guard */ }

  // Проба ПОСЛЕ load: эта страница и так открылась с данного origin,
  // спешки нет — не конкурируем с первыми API-вызовами приложения.
  window.addEventListener('load', function () {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { try { ctl && ctl.abort(); } catch (e) {} }, 4000);
    // У Filmotiv нет /api/version (лимит 12 функций) — дешёвая функциональная
    // проба цели: OPTIONS /api/me отвечает 200/204 из первой строки handler'а,
    // без Supabase; CORS-слой отвечает любому origin (ACAO).
    fetch(TARGET_ORIGIN + '/api/me', {
      method: 'OPTIONS',
      cache: 'no-store',
      mode: 'cors',
      signal: ctl ? ctl.signal : undefined
    })
      .then(function (r) {
        clearTimeout(timer);
        if (r.ok || r.status === 204) {
          window.location.replace(
            TARGET_ORIGIN + window.location.pathname +
            window.location.search + window.location.hash
          );
        }
        // иначе — цель отвечает ошибкой, остаёмся здесь
      })
      .catch(function () { clearTimeout(timer); /* цель недоступна — остаёмся */ });
  }, { once: true });
})();
