
    // ====== Suppress noisy logs in production console ======
    // Filters: Telegram SDK postEvent noise + our own info-level logs
    // ([cache], [app], [sw], [perf], [tg] info, [player] debug).
    // Errors and warnings are NOT suppressed — only info logs.
    // To debug: open browser DevTools and override console.log manually,
    // or set localStorage.debug = '1' to disable filtering.
    (function() {
      if (window.localStorage && localStorage.getItem('debug') === '1') return;
      var origLog = console.log;
      var suppressPatterns = [
        '[Telegram.WebView] > postEvent',
        '[Telegram.WebApp] Header color is not supported',
        '[Telegram.WebApp] Background color is not supported',
        '[Telegram.WebApp] Bottom bar color is not supported',
        '[cache] Instant load',
        '[cache] Cached',
        '[app] Filmotiv initialized',
        '[sw] registered',
        '[sw] registration',
        '[perf] DOMContentLoaded',
        '[perf] Window load',
        '[perf] player.html started',
        '[tg] Linked TG user ID',
        '[tg] Telegram WebApp initialized',
        '[tg] telegram-web-app.js unavailable',
        '[player] Resume from',
        '[player] Using ?t=',
        '[player] Using localStorage position',
        '[player] Seek confirmed',
        '[player] Seek attempt',
        '[player] Seeked event',
        '[player] Bridge ready',
        '[player] Fetching',
        '[player] Fetch response',
        '[player] Got HTML',
        '[player] srcdoc set',
        '[player] Fullscreen change',
        '[player] Position cleared',
        '[player] Ignored ended event',
        '[player] PiP active',
        '[Filmotiv] Bridge loaded',
        '[Filmotiv] Controls fix CSS injected',
        '[Filmotiv] Layout CSS injected',
        '[Filmotiv] bridge_ready posted',
        '[Filmotiv] Blocked WebSocket',
        '[Filmotiv] adsConfig assignment blocked',
        '[Filmotiv] Video element attached',
        '[Filmotiv] Rewrote MPD BaseURL'
      ];
      console.log = function() {
        try {
          var first = (arguments[0] || '') + '';
          for (var i = 0; i < suppressPatterns.length; i++) {
            if (first.indexOf(suppressPatterns[i]) !== -1) return;
          }
        } catch (_) {}
        return origLog.apply(console, arguments);
      };
    })();

    // ====== Performance & error logging (errors only — info suppressed above) ======
    window.addEventListener('error', function(e) {
      console.error('[error]', e.message, e.filename + ':' + e.lineno);
    });
    window.addEventListener('unhandledrejection', function(e) {
      console.error('[unhandled rejection]', e.reason && e.reason.message ? e.reason.message : e.reason);
    });

    // ====== JS-ошибки → Telegram админу (через /api/track type=js_error) ======
    // Клиентский flood-guard: не более 5 репортов за 10 минут на сессию —
    // зацикленный ошибкой сайт не должен заспамить админа и /api/track.
    (function() {
      var SENT_KEY = 'filmotiv_err_ts';
      var MAX_PER_WINDOW = 5;
      var WINDOW_MS = 10 * 60 * 1000;
      function underLimit() {
        try {
          var now = Date.now();
          var arr = [];
          try { arr = JSON.parse(localStorage.getItem(SENT_KEY) || '[]'); } catch (_) {}
          arr = arr.filter(function(ts) { return typeof ts === 'number' && now - ts < WINDOW_MS; });
          if (arr.length >= MAX_PER_WINDOW) return false;
          arr.push(now);
          localStorage.setItem(SENT_KEY, JSON.stringify(arr));
          return true;
        } catch (_) { return false; }
      }
      function report(message, source, lineno, colno, stack) {
        try {
          if (!message) return;
          if (!underLimit()) return;
          var payload = {
            type: 'js_error',
            message: String(message).slice(0, 300),
            source: String(source || '').replace(location.origin, '').slice(0, 160),
            line: lineno || 0,
            col: colno || 0,
            stack: String(stack || '').slice(0, 600),
            path: location.pathname,
            url: location.href.slice(0, 200),
            userId: (function() {
              try { return localStorage.getItem('filmotiv_tg_user_id') || localStorage.getItem('filmotiv_user_id') || ''; } catch (_) { return ''; }
            })()
          };
          var body = JSON.stringify(payload);
          // На зеркале (github.io) относительный путь попадает на GitHub
          // Pages → 405. Отправляем на рабочее vercel-происхождение.
          if (navigator.sendBeacon) {
            var bUrl = window.FilmotivAPIOrigin ? window.FilmotivAPIOrigin.beaconUrl('/api/track') : '/api/track';
            navigator.sendBeacon(bUrl, new Blob([body], { type: 'application/json' }));
          } else if (window.FilmotivAPIOrigin) {
            window.FilmotivAPIOrigin.apiFetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function() {});
          } else {
            fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function() {});
          }
        } catch (_) {}
      }
      window.addEventListener('error', function(e) {
        // Ошибки ресурсов (img/script/css) без message слишком шумные — пропускаем
        if (!e.message && e.target && e.target !== window) return;
        report(e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
      }, true);
      window.addEventListener('unhandledrejection', function(e) {
        var r = e.reason;
        report(r && r.message ? r.message : (r ? String(r) : ''), 'unhandledrejection', 0, 0, r && r.stack);
      });
    })();
  