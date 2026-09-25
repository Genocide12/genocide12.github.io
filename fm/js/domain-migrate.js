// Filmotiv v189: автоматическая переадресация на filmotiv.duckdns.org
//
// ЗАЧЕМ: *.vercel.app живёт на ротационном anycast-пуле {64.29.17.x,216.198.79.x}×
// {3,67,131,195}, который ТСПУ режет по-ISP (подмножества, у каждого провайдера
// своё) — «IP-лотерея». Кастомный домен filmotiv.duckdns.org (A → 76.76.21.21)
// обслуживается С ДРУГОГО пула IP Vercel, чистого из РФ.
//
// ДВА ВХОДА переадресации (оба — только когда цель подтверждённо жива ИЗ
// СЕТИ ПОЛЬЗОВАТЕЛЯ, и НИКОГДА на player/film — редирект убил бы воспроизведение):
//   1) filmotiv.vercel.app — старые закладки/сообщения бота: мягкий переезд
//      на стабильный домен (одна попытка за сессию).
//   2) genocide12.github.io (зеркало) — зеркало открылось = верcel-хосты из
//      сети пользователя недоступны или ненадёжны. Если при этом duckdns жив
//      — уводим на него: там полноценное приложение с same-origin API.
//      Если duckdns тоже заблокирован — остаёмся на зеркале (оно работает
//      через кросс-доменную ротацию API).
//
// ВАЖНО: если vercel.app НЕ ОТКРЫЛСЯ ВОВСЕ (TCP/TLS заблокирован), JS на той
// странице не выполняется — этот скрипт там бесполезен. Такой случай ловится
// отсюда (зеркало) и из watchRedirect() в api-origin.js. Поэтому вход для
// заблокированных: genocide12.github.io или сам filmotiv.duckdns.org.
//
// Выход для отладки: ?nomigrate=1 в URL.
(function () {
  'use strict';

  var TARGET_ORIGIN = 'https://filmotiv.duckdns.org';
  var host = '';
  try { host = window.location.hostname || ''; } catch (e) { return; }

  var isVercelProd = host === 'filmotiv.vercel.app';

  // v192-fm: зеркало GitHub Pages — ОТДЕЛЬНЫЙ САЙТ (решение владельца):
  // никакой авто-переадресации с genocide12.github.io/fm/ на duckdns.
  // Миграция работает только на filmotiv.vercel.app (старые закладки).
  if (!isVercelProd) return;

  // Не переадресуем, если пользователь пришёл с явным намерением остаться.
  try {
    if (window.location.search.indexOf('nomigrate=1') !== -1) return;
  } catch (e) { /* continue */ }

  // Максимум один раз за сессию (отдельный guard для зеркала и для vercel):
  // если цель окажется нестабильной, пинг-понг хуже, чем остаться на месте.
  var guardKey = 'fm_migrated_once';
  try {
    if (sessionStorage.getItem(guardKey)) return;
    sessionStorage.setItem(guardKey, '1');
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
          // Путь, query и Telegram-хеш (#tgWebAppData=…) сохраняются полностью.
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
