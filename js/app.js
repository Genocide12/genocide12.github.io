// Filmotiv Core Module — constants, helpers, user identification
// Loaded BEFORE app.js. Attaches to window.FilmotivApp namespace.
(function() {
  'use strict';
  var App = window.FilmotivApp = window.FilmotivApp || {};

  App.CORE = {
    API_BASE: '/api/kinopoisk',
    SW_CACHE_VERSION: '164',

    // ================= МУЛЬТИ-ДОМЕННЫЙ API (зеркало) =================
    // vercel.app частично блокируется из РФ: РКН режет TCP до части
    // edge-IP Vercel (проверено check-host.net 2026-09-24: из 3 RU-нод
    // у 2-х Connection timed out, у 1-й 200 OK) — сайт «открывается через
    // раз / только с VPN». Зеркало на GitHub Pages (genocide12.github.io)
    // отдаёт статику (GitHub из РФ доступен), а API строится по цепочке:
    //   1) same-origin (на vercel — это и есть прод)
    //   2) vercel напрямую (с зеркала; работает, если IP не заблокирован)
    //   3) URL деплоя filmotiv-5sp8sjewa-... (другой edge-IP, доступен
    //      из РФ без VPN — подтверждено пользователем 2026-09-24)
    //   4) Cloudflare-прокси allorigins (доступен из РФ, IP 188.114.x.x)
    // Рабочее происхождение «залипает» (sessionStorage + api-origin.js
    // держит час в localStorage). POST-запросы ротируются тем же способом
    // через window.FilmotivAPIOrigin.apiFetch (загружается перед app.js).
    // v191: ПОЛНАЯ РАЗВЯЗКА ПРОЕКТОВ (запрос пользователя: «разные проекты,
    // у каждого всё своё»). Удалён edge-прокси Genopoisk; в цепочке —
    // ТОЛЬКО собственные хосты Filmotiv, включая стабильные
    // project/branch-хосты (наработка из api-origin.js теперь и в GET-
    // ротации ленты). Sticky-ключ поднят до v3 (сброс индексов старой
    // цепочки). Свой чистый домен у Filmotiv (когда появится) встанет
    // сюда первым без изменения механики.
    API_ORIGIN_VERCEL: 'https://filmotiv.vercel.app',
    API_ORIGIN_PROJECT: 'https://filmotiv-genocide12s-projects.vercel.app',
    API_ORIGIN_BRANCH: 'https://filmotiv-git-main-genocide12s-projects.vercel.app',
    API_ORIGIN_BACKUP: 'https://filmotiv-5sp8sjewa-genocide12s-projects.vercel.app',
    API_PROXY_PREFIX: 'https://api.allorigins.win/raw?url=',
    apiOrigins: function() {
      if (this._apiOrigins) return this._apiOrigins;
      var h = (location.hostname || '');
      var isProd = h.indexOf('vercel.app') !== -1 || h === 'localhost' || h.indexOf('127.0.0.1') !== -1;
      this._apiOrigins = isProd
        ? ['']
        : [this.API_ORIGIN_VERCEL, this.API_ORIGIN_PROJECT, this.API_ORIGIN_BRANCH, this.API_ORIGIN_BACKUP, 'PROXY:' + this.API_PROXY_PREFIX];
      return this._apiOrigins;
    },
    stickyOrigin: function() {
      try { var v = parseInt(sessionStorage.getItem('filmotiv_api_origin_v3'), 10); return isNaN(v) ? -1 : v; } catch (_) { return -1; }
    },
    setStickyOrigin: function(i) {
      try { sessionStorage.setItem('filmotiv_api_origin_v3', String(i)); } catch (_) {}
    },
    urlForOrigin: function(origin, url) {
      if (origin === '') return url;
      if (origin.indexOf('PROXY:') === 0) return origin.slice(6) + encodeURIComponent(this.API_ORIGIN_VERCEL + url);
      return origin + url;
    },
    // POST/любые fetch к /api/* с ротацией происхождения (зеркало → vercel).
    // api-origin.js должен быть загружен РАНЬШЕ app.js (см. index.html).
    apiSend: function(path, opts) {
      if (window.FilmotivAPIOrigin) return window.FilmotivAPIOrigin.apiFetch(path, opts);
      return fetch(path, opts);
    },
    // POST JSON + удобный возврат Response|null
    apiPost: function(path, bodyObj) {
      return this.apiSend(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(bodyObj || {})
      });
    },
    // Собрать URL API с учётом «залипшего» происхождения (для fetch вне apiGet:
    // постеры, предзагрев и т.п.)
    resolveApi: function(pathWithQuery) {
      var origins = this.apiOrigins();
      var sticky = this.stickyOrigin();
      var oi = (sticky >= 0 && sticky < origins.length) ? sticky : 0;
      return this.urlForOrigin(origins[oi], pathWithQuery);
    },

    // --- User identification ---
    // Priority: 1) Stored TG user ID  2) Stable localStorage web_ ID
    getUserId: function() {
      var tgId = localStorage.getItem('filmotiv_tg_user_id');
      if (tgId) return tgId;
      var id = localStorage.getItem('filmotiv_user_id');
      if (!id) {
        var rand = Math.random().toString(36).slice(2, 11);
        var time = Date.now().toString(36);
        id = 'web_' + time + '_' + rand;
        localStorage.setItem('filmotiv_user_id', id);
      }
      return id;
    },

    getTgInitData: function() {
      try {
        var t = window.Telegram && window.Telegram.WebApp;
        return t && t.initData ? t.initData : '';
      } catch (_) { return ''; }
    },

    // --- Escape HTML ---
    escapeHtml: function(s) {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    // --- Флаг страны производства (после года на карточках) ---
    // Русские названия стран из Кинопоиска → ISO-код → эмодзи-флаг.
    COUNTRY_ISO: {
      'Россия': 'RU', 'СССР': 'RU', 'США': 'US', 'Великобритания': 'GB', 'Франция': 'FR',
      'Германия': 'DE', 'Италия': 'IT', 'Испания': 'ES', 'Канада': 'CA', 'Австралия': 'AU',
      'Япония': 'JP', 'Южная Корея': 'KR', 'Корея Южная': 'KR', 'Китай': 'CN', 'Гонконг': 'HK',
      'Тайвань': 'TW', 'Индия': 'IN', 'Бразилия': 'BR', 'Мексика': 'MX', 'Аргентина': 'AR',
      'Швеция': 'SE', 'Норвегия': 'NO', 'Дания': 'DK', 'Финляндия': 'FI', 'Исландия': 'IS',
      'Польша': 'PL', 'Чехия': 'CZ', 'Словакия': 'SK', 'Венгрия': 'HU', 'Румыния': 'RO',
      'Болгария': 'BG', 'Греция': 'GR', 'Турция': 'TR', 'Украина': 'UA', 'Беларусь': 'BY',
      'Казахстан': 'KZ', 'Узбекистан': 'UZ', 'Кыргызстан': 'KG', 'Грузия': 'GE', 'Армения': 'AM',
      'Азербайджан': 'AZ', 'Литва': 'LT', 'Латвия': 'LV', 'Эстония': 'EE', 'Молдова': 'MD',
      'Израиль': 'IL', 'Иран': 'IR', 'Ирак': 'IQ', 'Египет': 'EG', 'Марокко': 'MA',
      'Тунис': 'TN', 'Алжир': 'DZ', 'Нигерия': 'NG', 'ЮАР': 'ZA', 'Кения': 'KE',
      'Эфиопия': 'ET', 'Гана': 'GH', 'Таиланд': 'TH', 'Вьетнам': 'VN', 'Филиппины': 'PH',
      'Индонезия': 'ID', 'Малайзия': 'MY', 'Сингапур': 'SG', 'Новая Зеландия': 'NZ',
      'Ирландия': 'IE', 'Бельгия': 'BE', 'Нидерланды': 'NL', 'Швейцария': 'CH', 'Австрия': 'AT',
      'Португалия': 'PT', 'Сербия': 'RS', 'Хорватия': 'HR', 'Словения': 'SI', 'Босния и Герцеговина': 'BA',
      'Северная Македония': 'MK', 'Черногория': 'ME', 'Албания': 'AL', 'Куба': 'CU',
      'Венесуэла': 'VE', 'Чили': 'CL', 'Колумбия': 'CO', 'Перу': 'PE', 'Уругвай': 'UY',
      'Панама': 'PA', 'Пакистан': 'PK', 'Бангладеш': 'BD', 'Шри-Ланка': 'LK', 'Монголия': 'MN',
      'ОАЭ': 'AE', 'Саудовская Аравия': 'SA', 'Катар': 'QA', 'Кувейт': 'KW', 'Иордания': 'JO',
      'Ливан': 'LB', 'Сирия': 'SY', 'Афганистан': 'AF', 'Лихтенштейн': 'LI', 'Люксембург': 'LU',
      'Мальта': 'MT', 'Кипр': 'CY', 'Индонезия ': 'ID'
    },
    isoToFlag: function(iso) {
      if (!iso || iso.length !== 2) return '';
      try {
        var a = iso.toUpperCase().charCodeAt(0), b = iso.toUpperCase().charCodeAt(1);
        return String.fromCodePoint(127397 + a, 127397 + b);
      } catch (_) { return ''; }
    },
    flagOf: function(film) {
      try {
        var c = film && film.countries && film.countries[0] && film.countries[0].country;
        if (!c) return '';
        var iso = App.CORE.COUNTRY_ISO[String(c).trim()] || App.CORE.COUNTRY_ISO[String(c).trim().replace(/ё/g, 'е')];
        return App.CORE.isoToFlag(iso);
      } catch (_) { return ''; }
    },

    // --- Mobile detection ---
    isMobileView: function() {
      return window.innerWidth <= 768;
    },

    // --- Constants for pagination ---
    MOBILE_INITIAL: 8,
    MOBILE_CHUNK: 6
  };

  // Expose globally for app.js
  window.API_BASE = App.CORE.API_BASE;
  window.SW_CACHE_VERSION = App.CORE.SW_CACHE_VERSION;
  window.getUserId = App.CORE.getUserId;
  window.getTgInitData = App.CORE.getTgInitData;
})();
// Filmotiv Device Module — TV/projector/mobile detection, theme system
(function() {
  'use strict';
  var App = window.FilmotivApp = window.FilmotivApp || {};

  App.DEVICE = {
    // --- TV/Projector detection ---
    isTVDevice: function() {
      var ua = (navigator.userAgent || '').toLowerCase();
      var tvPatterns = ['tv', 'television', 'googletv', 'android tv', 'smarttv', 'smart tv',
                        'projector', 'bravia', 'webos', 'tizen', 'hbbtv', 'roku', 'firetv',
                        'aftt', 'aftm', 'bento'];
      for (var i = 0; i < tvPatterns.length; i++) {
        if (ua.indexOf(tvPatterns[i]) !== -1) return true;
      }
      var isAndroid = ua.indexOf('android') !== -1;
      var hasRealTouch = (navigator.maxTouchPoints || 0) > 0;
      if (isAndroid && window.innerWidth >= 1024 && !hasRealTouch) return true;
      return false;
    },

    // --- Mobile detection ---
    isMobile: function() {
      var ua = (navigator.userAgent || '').toLowerCase();
      if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) return true;
      if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
      return false;
    },

    isIOS: function() {
      var ua = navigator.userAgent || '';
      var platform = navigator.platform || '';
      if (/iPhone|iPad|iPod/i.test(ua)) return true;
      if (platform === 'MacIntel' && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
      return false;
    },

    // --- Theme system ---
    getThemeMode: function() {
      try { return localStorage.getItem('filmotiv_theme') || 'auto'; }
      catch (_) { return 'auto'; }
    },

    setThemeMode: function(mode) {
      try { localStorage.setItem('filmotiv_theme', mode); } catch (_) {}
    },

    applyTheme: function(mode) {
      document.body.classList.remove('light-theme', 'night-theme');
      if (mode === 'light') document.body.classList.add('light-theme');
      else if (mode === 'night') document.body.classList.add('night-theme');
      // 'dark', 'auto' и 'night' — неон-скин V5 всегда тёмный: светлая
      // системная тема больше не включает light-theme (ломал неон-дизайн).
    },

    getCurrentMode: function() {
      return App.DEVICE.getThemeMode();
    },

    cycleTheme: function() {
      // Cycle: dark → light (only 2 themes, no auto/night)
      var modes = ['dark', 'light'];
      var current = App.DEVICE.getThemeMode();
      // If current is 'auto' or 'night', start cycling from dark
      if (current === 'auto' || current === 'night') current = 'dark';
      var idx = modes.indexOf(current);
      if (idx === -1) idx = 0;
      var next = modes[(idx + 1) % modes.length];
      App.DEVICE.setThemeMode(next);
      App.DEVICE.applyTheme(next);
      return next;
    },

    // --- PWA detection ---
    isStandalone: function() {
      try {
        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
               (window.navigator.standalone === true);
      } catch (_) { return false; }
    },

    isTelegramMiniApp: function(tg) {
      try {
        if (!tg) return false;
        if (tg.initData && tg.initData.length > 0) return true;
        if (tg.platform && tg.platform !== 'unknown') return true;
        return false;
      } catch (_) { return false; }
    }
  };

  // Expose globally
  window.isTVDevice = App.DEVICE.isTVDevice;
  window.isMobileView = function() { return window.innerWidth <= 768; };
})();
// Filmotiv Auth Module — Telegram init, session management
(function() {
  'use strict';
  var App = window.FilmotivApp = window.FilmotivApp || {};

  var tg = null;
  var tgInitData = '';

  App.AUTH = {
    getTg: function() { return tg; },
    getTgInitData: function() { return tgInitData; },

    initTelegramWebApp: function() {
      tg = window.Telegram && window.Telegram.WebApp;
      if (!tg) return null;
      try {
        tg.ready();
        tg.expand();
        if (tg.setHeaderColor) tg.setHeaderColor('#000000');
        if (tg.setBackgroundColor) tg.setBackgroundColor('#000000');
      } catch (_) {}
      tgInitData = tg.initData || '';
      if (tgInitData) {
        try {
          var params = new URLSearchParams(tgInitData);
          var userJson = params.get('user');
          if (userJson) {
            var u = JSON.parse(userJson);
            localStorage.setItem('filmotiv_tg_user_id', String(u.id));
            if (u.username) localStorage.setItem('filmotiv_tg_username', u.username);
            console.log('[tg] Linked TG user ID:', u.id, 'username:', u.username);
          }
        } catch (_) {}
      }
      console.log('[tg] Telegram WebApp initialized, has initData:', !!tgInitData);
      return tg;
    },

    checkTgLoginBar: function() {
      var tgPlatform = (tg && tg.platform) ? tg.platform : 'unknown';
      var isInTelegram = !!(tg && tg.initData) || (tg && tgPlatform && tgPlatform !== 'unknown');
      var storedTgId = localStorage.getItem('filmotiv_tg_user_id');
      var storedTgUsername = localStorage.getItem('filmotiv_tg_username');
      var isLoggedIn = !!(storedTgId || storedTgUsername);

      var fixedBtn = document.getElementById('fixedTelegramBtn');
      var fixedText = document.getElementById('fixedTelegramText');
      var isTVDevice = App.DEVICE.isTVDevice();

      if (!fixedBtn) return;

      if (isInTelegram) {
        fixedBtn.classList.add('hidden');
        fixedBtn.classList.add('hidden-by-tv');
      } else if (isTVDevice) {
        // TV devices: hide the Telegram button entirely — login flow
        // works on phone/desktop, no auth possible on TV.
        fixedBtn.classList.add('hidden');
        fixedBtn.classList.add('hidden-by-tv');
      } else {
        fixedBtn.classList.remove('hidden');
        if (fixedText) {
          if (isLoggedIn) {
            fixedText.textContent = 'Открыть Telegram';
            fixedBtn.href = 'https://t.me/Filmotivbot?start=app';
            fixedBtn.onclick = null;
          } else {
            fixedText.textContent = 'Открыть Telegram';
            var guestId = localStorage.getItem('filmotiv_user_id');
            if (guestId && guestId.indexOf('web_') === 0) {
              fixedBtn.href = '/api/auth/telegram/login?guest_id=' + encodeURIComponent(guestId);
            } else {
              fixedBtn.href = '/api/auth/telegram/login';
            }
            fixedBtn.onclick = null;
          }
        }
      }
    },

    // --- Premium badge (🔥) in hero title ---
    // Reads is_premium from /api/me response or localStorage cache and
    // toggles the 🔥 badge before "Filmotiv" in the hero title.
    updatePremiumBadge: function(isPremium) {
      var badge = document.getElementById('premiumBadge');
      if (!badge) return;
      // CSS class handles all sizing/alignment. We just toggle display.
      badge.style.display = isPremium ? 'inline-block' : 'none';
      if (isPremium) {
        try { localStorage.setItem('filmotiv_is_premium', '1'); } catch(_) {}
      } else {
        try { localStorage.removeItem('filmotiv_is_premium'); } catch(_) {}
      }
    },

    // Restore premium badge from localStorage on initial page load (instant,
    // before /api/me returns). /api/me will then confirm or correct it.
    restorePremiumBadge: function() {
      try {
        var cached = localStorage.getItem('filmotiv_is_premium');
        var badge = document.getElementById('premiumBadge');
        if (badge && cached === '1') badge.style.display = 'inline-block';
      } catch(_) {}
    },

    checkAuth: async function() {
      var tgId = localStorage.getItem('filmotiv_tg_user_id');
      var tgUsername = localStorage.getItem('filmotiv_tg_username');
      if (!tgId && !tgUsername) return;
      if (tg && tg.initData) return;
      try {
        var res = await App.CORE.apiPost('/api/me', { userId: tgId, username: tgUsername, initData: App.CORE.getTgInitData() });
        if (!res || !res.ok) return; // network error — don't reload
        var data = await res.json();
        // Update premium badge based on server response
        if (typeof data.is_premium !== 'undefined') {
          App.AUTH.updatePremiumBadge(!!data.is_premium);
        }
        // Only reload if server EXPLICITLY says reauth AND user was previously
        // logged in (had tgId in localStorage). Don't reload on transient
        // network glitches or empty responses — that caused random refreshes.
        if (data.reauth === true && data.exists === false && tgId) {
          // Only reload if this is a CONFIRMED reauth — mark it so we don't
          // loop. User must manually re-login via /start in the bot.
          localStorage.removeItem('filmotiv_tg_user_id');
          localStorage.removeItem('filmotiv_tg_user_name');
          localStorage.removeItem('filmotiv_tg_username');
          // Don't auto-reload — just update the UI. User can reload manually.
          console.warn('[auth] Session expired. User needs to re-login via bot /start.');
        }
      } catch (e) { console.warn('[auth] check failed (non-fatal):', e); }
    },

    handleOAuthRedirect: function() {
      var urlParams = new URLSearchParams(window.location.search);
      var telegramLogin = urlParams.get('telegram_login');
      var tgIdFromUrl = urlParams.get('tg_id');
      var tgNameFromUrl = urlParams.get('tg_name');
      var tgUsernameFromUrl = urlParams.get('tg_username');

      if (telegramLogin === 'success' && tgIdFromUrl) {
        // SYNC FIX: выгружаем локальную коллекцию гостя в аккаунт ДО перезагрузки.
        // Раньше favourites, добавленные на сайте до логина, оставались только
        // в sessionStorage и терялись (серверная миграция web_* строк не находила —
        // track.js их не создаёт). Сервер сам дедуплицирует по filmId.
        try {
          var guestFavs = JSON.parse(sessionStorage.getItem('filmotiv_fav_cache') || '[]');
          if (Array.isArray(guestFavs)) {
            guestFavs.forEach(function(f) {
              var fid = f && (f.filmId || f.kinopoiskId);
              if (!fid) return;
              var body = JSON.stringify({
                type: 'favorite_added', userId: String(tgIdFromUrl),
                filmId: String(fid), title: f.title || f.nameRu || '',
                year: f.year || '', poster: f.poster || f.posterUrlPreview || '',
                platform: 'browser'
              });
              if (navigator.sendBeacon) {
                var bUrl = window.FilmotivAPIOrigin ? window.FilmotivAPIOrigin.beaconUrl('/api/track') : '/api/track';
                navigator.sendBeacon(bUrl, new Blob([body], { type: 'application/json' }));
              } else {
                App.CORE.apiSend('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
              }
            });
          }
        } catch (_) {}
        localStorage.setItem('filmotiv_tg_user_id', String(tgIdFromUrl));
        if (tgNameFromUrl) localStorage.setItem('filmotiv_tg_user_name', tgNameFromUrl);
        if (tgUsernameFromUrl) localStorage.setItem('filmotiv_tg_username', tgUsernameFromUrl);
        localStorage.removeItem('filmotiv_user_id');
        history.replaceState(null, '', window.location.pathname);
        window.location.reload();
      } else if (telegramLogin === 'error') {
        console.error('[tg] OIDC login error:', urlParams.get('message'));
        history.replaceState(null, '', window.location.pathname);
      } else if (tgIdFromUrl && !telegramLogin) {
        localStorage.setItem('filmotiv_tg_user_id', String(tgIdFromUrl));
        if (tgNameFromUrl) localStorage.setItem('filmotiv_tg_user_name', tgNameFromUrl);
        history.replaceState(null, '', window.location.pathname);
        window.location.reload();
      }
    }
  };

  // Expose globally
  window.checkTgLoginBar = App.AUTH.checkTgLoginBar;
  window.checkAuth = App.AUTH.checkAuth;
  window.openPlayer = function(filmId, title, poster) {
    // Track that user opened this film (adds to "My Films" history)
    // Use sendBeacon for fire-and-forget (won't be cancelled by page navigation)
    if (navigator.sendBeacon) {
      try {
        var uid = App.CORE.getUserId();
        var initData = App.CORE.getTgInitData();
        var body = JSON.stringify({ type: 'movies_opened', userId: uid, initData: initData, filmId: String(filmId), title: title });
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/track', blob);
      } catch (_) {}
    } else if (window.trackEvent) {
      window.trackEvent('movies_opened', { filmId: filmId, title: title });
    }
    // Запись для блока «Последние фильмы» (3 последних открытых) в правой панели
    try {
      var rec = JSON.parse(localStorage.getItem('filmotiv_recent_films') || '[]');
      if (!Array.isArray(rec)) rec = [];
      rec = rec.filter(function(x) { return x && String(x.filmId) !== String(filmId); });
      rec.unshift({ filmId: String(filmId || ''), title: title || '', poster: poster || '', year: '', ts: Date.now() });
      if (rec.length > 3) rec = rec.slice(0, 3);
      localStorage.setItem('filmotiv_recent_films', JSON.stringify(rec));
    } catch (_) {}
    window.location.href = 'player.html?id=' + filmId + '&title=' + encodeURIComponent(title);
  };
})();
// Filmotiv UI Module — loader, empty states, film display, toast
(function() {
  'use strict';
  var App = window.FilmotivApp = window.FilmotivApp || {};

  App.UI = {
    showLoader: function() {
      var content = document.getElementById('content');
      var loader = document.getElementById('loader');
      if (content) content.classList.remove('hidden');
      if (loader) loader.classList.remove('hidden');
    },

    hideLoader: function() {
      var loader = document.getElementById('loader');
      if (loader) loader.classList.add('hidden');
    },

    showEmptyState: function(msg, icon) {
      var filmGrid = document.getElementById('filmGrid');
      if (filmGrid) {
        var ic = icon || '🎬';
        filmGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">' + ic + '</div><div class="empty-text">' + (msg || 'По вашему запросу фильмов не найдено 🤔 Попробуйте найти что-нибудь другое!') + '</div></div>';
      }
      App.UI.hideLoader();
    },

    // --- Кнопка «Показать ещё» (страховка бесконечного скролла) ---
    updateLoadMoreBtn: function() {
      var btn = document.getElementById('loadMoreBtn');
      if (!btn) return;
      try {
        var st = App.MOVIES.getState();
        var grid = document.getElementById('filmGrid');
        var hasCards = grid && grid.children.length > 0 && !grid.querySelector('.empty-state');
        var show = !!st.currentCategory && st.currentCategory !== 'random' && st.hasMore && hasCards && !st.isLoading;
        btn.hidden = !show;
        btn.textContent = st.isLoading ? 'Загрузка...' : 'Показать ещё';
        if (st.isLoading) btn.disabled = true; else btn.disabled = false;
      } catch (_) { btn.hidden = true; }
    },

    clearFilms: function() {
      var filmGrid = document.getElementById('filmGrid');
      if (filmGrid) {
        filmGrid.innerHTML = '';
        filmGrid.classList.remove('centered');
        filmGrid.classList.remove('random-mode');
      }
      App.UI.updateLoadMoreBtn();
    },

    // --- Toast ---
    showToast: function(msg, duration) {
      duration = duration || 3000;
      var toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;z-index:9999;max-width:90%;text-align:center;';
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, duration);
    },

    // --- Film card rendering ---
    // displayFilms = REPLACE grid contents (clears first, then appends).
    // Use appendFilms() directly to ADD films without clearing (used by infinite scroll).
    displayFilms: function(films, forceCenter) {
      if (!films || films.length === 0) {
        if (document.getElementById('filmGrid').children.length === 0) {
          App.UI.showEmptyState('По вашему запросу фильмов не найдено 🤔 Попробуйте найти что-нибудь другое!', '🔍');
        }
        return;
      }
      App.UI.clearFilms();
      App.UI.appendFilms(films, forceCenter);
    },

    appendFilms: function(films, forceCenter) {
      var filmGrid = document.getElementById('filmGrid');
      if (!filmGrid) return;
      var SW = window.SW_CACHE_VERSION || '67';
      var isMobile = window.innerWidth <= 768;
      var eagerCount = isMobile ? 6 : 12;

      var frag = document.createDocumentFragment();
      var userLang = window.__filmotivLang || 'ru';
      var isEn = (userLang === 'en');
      films.forEach(function(film, index) {
        var filmId = film.filmId || film.kinopoiskId;
        // Show nameRu for RU users, nameEn for EN users (fallback to other).
        var title = isEn ? (film.nameEn || film.nameRu || 'Untitled') : (film.nameRu || film.nameEn || 'Без названия');
        var year = film.year || '';
        // Rating: Kinopoisk for RU, IMDb for EN (both 1-10 scale).
        var rating = isEn ? (film.ratingImdb || film.ratingKinopoisk || film.rating) : (film.ratingKinopoisk || film.ratingImdb || film.rating);
        if (rating && !isNaN(Number(rating))) rating = Number(rating).toFixed(1);
        else rating = null;
        var genres = '';
        if (film.genres && film.genres.length > 0) {
          genres = film.genres.slice(0, 3).map(function(g) { return g.genre; }).join(', ');
        }
        // Country (first 1-2)
        var countries = '';
        if (film.countries && film.countries.length > 0) {
          countries = film.countries.slice(0, 2).map(function(c) { return c.country; }).join(', ');
        }
        // Film length
        var length = film.filmLength || '';
        if (length && !isNaN(Number(length))) {
          var hrs = Math.floor(Number(length) / 60);
          var mins = Number(length) % 60;
          length = (hrs > 0 ? hrs + 'ч ' : '') + mins + 'мин';
        }
        // Description NOT shown on cards — only title, year, genres, rating.
        // var description = film.shortDescription || film.description || '';
        // Use direct poster URL from API data (faster — no proxy needed).
        // Fallback to /api/poster proxy if direct URL fails.
        var directPoster = film.posterUrlPreview || film.posterUrl || '';
        var proxyPoster = filmId ? '/api/poster?id=' + filmId + '&size=small&_v=' + SW : '';
        var poster = directPoster || proxyPoster;
        var isAboveFold = index < eagerCount;
        var loadingAttr = isAboveFold ? 'eager' : 'lazy';
        var fetchPriority = isAboveFold ? 'fetchpriority="high"' : '';

        var card = document.createElement('div');
        card.className = 'film-card';
        if (index < 10) card.style.animationDelay = (index * 0.04) + 's';

        var img = document.createElement('img');
        img.src = poster;
        img.alt = title;
        img.width = 200;
        img.height = 300;
        img.loading = loadingAttr;
        img.decoding = 'async';
        if (fetchPriority) img.setAttribute('fetchpriority', 'high');
        img.classList.add('film-poster');
        img.onload = function() { this.classList.add('loaded'); };
        img.onerror = function() {
          if (directPoster && proxyPoster) {
            // Try proxy as fallback
            this.onerror = function() {
              this.classList.add('error');
              this.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 300%22><rect fill=%22%232C2C2E%22 width=%22200%22 height=%22300%22/><text x=%22100%22 y=%22160%22 text-anchor=%22middle%22 fill=%22%2398989D%22 font-size=%2214%22>Нет постера</text></svg>';
            };
            this.src = proxyPoster;
          } else {
            this.classList.add('error');
            this.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 300%22><rect fill=%22%232C2C2E%22 width=%22200%22 height=%22300%22/><text x=%22100%22 y=%22160%22 text-anchor=%22middle%22 fill=%22%2398989D%22 font-size=%2214%22>Нет постера</text></svg>';
          }
        };
        card.appendChild(img);

        var info = document.createElement('div');
        info.className = 'film-info';
        // Meta: год · флаг страны · страна · жанры · длина · рейтинг
        // Флаг страны производства — сразу ПОСЛЕ года выпуска (запрос пользователя).
        var flag = App.CORE.flagOf(film);
        var metaParts = [];
        if (year) metaParts.push('<span>' + year + '</span>');
        if (flag) metaParts.push('<span class="film-flag">' + flag + '</span>');
        if (countries) metaParts.push('<span class="film-genres">' + countries + '</span>');
        if (genres) metaParts.push('<span class="film-genres">' + genres + '</span>');
        if (length) metaParts.push('<span class="film-genres">' + length + '</span>');
        var metaHtml = metaParts.join(' · ');
        if (rating) metaHtml += ' <span class="rating">⭐ ' + rating + '</span>';
        info.innerHTML = '<div class="film-title">' + App.CORE.escapeHtml(title) + '</div><div class="film-meta">' + metaHtml + '</div>';
        card.appendChild(info);
        card.dataset.filmId = filmId || '';
        card.dataset.title = title;
        card.dataset.year = year;
        card.dataset.rating = (rating !== 'Н/Д') ? rating : '';
        card.dataset.poster = poster || '';
        card.onclick = function() { window.openPlayer(filmId, title, poster); };
        frag.appendChild(card);
      });
      filmGrid.appendChild(frag);
      App.UI.hideLoader();
      // Single film or forceCenter → centered layout.
      // Multi-film → ensure grid (remove centered/random-mode from prev state).
      if (forceCenter || films.length === 1) {
        filmGrid.classList.add('centered');
      } else {
        filmGrid.classList.remove('centered');
        filmGrid.classList.remove('random-mode');
      }
    }
  };

  // Expose globally
  window.showLoader = App.UI.showLoader;
  window.hideLoader = App.UI.hideLoader;
  window.showEmptyState = App.UI.showEmptyState;
  window.clearFilms = App.UI.clearFilms;
  window.displayFilms = App.UI.displayFilms;
  window.appendFilms = App.UI.appendFilms;
})();
// Filmotiv Movies Module — catalog loading, search, favorites, pagination
(function() {
  'use strict';
  var App = window.FilmotivApp = window.FilmotivApp || {};

  var currentCategory = null;
  var currentPage = 1;
  var hasMore = true;
  var isLoading = false;
  var filmBuffer = [];
  var MOBILE_INITIAL = 8;
  var MOBILE_CHUNK = 6;

  App.MOVIES = {
    getState: function() {
      return { currentCategory: currentCategory, currentPage: currentPage, hasMore: hasMore, isLoading: isLoading };
    },
    setCategory: function(cat) { currentCategory = cat; },
    resetPagination: function() { currentPage = 1; hasMore = true; filmBuffer = []; },
    setBuffer: function(buf) { filmBuffer = buf; },
    getBuffer: function() { return filmBuffer; },
    drainBuffer: function() {
      if (filmBuffer.length === 0) return [];
      var chunk = filmBuffer.splice(0, MOBILE_CHUNK);
      return chunk;
    },

    // --- API calls ---
    // apiGet с ротацией происхождений (прод / зеркало → vercel → Cloudflare-
    // прокси). Сетевой сбой или 5xx/429 на одном происхождении → пробуем
    // следующее; успех «залипает» на сессию. Логика ретрая внутри одного
    // происхождения сохранена (одна повторная попытка на retryable-статусы).
    apiGet: async function(url) {
      var origins = App.CORE.apiOrigins();
      var sticky = App.CORE.stickyOrigin();
      var order = [];
      if (sticky >= 0 && sticky < origins.length) order.push(sticky);
      for (var oi0 = 0; oi0 < origins.length; oi0++) {
        if (order.indexOf(oi0) === -1) order.push(oi0);
      }
      var lastErr = null;
      for (var a = 0; a < order.length; a++) {
        var oi = order[a];
        var full = App.CORE.urlForOrigin(origins[oi], url);
        for (var tryNo = 0; tryNo < 2; tryNo++) {
          try {
            var res = await fetch(full, { headers: { 'Content-Type': 'application/json' } });
            if (res.ok) {
              if (oi !== 0 || tryNo > 0) App.CORE.setStickyOrigin(oi);
              return await res.json();
            }
            var errData = null;
            try { errData = await res.json(); } catch (_) {}
            var isRetryable = (res.status === 429 || res.status === 403 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504);
            lastErr = (errData && errData.message) ? new Error(errData.message) : new Error('HTTP ' + res.status);
            if (!isRetryable) throw lastErr;              // 4xx — ретраить бесполезно
            if (tryNo === 0) { await new Promise(function(r) { setTimeout(r, 300); }); continue; } // ретрай того же origin
            break;                                        // → следующее происхождение
          } catch (e) {
            lastErr = e;
            break;                                        // сеть/таймаут → следующее происхождение
          }
        }
      }
      throw lastErr || new Error('Request failed');
    },

    extractFilms: function(data) {
      if (!data) return [];
      return data.films || data.items || data.results || [];
    },

    // ============ ФИЛЬТР «ФИЛЬМ ЕСТЬ В ПЛЕЕРЕ» ============
    // Задача пользователя: «в выдаче часто фильмы, которых в плеере нет!
    // особенно в Новинках — добавь проверку».
    // Плеер играет через api.embess.ws/embed/kp/{id}: 200 — есть, 404 — нет.
    // ВАЖНО (диагностика 2026-09-24): embess ОТВЕЧАЕТ 422 (пустое тело,
    // Content-Length: 0) на перегруженный IP — это троттлинг, а НЕ «нет
    // фильма»! Один и тот же фильм мигрирует 200 <-> 422 между запросами.
    // Поэтому: 404 = точно нет; 200 = есть; 422/прочее = НЕИЗВЕСТНО (null).
    // v184: прямые проверки из браузера полностью убраны — они сами были
    // причиной 422-шторма (см. комментарий у filterAvailable). Остались
    // только пассивные источники фактов: общий кеш + write-back плеера.
    // Локальный кеш 7 дней в localStorage.
    _availCache: null,
    getAvailMap: function() {
      if (this._availCache) return this._availCache;
      try {
        var raw = localStorage.getItem('filmotiv_avail_v1');
        if (raw) {
          var p = JSON.parse(raw);
          if (p && p.map && Date.now() - p.ts < 7 * 24 * 60 * 60 * 1000) {
            this._availCache = p.map;
            return this._availCache;
          }
        }
      } catch (_) {}
      this._availCache = {};
      return this._availCache;
    },
    saveAvailMap: function() {
      try { localStorage.setItem('filmotiv_avail_v1', JSON.stringify({ map: this._availCache, ts: Date.now() })); } catch (_) {}
    },
    // v184 — ФИЛЬТР «ФИЛЬМ ЕСТЬ В ПЛЕЕРЕ» БЕЗ ПРЯМЫХ ПРОВЕРОК.
    // Прямые проверки embess из браузера (v178-v183, квоты 120→24) УДАЛЕНЫ:
    // они раскаляли семейство зеркал с IP пользователя (до ~48 запросов за
    // сессию, 2 хоста на проверку) → к открытию плеера ВСЕ хосты отвечали
    // 422 → «плеер не загружается» (консоль пользователя 2026-09-25: шесть
    // подряд 422 по всей цепочке). Теперь факты копятся пассивно и БЕЗ
    // единого запроса к зеркалам:
    //   • write-back при каждом успешном старте плеера (player.html);
    //   • серверный _embed-fetch (пишет факт на своей стороне);
    //   • общий кеш _embed-cache (Supabase), читается ниже.
    // Неизвестные фильмы остаются в выдаче (fail-open).
    filterAvailable: async function(films) {
      if (!Array.isArray(films) || films.length === 0) return films || [];
      var map = this.getAvailMap();
      var ids = [];
      for (var i = 0; i < films.length; i++) {
        var id = String(films[i].filmId || films[i].kinopoiskId || '');
        if (!id || /^\D/.test(id)) continue;
        if (map[id] === undefined && ids.indexOf(id) === -1) ids.push(id);
      }
      if (ids.length > 0) {
        try {
          var cUrl = App.CORE.API_BASE + '/_embed-cache?ids=' + encodeURIComponent(ids.slice(0, 120).join(','));
          var cData = await App.MOVIES.apiGet(cUrl);
          if (cData && cData.available) {
            for (var ck in cData.available) {
              if (Object.prototype.hasOwnProperty.call(cData.available, ck)) {
                map[String(ck)] = cData.available[ck] === true;
              }
            }
            this.saveAvailMap();
            console.log('[avail] shared cache facts:', Object.keys(cData.available).length, '/', ids.length);
          }
        } catch (_) { /* сервер недоступен — fail-open */ }
      }
      var anyFalse = false;
      for (var j = 0; j < films.length; j++) {
        var fid = String(films[j].filmId || films[j].kinopoiskId || '');
        if (map[fid] === false) { anyFalse = true; break; }
      }
      if (!anyFalse) return films;
      var out = films.filter(function(f) {
        var id2 = String(f.filmId || f.kinopoiskId || '');
        return map[id2] !== false;
      });
      console.log('[avail] filtered out', films.length - out.length, 'films missing from player');
      return out;
    },

    // «Смотрят онлайн» — топ-100 популярных Кинопоиска (то, чем сейчас
    // интересуются люди; раньше был свой фильтр NUM_VOTE по годам 2020-2025).
    getPopular: async function(page) {
      page = page || 1;
      var url = App.CORE.API_BASE + '/v2.2/films/top?type=TOP_100_POPULAR_FILMS&page=' + page;
      return App.MOVIES.extractFilms(await App.MOVIES.apiGet(url));
    },

    // Жанр — ПОЛНАЯ пагинация (раньше loadGenre грузил только page=1 без
    // «Показать ещё» — пользователь видел ровно 20 фильмов и жаловался,
    // что «в жанрах по-прежнему показывается мало фильмов»).
    getByGenre: async function(genreId, page) {
      page = page || 1;
      var url = App.CORE.API_BASE + '/v2.2/films?order=NUM_VOTE&type=FILM&genres=' + encodeURIComponent(genreId) + '&page=' + page;
      return App.MOVIES.extractFilms(await App.MOVIES.apiGet(url));
    },

    // «Фильмы» — весь каталог (без фильтра рейтинга), отдельная категория
    getFilms: async function(page) {
      page = page || 1;
      var url = App.CORE.API_BASE + '/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&page=' + page;
      return App.MOVIES.extractFilms(await App.MOVIES.apiGet(url));
    },

    // Четверговая подборка новинок (премьеры, включая ещё не вышедшие).
    // Крон /api/cron/weekly-new каждый четверг ЗАМЕНЯЕТ прошый список новым.
    weeklyNewCache: null,
    getWeeklyNew: async function() {
      if (App.MOVIES.weeklyNewCache) return App.MOVIES.weeklyNewCache;
      try {
        // apiGet: ротация происхождения (важно на зеркале — раньше был
        // голый fetch('/api/new-films') → 404 на genocide12.github.io)
        var res = await App.MOVIES.apiGet('/api/new-films');
        if (res && res.ok) {
          var data = await res.json();
          if (data && Array.isArray(data.films) && data.films.length > 0) {
            App.MOVIES.weeklyNewCache = data.films;
            return data.films;
          }
        }
      } catch (_) {}
      return null;
    },

    getTop250: async function(page) {
      page = page || 1;
      var url = App.CORE.API_BASE + '/v2.2/films/top?type=TOP_250_BEST_FILMS&page=' + page;
      var d = await App.MOVIES.apiGet(url);
      var f = App.MOVIES.extractFilms(d);
      if (f.length === 0) {
        var fb = App.CORE.API_BASE + '/v2.2/films?order=RATING&type=FILM&ratingFrom=8&ratingTo=10&page=' + page;
        return App.MOVIES.extractFilms(await App.MOVIES.apiGet(fb));
      }
      return f;
    },

    getNew: async function(page) {
      page = page || 1;
      // Приоритет — четверговая подборка (премьеры, замена прошых новинок)
      var weekly = await App.MOVIES.getWeeklyNew();
      if (weekly && weekly.length > 0) {
        var PER_PAGE = 20;
        return weekly.slice((page - 1) * PER_PAGE, page * PER_PAGE);
      }
      var year = new Date().getFullYear();
      var url = App.CORE.API_BASE + '/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&yearFrom=' + year + '&yearTo=' + year + '&page=' + page;
      return App.MOVIES.extractFilms(await App.MOVIES.apiGet(url));
    },

    getSeries: async function(page) {
      page = page || 1;
      var url = App.CORE.API_BASE + '/v2.2/films?order=NUM_VOTE&type=TV_SERIES&ratingFrom=7&ratingTo=10&page=' + page;
      return App.MOVIES.extractFilms(await App.MOVIES.apiGet(url));
    },

    getRandomFilm: async function() {
      // Track recently shown films to avoid duplicates
      if (!window._randomHistory) window._randomHistory = [];
      var history = window._randomHistory;
      var maxHistory = 20; // remember last 20 films

      // Try cached films first (instant — no API call)
      var cachedCats = ['top250', 'popular', 'new'];
      var allCached = [];
      for (var i = 0; i < cachedCats.length; i++) {
        try {
          var raw = localStorage.getItem('filmotiv_films_' + cachedCats[i] + '_1');
          if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.films && parsed.films.length > 0 &&
                (Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000)) {
              allCached = allCached.concat(parsed.films);
            }
          }
        } catch (_) {}
      }

      // Filter out recently shown films
      var available = allCached.filter(function(f) {
        var fid = String(f.filmId || f.kinopoiskId);
        return history.indexOf(fid) === -1;
      });

      // If all cached films were shown, reset history
      if (available.length === 0 && allCached.length > 0) {
        history = [];
        window._randomHistory = [];
        available = allCached;
      }

      if (available.length > 0) {
        var film = available[Math.floor(Math.random() * available.length)];
        var fid = String(film.filmId || film.kinopoiskId);
        history.push(fid);
        if (history.length > maxHistory) history.shift();
        return film;
      }

      // No cache — fetch from API
      var randomPage = Math.floor(Math.random() * 3) + 1;
      var films = await App.MOVIES.getTop250(randomPage);
      if (films && films.length > 0) {
        var film = films[Math.floor(Math.random() * films.length)];
        var fid = String(film.filmId || film.kinopoiskId);
        history.push(fid);
        if (history.length > maxHistory) history.shift();
        return film;
      }
      return null;
    },

    searchFilms: async function(query) {
      // Single page = 20 films (Kinopoisk search returns 20 per page).
      // For short queries (≤4 chars) fetch 2 pages IN PARALLEL for better results.
      var pages = query.length <= 4 ? 2 : 1;
      var urls = [];
      for (var p = 1; p <= pages; p++) {
        urls.push(App.CORE.API_BASE + '/v2.1/films/search-by-keyword?keyword=' + encodeURIComponent(query) + '&page=' + p);
      }
      var results = await Promise.all(urls.map(function(u) {
        return App.MOVIES.apiGet(u).then(function(d) { return App.MOVIES.extractFilms(d); }).catch(function() { return []; });
      }));
      var allFilms = results.reduce(function(a, b) { return a.concat(b); }, []);
      var q = query.toLowerCase();
      allFilms.sort(function(a, b) {
        var aName = (a.nameRu || a.nameEn || '').toLowerCase();
        var bName = (b.nameRu || b.nameEn || '').toLowerCase();
        var aStarts = aName.indexOf(q) === 0 ? 0 : 1;
        var bStarts = bName.indexOf(q) === 0 ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        var aContains = aName.indexOf(q) !== -1 ? 0 : 1;
        var bContains = bName.indexOf(q) !== -1 ? 0 : 1;
        if (aContains !== bContains) return aContains - bContains;
        return aName.localeCompare(bName, 'ru');
      });
      return allFilms;
    },

    // --- Category loading ---
    loadCategory: async function(category) {
      currentCategory = category;
      currentPage = 1;
      hasMore = true;
      filmBuffer = [];
      App.UI.clearFilms();
      App.UI.showLoader();
      var searchInput = document.getElementById('searchInput');
      if (searchInput) searchInput.value = '';
      if (window.trackEvent) window.trackEvent('categories_opened', { category: category });
      try {
        if (category === 'random') {
          // Don't clear films if already showing a random film — just replace it
          var existingGrid = document.getElementById('filmGrid');
          if (currentCategory === 'random' && existingGrid && existingGrid.children.length > 0) {
            // Already in random mode — just swap the film, keep layout
            App.UI.showLoader();
            var film = await App.MOVIES.getRandomFilm();
            App.UI.clearFilms();
            if (film) App.UI.displayFilms([film], true);
            else App.UI.showEmptyState('Упс, не удалось загрузить случайный фильм 🎲 Попробуйте ещё раз!', '🎲');
          } else {
            // First time clicking random — normal flow
            App.UI.showLoader();
            var film = await App.MOVIES.getRandomFilm();
            if (film) App.UI.displayFilms([film], true);
            else App.UI.showEmptyState('Упс, не удалось загрузить случайный фильм 🎲 Попробуйте ещё раз!', '🎲');
          }
        } else {
          // Cache-first: show cached films instantly
          // НО НЕ для «новинок» — четверговый список должен быть свежим
          // (крон каждую неделю ЗАМЕНЯЕТ его новым, локальный кеш устареет)
          try {
            var cachedRaw = category !== 'new' ? localStorage.getItem('filmotiv_films_' + category + '_1') : null;
            if (cachedRaw) {
              var cached = JSON.parse(cachedRaw);
              if (cached && cached.films && cached.films.length > 0 && (Date.now() - cached.ts < 7 * 24 * 60 * 60 * 1000)) {
                if (window.innerWidth <= 768) {
                  var showNow = cached.films.slice(0, MOBILE_INITIAL);
                  filmBuffer = cached.films.slice(showNow.length);
                  App.UI.appendFilms(showNow);
                } else {
                  App.UI.appendFilms(cached.films);
                }
                currentPage = 2;
                App.UI.hideLoader();
                console.log('[cache] Instant load:', category, cached.films.length, 'films');
                App.MOVIES.loadMoreFilms();
                return;
              }
            }
          } catch (_) {}
          await App.MOVIES.loadMoreFilms();
        }
      } catch (e) {
        App.UI.showEmptyState('Ой, что-то пошло не так 😅 Попробуйте обновить страницу', '⚠️');
      }
    },

    loadMoreFilms: async function() {
      if (isLoading || !hasMore || !currentCategory) return;
      if (filmBuffer.length > 0) {
        var chunk = filmBuffer.splice(0, MOBILE_CHUNK);
        App.UI.appendFilms(chunk);
        App.UI.updateLoadMoreBtn();
        setTimeout(function() {
          if (currentCategory && hasMore && !isLoading) {
            var scrollPos = window.innerHeight + window.pageYOffset;
            var threshold = document.documentElement.scrollHeight - 800;
            if (scrollPos >= threshold) App.MOVIES.loadMoreFilms();
          }
        }, 100);
        return;
      }
      isLoading = true;
      try {
        var films = [];
        if (currentCategory === 'popular') films = await App.MOVIES.getPopular(currentPage);
        else if (currentCategory === 'films') films = await App.MOVIES.getFilms(currentPage);
        else if (currentCategory === 'top250') films = await App.MOVIES.getTop250(currentPage);
        else if (currentCategory === 'new') films = await App.MOVIES.getNew(currentPage);
        else if (currentCategory === 'series') films = await App.MOVIES.getSeries(currentPage);
        else if (currentCategory && currentCategory.indexOf('genre:') === 0) films = await App.MOVIES.getByGenre(currentCategory.slice(6), currentPage);

        // Показываем только фильмы, которые реально есть в плеере
        films = await App.MOVIES.filterAvailable(films);

        if (films.length > 0) {
          try {
            localStorage.setItem('filmotiv_films_' + currentCategory + '_' + currentPage, JSON.stringify({ films: films, ts: Date.now() }));
          } catch (_) {}
          currentPage++;
          if (window.innerWidth <= 768) {
            var isFirstLoad = document.getElementById('filmGrid').children.length === 0 || document.getElementById('filmGrid').querySelector('.empty-state');
            var showNow = isFirstLoad ? films.slice(0, MOBILE_INITIAL) : films.slice(0, MOBILE_CHUNK);
            filmBuffer = films.slice(showNow.length);
            App.UI.appendFilms(showNow);
          } else {
            App.UI.appendFilms(films);
          }
        } else {
          hasMore = false;
          App.UI.updateLoadMoreBtn();
          if (document.getElementById('filmGrid').children.length === 0) App.UI.showEmptyState('По вашему запросу фильмов не найдено 🤔 Попробуйте найти что-нибудь другое!', '🔍');
        }
      } catch (e) {
        // Network errors (ERR_CONNECTION_RESET, AbortError) are common on
        // mobile/VPN/Telegram WebView. Don't show error if films are already
        // on screen from cache — just silently fail the background refresh.
        var cachedFilms = null;
        try {
          var raw = localStorage.getItem('filmotiv_films_' + currentCategory + '_' + currentPage);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.films && (Date.now() - parsed.ts < 7 * 24 * 60 * 60 * 1000)) cachedFilms = parsed.films;
          }
        } catch (_) {}
        if (cachedFilms && cachedFilms.length > 0) {
          currentPage++;
          App.UI.appendFilms(cachedFilms);
        } else {
          // Only show error if grid is EMPTY — if films already shown (from
          // cache-first), don't disrupt the user with a background error.
          // ВАЖНО: hasMore НЕ сбрасываем — иначе одна сетевая ошибка навсегда
          // убивала пагинацию ( symptom: «грузится только по 20 фильмов»).
          // Следующий скролл/клик по «Показать ещё» повторит попытку.
          var filmGrid = document.getElementById('filmGrid');
          if (filmGrid && filmGrid.children.length === 0) {
            App.UI.showEmptyState('Ой, что-то пошло не так 😅 Попробуйте обновить страницу', '⚠️');
            hasMore = true; // следующая попытка возможна
          } else {
            console.warn('[movies] Background fetch failed, films already shown:', e.message);
          }
        }
      } finally {
        isLoading = false;
        App.UI.updateLoadMoreBtn();
      }
    },

    loadFavorites: async function() {
      currentCategory = null;
      hasMore = false;
      App.UI.clearFilms();
      App.UI.showLoader();
      // INSTANT load from cache — show cached films immediately, then
      // refresh in background if needed.
      var cacheKey = 'filmotiv_fav_cache';
      try {
        var cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          var cachedFilms = JSON.parse(cached);
          if (cachedFilms && cachedFilms.length > 0) {
            App.UI.displayFilms(cachedFilms);
          }
        }
      } catch (_) {}

      var uid = App.CORE.getUserId();
      var initData = App.CORE.getTgInitData();
      // Don't block guests — try /api/me anyway, session cookie may work
      // even if localStorage doesn't have tg_user_id
      try {
        var res = await App.CORE.apiPost('/api/me', { userId: uid, initData: initData });
        if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : 'null'));
        var data = await res.json();
        // If user doesn't exist or is guest with no server data
        if (!data.exists && !data.favorites) {
          App.UI.clearFilms();
          // SYNC FIX: даём гостю кнопку входа прямо здесь (раньше был голый
          // текст и пользователь не находил, как связать сайт с мини-аппом)
          var guestId = '';
          try { guestId = localStorage.getItem('filmotiv_user_id') || ''; } catch (_) {}
          var loginUrl = '/api/auth/telegram/login' + (guestId.indexOf('web_') === 0 ? '?guest_id=' + encodeURIComponent(guestId) : '');
          var loginHtml = 'Войдите через Telegram, чтобы видеть свою коллекцию ❤️<br>' +
            '<a class="login-cta" href="' + loginUrl + '">🔑 Войти через Telegram</a><br>' +
            '<span class="login-hint">Коллекция, история и премиум едины на сайте и в мини-аппе</span>';
          if (data.is_guest) {
            App.UI.showEmptyState(loginHtml, '🔑');
          } else if (data.reauth) {
            App.UI.showEmptyState('Сессия истекла 😅 Обновите страницу, чтобы войти заново', '⏰');
          } else {
            App.UI.showEmptyState(loginHtml, '🔑');
          }
          return;
        }
        var favs = data.favorites || [];
        if (favs.length === 0) {
          App.UI.clearFilms();
          try { sessionStorage.removeItem(cacheKey); } catch (_) {}
          App.UI.showEmptyState('В коллекции пока пусто 📭 Нажмите ❤ в плеере, чтобы добавить фильм!', '📭');
          return;
        }
        // /api/me now returns favorites with full Kinopoisk details (year,
        // rating, poster, genres) — populated server-side in parallel.
        // Client only fetches missing details if server couldn't (very rare).
        var favLang = window.__filmotivLang || 'ru';
        var favIsEn = (favLang === 'en');
        var filmsWithDetails = favs.map(function(f) {
          if (f.year || f.poster || f.genres) {
            return {
              filmId: f.filmId,
              nameRu: f.title || f.nameRu || '',
              nameEn: f.title || f.nameEn || '',
              year: f.year || '',
              rating: f.rating || null,
              genres: f.genres || [],
              countries: f.countries || [],
              filmLength: f.filmLength || '',
              posterUrlPreview: f.poster || ''
            };
          }
          return {
            filmId: f.filmId,
            nameRu: f.title || '',
            nameEn: f.title || '',
            year: '',
            rating: null,
            genres: [],
            countries: [],
            filmLength: '',
            posterUrlPreview: ''
          };
        });
        // Avoid re-render if cache already shows the SAME films (prevents
        // 'cards flash/reload' when /api/me returns identical list).
        var cachedRaw = null;
        try { cachedRaw = sessionStorage.getItem(cacheKey); } catch(_){}
        if (cachedRaw) {
          try {
            var cachedFilms = JSON.parse(cachedRaw);
            var sameCount = cachedFilms && cachedFilms.length === filmsWithDetails.length;
            var sameIds = sameCount;
            if (sameIds) {
              for (var i = 0; i < filmsWithDetails.length; i++) {
                if (String(cachedFilms[i].filmId) !== String(filmsWithDetails[i].filmId)) { sameIds = false; break; }
              }
            }
            if (sameIds) {
              // Same films — just update cache with fresh details, don't re-render
              try { sessionStorage.setItem(cacheKey, JSON.stringify(filmsWithDetails)); } catch(_){}
              App.UI.hideLoader();
              return;
            }
          } catch(_){}
        }
        App.UI.displayFilms(filmsWithDetails);
        try { sessionStorage.setItem(cacheKey, JSON.stringify(filmsWithDetails)); } catch (_) {}
      } catch (e) {
        App.UI.clearFilms();
        App.UI.showEmptyState('Не удалось загрузить коллекцию 😓 Попробуйте позже', '❤️');
      }
    },

    // (Подборка removed — feature disabled)
  };

  // Expose globally
  window.loadCategory = App.MOVIES.loadCategory;
  window.loadMoreFilms = App.MOVIES.loadMoreFilms;
  window.loadFavorites = App.MOVIES.loadFavorites;
})();
// Filmotiv Tracking Module — event tracking + resume card
(function() {
  'use strict';
  var App = window.FilmotivApp = window.FilmotivApp || {};

  var resumeFilm = null;

  App.TRACKING = {
    trackEvent: async function(type, payload) {
      payload = payload || {};
      try {
        var uid = App.CORE.getUserId();
        var initData = App.CORE.getTgInitData();
        var body = { type: type, userId: uid, initData: initData };
        // Client-side platform detection is more reliable than UA sniffing:
        // Telegram Desktop / Windows and iOS webviews have a plain UA without
        // any "Telegram" token, so the server fallback mislabels them.
        // Telegram.WebApp exists only after telegram-web-app.js loads
        // (deferred to window load) — page_views waits for the
        // tg-webapp-loaded event (see the boot section), other events fire
        // after user interaction, by which time the script is loaded.
        var tgObj = window.Telegram && window.Telegram.WebApp;
        if (tgObj) {
          body.platform = (tgObj.initData || (tgObj.platform && tgObj.platform !== 'unknown')) ? 'miniapp' : 'browser';
          body.tgPlatform = tgObj.platform || null;
        }
        try {
          var storedName = localStorage.getItem('filmotiv_tg_username');
          if (storedName) body.username = storedName;
        } catch (_) {}
        if (payload.filmId) body.filmId = String(payload.filmId);
        if (payload.title) body.title = payload.title;
        if (payload.category) body.category = payload.category;
        if (payload.position !== undefined) body.position = payload.position;
        if (payload.duration !== undefined) body.duration = payload.duration;
        if (payload.rating) body.rating = payload.rating;
        if (payload.query) body.query = payload.query;
        if (payload.path) body.path = payload.path;
        await App.CORE.apiSend('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body)
        });
      } catch (e) { console.warn('track error:', e); }
    },

    loadResumeCard: async function() {
      try {
        var uid = App.CORE.getUserId();
        var initData = App.CORE.getTgInitData();
        var filmData = null;

        // Always try server — session cookie may work even for web_* guests
        try {
          var res = await App.CORE.apiPost('/api/me', { initData: initData, userId: uid });
          if (res && res.ok) {
            var data = await res.json();
            if (data.last_film) filmData = data.last_film;
            // Update premium badge (covers Mini App path where checkAuth
            // returns early because tg.initData is set)
            if (typeof data.is_premium !== 'undefined' && App.AUTH && App.AUTH.updatePremiumBadge) {
              App.AUTH.updatePremiumBadge(!!data.is_premium);
            }
          }
        } catch (e) { console.warn('[resume] server fetch failed:', e); }

        if (!filmData) {
          try {
            var localLast = localStorage.getItem('filmotiv_last_watched_film');
            if (localLast) {
              var parsed = JSON.parse(localLast);
              var age = Date.now() - new Date(parsed.ts).getTime();
              if (age <= 48 * 60 * 60 * 1000) {
                filmData = { filmId: parsed.filmId, title: parsed.title, ts: parsed.ts, position: parsed.position || 0, duration: parsed.duration || 0 };
              }
            }
          } catch (_) {}
        }

        if (!filmData) return;
        var filmAge = Date.now() - new Date(filmData.ts).getTime();
        if (filmAge > 48 * 60 * 60 * 1000) return;

        resumeFilm = filmData;
        var bestPosition = 0;
        if (typeof filmData.position === 'number' && filmData.position > 5) bestPosition = filmData.position;
        if (bestPosition === 0) {
          try {
            var raw = localStorage.getItem('filmotiv_position_' + filmData.filmId);
            if (raw) { var pos = JSON.parse(raw); if (pos && pos.t && pos.t > 5) bestPosition = pos.t; }
          } catch (_) {}
        }

        var resumeCard = document.getElementById('resumeCard');
        var resumeTitle = document.getElementById('resumeTitle');
        var resumeMeta = document.getElementById('resumeMeta');
        if (!resumeCard || !resumeTitle || !resumeMeta) return;

        if (bestPosition > 5) {
          try {
            localStorage.setItem('filmotiv_position_' + filmData.filmId, JSON.stringify({ t: bestPosition, d: filmData.duration || 0, ts: new Date().toISOString(), title: filmData.title }));
          } catch (_) {}
          resumeTitle.textContent = filmData.title;
          // Position time NOT shown (user requested). Just 'Продолжить просмотр'.
          resumeMeta.textContent = '';
        } else {
          resumeTitle.textContent = filmData.title;
          resumeMeta.textContent = '';
        }

        var posterEl = document.getElementById('resumePosterBg');
        if (posterEl) {
          posterEl.loading = 'eager';
          posterEl.decoding = 'async';
          // Use large poster for background (better quality when stretched)
          posterEl.src = '/api/poster?id=' + encodeURIComponent(filmData.filmId) + '&size=medium&_v=' + App.CORE.SW_CACHE_VERSION;
          posterEl.onerror = function() { this.style.opacity = '0'; };
        }
        resumeCard.classList.add('visible');
      } catch (e) { console.warn('resume load error:', e); }
    },

    formatResumeTime: function(s) {
      var h = Math.floor(s / 3600);
      var m = Math.floor((s % 3600) / 60);
      var sec = Math.floor(s % 60);
      if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    },

    getResumeFilm: function() { return resumeFilm; },

    // --- Tiered prefetch (lightweight — avoid slowing down page) ---
    // Tier 1 (immediate): popular page 1 only (most clicked category)
    // Tier 2 (idle, 3s): top250 + new (only if user is idle)
    // Tier 3 REMOVED (was prefetching top250 page 2 + 12 posters — slowed
    // down page load on slow connections). Posters are lazy-loaded by
    // browser when user scrolls to them.
    prefetchAll: function() {
      var SW = App.CORE.SW_CACHE_VERSION;
      var year = new Date().getFullYear();

      // Tier 1: immediate — most clicked category («Смотрят онлайн» = топ-100
      // популярных Кинопоиска). Кешируем УЖЕ ПРОФИЛЬТРОВАННЫЙ список
      // («есть в плеере»), чтобы и кеш-первый показ был чистым.
      try {
        fetch(App.CORE.resolveApi(App.CORE.API_BASE + '/v2.2/films/top?type=TOP_100_POPULAR_FILMS&page=1'))
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(data) {
            if (!data) return;
            App.MOVIES.filterAvailable(App.MOVIES.extractFilms(data))
              .then(function(films) { if (films.length > 0) App.TRACKING.cacheFilms('popular', 1, { films: films }); })
              .catch(function(){});
          })
          .catch(function(){});
      } catch(_) {}

      // Tier 2: after 3s idle — top250 + new (only if user is idle, not blocking)
      setTimeout(function() {
        try {
          // apiGet: ротация происхождения (голый fetch давал 404 на зеркале)
          App.MOVIES.apiGet(App.CORE.API_BASE + '/v2.2/films/top?type=TOP_250_BEST_FILMS&page=1')
            .then(function(data) { if (data) App.TRACKING.cacheFilms('top250', 1, data); })
            .catch(function(){});
          App.MOVIES.apiGet(App.CORE.API_BASE + '/v2.2/films?order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&yearFrom=' + year + '&yearTo=' + year + '&page=1')
            .then(function(data) { if (data) App.TRACKING.cacheFilms('new', 1, data); })
            .catch(function(){});
        } catch(_) {}
      }, 3000);
    },

    cacheFilms: function(cat, page, data) {
      try {
        var films = data.films || data.items || data.results || [];
        if (films.length === 0) return;
        localStorage.setItem('filmotiv_films_' + cat + '_' + page, JSON.stringify({ films: films, ts: Date.now() }));
      } catch(_) {}
    }
  };

  // Expose globally
  window.trackEvent = App.TRACKING.trackEvent;
  window.loadResumeCard = App.TRACKING.loadResumeCard;
})();
// Filmotiv App — Main orchestrator
// Loads modules and wires up UI events. All logic lives in modules.
(function() {
  'use strict';

  // ====== Global error handler ======
  window.addEventListener('error', function(e) {
    if (e.message && e.message.indexOf('Script error') === -1) {
      console.error('[global-error]', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno);
    }
  });
  window.addEventListener('unhandledrejection', function(e) {
    console.error('[unhandled-rejection]', e.reason && e.reason.message ? e.reason.message : e.reason);
  });

  var App = window.FilmotivApp;
  var tg = null;

  // ====== Init Telegram WebApp ======
  tg = App.AUTH.initTelegramWebApp();

  // ====== Handle OAuth redirect (if returning from Telegram login) ======
  App.AUTH.handleOAuthRedirect();

  // ====== Setup login bar + auth check ======
  // Restore premium badge from localStorage cache (instant, before /api/me)
  App.AUTH.restorePremiumBadge();
  if (!window.Telegram) {
    App.AUTH.checkTgLoginBar();
    App.AUTH.checkAuth();
  }
  window.addEventListener('load', function() {
    if (!tg) tg = App.AUTH.initTelegramWebApp();
    App.AUTH.checkTgLoginBar();
    App.AUTH.checkAuth();
  });
  setInterval(function() { if (!(tg && tg.initData)) App.AUTH.checkAuth(); }, 120000);

  // ====== Resume card setup ======
  var resumeClose = document.getElementById('resumeClose');
  if (resumeClose) {
    resumeClose.addEventListener('click', function(e) {
      e.stopPropagation();
      var resumeCard = document.getElementById('resumeCard');
      if (resumeCard) resumeCard.classList.remove('visible');
    });
  }
  var resumeCard = document.getElementById('resumeCard');
  if (resumeCard) {
    resumeCard.addEventListener('click', function() {
      var film = App.TRACKING.getResumeFilm();
      if (film) {
        // Track that user reopened this film
        if (navigator.sendBeacon) {
          try {
            var uid = App.CORE.getUserId();
            var initData = App.CORE.getTgInitData();
            var body = JSON.stringify({ type: 'movies_opened', userId: uid, initData: initData, filmId: String(film.filmId), title: film.title });
            navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
          } catch (_) {}
        }
        var startPos = (typeof film.position === 'number' && film.position > 5) ? film.position : 0;
        var tParam = startPos > 0 ? '&t=' + startPos : '';
        setTimeout(function() { window.location.href = 'player.html?id=' + film.filmId + '&title=' + encodeURIComponent(film.title) + tParam; }, 100);
      }
    });
  }
  App.TRACKING.loadResumeCard();
  App.TRACKING.prefetchAll();

  // ====== Check for admin messages ======
  (async function() {
    try {
      var uid = App.CORE.getUserId();
      var initData = App.CORE.getTgInitData();
      var res = await App.CORE.apiPost('/api/me', { userId: uid, initData: initData });
      if (!res || !res.ok) return;
      var data = await res.json();
      if (!data.admin_messages || data.admin_messages.length === 0) return;
      // Check if we already showed this message (by timestamp)
      var lastShownTs = localStorage.getItem('filmotiv_last_admin_msg_ts') || '';
      var newestMsg = data.admin_messages[0];
      if (newestMsg.ts && newestMsg.ts === lastShownTs) return; // already shown
      // Show notification
      localStorage.setItem('filmotiv_last_admin_msg_ts', newestMsg.ts || '');
      showAdminMessage(newestMsg);
    } catch(_) {}
  })();

  function showAdminMessage(msg) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#1c1c1e;color:#fff;border-radius:20px;padding:32px 24px;max-width:400px;width:100%;text-align:center;font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,0.5);';
    var fromText = msg.from ? ' от ' + msg.from : '';
    modal.innerHTML =
      '<div style="font-size:20px;margin-bottom:16px;">✉️</div>' +
      '<div style="font-size:14px;color:rgba(255,255,255,0.5);margin-bottom:8px;">Сообщение' + fromText + '</div>' +
      '<div style="font-size:16px;line-height:1.5;margin-bottom:24px;">' + (msg.text || '') + '</div>' +
      '<button id="adminMsgClose" style="background:#8b5cf6;color:#fff;border:none;padding:12px 32px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;">✕ Закрыть</button>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    var closeBtn = modal.querySelector('#adminMsgClose');
    if (closeBtn) {
      closeBtn.onclick = function() { overlay.remove(); };
    }
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });
  }

  // Remove the PWA "📲 install info" button if we turn out to be inside the
  // Mini App (it may have been created before Telegram was detected).
  function hidePwaBtnInTelegram() {
    try {
      var t = window.Telegram && window.Telegram.WebApp;
      var inTg = !!(t && (t.initData || (t.platform && t.platform !== 'unknown')));
      if (!inTg) return;
      var btn = document.getElementById('pwaInstallInfoBtn');
      if (btn) btn.remove();
    } catch (_) {}
  }

  // telegram-web-app.js is loaded ASYNC by index.html — it may appear long
  // AFTER this script (defer) and even after the window load event (dynamic
  // scripts don't delay it). Whenever it finally shows up, re-init Telegram
  // and re-run the UI decisions that depend on TG detection (login bar,
  // "Open in Telegram" banner, PWA install button).
  var tgHandledTg = false;     // decided "inside Telegram" and fixed the UI
  var tgCheckedNotTg = false;  // decided "outside Telegram" (script present, platform unknown)
  function tgLiveState() {
    var t = window.Telegram && window.Telegram.WebApp;
    if (!t) return 'absent';
    if (t.initData && t.initData.length > 0) return 'tg';
    if (t.platform && t.platform !== 'unknown') return 'tg';
    return 'not-tg';
  }
  function markTgSeen() {
    var st = tgLiveState();
    if (st === 'absent') return false;
    if (tgHandledTg) return true; // already inside Mini App — nothing to redo
    if (st === 'tg') {
      tgHandledTg = true;
      tg = App.AUTH.initTelegramWebApp();
      App.AUTH.checkTgLoginBar();
      App.AUTH.checkAuth();
      hidePwaBtnInTelegram();
      // CSS safety net: mark Mini App mode (inline script in index.html does
      // the same earlier — this covers late telegram-web-app.js loading).
      try { document.body.classList.add('in-tg'); } catch (_) {}
      console.log('[tg] Telegram WebApp detected (initData/platform), UI updated for Mini App');
    } else if (!tgCheckedNotTg) {
      tgCheckedNotTg = true;
      App.AUTH.checkTgLoginBar();
      console.log('[tg] telegram-web-app.js loaded outside Telegram (platform unknown)');
    }
    return true;
  }
  document.addEventListener('tg-webapp-loaded', markTgSeen);
  // Safety-net poll: covers the rare case where the script executed before
  // the event listener was registered (cached async script winning the race).
  var tgPollN = 0;
  var tgPoll = setInterval(function() {
    tgPollN++;
    markTgSeen();
    if (tgHandledTg || tgPollN > 24) clearInterval(tgPoll);
  }, 250);
  markTgSeen();

  // ====== Track initial page view ======
  // Wait until Telegram detection settles BEFORE sending: page_views is the
  // first event and used to fire before the deferred telegram-web-app.js
  // loaded — inside the Mini App the platform was then misdetected.
  // markTgSeen() (registered earlier for the same event) re-initializes
  // Telegram.WebApp synchronously, so by the time this listener runs the
  // platform/initData are ready to be attached by trackEvent().
  (function() {
    var fired = false;
    function fire() {
      if (fired) return;
      fired = true;
      App.TRACKING.trackEvent('page_views', { path: '/' });
    }
    document.addEventListener('tg-webapp-loaded', function() {
      var t = window.Telegram && window.Telegram.WebApp;
      var inTg = !!(t && (t.initData || (t.platform && t.platform !== 'unknown')));
      if (inTg) fire();            // Mini App — platform 'miniapp' + tgPlatform
      else setTimeout(fire, 300);  // script loaded outside Telegram — browser
    });
    // Safety net: telegram.org unreachable in a plain browser — the event
    // never fires (the loader aborts after 4s); 3.5s covers slow Mini App
    // networks too, after which best-effort "browser" is sent.
    setTimeout(fire, 3500);
  })();

  // ====== Global openPlayer (also defined in auth.js, but ensure it's available) ======
  if (!window.openPlayer) {
    window.openPlayer = function(filmId, title) {
      if (navigator.sendBeacon) {
        try {
          var uid = App.CORE.getUserId();
          var initData = App.CORE.getTgInitData();
          var body = JSON.stringify({ type: 'movies_opened', userId: uid, initData: initData, filmId: String(filmId), title: title });
          navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
        } catch (_) {}
      } else if (window.trackEvent) {
        window.trackEvent('movies_opened', { filmId: filmId, title: title });
      }
      window.location.href = 'player.html?id=' + filmId + '&title=' + encodeURIComponent(title);
    };
  }

  // ====== Action card clicks + touch press effect ======
  function setupTouchPressEffect(el) {
    el.addEventListener('touchstart', function() {
      el.classList.add('pressing');
    }, { passive: true });
    el.addEventListener('touchend', function() { el.classList.remove('pressing'); }, { passive: true });
    el.addEventListener('touchcancel', function() { el.classList.remove('pressing'); }, { passive: true });
    el.addEventListener('mousedown', function() { el.classList.add('pressing'); });
    el.addEventListener('mouseup', function() { el.classList.remove('pressing'); });
    el.addEventListener('mouseleave', function() { el.classList.remove('pressing'); });
  }

  document.querySelectorAll('.action-card, .film-card, .resume-card').forEach(function(card) {
    setupTouchPressEffect(card);
    if (card.classList.contains('action-card')) {
      card.addEventListener('click', function() {
        var cat = card.dataset.cat;
        if (cat === 'favorites') App.MOVIES.loadFavorites();
        else App.MOVIES.loadCategory(cat);
        // Lift search+actions to top on PC (smooth animation)
        if (window.liftSearchActions) window.liftSearchActions();
        // Auto-scroll only on mobile (width <= 768px) — on PC the categories
        // and film grid fit on one screen, scroll is annoying.
        // Hero tap-to-scroll-top still works on all devices.
        if (window.innerWidth <= 768) {
          setTimeout(function() {
            var content = document.getElementById('content');
            var hero = document.querySelector('.hero');
            if (content) {
              var rect = content.getBoundingClientRect();
              var heroH = hero ? hero.offsetHeight : 60;
              var targetY = (window.pageYOffset || 0) + rect.top - heroH - 4;
              if (targetY < 0) targetY = 0;
              try { window.scrollTo({ top: targetY, behavior: 'smooth' }); }
              catch (e) { window.scrollTo(0, targetY); }
            }
          }, 350);
        }
      });
    }
  });

  // Re-apply touch press effect to dynamically added film cards
  var filmGrid = document.getElementById('filmGrid');
  if (filmGrid) {
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node && node.classList && node.classList.contains('film-card') && !node.dataset.pressSetup) {
            node.dataset.pressSetup = '1';
            setupTouchPressEffect(node);
          }
        });
      });
    });
    observer.observe(filmGrid, { childList: true });
  }

  // ====== Desktop hover effects (PC only) ======
  // REMOVED: holo cursor-following glow + 3D tilt on action cards.
  // Was creating 'phantom fire' blob at cursor position on click.
  // Now CSS-only :hover border highlight — no JS, no glow, no 3D tilt.
  function setupActionCardEffects() {
    // No-op: action card hover effects now handled purely in CSS
    return;
  }

  // Hero title cursor glow REMOVED — was creating phantom badge on PC
  // (radial-gradient at cursor position with inset:-30px -50px on
  // .hero-title.cursor-glow::before created a visible colored blob).
  // The .hero::before overlay already provides smooth color animation.
  function setupHeroTitleGlow() {
    // No-op: cursor glow removed to fix phantom badge on PC
    return;
  }

  // Run hover effects after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setupActionCardEffects();
      setupHeroTitleGlow();
    });
  } else {
    setupActionCardEffects();
    setupHeroTitleGlow();
  }

  // ====== Search ======
  var searchInput = document.getElementById('searchInput');
  var searchClear = document.getElementById('searchClear');
  var actionsEl = document.querySelector('.actions');
  var searchTimeout;

  function hideCategories() { if (actionsEl) actionsEl.style.display = 'none'; }
  function showCategories() { if (actionsEl) actionsEl.style.display = ''; }

  if (searchInput) {
    // Close keyboard on Enter / Search button on mobile.
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        searchInput.blur();
        // Also close TG keyboard if available.
        if (window.Telegram && window.Telegram.WebApp) {
          try { window.Telegram.WebApp.disableVerticalSwipes(); } catch(_) {}
        }
      }
    });

    // "Done" button REMOVED — user requested. To dismiss keyboard on mobile,
    // user taps outside the input or presses Enter (handled in keydown below).

    // Blur outside the search (click elsewhere on PC / dismiss keyboard on
    // mobile): if there is no query and no category is open, return the page
    // to its centered state. Fixes: layout stayed "lifted" forever unless
    // the ✕ button was pressed.
    searchInput.addEventListener('blur', function() {
      setTimeout(function() {
        if (document.activeElement === searchInput) return;
        if (searchInput.value.trim()) return; // text present — keep search state
        try {
          var state = App.MOVIES.getState();
          if (state.currentCategory || state.isLoading) return; // category open — keep lifted
        } catch (_) {}
        if (window.lowerSearchActions) window.lowerSearchActions();
      }, 150);
    });

    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimeout);
      var query = searchInput.value.trim();
      if (searchClear) searchClear.classList.toggle('visible', !!query);
      if (!query) {
        showCategories();
        App.UI.clearFilms();
        return;
      }
      hideCategories();
      searchTimeout = setTimeout(async function() {
        App.UI.clearFilms();
        App.UI.showLoader();
        try {
          // Поиск — не категория: сбрасываем, чтобы бесконечный скролл
          // не догружал прежнюю категорию под результаты поиска
          App.MOVIES.setCategory(null);
          App.MOVIES.resetPagination();
          var films = await App.MOVIES.searchFilms(query);
          App.UI.displayFilms(films, films.length === 1);
          App.TRACKING.trackEvent('searches', { query: query });
        } catch (e) { App.UI.showEmptyState('Поиск не сработал 😅 Попробуйте другой запрос', '🔍'); }
      }, 250);
    });

    searchInput.addEventListener('focus', function() {
      if (searchInput.value.trim()) hideCategories();
      liftSearchActions();
    });
  }

  // Lift search+actions to top (all devices — PC and mobile).
  // Resume card slides up and hides under the sticky hero.
  function liftSearchActions() {
    var sw = document.querySelector('.search-wrapper');
    if (sw) {
      sw.classList.add('sa-lifted');
    }
    // Slide resume card up and hide under hero (smooth animation)
    var rc = document.getElementById('resumeCard');
    if (rc) rc.classList.add('sa-hidden');
  }
  window.liftSearchActions = liftSearchActions;

  // Lower search+actions back to middle (when search cleared / closed)
  function lowerSearchActions() {
    var sw = document.querySelector('.search-wrapper');
    if (sw) {
      sw.classList.remove('sa-lifted');
    }
    // Slide resume card back down
    var rc = document.getElementById('resumeCard');
    if (rc) rc.classList.remove('sa-hidden');
  }
  window.lowerSearchActions = lowerSearchActions;

  if (searchClear) {
    searchClear.addEventListener('click', function() {
      searchInput.value = '';
      searchClear.classList.remove('visible');
      showCategories();
      App.UI.clearFilms();
      searchInput.blur();
      // Lower search+actions back to center
      if (window.lowerSearchActions) window.lowerSearchActions();
    });
  }

  // Кнопка «Показать ещё» — страховка бесконечного скролла
  var loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function() { App.MOVIES.loadMoreFilms(); });
  }

  // ====== Scroll: hide/show fixed button + infinite scroll ======
  var scrollTimeout;
  var lastScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  window.addEventListener('scroll', function() {
    clearTimeout(scrollTimeout);
    var currentScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    var fixedBtn = document.getElementById('fixedTelegramBtn');
    if (fixedBtn && !fixedBtn.classList.contains('hidden-by-tv')) {
      if (currentScrollY > lastScrollY + 5 && currentScrollY > 50) fixedBtn.classList.add('hidden');
      else if (currentScrollY < lastScrollY - 5) fixedBtn.classList.remove('hidden');
    }
    lastScrollY = currentScrollY;
    scrollTimeout = setTimeout(function() {
      var scrollPos = (window.pageYOffset || document.documentElement.scrollTop || 0) + window.innerHeight;
      var threshold = document.documentElement.scrollHeight - 800;
      var state = App.MOVIES.getState();
      if (scrollPos >= threshold && state.currentCategory && state.currentCategory !== 'random' && !state.isLoading && state.hasMore) {
        App.MOVIES.loadMoreFilms();
      }
    }, 100);
  });

  // ====== Service Worker ======
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      // Register SW only ONCE per session — don't unregister on every load
      // (was causing infinite reload loop on bad internet)
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function(reg) {
        console.log('[sw] registered, scope:', reg.scope);
        // Check for updates every 10 min — but DON'T auto-reload on
        // controllerchange. New SW will activate on next manual page load.
        // Auto-reload was causing random page refreshes mid-session.
        setInterval(function() { reg.update().catch(function() {}); }, 600000);
      }).catch(function(e) { console.warn('[sw] registration failed:', e); });
    });
  }

  // ====== PWA install button (mobile only) ======
  function pwaIsStandalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (window.navigator.standalone === true);
    } catch (_) { return false; }
  }
  function pwaIsTelegramMiniApp() {
    // Check multiple signals — tg may not be ready yet on first call
    if (tg && tg.initData) return true;
    if (tg && tg.platform && tg.platform !== 'unknown') return true;
    try {
      var t = window.Telegram && window.Telegram.WebApp;
      if (t && t.initData) return true;
      if (t && t.platform && t.platform !== 'unknown') return true;
      // Синхронный сигнал: Telegram Mini App пробрасывает данные в URL-хеш
      // (#tgWebAppData=...) ДО загрузки telegram-web-app.js — позвляет
      // решить вопрос мгновенно, без ожидания скрипта.
      if (location.hash.indexOf('tgWebApp') !== -1) return true;
    } catch (_) {}
    return false;
  }
  function pwaIsIOS() { return App.DEVICE.isIOS(); }
  function pwaIsMobile() { return App.DEVICE.isMobile(); }

  function pwaShowInstallInfoButton() {
    if (pwaIsTelegramMiniApp() || pwaIsStandalone() || !pwaIsMobile()) return;
    var btn = document.createElement('button');
    btn.id = 'pwaInstallInfoBtn';
    btn.textContent = '📲';
    btn.title = 'Как установить приложение';
    btn.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#8b5cf6;color:#fff;border:none;width:52px;height:52px;border-radius:50%;font-size:24px;cursor:pointer;z-index:1000;box-shadow:0 4px 16px rgba(139,92,246,0.5);font-family:inherit;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;justify-content:center;line-height:1;';
    document.body.appendChild(btn);
    var deferredPrompt = null;
    var isIOS = pwaIsIOS();
    window.addEventListener('beforeinstallprompt', function(e) { e.preventDefault(); deferredPrompt = e; });
    window.addEventListener('appinstalled', function() { btn.remove(); });
    btn.addEventListener('click', function() {
      if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(function() { deferredPrompt = null; }).catch(function() {}); }
      else if (isIOS) { pwaShowIosInstructions(); }
      else { pwaShowAndroidInstructions(); }
    });
  }

  function pwaShowIosInstructions() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#1c1c1e;color:#fff;border-radius:18px;padding:24px;max-width:340px;width:100%;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
    modal.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:14px;">📲 Установка на iPhone/iPad</div><div style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.85);"><p style="margin:0 0 10px;">1. Нажмите кнопку <b>«Поделиться»</b> внизу Safari (квадрат со стрелкой вверх ▲).</p><p style="margin:0 0 10px;">2. В меню выберите <b>«На экран Домой»</b> (➕).</p><p style="margin:0 0 10px;">3. Нажмите <b>«Добавить»</b> в правом верхнем углу.</p><p style="margin:0;">Приложение появится на главном экране.</p></div><button id="pwaIosClose" style="margin-top:18px;width:100%;background:#8b5cf6;color:#fff;border:none;padding:12px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Понятно</button>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay || e.target.id === 'pwaIosClose') overlay.remove(); });
  }

  function pwaShowAndroidInstructions() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#1c1c1e;color:#fff;border-radius:18px;padding:24px;max-width:340px;width:100%;font-family:inherit;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
    var ua = navigator.userAgent || '';
    var browserName = 'браузере';
    if (ua.indexOf('Firefox') !== -1) browserName = 'Firefox';
    else if (ua.indexOf('SamsungBrowser') !== -1) browserName = 'Samsung Internet';
    else if (ua.indexOf('Edg/') !== -1) browserName = 'Edge';
    else if (ua.indexOf('Chrome') !== -1) browserName = 'Chrome';
    modal.innerHTML = '<div style="font-size:18px;font-weight:700;margin-bottom:14px;">📲 Установка на Android</div><div style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.85);"><p style="margin:0 0 10px;">1. Нажмите меню <b>⋮</b> в ' + browserName + '.</p><p style="margin:0 0 10px;">2. Выберите <b>«Установить приложение»</b> или <b>«На главный экран»</b>.</p><p style="margin:0;">Приложение появится на главном экране.</p></div><button id="pwaAndroidClose" style="margin-top:18px;width:100%;background:#8b5cf6;color:#fff;border:none;padding:12px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Понятно</button>';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay || e.target.id === 'pwaAndroidClose') overlay.remove(); });
  }
  // Кнопка установки появляется МГНОВЕННО: хеш #tgWebApp* позволяет
  // надёжно отличить Mini App от браузера синхронно, ждать 4.5с больше не
  // нужно (пользователь жаловался на долгую загрузку кнопки).
  pwaShowInstallInfoButton();

  // ====== Long-press film info popup ======
  var LONGPRESS_DURATION = 1000; // 1 second (user request)
  var LONGPRESS_MOVE_TOLERANCE = 10;
  var filmInfoOverlay = document.getElementById('filmInfoOverlay');
  var filmInfoPopup = document.getElementById('filmInfoPopup');
  var fipPoster = document.getElementById('fipPoster');
  var fipTitle = document.getElementById('fipTitle');
  var fipMeta = document.getElementById('fipMeta');
  var fipDesc = document.getElementById('fipDesc');
  var fipOpenBtn = document.getElementById('fipOpen');
  var fipCloseBtn = document.getElementById('fipClose');
  var pendingFilmId = null;
  var pendingFilmTitle = null;

  function showFilmInfoPopup(card) {
    if (!filmInfoPopup || !filmInfoOverlay) return;
    // Block page scroll while popup is open
    document.body.style.overflow = 'hidden';
    var filmId = card.dataset.filmId;
    var title = card.dataset.title || 'Без названия';
    var year = card.dataset.year || '';
    var rating = card.dataset.rating || '';
    var poster = card.dataset.poster || '';
    var desc = card.dataset.desc || '';
    pendingFilmId = filmId;
    pendingFilmTitle = title;
    if (poster) { fipPoster.loading = 'lazy'; fipPoster.decoding = 'async'; fipPoster.src = poster; fipPoster.style.display = 'block'; }
    else { fipPoster.style.display = 'none'; }
    fipTitle.textContent = title;
    var metaHtml = '';
    if (year) metaHtml += '<span>' + year + '</span>';
    if (rating) metaHtml += '<span class="rating">⭐ ' + rating + '</span>';
    fipMeta.innerHTML = metaHtml;
    // Show description if in dataset, else lazy-fetch from Kinopoisk API.
    if (desc) {
      fipDesc.textContent = desc;
      fipDesc.style.display = 'block';
    } else if (filmId) {
      fipDesc.textContent = 'Загрузка...';
      fipDesc.style.display = 'block';
      // apiGet: ротация происхождения (голый fetch давал 404 на зеркале)
      App.MOVIES.apiGet(App.CORE.API_BASE + '/v2.2/films/' + encodeURIComponent(filmId))
        .then(function(r) { return r ? r.json() : null; })
        .then(function(d) {
          if (!d) { fipDesc.textContent = 'Описание недоступно'; return; }
          var fullDesc = d.shortDescription || d.description || '';
          fipDesc.textContent = fullDesc || 'Описание недоступно';
          card.dataset.desc = fullDesc.substring(0, 500);
        })
        .catch(function() { fipDesc.textContent = 'Ошибка загрузки'; });
    } else {
      fipDesc.style.display = 'none';
    }
    filmInfoOverlay.classList.add('visible');
    filmInfoPopup.classList.add('visible');
  }

  function hideFilmInfoPopup() {
    if (filmInfoOverlay) filmInfoOverlay.classList.remove('visible');
    if (filmInfoPopup) filmInfoPopup.classList.remove('visible');
    document.body.style.overflow = '';
  }

  if (fipCloseBtn) fipCloseBtn.addEventListener('click', hideFilmInfoPopup);
  if (fipOpenBtn) fipOpenBtn.addEventListener('click', function() {
    if (pendingFilmId) window.location.href = 'player.html?id=' + pendingFilmId + '&title=' + encodeURIComponent(pendingFilmTitle);
  });
  if (filmInfoOverlay) filmInfoOverlay.addEventListener('click', function(e) { if (e.target === filmInfoOverlay) hideFilmInfoPopup(); });

  function attachLongPress(card) {
    var timer = null;
    var startX = 0, startY = 0;
    var moved = false;
    card.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      moved = false;
      timer = setTimeout(function() {
        if (!moved) { e.preventDefault(); showFilmInfoPopup(card); }
      }, LONGPRESS_DURATION);
    }, { passive: false });
    card.addEventListener('touchmove', function(e) {
      if (e.touches.length !== 1) return;
      var dx = Math.abs(e.touches[0].clientX - startX);
      var dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > LONGPRESS_MOVE_TOLERANCE || dy > LONGPRESS_MOVE_TOLERANCE) {
        moved = true;
        if (timer) { clearTimeout(timer); timer = null; }
      }
    }, { passive: true });
    card.addEventListener('touchend', function() { if (timer) { clearTimeout(timer); timer = null; } });
    card.addEventListener('touchcancel', function() { if (timer) { clearTimeout(timer); timer = null; } });
    // Prevent iOS image context menu / long-press save.
    var img = card.querySelector('img.film-poster');
    if (img) {
      img.addEventListener('contextmenu', function(e) { e.preventDefault(); });
      img.style.webkitUserSelect = 'none';
      img.style.webkitTouchCallout = 'none';
    }
  }

  // Use MutationObserver instead of deprecated DOMNodeInserted.
  var filmGridEl = document.getElementById('filmGrid');
  if (filmGridEl && window.MutationObserver) {
    var cardObserver = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node.classList && node.classList.contains('film-card') && !node.dataset.longpressAttached) {
            node.dataset.longpressAttached = '1';
            attachLongPress(node);
          }
        });
      });
    });
    cardObserver.observe(filmGridEl, { childList: true, subtree: true });
  }
  // (deprecated DOMNodeInserted fallback removed — MutationObserver is
  // supported by every browser since 2013; the fallback was dead weight)

  // ====== Theme toggle (long-press on hero — NO toast) ======
  window.toggleTheme = function() {
    App.DEVICE.cycleTheme();
  };

  // ====== Sticky hero + tap=scroll-top ======
  var heroEl = document.querySelector('.hero');
  var heroTitle = document.getElementById('heroTitle');
  var rafPending = false;

  function updateHero() {
    rafPending = false;
    if (!heroEl) return;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    var isShrunk = heroEl.classList.contains('shrunk');
    if (!isShrunk && y > 20) heroEl.classList.add('shrunk');
    else if (isShrunk && y < 5) heroEl.classList.remove('shrunk');
  }

  window.addEventListener('scroll', function() {
    if (rafPending) return;
    rafPending = true;
    if (window.requestAnimationFrame) requestAnimationFrame(updateHero);
    else setTimeout(updateHero, 16);
  }, { passive: true });

  // ====== Smooth window resize ======
  // While the window is being resized, body gets the .resizing class which
  // suspends ALL CSS transitions/animations (see app.css). Without it,
  // clamp() font sizes, vh-margins and the sticky hero animate to their new
  // values with a 0.3–0.4s lag while you drag — the page looks drunk.
  // The class is removed 180ms after the last resize event.
  var resizeDebounceTimer = null;
  window.addEventListener('resize', function() {
    document.body.classList.add('resizing');
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(function() {
      document.body.classList.remove('resizing');
      resizeDebounceTimer = null;
    }, 180);
  }, { passive: true });

  // ====== Pull-to-refresh (mobile) ======
  // When user pulls down at the top of the page, the substrate above the
  // hero grows and follows the finger (--ptr-h CSS var). On release:
  //   - pull >= ptrThreshold (100px)  → substrate collapses, page reloads
  //   - pull <  ptrThreshold          → substrate collapses, NO reload
  // touchcancel is handled too (interrupted gesture → clean reset, no
  // stuck state, no surprise reload on the next tap).
  // Only works when scrollY === 0.
  var ptrActive = false;
  var ptrStartY = 0;
  var ptrMaxDelta = 0;
  var ptrThreshold = 100; // px pull needed to trigger reload

  function ptrReset() {
    if (!heroEl) return;
    heroEl.classList.remove('ptr-stretch');
    heroEl.classList.remove('ptr-release');
    heroEl.style.removeProperty('--ptr-h');
  }

  window.addEventListener('touchstart', function(e) {
    if (window.pageYOffset > 0) return;
    if (e.touches.length !== 1) return;
    ptrActive = true;
    ptrStartY = e.touches[0].clientY;
    ptrMaxDelta = 0;
  }, { passive: true });

  window.addEventListener('touchmove', function(e) {
    if (!ptrActive) return;
    if (window.pageYOffset > 0) { ptrActive = false; ptrReset(); return; }
    var delta = e.touches[0].clientY - ptrStartY;
    if (delta > ptrMaxDelta) ptrMaxDelta = delta;
    if (delta > 10 && heroEl) {
      heroEl.classList.remove('ptr-release');
      heroEl.classList.add('ptr-stretch');
      // Substrate follows the finger (damped 0.6x, capped at 160px)
      var h = Math.min(Math.round(delta * 0.6), 160);
      heroEl.style.setProperty('--ptr-h', h + 'px');
    } else if (delta <= 10 && heroEl && heroEl.classList.contains('ptr-stretch')) {
      // Finger returned to start — collapse substrate without reload
      ptrReset();
    }
  }, { passive: true });

  window.addEventListener('touchend', function() {
    if (!ptrActive) return;
    ptrActive = false;
    if (!heroEl) return;
    if (heroEl.classList.contains('ptr-stretch')) {
      heroEl.classList.remove('ptr-stretch');
      heroEl.classList.add('ptr-release');
      heroEl.style.removeProperty('--ptr-h');
      // Substrate collapses back to 0, then reload — ONLY if the pull
      // was long enough (ptrThreshold actually enforced now).
      if (ptrMaxDelta >= ptrThreshold) {
        setTimeout(function() { window.location.reload(); }, 400);
      } else {
        setTimeout(function() {
          if (heroEl) heroEl.classList.remove('ptr-release');
        }, 500);
      }
    }
  }, { passive: true });

  // Interrupted gesture (system gesture / notification shade) — clean
  // reset without reload. Was missing → hero got stuck in ptr-stretch
  // and the next tap caused a surprise reload.
  window.addEventListener('touchcancel', function() {
    if (!ptrActive) return;
    ptrActive = false;
    ptrReset();
  }, { passive: true });

  // ====== Hero click handlers ======
  // Tap on hero = scroll to top.
  // Long-press on 'Filmotiv' TITLE = toggle theme (dark/light).
  if (heroEl) {
    heroEl.addEventListener('click', function(e) {
      e.stopPropagation();
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); }
      catch (err) { window.scrollTo(0, 0); }
    });

    // Long-press on 'Filmotiv' title (NOT the whole hero) → toggle theme.
    // Only dark/light themes (cycleTheme handles the 2-theme cycle).
    if (heroTitle) {
      var themePressTimer = null;
      heroTitle.addEventListener('pointerdown', function(e) {
        e.stopPropagation();
        themePressTimer = setTimeout(function() {
          themePressTimer = null;
          try { window.toggleTheme(); } catch(_) {}
        }, 500);
      });
      heroTitle.addEventListener('pointerup', function(e) {
        e.stopPropagation();
        if (themePressTimer) { clearTimeout(themePressTimer); themePressTimer = null; }
      });
      heroTitle.addEventListener('pointerleave', function() {
        if (themePressTimer) { clearTimeout(themePressTimer); themePressTimer = null; }
      });
      heroTitle.addEventListener('pointercancel', function() {
        if (themePressTimer) { clearTimeout(themePressTimer); themePressTimer = null; }
      });
    }
  }

  // Apply initial theme (auto by default — follows system preference)
  App.DEVICE.applyTheme(App.DEVICE.getThemeMode());

  // Auto theme re-evaluation every 30 min
  setInterval(function() {
    if (App.DEVICE.getThemeMode() === 'auto') App.DEVICE.applyTheme('auto');
  }, 30 * 60 * 1000);

  console.log('[app] Filmotiv initialized, modules loaded');
})();
