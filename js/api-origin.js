// Filmotiv API Origin resolver — единый слой выбора происхождения API.
//
// ПРОБЛЕМА, которую решает (2026-09-24, отчёт пользователя):
//   На зеркале genocide12.github.io все fetch('/api/...') уходили на сам
//   GitHub Pages → 404/405 (GitHub Pages не выполняет serverless-функции).
//   Ротация была только у GET (apiGet в app.js) — POST (/api/me, /api/track)
//   падали всегда. Плюс filmotiv.vercel.app частично блокируется из РФ,
//   а URL деплоя filmotiv-5sp8sjewa-genocide12s-projects.vercel.app —
//   ДОСТУПЕН (проверено пользователем) → добавлен как резервное происхождение.
//
// Решение:
//   1) apiFetch(path, opts) — fetch с автоматической ротацией происхождения
//      для ЛЮБЫХ методов (GET/POST). Рабочее происхождение «залипает»
//      в localStorage на 1 час.
//   2) watchRedirect() — на vercel-хостах, если /api/me недоступен
//      дважды подряд, показываем плашку и автоматически переходим на зеркало
//      genocide12.github.io (запрос пользователя: «автоматическое
//      перенаправление на github.io с vercel, если последний недоступен»).
//      Техническое ограничение: если ХОСТ полностью заблокирован (страница
//      вообще не открылась), JS не выполнится — тут помогает только зеркало.
//
// v183 (2026-09-25): ОБНАРУЖЕНО И ИСПРАВЛЕНО:
//   а) SSO Deployment Protection (ssoProtection: all_except_custom_domains)
//      закрывала ВСЕ deployment-URL редиректом на vercel.com/login →
//      BACKUP-origin отдавал HTML логина вместо API (пользователь: «фильмы
//      для скачивания не находит»). Защита снята через Vercel API.
//   б) RU-блокировка ВЫБОРОЧНА по hostname/IP (check-host: vercel.app из
//      ru1/ru2 — timeout, ru3 — 200). Стабильные hostname проекта
//      filmotiv-genocide12s-projects (последний prod) и
//      filmotiv-git-main-genocide12s-projects (ветка main) резолвятся в
//      ДРУГИЕ IP anycast и открываются с ru1, где vercel.app не доступен.
//      Оба добавлены в цепочку ротации перед per-deployment BACKUP.
//      Техническое ограничение: если ХОСТ полностью заблокирован (страница
//      вообще не открылась), JS не выполнится — тут помогает только зеркало.
// v188 (2026-09-25): СВОЙ ЧИСТЫЙ ДОМЕН. filmotiv.duckdns.org (A → 76.76.21.21)
//   добавлен ПЕРВЫМ в цепочку ротации: кастом-домены Vercel обслуживаются с
//   ДРУГОГО пула IP (76.76.21.x), который ТСПУ сейчас не режет — в отличие от
//   ротационного anycast-пула *.vercel.app (IP-лотерея, диагноз Genopoisk
//   v181/v182). Кеш-ключ поднят до v3 — старое «залипшее» происхождение
//   сбрасывается у всех. domain-migrate.js мягко переводит входные страницы
//   vercel.app → duckdns; плеер через edgeUrl() тоже получает чистый домен.
(function() {
  'use strict';

  var VERCEL = 'https://filmotiv.vercel.app';
  var DUCKDNS = 'https://filmotiv.duckdns.org';                          // v188: чистый пул 76.76.21.21
  var PROJECT = 'https://filmotiv-genocide12s-projects.vercel.app';      // стабильный: последний prod
  var BRANCH = 'https://filmotiv-git-main-genocide12s-projects.vercel.app'; // стабильный: ветка main
  var BACKUP = 'https://filmotiv-5sp8sjewa-genocide12s-projects.vercel.app'; // per-deployment (устаревает)
  var MIRROR = 'https://genocide12.github.io/';
  var LS_KEY = 'filmotiv_api_origin_v3';
  var TTL = 60 * 60 * 1000; // 1 час

  function isVercelHost() {
    var h = location.hostname || '';
    return h === 'localhost' || h === '127.0.0.1' ||
           h.indexOf('vercel.app') !== -1 ||
           h.indexOf('vercel.app.') !== -1; // preview-домены
  }

  function cachedOrigin() {
    try {
      var v = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (v && v.origin && Date.now() - v.ts < TTL) return v.origin;
    } catch (_) {}
    return null;
  }

  function storeOrigin(o) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ origin: o, ts: Date.now() })); } catch (_) {}
  }

  // Список кандидатов. На vercel-хостах '' (same-origin) всегда первый,
  // далее v188 DUCKDNS (чистый пул) — и только потом верcel-хосты.
  function origins() {
    var list = isVercelHost() ? ['', DUCKDNS, VERCEL, PROJECT, BRANCH, BACKUP]
                              : [DUCKDNS, VERCEL, PROJECT, BRANCH, BACKUP];
    var c = cachedOrigin();
    if (c && c !== '') {
      var i = list.indexOf(c);
      if (i > 0) { list.splice(i, 1); list.unshift(c); }
    }
    return list;
  }

  function urlFor(o, path) { return (o === '' ? '' : o) + path; }

  // fetch с ротацией. Возвращает Response или null (все попытки исчерпаны).
  async function apiFetch(path, opts, timeoutMs) {
    opts = opts || {};
    var list = origins();
    var maxTries = Math.min(list.length, 6);
    var lastStatus = 0;
    for (var a = 0; a < maxTries; a++) {
      var o = list[a];
      if (o === undefined) break;
      var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function() { try { ctrl.abort(); } catch (_) {} }, timeoutMs || 9000) : null;
      try {
        var init = ctrl ? Object.assign({}, opts, { signal: ctrl.signal }) : opts;
        var res = await fetch(urlFor(o, path), init);
        if (timer) clearTimeout(timer);
        if (res.status >= 500 || res.status === 408 || res.status === 429) {
          lastStatus = res.status;
          continue; // сервер/функция перегружена — пробуем другое происхождение
        }
        if (o !== '') storeOrigin(o);
        return res;
      } catch (e) {
        if (timer) clearTimeout(timer);
        lastStatus = 0;
        continue; // сеть/DNS/блокировка — следующее происхождение
      }
    }
    if (lastStatus) console.warn('[origin] все происхождения недоступны, последний статус', lastStatus);
    return null;
  }

  // Абсолютный URL для sendBeacon (не ждёт ответа, ротация невозможна —
  // берём залипшее происхождение или первое доступное).
  function beaconUrl(path) {
    if (isVercelHost()) return path;
    var c = cachedOrigin();
    return (c && c !== '' ? c : DUCKDNS) + path;
  }

  // Абсолютный URL для Edge-прокси плеера (/api/embed-edge, /api/media/...).
  // На vercel-хостах — same-origin; на зеркале — лучшее доступное
  // происхождение (залипшее в localStorage или первое из списка). Если
  // происхождение мертво, плеер уйдёт по цепочке дальше (семейство/FlixCDN).
  function edgeUrl(path) {
    if (isVercelHost()) return path;
    var list = origins();
    return (list[0] || VERCEL) + path;
  }

  // Авто-переход на зеркало при недоступности прод-API (только на vercel).
  function watchRedirect() {
    if (!/(^|\.)vercel\.app$/.test(location.hostname)) return;
    var tries = 0;
    function probe() {
      var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function() { try { ctrl.abort(); } catch (_) {} }, 4000) : null;
      // OPTIONS /api/me — самый дешёвый вызов serverless-функции (ответ 200
      // из первой строки, без Supabase). Лимит Hobby: 12 функций, поэтому
      // отдельного /api/health нет.
      fetch('/api/me', ctrl ? { method: 'OPTIONS', signal: ctrl.signal, cache: 'no-store' } : { method: 'OPTIONS', cache: 'no-store' })
        .then(function(r) {
          if (timer) clearTimeout(timer);
          if (!r.ok && r.status !== 204) throw new Error('HTTP ' + r.status);
          console.log('[origin] prod healthy');
        })
        .catch(function() {
          if (timer) clearTimeout(timer);
          tries++;
          if (tries >= 2) fallbackBar();
          else setTimeout(probe, 2500);
        });
    }
    function fallbackBar() {
      console.warn('[origin] prod API недоступен → зеркало через 5с');
      try {
        var el = document.createElement('div');
        el.id = 'mirrorFallbackBar';
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(13,13,22,.97);color:#fff;font:600 13px/1.5 system-ui,sans-serif;padding:12px 16px;text-align:center;border-top:1px solid rgba(255,255,255,.14)';
        el.innerHTML = '⚠️ Прод-сервер недоступен. Переходим на <a href="' + MIRROR + '" style="color:#a78bfa;font-weight:800;text-decoration:underline">зеркало</a> через <b id="mirrorFbCnt">5</b> с…';
        var mount = document.body || document.documentElement;
        mount.appendChild(el);
        var n = 5;
        var iv = setInterval(function() {
          n--;
          var c = document.getElementById('mirrorFbCnt');
          if (c) c.textContent = n;
          if (n <= 0) { clearInterval(iv); try { location.replace(MIRROR); } catch (_) { location.href = MIRROR; } }
        }, 1000);
      } catch (_) {
        try { location.replace(MIRROR); } catch (_) {}
      }
    }
    if (document.readyState === 'complete') setTimeout(probe, 1500);
    else window.addEventListener('load', function() { setTimeout(probe, 1500); }, { once: true });
  }

  window.FilmotivAPIOrigin = {
    VERCEL: VERCEL,
    DUCKDNS: DUCKDNS,
    PROJECT: PROJECT,
    BRANCH: BRANCH,
    BACKUP: BACKUP,
    MIRROR: MIRROR,
    isVercelHost: isVercelHost,
    origins: origins,
    apiFetch: apiFetch,
    beaconUrl: beaconUrl,
    edgeUrl: edgeUrl,
    watchRedirect: watchRedirect
  };
  watchRedirect();
})();
