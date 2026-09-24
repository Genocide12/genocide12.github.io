// Bridge script — injected as the FIRST element in <head> of the iframe.
// Blocks ad config (prevents "fullscreen disabled during ad" message),
// blocks tracking endpoints, fixes player controls visibility.
//
// ПРЕМИУМ-РЕЖИМ (v176): блокировка рекламы — привилегия премиума.
//   /bridge.js?v=176&premium=1 → плеер грузится БЕЗ рекламы
//   /bridge.js?v=176           → реклама работает как в оригинальном плеере
// Функциональные фиксы (высота #player, resume-трекинг, перезапись битых
// CDN-URL в MPD, блок телеметрии myangular) — для всех.

(function() {
  if (window.__filmotivBridge) return;
  window.__filmotivBridge = true;

  var PREMIUM = false;
  try {
    var src = (document.currentScript && document.currentScript.src) || '';
    PREMIUM = /([?&])premium=1(&|$)/.test(src);
  } catch (_) { PREMIUM = false; }

  function log() {
    try { console.log('[Filmotiv]', Array.from(arguments).join(' ')); } catch(_) {}
  }
  log('Bridge loaded (premium=' + PREMIUM + ')');

  var videoEl = null;

  function post(msg) {
    try { parent.postMessage(msg, '*'); } catch(_) {}
  }

  // ====== 0a. Pre-emptively neutralize adsConfig — ТОЛЬКО ПРЕМИУМ ======
  // venoplayer reads window.adsConfig to decide if ads should play.
  // If adsConfig has pre/middle/post roll URLs, venoplayer enters "ad mode"
  // and disables fullscreen + shows "fullscreen disabled during ad".
  // Для НЕ-премиума adsConfig НЕ трогаем — обычные пользователи смотрят
  // рекламу, как в оригинальном плеере (возврат рекламы по запросу).
  if (PREMIUM) {
  var EMPTY_ADS_CONFIG = {
    nonLinear: { fallbackOnly: true, url: '', total: 0, offset: 0 },
    pre: { vast: { timeouts: { loading: 1, starting: 1, global: 1 } }, maxImpressions: 0, urls: [] },
    middle: { offset: 999999, vast: { timeouts: { loading: 1, starting: 1, global: 1 } }, nonLinearFallback: false, pop: false, total: 0, maxImpressions: 0, urls: [] },
    post: { vast: { timeouts: { loading: 1, starting: 1, global: 1 } }, maxImpressions: 0, urls: [] }
  };
  try {
    Object.defineProperty(window, 'adsConfig', {
      get: function() { return EMPTY_ADS_CONFIG; },
      set: function(val) { log('adsConfig assignment blocked'); },
      configurable: true
    });
  } catch(e) { log('adsConfig override failed', e); }
  } // end PREMIUM: adsConfig override

  // ====== 0. Hide ad / fullscreen-disabled overlays — ТОЛЬКО ПРЕМИУМ ======
  // Для не-премиума рекламные оверлеи НЕ скрываем — реклама возвращена.
  if (PREMIUM) {
  function injectControlsFix() {
    if (document.querySelector('style[data-filmotiv-controls]')) return;
    var css =
      // Hide ad-related overlays and "fullscreen disabled during ad" messages
      // + non-linear ad banners (distribrey overlay) and any ad containers
      '.vp-ad-overlay, .vp-ad-message, .ad-message, [class*="ad-disabled"], [class*="fullscreen-disabled"], ' +
      '[class*="nonlinear"], [class*="non-linear"], [class*="ad-overlay"], [class*="ad_overlay"], ' +
      '[class*="ad-banner"], [class*="advert-banner"], .vp-nl, .vp-banner { display:none !important; }';
    var style = document.createElement('style');
    style.setAttribute('data-filmotiv-controls', 'true');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    log('Controls fix CSS injected (ad overlays only — venoplayer controls untouched)');
  }
  if (document.head) { injectControlsFix(); }
  else {
    var cObs = new MutationObserver(function() {
      if (document.head) { injectControlsFix(); cObs.disconnect(); }
    });
    cObs.observe(document.documentElement, { childList: true, subtree: true });
  }
  } // end PREMIUM: ad-overlay CSS hiding
  if (PREMIUM) {
  // Periodic check: remove ad messages and ensure center button visible
  setInterval(function() {
    // Remove ad overlay messages + non-linear banners
    var adMsgs = document.querySelectorAll('.vp-ad-message, .ad-message, [class*="fullscreen-disabled"], ' +
      '[class*="nonlinear"], [class*="non-linear"], [class*="ad-overlay"], [class*="ad_overlay"], ' +
      '[class*="ad-banner"], [class*="advert-banner"], .vp-nl, .vp-banner');
    for (var i = 0; i < adMsgs.length; i++) {
      adMsgs[i].style.display = 'none';
      adMsgs[i].remove();
    }
  }, 1000);
  } // end PREMIUM: periodic ad cleanup
  // venoplayer sets #player height:180px inline. We need:
  // 1. html, body { height:100% } so #player can be height:100%
  // 2. #player { height:100% !important } to override inline 180px
  // --vp-vh is computed FROM #player height, so this is safe.
  function injectLayoutCSS() {
    if (document.querySelector('style[data-filmotiv-layout]')) return;
    var css =
      'html { height:100% !important; }' +
      'body { height:100% !important; margin:0 !important; padding:0 !important; }' +
      '#player { height:100% !important; width:100% !important; }';
    var style = document.createElement('style');
    style.setAttribute('data-filmotiv-layout', 'true');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    log('Layout CSS injected (html/body/#player height:100%)');
  }
  if (document.head) {
    injectLayoutCSS();
  } else {
    var headObs = new MutationObserver(function() {
      if (document.head) { injectLayoutCSS(); headObs.disconnect(); }
    });
    headObs.observe(document.documentElement, { childList: true, subtree: true });
  }
  // Re-inject after delays — venoplayer sets inline styles during init
  setTimeout(injectLayoutCSS, 500);
  setTimeout(injectLayoutCSS, 2000);
  setTimeout(injectLayoutCSS, 5000);

  // ====== 1. Block tracking + ad endpoints ======
  // Список заблокированных сайтов — из репозитория genopoisk (коммит d772e84
  // «ad block»), расширен по живой странице api.embess.ws и venoplayer:
  //   - s.myangular.life / stats.myangular.life (stats/telemetry)
  //   - evr.mzona.net (local ad overlay)
  //   - distribrey.com — ОСНОВНАЯ рекламная сеть embess: VAST-роллы
  //     pre/middle/post + nonLinear overlay задаются в inline-скрипте
  //     страницы плеера (adsConfig.urls = https://distribrey.com/load-xml/...)
  //   - getsdk.online (пинги «check»), stiven-king.com (storage-sync iframe),
  //     getaim.org + advertserve.com + 4736.in (телеметрия venoplayer)
  //   - классические сети: doubleclick, googlesyndication, google-analytics,
  //     googletagmanager, adsterra, propellerads, taboola, mgid и т.д.
  // DO NOT block hye1eaipby4w.interkh.com (video CDN), *.zcvh.net (P2P
  // tracker), api.embess.ws (embed host), cdn.jsdelivr.net / unpkg.com
  // (player library) — иначе видео не загрузится.
  var trackingPattern = new RegExp(
    's\\.myangular\\.life|stats\\.myangular\\.life|myangular\\.life|evr\\.mzona\\.net' +
    '|distribrey\\.com' +
    '|getsdk\\.online|stiven-king\\.com|getaim\\.org|advertserve\\.com|4736\\.in' +
    '|doubleclick\\.net|googlesyndication\\.com|google-analytics\\.com|googletagmanager\\.com' +
    '|adsterra|propellerads|popads|popcash|popunder|onclickads\\.net|clickadu|hilltopads|adcash' +
    '|adservice|adsystem|adnxs|adroll|taboola|outbrain|criteo|mgid\\.com' +
    '|an\\.yandex\\.ru|yandexadexchange\\.net|mc\\.yandex\\.ru|adfox\\.ru|adriver\\.ru|videonow\\.(?:ru|tv)' +
    '|mradx\\.net|top-fwz1\\.mail\\.ru|rb\\.mail\\.ru|ad\\.mail\\.ru' +
    '|betweenadspots\\.com|smartadserver\\.com|pubmatic\\.com|rubiconproject\\.com|openx\\.net' +
    '|adsrvr\\.org|amazon-adsystem\\.com|moatads\\.com|bidswitch\\.net|traforet\\.com' +
    '|exoclick|juicyads|revcontent|bidvertiser|zeropark|trafficstars|trafficjunky|coinzilla' +
    '|luckyads\\.pro|ads\\.vk\\.com', 'i');

  // Пустой VAST — отдаётся вместо рекламных XML: плеер получает AdError и
  // молча пропускает ролл (это штатная ветка venoplayer).
  var EMPTY_VAST = '<?xml version="1.0" encoding="utf-8"?><VAST version="2.0"></VAST>';

  function isVastBody(ct, text) {
    if (ct && /vast[+]xml/i.test(ct)) return true;
    if (typeof text === 'string' && text.length < 262144 && text.indexOf('<VAST') !== -1 && text.indexOf('<MPD') === -1) return true;
    return false;
  }

  function isBlocked(url) {
    if (typeof url !== 'string') return false;
    return trackingPattern.test(url);
  }

  function isP2pCdn(url) {
    return false; // don't block P2P CDN
  }

  // Override fetch
  try {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (PREMIUM && isBlocked(url)) {
        log('Blocked fetch (204):', url.slice(0, 100));
        return Promise.resolve(new Response('', { status: 204 }));
      }
      if (isP2pCdn(url)) {
        log('P2P CDN blocked (network error):', url.slice(0, 100));
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      // Rewrite segment URLs from broken CDNs to working CDN
      if (typeof url === 'string') {
        var newUrl = url.replace(
          /https:\/\/(ghzbfjzbazc|x-bc)\.interkh\.com/g,
          'https://hye1eaipby4w.interkh.com'
        );
        if (newUrl !== url) {
          log('fetch URL rewrite:', url.slice(0, 60), '→', newUrl.slice(0, 60));
          if (typeof input === 'string') {
            input = newUrl;
          } else if (input && input.url) {
            input = new Request(newUrl, input);
          }
        }
      }
      // Intercept MPD manifest responses and rewrite BaseURL from broken
      // P2P CDNs (ghzbfjzbazc, x-bc) to the working CDN (hye1eaipby4w).
      // Also: kill VAST ad XML responses (second line of defense — even if a
      // new ad domain appears, the player gets an empty VAST and skips it).
      return origFetch.apply(this, arguments).then(function(res) {
        var ct = res.headers.get('content-type') || '';
        // VAST-подмена — только премиум (у обычных реклама играет)
        if (PREMIUM && (/vast[+]xml/i.test(ct) || isBlocked(res.url || url))) {
          log('Blocked VAST response (fetch):', String(res.url || url).slice(0, 100));
          return new Response(EMPTY_VAST, { status: 200, headers: { 'content-type': 'application/xml' } });
        }
        if (ct.indexOf('dash+xml') !== -1 || ct.indexOf('xml') !== -1) {
          return res.text().then(function(text) {
            if (text.indexOf('<MPD') === -1) return res;
            var rewritten = text.replace(
              /https:\/\/(ghzbfjzbazc|x-bc)\.interkh\.com/g,
              'https://hye1eaipby4w.interkh.com'
            );
            if (rewritten !== text) {
              log('Rewrote MPD BaseURL (fetch body): ghzbfjzbazc/x-bc → hye1eaipby4w');
            }
            return new Response(rewritten, {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers
            });
          });
        }
        return res;
      });
    };
  } catch(e) {}

  // Override XMLHttpRequest
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._filmotivBlocked = isBlocked(url);
      this._filmotivP2p = isP2pCdn(url);
      // Rewrite segment URLs from broken CDNs to working CDN.
      // dash.js constructs segment URLs as BaseURL + SegmentTemplate.
      // We rewrite them here in open() so the actual request goes to the
      // working CDN.
      if (typeof url === 'string') {
        var newUrl = url.replace(
          /https:\/\/(ghzbfjzbazc|x-bc)\.interkh\.com/g,
          'https://hye1eaipby4w.interkh.com'
        );
        if (newUrl !== url) {
          log('XHR URL rewrite:', url.slice(0, 60), '→', newUrl.slice(0, 60));
          url = newUrl;
          arguments[1] = newUrl;
        }
      }
      this._filmotivUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      var self = this;
      // Second line of defense: even if a blocked VAST slipped through a new
      // domain, replace the response body with an empty VAST document.
      // NOTE: responseText throws for blob/arraybuffer responseType — guard it.
      this.addEventListener('readystatechange', function() {
        if (!PREMIUM) return; // реклама возвращена обычным пользователям
        if (self.readyState !== 4 || self.status !== 200) return;
        var rt = self.responseType;
        if (rt && rt !== 'text') return; // binary — not a VAST doc
        var txt = null;
        try { txt = self.responseText; } catch(e) { return; }
        var u = String(self._filmotivUrl || '');
        if (isVastBody(self.getResponseHeader('content-type'), txt) || /vast|load-xml/i.test(u)) {
          log('Blocked VAST response (XHR):', u.slice(0, 100));
          try {
            Object.defineProperty(self, 'responseText', { value: EMPTY_VAST, configurable: true });
            Object.defineProperty(self, 'response', { value: EMPTY_VAST, configurable: true });
          } catch(e) {}
        }
      });
      if (PREMIUM && this._filmotivBlocked) {
        setTimeout(function() {
          try {
            Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(self, 'status', { value: 204, configurable: true });
            Object.defineProperty(self, 'responseText', { value: '', configurable: true });
            Object.defineProperty(self, 'response', { value: '', configurable: true });
            if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
            if (typeof self.onload === 'function') self.onload();
            self.dispatchEvent(new Event('load'));
            self.dispatchEvent(new Event('loadend'));
          } catch(e) {}
        }, 0);
        return;
      }
      if (this._filmotivP2p) {
        setTimeout(function() {
          try {
            Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(self, 'status', { value: 0, configurable: true });
            if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
            if (typeof self.onerror === 'function') self.onerror();
            self.dispatchEvent(new Event('error'));
            self.dispatchEvent(new Event('loadend'));
          } catch(e) {}
        }, 0);
        return;
      }
      // Also intercept MPD manifest responses and rewrite BaseURL in body
      // (guard responseText — it throws for non-text responseType)
      var mpdHandler = function() {
        if (self.readyState === 4 && self.status === 200) {
          var rt = self.responseType;
          if (rt && rt !== 'text') return;
          var ct = self.getResponseHeader('content-type') || '';
          if ((ct.indexOf('dash+xml') !== -1 || ct.indexOf('xml') !== -1) &&
              self.responseText && self.responseText.indexOf('<MPD') !== -1) {
            var rewritten = self.responseText.replace(
              /https:\/\/(ghzbfjzbazc|x-bc)\.interkh\.com/g,
              'https://hye1eaipby4w.interkh.com'
            );
            if (rewritten !== self.responseText) {
              log('Rewrote MPD BaseURL (XHR body): ghzbfjzbazc/x-bc → hye1eaipby4w');
              try {
                Object.defineProperty(self, 'responseText', { value: rewritten, configurable: true });
                Object.defineProperty(self, 'response', { value: rewritten, configurable: true });
              } catch(e) {}
            }
          }
        }
      };
      this.addEventListener('readystatechange', mpdHandler);
      return origSend.apply(this, arguments);
    };
  } catch(e) {}

  // ====== 1b. Block popunders (adsConfig.middle.pop = true) — ТОЛЬКО ПРЕМИУМ ======
  // Ad scripts open popunders via window.open — kill blocked URLs; a null
  // return makes their `win.location = ...` throw inside their own try/catch.
  if (PREMIUM) {
  try {
    var origWinOpen = window.open;
    window.open = function(u) {
      if (isBlocked(String(u || ''))) {
        log('Blocked window.open (popunder):', String(u).slice(0, 100));
        return null;
      }
      return origWinOpen.apply(window, arguments);
    };
  } catch(e) {}
  } // end PREMIUM: popunder blocker

  // Override WebSocket to block tracking connections only (s.myangular.life).
  // Do NOT block t6.zcvh.net (P2P tracker) — venoplayer needs it.
  // (Телеметрия, не реклама — блокируем всем: чистая консоль, без рекламных решений.)
  //
  // For blocked URLs, we return a STUB OBJECT that mimics the WebSocket
  // interface (readyState, send, close, addEventListener, etc.) but does
  // nothing. This is silent — no network attempt, no ERR_UNSAFE_PORT error
  // in console (the previous approach redirected to ws://localhost:0 which
  // Chrome logs as an unsafe-port error, polluting the debug console).
  try {
    var OrigWebSocket = window.WebSocket;
    function BlockedWebSocketStub(url) {
      log('Blocked WebSocket (silent stub):', String(url).slice(0, 100));
      // Mimic WebSocket constants
      this.readyState = OrigWebSocket.CLOSED; // never opens
      this.url = url;
      this.extensions = '';
      this.protocol = '';
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;
      // Stub methods — all no-ops
      this.send = function() {};
      this.close = function() {};
      this.addEventListener = function() {};
      this.removeEventListener = function() {};
      this.dispatchEvent = function() { return true; };
    }
    var WrappedWebSocket = function(url, protocols) {
      if (typeof url === 'string' && trackingPattern.test(url)) {
        return new BlockedWebSocketStub(url);
      }
      if (protocols !== undefined) {
        return new OrigWebSocket(url, protocols);
      }
      return new OrigWebSocket(url);
    };
    WrappedWebSocket.prototype = OrigWebSocket.prototype;
    WrappedWebSocket.CONNECTING = OrigWebSocket.CONNECTING;
    WrappedWebSocket.OPEN = OrigWebSocket.OPEN;
    WrappedWebSocket.CLOSING = OrigWebSocket.CLOSING;
    WrappedWebSocket.CLOSED = OrigWebSocket.CLOSED;
    window.WebSocket = WrappedWebSocket;
  } catch(e) { log('WebSocket override failed', e); }

  // ====== 2. MutationObserver: remove ad/tracking nodes — ТОЛЬКО ПРЕМИУМ ======
  if (PREMIUM) {
  var adObserver = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        var tag = node.tagName;
        if (tag === 'IMG' || tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'SOURCE') {
          var src = node.src || node.getAttribute('src') || '';
          if (isBlocked(src)) {
            log('Removed ad/tracking node:', tag, String(src).slice(0, 80));
            node.remove();
          }
        } else if (tag === 'A') {
          var href = node.href || '';
          if (isBlocked(href)) {
            log('Removed ad link:', String(href).slice(0, 80));
            node.remove();
          }
        }
      }
    }
  });
  adObserver.observe(document.documentElement, { childList: true, subtree: true });
  } // end PREMIUM: MutationObserver

  // ====== 3. Setup video element when it appears ======
  function setupVideo(video) {
    if (videoEl === video) return;
    videoEl = video;
    log('Video element attached');

    try { video.setAttribute('playsinline', ''); } catch(_) {}
    try { video.setAttribute('webkit-playsinline', ''); } catch(_) {}
    try { video.disablePictureInPicture = false; } catch(_) {}

    post({ type: 'ready', currentTime: video.currentTime || 0, duration: video.duration || 0 });

    video.addEventListener('timeupdate', function() {
      post({ type: 'timeupdate', currentTime: video.currentTime, duration: video.duration });
    });
    video.addEventListener('durationchange', function() {
      post({ type: 'duration', duration: video.duration });
    });
    video.addEventListener('play', function() {
      post({ type: 'play', currentTime: video.currentTime });
    });
    video.addEventListener('pause', function() {
      post({ type: 'pause', currentTime: video.currentTime });
    });
    video.addEventListener('ended', function() {
      post({ type: 'ended' });
    });
    video.addEventListener('loadedmetadata', function() {
      post({ type: 'loaded', currentTime: video.currentTime, duration: video.duration });
    });
    video.addEventListener('enterpictureinpicture', function() {
      post({ type: 'pip_enter' });
    });
    video.addEventListener('leavepictureinpicture', function() {
      post({ type: 'pip_leave' });
    });

    window.addEventListener('message', function(e) {
      if (!e.data) return;
      var d = e.data;
      if (typeof d === 'string') {
        try { d = JSON.parse(d); } catch(_) { return; }
      }
      if (!d || typeof d !== 'object') return;
      if (d.type === 'seek' && typeof d.time === 'number') {
        var targetTime = d.time;
        log('Seek requested to', targetTime, 'readyState:', video.readyState);

        // Cancel any previous pending seek — only ONE seek can be in-flight
        // at a time. Without this, multiple seek requests from player.html
        // each register their own canplay listener, and when canplay fires
        // ALL of them run aggressiveSeek → flood of seeked events.
        if (window.__pendingSeekCleanup) {
          try { window.__pendingSeekCleanup(); } catch(_) {}
          window.__pendingSeekCleanup = null;
        }
        // Clear any previous seekedSent state
        var seekedSent = false;
        var cancelled = false;

        function performSeek(isLast) {
          if (cancelled) return;
          try {
            video.currentTime = targetTime;
            log('Seek set to', targetTime, '→ actual:', video.currentTime);
            if (isLast && !seekedSent) {
              seekedSent = true;
              post({ type: 'seeked', currentTime: video.currentTime });
            }
          } catch(err) {
            log('Seek failed', err);
            if (isLast && !seekedSent) {
              seekedSent = true;
              post({ type: 'seeked', currentTime: video.currentTime });
            }
          }
        }

        // Aggressive seek: 3 attempts, 300ms apart. Only last sends 'seeked'.
        var seekCount = 0;
        var MAX_SEEKS = 3;
        var aggressiveSeek = function() {
          if (cancelled) return;
          seekCount++;
          var isLast = (seekCount >= MAX_SEEKS);
          performSeek(isLast);
          if (!isLast) {
            setTimeout(aggressiveSeek, 300);
          }
        };

        // Cleanup function — removes listeners and marks this seek as cancelled
        window.__pendingSeekCleanup = function() {
          cancelled = true;
          if (seekOnCanPlay) {
            video.removeEventListener('canplay', seekOnCanPlay);
            video.removeEventListener('loadeddata', seekOnCanPlay);
          }
        };

        var seekOnCanPlay = null;

        if (video.readyState < 2) {
          log('Video not ready, waiting for canplay...');
          seekOnCanPlay = function() {
            video.removeEventListener('canplay', seekOnCanPlay);
            video.removeEventListener('loadeddata', seekOnCanPlay);
            if (!cancelled) setTimeout(aggressiveSeek, 200);
          };
          video.addEventListener('canplay', seekOnCanPlay);
          video.addEventListener('loadeddata', seekOnCanPlay);
          // Safety timeout — if canplay never fires, force aggressive seek
          setTimeout(function() {
            if (cancelled) return;
            video.removeEventListener('canplay', seekOnCanPlay);
            video.removeEventListener('loadeddata', seekOnCanPlay);
            if (!seekedSent && !cancelled) aggressiveSeek();
          }, 3000);
        } else {
          try {
            var playPromise = video.play();
            if (playPromise && playPromise.then) {
              playPromise.then(function() {
                if (!cancelled) {
                  log('Video playing, aggressive seeking...');
                  setTimeout(aggressiveSeek, 100);
                }
              }).catch(function() {
                if (!cancelled) aggressiveSeek();
              });
            } else {
              aggressiveSeek();
            }
          } catch(_) {
            aggressiveSeek();
          }
        }
      } else if (d.type === 'showControls') {
        // Force venoplayer controls visible (after fullscreen exit)
        log('showControls requested');
        try {
          // Try to find and show venoplayer control bar
          var controls = document.querySelector('.vp-controls, .vjs-control-bar, .player-controls');
          if (controls) {
            controls.style.opacity = '1';
            controls.style.visibility = 'visible';
            controls.style.display = 'flex';
            log('Controls shown:', controls.className);
          }
          // Also try calling venoplayer API if available
          if (window.app && window.app.player) {
            try { window.app.player.controls(true); } catch(_) {}
          }
          // Click on player to trigger controls show
          var playerDiv = document.querySelector('#player');
          if (playerDiv) {
            var ev = new MouseEvent('mousemove', { bubbles: true });
            playerDiv.dispatchEvent(ev);
          }
        } catch(e) { log('showControls failed', e); }
      } else if (d.type === 'getTime') {
        post({ type: 'currentTime', currentTime: video.currentTime, duration: video.duration });
      } else if (d.type === 'play') {
        try { video.play(); } catch(_) {}
      } else if (d.type === 'pause') {
        try { video.pause(); } catch(_) {}
      } else if (d.type === 'requestPiP') {
        try {
          if (video.requestPictureInPicture && document.pictureInPictureEnabled) {
            video.requestPictureInPicture().then(function() {
              post({ type: 'pip_enter' });
            }).catch(function(err) {
              log('PiP failed:', err);
              post({ type: 'pip_error', message: err.message });
            });
          } else {
            post({ type: 'pip_error', message: 'PiP not supported on this device' });
          }
        } catch(e) {
          post({ type: 'pip_error', message: e.message });
        }
      }
    });
  }

  // Poll for video element
  var videoCheckCount = 0;
  var videoCheckInterval = setInterval(function() {
    videoCheckCount++;
    var v = document.querySelector('video');
    if (v) {
      setupVideo(v);
      clearInterval(videoCheckInterval);
    } else if (videoCheckCount > 300) {
      clearInterval(videoCheckInterval);
      log('Video element not found after 60s');
    }
  }, 200);

  var videoObserver = new MutationObserver(function() {
    var v = document.querySelector('video');
    if (v) setupVideo(v);
  });
  videoObserver.observe(document.documentElement, { childList: true, subtree: true });

  post({ type: 'bridge_ready' });
  log('bridge_ready posted');
})();
