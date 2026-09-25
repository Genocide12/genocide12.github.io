// Filmotiv v192: автоматическая переадресация filmotiv.vercel.app → filmotiv.duckdns.org
//
// ЗАЧЕМ: *.vercel.app живёт на ротационном anycast-пуле {64.29.17.x,216.198.79.x}×
// {3,67,131,195}, который ТСПУ режет по-ISP (подмножества, у каждого провайдера
// своё) — «IP-лотерея». Кастомный домен filmotiv.duckdns.org (A → 76.76.21.21)
// обслуживается С ДРУГОГО пула IP Vercel, чистого из РФ.
//
// РЕШЕНИЕ ВЛАДЕЛЬЦА (v192): зеркало GitHub Pages (genocide12.github.io/fm/) —
// ОТДЕЛЬНЫЙ сайт. Ветка «зеркало → duckdns» УДАЛЕНА: кто открыл зеркало —
// остаётся на зеркале (там своя кросс-доменная ротация API).
// Осталась единственная ветка: filmotiv.vercel.app (старые закладки/сообщения
// бота) → мягкий переезд на стабильный duckdns (одна попытка за сессию,
// НИКОГДА на player/film — редирект убил бы воспроизведение).
//
// ВАЖНО: если vercel.app НЕ ОТКРЫЛСЯ ВОВСЕ (TCP/TLS заблокирован), JS на той
// странице не выполняется — этот скрипт там бесполезен. Такой случай ловит
// watchRedirect() в api-origin.js. Входы для заблокированных:
// filmotiv.duckdns.org или зеркало genocide12.github.io/fm/.
//
// Выход для отладки: ?nomigrate=1 в URL.
(function () {
  'use strict';

  var TARGET_ORIGIN = 'https://filmotiv.duckdns.org';
  var host = '';
  try { host = window.location.hostname || ''; } catch (e) { return; }

  var isVercelProd = host === 'filmotiv.vercel.app';

  // preview-деплои (случайные имена), duckdns, зеркало и локальные — не трогаем.
  if (!isVercelProd) return;

  // Не переадресуем, если пользователь пришёл с явным намерением остаться.
  try {
    if (window.location.search.indexOf('nomigrate=1') !== -1) return;
  } catch (e) { /* continue */ }

  // Максимум один раз за сессию: если цель окажется нестабильной,
  // пинг-понг хуже, чем остаться на месте.
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
