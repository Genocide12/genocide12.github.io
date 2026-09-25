// Bridge script — injected as the FIRST element in <head> of the iframe.
//
// v186 — СЛИЯНИЕ с Genopoisk v177..v180 (f090698): апстрим embess поменял
// пайплайн (x-en-x теперь отдаёт полные MPD вместо компактных
// session-манифестов) и воспроизведение сломалось для ВСХ фильмов.
// Рабочая схема (проверена в Genopoisk на проде):
//   1) МЕДИА-ПРОКСИ /api/media/<enc-url>: CDN (*.interkh.com) отдаёт
//      манифесты любому IP, но сегменты режет 410 по гео/UA. Бридж
//      ЗАВОРАЧИВАЕТ каждый interkh-URL (манифесты, сегменты, субтитры,
//      x-en-x) в прокси на этапе запроса; прокси декодирует шифр x-en-x
//      и стримит с AWS-egress. Манифесты переписываются на сервере
//      прокси (rewriteMpd/rewriteM3u8), бридж сквозные НЕ трогает.
//   2) P2P-движок venoplayer ОТКЛЮЧЁН (RTCPeerConnection скрыт): иначе
//      он сначала пробует свой WebSocket (wss://ws.getzend.digital/px,
//      гео-блок для РФ) и висит до 300с без фолбэка. Скрытие →
//      isSupported=false → все сегменты через XHR → /api/media/.
//   3) Парсеры fragDash/fragHls фиксятся на сервере embed-edge
//      (proxy-aware, см. api/embed-edge.js).
// ПРЕМИУМ-РЕЖИМ: блокировка рекламы — привилегия премиума.
//   /bridge.js?v=186&premium=1 → плеер БЕЗ рекламы
//   /bridge.js?v=186           → реклама работает как в оригинале
// Функциональные фиксы (высота #player, resume, медиа-прокси, P2P) — для всех.

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

  // ====== 0b. Media proxy wrapping (v180, для ВСЕХ) ======
  // CDN (*.interkh.com) отдаёт манифесты (.mpd/.m3u8/.vtt) любому IP, но
  // возвращает 410 на СЕГМЕНТЫ с РФ-IP (гео-блок). Same-origin edge-прокси
  // /api/media/<encoded-url> идёт с неРФ-egress. КАЖДЫЙ interkh-URL
  // (манифесты, сегменты, субтитры, миниатюры) заворачивается в прокси.
  // SHAPE: один path-сегмент, encodeURIComponent с сырыми $ { }
  // (шаблоны dash.js $Number$/$Time$ и ${spriteNum} выживают);
  // multi-segment пути не маршрутизируются на Vercel, сырой '//' схлопывается
  // 308-редиректом. Относительные URI сегментов не резолвятся против такого
  // URL манифеста → тела манифестов переписываются прокси на сервере
  // (rewriteMpdBody / rewriteM3u8Body — зеркала api/media/[...url].mjs).
  var PROXY_MARK = '/api/media/';
  var MEDIA_PROXY = location.origin + PROXY_MARK;
  var INTERKH_URL_RE = /^https?:\/\/[a-z0-9-]+\.interkh\.com\//i;
  var ALLOWED_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:interkh\.com|embess\.ws|stiven-king\.com)$/i;

  function encForPath(u) {
    return encodeURIComponent(u).replace(/%24/g, '$').replace(/%7B/g, '{').replace(/%7D/g, '}');
  }

  function toProxyUrl(url) {
    if (typeof url !== 'string' || !url) return null;
    if (url.indexOf(PROXY_MARK) !== -1) return null; // already proxied
    if (!INTERKH_URL_RE.test(url)) return null;
    return MEDIA_PROXY + encForPath(url);
  }

  function upstreamFromProxy(u) {
    if (typeof u !== 'string' || u.indexOf(MEDIA_PROXY) !== 0) return null;
    try { return decodeURIComponent(u.slice(MEDIA_PROXY.length)); } catch (e) { return null; }
  }

  function resolveUp(u, base) {
    var s = String(u).replace(/&amp;/g, '&');
    try {
      var abs = new URL(s, base).href;
      return /^https?:\/\//i.test(abs) ? abs : null;
    } catch (e) { return null; }
  }

  function isAllowedAbs(u) {
    try { return ALLOWED_HOST_RE.test(new URL(u).hostname); } catch (e) { return false; }
  }

  function rewriteMpdBody(text, manifestUrl) {
    var firstBase = null;
    text = text.replace(/<BaseURL>([^<]*)<\/BaseURL>/g, function (m, inner) {
      var abs = resolveUp(inner, manifestUrl);
      if (!abs || !isAllowedAbs(abs)) return m;
      if (!firstBase) firstBase = abs;
      return '<BaseURL>' + MEDIA_PROXY + encForPath(abs) + '</BaseURL>';
    });
    var effectiveBase = firstBase || manifestUrl;
    text = text.replace(/\b(initialization|media|source)="([^"]*)"/g, function (m, attr, val) {
      if (!val) return m;
      var abs = resolveUp(val, effectiveBase);
      if (!abs || !isAllowedAbs(abs)) return m;
      return attr + '="' + MEDIA_PROXY + encForPath(abs) + '"';
    });
    return text.replace(/https?:\/\/[a-z0-9-]+\.interkh\.com\/[^\s"'<>\\]+/gi, function (m) {
      return MEDIA_PROXY + encForPath(m);
    });
  }

  function rewriteM3u8Body(text, playlistUrl) {
    return text.split('\n').map(function (line) {
      var trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.charAt(0) === '#') {
        return line.replace(/URI="([^"]+)"/g, function (m, val) {
          var abs = resolveUp(val, playlistUrl);
          if (!abs || !isAllowedAbs(abs)) return m;
          return 'URI="' + MEDIA_PROXY + encForPath(abs) + '"';
        });
      }
      var abs = resolveUp(trimmed, playlistUrl);
      if (!abs || !isAllowedAbs(abs)) return line;
      return MEDIA_PROXY + encForPath(abs);
    }).join('\n');
  }

  function rewriteManifest(text, finalUrl) {
    var up = upstreamFromProxy(finalUrl) || finalUrl;
    if (text.indexOf('<MPD') !== -1) return rewriteMpdBody(text, up);
    if (text.indexOf('#EXTM3U') !== -1) return rewriteM3u8Body(text, up);
    return text;
  }

  // ====== 0a. Pre-emptively neutralize adsConfig — ТОЛЬКО ПРЕМИУМ ======
  // venoplayer reads window.adsConfig to decide if ads should play.
  // Если в adsConfig есть pre/middle/post роллы, venoplayer входит в
  // «ad mode» и блокирует fullscreen. Для НЕ-премиума adsConfig НЕ трогаем —
  // реклама играет как в оригинальном плеере.
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
  } // end PREMIUM: adsConfig

  // ====== 0c. Disable venoplayer's P2P engine (v180, для ВСЕХ) ======
  // venoplayer injects a P2P FragmentLoader into dash.js (W.Ay.inject). For
  // MediaSegments it FIRST tries its own WebSocket file fetcher
  // (wss://ws.getzend.digital/px, source "ppx") and only falls back to plain
  // HTTP when that REJECTS — but with the WS unreachable (RU networks) the
  // request hangs for up to `longDownload` (300s per the embed config) with
  // no fallback: the video sits at 0 buffer forever even after tapping play.
  // Removing RTCPeerConnection makes W.Ay.isSupported === false → the engine
  // never injects → EVERY segment (init + media) loads through the default
  // XHR loader → cdn.js factory → our media proxy. Deterministic and
  // region-independent. (Tradeoff: no P2P bandwidth savings — all traffic
  // flows through the proxy.)
  try {
    ['RTCPeerConnection', 'mozRTCPeerConnection', 'webkitRTCPeerConnection'].forEach(function (k) {
      try {
        Object.defineProperty(window, k, {
          get: function () { return undefined; },
          set: function () {},
          configurable: true
        });
      } catch (e) {}
    });
    log('P2P engine disabled (RTCPeerConnection hidden)');
  } catch (e) { log('P2P disable failed', e); }

  // ====== 0. Hide ad overlays — ТОЛЬКО ПРЕМИУМ ======
  // Для премиума скрываем рекламные оверлеи и «fullscreen disabled during
  // ad» сообщения. Управление venoplayer не трогаем (иначе контролы не
  // появляются по тапу).
  if (PREMIUM) {
  function injectControlsFix() {
    if (document.querySelector('style[data-filmotiv-controls]')) return;
    var css =
      '.vp-ad-overlay, .vp-ad-message, .ad-message, [class*="ad-disabled"], [class*="fullscreen-disabled"] { display:none !important; }';
    var style = document.createElement('style');
    style.setAttribute('data-filmotiv-controls', 'true');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    log('Controls fix CSS injected (ad overlays only)');
  }
  if (document.head) { injectControlsFix(); }
  else {
    var cObs = new MutationObserver(function() {
      if (document.head) { injectControlsFix(); cObs.disconnect(); }
    });
    cObs.observe(document.documentElement, { childList: true, subtree: true });
  }
  // Periodic check: remove ad overlay messages
  setInterval(function() {
    var adMsgs = document.querySelectorAll('.vp-ad-message, .ad-message, [class*="fullscreen-disabled"]');
    for (var i = 0; i < adMsgs.length; i++) {
      adMsgs[i].style.display = 'none';
      adMsgs[i].remove();
    }
  }, 1000);
  } // end PREMIUM: ad overlays

  // venoplayer sets #player height:180px inline. We need:
  // 1. html, body { height:100% } so #player can be height:100%
  // 2. #player { height:100% !important } to override inline 180px
  // --vp-vh is computed FROM #player height, so this is safe. (Для всех.)
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
  // Список — из genopoisk (d772e84) + живая страница api.embess.ws.
  // БЛОКИРОВКА ТОЛЬКО ДЛЯ ПРЕМИУМА (у обычных реклама играет, как в
  // оригинале). DO NOT block hye1eaipby4w.interkh.com (video CDN),
  // *.zcvh.net (P2P tracker), api.embess.ws, cdn.jsdelivr.net / unpkg.com.
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
      // v180: wrap direct CDN URLs into the media proxy (RU geo-block).
      // NOTE: запрос переиздаётся с НОВЫМ input — старый код переназначал
      // `input`, но звал оригинал с протухшим `arguments`, и рерайт
      // молча не применялся.
      var proxied = toProxyUrl(url);
      if (proxied) {
        log('fetch → media proxy:', url.slice(0, 70));
        if (typeof input === 'string') {
          input = proxied;
        } else if (input && input.url) {
          input = new Request(proxied, input);
        }
        return origFetch.call(this, input, init).then(function(res) {
          return wrapManifestResponse(res, proxied);
        });
      }
      return origFetch.apply(this, arguments).then(function(res) {
        var ct = res.headers.get('content-type') || '';
        // VAST-подмена — только премиум (у обычных реклама играет)
        if (PREMIUM && (/vast[+]xml/i.test(ct) || isBlocked(res.url || url))) {
          log('Blocked VAST response (fetch):', String(res.url || url).slice(0, 100));
          return new Response(EMPTY_VAST, { status: 200, headers: { 'content-type': 'application/xml' } });
        }
        return wrapManifestResponse(res, url);
      });
    };
    // MPD/m3u8 ответы: переписываем тела НЕ-проксированных манифестов
    // (относительные атрибуты пре-резолвятся против исходного base).
    // v179/v180 (Genopoisk, критично): проксированный манифест УЖЕ
    // переписан серверной стороной /api/media. res.text() здесь СЪЕЛА бы
    // тело → cdn.js получил бы «body already used», трактовал манифест как
    // битый и переключил пайплайн на WebSocket-лоадер (гео-блок РФ) —
    // видео вообще не грузится. Проксированные тела НЕ ТРОГАЕМ и возвращаем
    // исходный Response (пересоздание стирает Response.url, который нужен
    // dash.js — пустой responseURL ставит пайплайн до первого сегмента).
    function wrapManifestResponse(res, finalUrl) {
      try {
        if (!finalUrl || typeof finalUrl !== 'string') return res;
        if (upstreamFromProxy(finalUrl)) return res; // proxied → already rewritten server-side
        var ct = res.headers.get('content-type') || '';
        var manifestish = ct.indexOf('dash+xml') !== -1 || ct.indexOf('xml') !== -1 ||
          ct.indexOf('mpegurl') !== -1 || /\.(mpd|m3u8)(\?|$)/i.test(finalUrl);
        if (!manifestish) return res;
        return res.text().then(function(text) {
          if (text.indexOf('<MPD') === -1 && text.indexOf('#EXTM3U') === -1) return res;
          var rewritten = rewriteManifest(text, finalUrl);
          if (rewritten === text) return res; // no-op → preserve Response.url
          log('Manifest body → media proxy (fetch)');
          var h = new Headers(res.headers);
          try { h.delete('content-length'); } catch(_) {}
          return new Response(rewritten, {
            status: res.status,
            statusText: res.statusText,
            headers: h
          });
        });
      } catch(e) {
        return res;
      }
    }
  } catch(e) {}

  // Override XMLHttpRequest
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._filmotivBlocked = isBlocked(url);
      this._filmotivP2p = isP2pCdn(url);
      // v180: wrap direct CDN URLs into the media proxy. dash.js строит
      // URL сегментов как BaseURL + SegmentTemplate и грузит их XHR —
      // это главный горячий путь видеосегментов.
      if (typeof url === 'string') {
        var proxied = toProxyUrl(url);
        if (proxied) {
          log('XHR → media proxy:', url.slice(0, 70));
          arguments[1] = proxied;
          this._filmotivUrl = proxied;
          return origOpen.apply(this, arguments);
        }
      }
      this._filmotivUrl = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      var self = this;
      // Second line of defense (premium): VAST → empty VAST document.
      // NOTE: responseText throws for blob/arraybuffer responseType — guard.
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
      // Манифесты: переписываем тело НЕ-проксированных запросов в медиа-прокси
      // (относительные атрибуты пре-резолвятся против base). Проксированные
      // уже переписаны сервером — не трогаем (guard upstreamFromProxy).
      this.addEventListener('readystatechange', function() {
        if (self.readyState === 4 && self.status === 200) {
          var rt = '';
          try { rt = self.responseType || ''; } catch(_) {}
          if (rt !== '' && rt !== 'text') return;
          var finalUrl = String(self._filmotivUrl || '');
          if (!finalUrl) return;
          var ct = self.getResponseHeader('content-type') || '';
          var up = upstreamFromProxy(finalUrl);
          var manifestish = ct.indexOf('dash+xml') !== -1 || ct.indexOf('xml') !== -1 ||
            ct.indexOf('mpegurl') !== -1 || /\.(mpd|m3u8)(\?|$)/i.test(finalUrl) ||
            (up && /\.(mpd|m3u8)/i.test(up));
          if (manifestish && self.responseText &&
              (self.responseText.indexOf('<MPD') !== -1 || self.responseText.indexOf('#EXTM3U') !== -1)) {
            var rewritten = rewriteManifest(self.responseText, finalUrl);
            if (rewritten !== self.responseText) {
              log('Manifest body → media proxy (XHR)');
              try {
                Object.defineProperty(self, 'responseText', { value: rewritten, configurable: true });
                Object.defineProperty(self, 'response', { value: rewritten, configurable: true });
              } catch(e) {}
            }
          }
        }
      });
      return origSend.apply(this, arguments);
    };
  } catch(e) {}

  // ====== 1a. Block popunders (adsConfig.middle.pop) — ТОЛЬКО ПРЕМИУМ ======
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

  // Override WebSocket: блок телеметрии ВСЕМ (не реклама — чистая консоль).
  // Do NOT block t6.zcvh.net (P2P tracker) — venoplayer needs it.
  // (P2P WS уже нейтрализован скрытием RTCPeerConnection — см. 0c.)
  // For blocked URLs, we return a STUB OBJECT that mimics the WebSocket
  // interface but does nothing — silent, no console errors.
  try {
    var OrigWebSocket = window.WebSocket;
    function BlockedWebSocketStub(url) {
      log('Blocked WebSocket (silent stub):', String(url).slice(0, 100));
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

  // ====== 1b. Rewrite media URLs on DOM elements (v180, для ВСЕХ) ======
  // venoplayer ставит <img src> (спрайты), <track src> (субтитры) и иногда
  // <video src>/<source src> (нативный HLS на iOS) НАПРЯМУЮ — мимо fetch/XHR
  // хуков. Наблюдатель переписывает interkh URL в прокси до запроса.
  function proxifyElement(el) {
    try {
      if (!el || el.nodeType !== 1) return;
      var tag = el.tagName;
      if (tag !== 'IMG' && tag !== 'TRACK' && tag !== 'SOURCE' &&
          tag !== 'VIDEO' && tag !== 'AUDIO') return;
      var raw = el.getAttribute && el.getAttribute('src');
      if (!raw) return;
      var proxied = toProxyUrl(raw);
      if (proxied) {
        el.setAttribute('src', proxied);
        log('Element src → media proxy:', tag, raw.slice(0, 60));
      }
    } catch(e) {}
  }
  var mediaObs = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mu = mutations[i];
      if (mu.type === 'attributes') {
        proxifyElement(mu.target);
      } else {
        var added = mu.addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          proxifyElement(node);
          if (node.querySelectorAll) {
            var inner = node.querySelectorAll('img, track, source, video, audio');
            for (var k = 0; k < inner.length; k++) proxifyElement(inner[k]);
          }
        }
      }
    }
  });
  try {
    mediaObs.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src']
    });
  } catch(e) { log('media observer failed', e); }

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
