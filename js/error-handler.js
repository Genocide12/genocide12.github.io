
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
  