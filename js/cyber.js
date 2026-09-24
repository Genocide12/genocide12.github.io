// Filmotiv Cyber Dashboard — hero-баннер, секции-ряды, жанры, правая панель.
// Надстройка над app.js (не ломает легаси-хуки): всё в try/catch,
// любые ошибки косметики не влияют на поиск/каталог.
(function() {
  'use strict';
  if (!window.FilmotivApp) return;
  var App = window.FilmotivApp;

  var FRESH = 7 * 24 * 60 * 60 * 1000;
  var YEAR = new Date().getFullYear();

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    try { return App.CORE.escapeHtml(String(s == null ? '' : s)); }
    catch (_) { return String(s == null ? '' : s); }
  }

  function readCatCache(cat, page) {
    try {
      var raw = localStorage.getItem('filmotiv_films_' + cat + '_' + (page || 1));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.films && parsed.films.length > 0 &&
          (Date.now() - parsed.ts < FRESH)) return parsed.films;
    } catch (_) {}
    return null;
  }

  function fetchCat(cat) {
    if (cat === 'new') {
      // Четверговая подборка премьер (крон ЗАМЕНЯЕТ прошые новинки).
      // Фолбэк — живой запрос к Кинопоиску по текущему году.
      return fetch(App.CORE.resolveApi('/api/new-films'))
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
          if (d && Array.isArray(d.films) && d.films.length > 0) return { items: d.films };
          var year = new Date().getFullYear();
          return fetch(App.CORE.resolveApi('/api/kinopoisk?q=v2.2/films&order=NUM_VOTE&type=FILM&ratingFrom=0&ratingTo=10&yearFrom=' + year + '&yearTo=' + year + '&page=1'))
            .then(function(r2) { return r2.ok ? r2.json() : null; });
        })
        .catch(function() { return null; });
    }
    if (cat === 'popular') {
      // «Смотрят онлайн» — топ-100 популярных Кинопоиска (чем интересуются сейчас)
      return fetch(App.CORE.resolveApi('/api/kinopoisk?q=v2.2/films/top?type=TOP_100_POPULAR_FILMS&page=1'))
        .then(function(r) { return r.ok ? r.json() : null; })
        .catch(function() { return null; });
    }
    var url = App.CORE.resolveApi('/api/kinopoisk?q=v2.2/films&order=NUM_VOTE&type=FILM&ratingFrom=7&ratingTo=10&yearFrom=2020&yearTo=2025&page=1');
    return fetch(url).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  }

  function posterOf(f) {
    return f.posterUrlPreview || f.posterUrl || App.CORE.resolveApi('/api/poster?id=' + (f.filmId || f.kinopoiskId) + '&size=small');
  }
  function filmIdOf(f) { return f.filmId || f.kinopoiskId; }
  function titleOf(f) { return f.nameRu || f.nameEn || f.nameOriginal || 'Без названия'; }
  function ratingOf(f) {
    var r = f.rating || f.ratingKinopoisk || f.ratingImdb || '';
    if (!r || r === 'null' || r === '0' || r === '0%') return '';
    return String(r);
  }

  // ====== VIEW SWITCHING ======
  function setNavActive(cat) {
    var nav = $('cyberNav');
    if (!nav) return;
    var items = nav.querySelectorAll('.cyber-nav-item');
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var isTarget = cat && (it.dataset.cat === cat || it.dataset.nav === cat);
      it.classList.toggle('active', !!isTarget);
    }
    // чипы-категории под хедером подсвечиваются синхронно
    var chips = document.querySelectorAll('.pm-chip[data-cat]');
    for (var k = 0; k < chips.length; k++) {
      chips[k].classList.toggle('active', !!cat && chips[k].dataset.cat === cat);
    }
  }

  function enterCategory(cat) {
    try { document.body.classList.add('view-category'); } catch (_) {}
    setNavActive(cat);
    // Infinite scroll writes into #filmGrid; nothing extra needed —
    // app.js showLoader() removes .hidden from #content.
  }

  // ====== СКРОЛЛ ПОД ШАПКУ (фикс мобильного UX) ======
  // Проблема: при нажатии «Жанры»/фильтров/категорий страница показывалась
  // «с середины списка» — прокрутка либо оставалась на старой позиции,
  // либо scrollIntoView прятал начало секции под sticky-шапкой.
  // Решение: считаем высоту шапки и скроллим так, чтобы блок начинался
  // ровно под ней. Повторяем через 450мс — на мобиле сетка/чипсы
  // дозагружаются и лейаут сдвигается.
  function scrollToUnderHeader(el, smoothFirst) {
    if (!el) return;
    var head = document.querySelector('.pm-header');
    var hh = head ? head.getBoundingClientRect().height : 64;
    var run = function(behavior) {
      var y = el.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop) - hh - 10;
      try { window.scrollTo({ top: Math.max(0, y), behavior: behavior }); } catch (_) { window.scrollTo(0, Math.max(0, y)); }
    };
    run(smoothFirst === false ? 'auto' : 'smooth');
    setTimeout(function() {
      var target = el.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop) - hh - 10;
      var cur = window.pageYOffset || document.documentElement.scrollTop;
      if (Math.abs(target - cur) > 40) run('auto');
    }, 450);
  }
  // при входе в категорию — сетка начинается сразу под шапкой
  function scrollToGridTop() { scrollToUnderHeader($('content')); }
  // при открытии жанров — секция жанров сразу под шапкой
  function scrollToGenresSection() {
    var t = $('cyberChips');
    var sec = t && t.closest ? t.closest('.cyber-section') : null;
    if (sec) scrollToUnderHeader(sec);
  }

  function goHome() {
    try {
      document.body.classList.remove('view-category');
      document.body.classList.remove('view-search');
      setNavActive(null);
      var nav = document.querySelector('.cyber-nav-item[data-nav="home"]');
      if (nav) nav.classList.add('active');
      App.MOVIES.setCategory(null);
      App.MOVIES.resetPagination();
      App.UI.clearFilms();
      var content = $('content');
      if (content) content.classList.add('hidden');
      var si = $('searchInput');
      if (si) si.value = '';
      // вернуть легаси-слои (liftSearchActions прятал резюм-карту)
      var sw = document.querySelector('.search-wrapper');
      if (sw) sw.classList.remove('sa-lifted');
      var rc = $('resumeCard');
      if (rc) rc.classList.remove('sa-hidden');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {}
  }

  function loadGenre(genre) {
    // Фикс «в жанрах только 20 фильмов»: жанр теперь — полноценная
    // категория MOVIES с пагинацией (кеш-первый показ, «Показать ещё»,
    // дозагрузка по скроллу) вместо одиночного fetch без страниц.
    enterCategory(null);
    try {
      var content = $('content');
      if (content) content.classList.remove('hidden');
      App.MOVIES.loadCategory('genre:' + genre.id);
      scrollToGridTop();
    } catch (_) {
      try { App.UI.showEmptyState('Ой, что-то пошло не так 😅', '⚠️'); } catch (__){}
    }
    if (window.trackEvent) window.trackEvent('categories_opened', { category: 'genre:' + genre.name });
  }

  function loadSeries() {
    enterCategory('series');
    try {
      var content = $('content');
      if (content) content.classList.remove('hidden');
      App.MOVIES.setCategory('series');
      App.MOVIES.resetPagination();
      App.MOVIES.loadCategory('series');
      scrollToGridTop();
      if (window.trackEvent) window.trackEvent('categories_opened', { category: 'series' });
    } catch (_) {}
  }

  // ====== PM-ЧИПЫ (категории под хедером) ======
  function bindPmChips() {
    var row = document.querySelector('.pm-chips-row');
    if (!row) return;
    row.addEventListener('click', function(e) {
      var chip = e.target && e.target.closest ? e.target.closest('.pm-chip') : null;
      if (!chip) return;
      if (chip.dataset.action === 'genres') {
        // жанры должны начинаться сразу под шапкой (а не «с ужасов и фантастики»)
        if (!document.body.classList.contains('view-category')) {
          scrollToGenresSection();
        } else {
          goHome();
          setTimeout(scrollToGenresSection, 350);
        }
        return;
      }
      var cat = chip.dataset.cat;
      if (!cat) return;
      enterCategory(cat);
      try {
        if (cat === 'favorites') App.MOVIES.loadFavorites();
        else App.MOVIES.loadCategory(cat);
        scrollToGridTop();
      } catch (_) {}
    });
  }

  // ====== HERO BANNER ======
  var heroFilms = [];
  var heroIdx = 0;
  var heroTimer = null;

  function heroBuild(films) {
    var hero = $('cyberHero');
    if (!hero || !films || films.length === 0) return;
    heroFilms = films.filter(function(f) { return posterOf(f); }).slice(0, 5);
    if (heroFilms.length === 0) return;
    var html = '';
    for (var i = 0; i < heroFilms.length; i++) {
      var f = heroFilms[i];
      var fid = filmIdOf(f);
      var meta = [];
      var y = f.year || '';
      var gens = (f.genres || []).slice(0, 2).map(function(g) { return g.genre; }).join(', ');
      var cts = (f.countries || []).slice(0, 2).map(function(c) { return c.country; }).join(', ');
      if (y) meta.push(esc(y));
      if (cts) meta.push(esc(cts));
      if (gens) meta.push(esc(gens));
      if (f.filmLength) meta.push(esc(f.filmLength) + ' мин');
      var r = ratingOf(f);
      html += '<div class="cyber-hero-slide' + (i === 0 ? ' active' : '') + '" data-i="' + i + '">' +
        '<img class="cyber-hero-bg" src="' + esc(f.posterUrl || posterOf(f)) + '" alt="" ' +
        (i === 0 ? 'fetchpriority="high"' : 'loading="lazy"') + ' decoding="async">' +
        '<div class="cyber-hero-content">' +
          '<div class="cyber-hero-title">' + esc(titleOf(f)) + '</div>' +
          '<div class="cyber-hero-meta">' +
            (r ? '<span class="cyber-hero-rating">⭐ ' + esc(r) + '</span>' : '') +
            '<span>' + meta.join(' · ') + '</span>' +
          '</div>' +
          (f.shortDescription ? '<div class="cyber-hero-desc">' + esc(f.shortDescription) + '</div>' : '') +
          '<div class="cyber-hero-actions">' +
            '<button class="cyber-btn cyber-btn-primary" data-watch="' + esc(fid) + '" data-title="' + esc(titleOf(f)) + '" type="button">▶ Смотреть</button>' +
            '<button class="cyber-btn cyber-btn-ghost" data-fav="' + esc(fid) + '" type="button" aria-label="В коллекцию" title="В коллекцию"><svg class="fav-svg" viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v16.2a.8.8 0 0 1-1.28.64L12 16.9l-5.72 3.94A.8.8 0 0 1 5 20.2V4a1 1 0 0 1 1-1z"/></svg></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    html += '<div class="cyber-hero-count" id="cyberHeroCount">01 / ' + ('0' + heroFilms.length).slice(-2) + '</div>';
    html += '<div class="cyber-hero-dots" id="cyberHeroDots">';
    for (var j = 0; j < heroFilms.length; j++) {
      html += '<button class="cyber-hero-dot' + (j === 0 ? ' active' : '') + '" data-dot="' + j + '" type="button" aria-label="Слайд ' + (j + 1) + '"></button>';
    }
    html += '</div>';
    hero.innerHTML = html;
    hero.hidden = false;
    heroShow(0);
    heroBind();
    heroTimer = setInterval(function() { heroShow((heroIdx + 1) % heroFilms.length); }, 7000);
  }

  function heroShow(i) {
    heroIdx = i;
    var hero = $('cyberHero');
    if (!hero) return;
    var slides = hero.querySelectorAll('.cyber-hero-slide');
    var dots = hero.querySelectorAll('.cyber-hero-dot');
    for (var k = 0; k < slides.length; k++) slides[k].classList.toggle('active', k === i);
    for (var d = 0; d < dots.length; d++) dots[d].classList.toggle('active', d === i);
    var cnt = $('cyberHeroCount');
    if (cnt) cnt.textContent = ('0' + (i + 1)).slice(-2) + ' / ' + ('0' + slides.length).slice(-2);
  }

  function heroBind() {
    var hero = $('cyberHero');
    if (!hero) return;
    hero.addEventListener('click', function(e) {
      var t = e.target;
      var favBtn = t.closest ? t.closest('[data-fav]') : null;
      if (favBtn) {
        var f = heroFilms[heroIdx];
        if (f) toggleFav(f, favBtn);
        return;
      }
      var watch = t.closest ? t.closest('[data-watch]') : null;
      if (watch && window.openPlayer) {
        var hf = heroFilms[heroIdx];
        window.openPlayer(watch.dataset.watch, watch.dataset.title, hf ? (hf.posterUrl || hf.posterUrlPreview || '') : '');
        return;
      }
      var dot = t.closest ? t.closest('[data-dot]') : null;
      if (dot) {
        heroShow(parseInt(dot.dataset.dot, 10) || 0);
        heroRestartTimer();
      }
    });
    // swipe
    var sx = 0;
    hero.addEventListener('touchstart', function(e) { sx = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', function(e) {
      var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) < 40) return;
      heroShow((heroIdx + (dx < 0 ? 1 : heroFilms.length - 1)) % heroFilms.length);
      heroRestartTimer();
    }, { passive: true });
  }

  function heroRestartTimer() {
    if (heroTimer) clearInterval(heroTimer);
    heroTimer = setInterval(function() { heroShow((heroIdx + 1) % heroFilms.length); }, 7000);
  }

  // ====== FAVORITES (hero button + rail) ======
  function readFavs() {
    try {
      var raw = sessionStorage.getItem('filmotiv_fav_cache');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function writeFavs(arr) {
    try { sessionStorage.setItem('filmotiv_fav_cache', JSON.stringify(arr)); } catch (_) {}
  }
  function favShape(f) {
    return {
      filmId: String(filmIdOf(f)), nameRu: titleOf(f), title: titleOf(f),
      posterUrlPreview: posterOf(f), poster: posterOf(f),
      year: f.year || '', rating: ratingOf(f)
    };
  }
  function toggleFav(f, btn) {
    var fid = String(filmIdOf(f));
    var favs = readFavs();
    var has = favs.some(function(x) { return String(x.filmId || x.kinopoiskId) === fid; });
    if (has) {
      favs = favs.filter(function(x) { return String(x.filmId || x.kinopoiskId) !== fid; });
      trackFav('favorite_removed', f);
    } else {
      favs.unshift(favShape(f));
      trackFav('favorite_added', f);
    }
    writeFavs(favs);
    updateFavBtn(btn, !has);
    renderFavs();
  }
  function updateFavBtn(btn, inFav) {
    if (!btn) return;
    btn.classList.toggle('in-fav', inFav);
    btn.innerHTML = inFav ? '<span class="fav-ico">✓</span>' : '<svg class="fav-svg" viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v16.2a.8.8 0 0 1-1.28.64L12 16.9l-5.72 3.94A.8.8 0 0 1 5 20.2V4a1 1 0 0 1 1-1z"/></svg>';
    btn.title = inFav ? 'В коллекции' : 'В коллекцию';
  }
  function trackFav(type, f) {
    try {
      // SYNC FIX: раньше читали гостевой ключ filmotiv_user_id — кнопка
      // «＋ В коллекцию» НИКОГДА не писала в базу (гость = web_* → выход,
      // после логина ключ удалён → тоже выход). Теперь: initData (мини-апп)
      // или filmotiv_tg_user_id (сайт после Telegram-логина).
      var initData = getTgInitData();
      var uid = localStorage.getItem('filmotiv_tg_user_id') || '';
      if (!initData && !uid) return; // гость — только localStorage, мигрирует при логине
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: type, userId: uid || undefined, initData: initData || undefined,
          filmId: String(filmIdOf(f)), title: titleOf(f),
          year: f.year || '', poster: posterOf(f),
          platform: initData ? 'miniapp' : 'browser'
        }),
        keepalive: true
      }).catch(function() {});
    } catch (_) {}
  }
  function getTgInitData() {
    try {
      var t = window.Telegram && window.Telegram.WebApp;
      return (t && t.initData) ? t.initData : '';
    } catch (_) { return ''; }
  }

  // ====== SERVER FAVORITES SYNC ======
  // Кнопки «В коллекцию» должны отражать серверную коллекцию даже на свежей
  // сессии: подтягиваем /api/me и объединяем кеши. Заодно наполняем блок
  // «Последние фильмы» из watched_films, если локальный список пуст.
  function favIdOf(x) { return String(x.filmId || x.kinopoiskId || ''); }
  function syncServerFavs() {
    try {
      var initData = getTgInitData();
      var uid = localStorage.getItem('filmotiv_tg_user_id') || '';
      if (!initData && !uid) return; // гость — серверной коллекции нет
      fetch('/api/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: uid || undefined, initData: initData || undefined })
      }).then(function(r) { return r.ok ? r.json() : null; }).then(function(data) {
        if (!data) return;
        if (Array.isArray(data.favorites)) {
          var server = data.favorites.map(function(f) {
            return {
              filmId: String(f.filmId || ''), nameRu: f.title || '', title: f.title || '',
              posterUrlPreview: f.poster || '', poster: f.poster || '',
              year: f.year || '', rating: f.rating || ''
            };
          }).filter(function(f) { return f.filmId && f.filmId !== 'undefined'; });
          var ids = {};
          server.forEach(function(f) { ids[favIdOf(f)] = true; });
          var localExtra = readFavs().filter(function(f) {
            var k = favIdOf(f);
            if (!k || ids[k]) return false;
            ids[k] = true;
            return true;
          });
          writeFavs(server.concat(localExtra));
          refreshFavButtons();
        }
        // «Последние фильмы»: локальный пуст — берём серверную историю открытий
        if (Array.isArray(data.watched_films) && data.watched_films.length > 0 && readRecent().length === 0) {
          var rec = data.watched_films
            .filter(function(f) { return f && f.filmId; })
            .slice(0, 3)
            .map(function(f) { return { filmId: String(f.filmId), title: f.title || '', poster: '', year: '', ts: Date.now() }; });
          if (rec.length > 0) {
            try { localStorage.setItem('filmotiv_recent_films', JSON.stringify(rec)); } catch (_) {}
            renderRecent();
          }
        }
      }).catch(function() {});
    } catch (_) {}
  }
  function refreshFavButtons() {
    try {
      var favs = readFavs();
      var btns = document.querySelectorAll('[data-fav]');
      for (var i = 0; i < btns.length; i++) {
        var fid = btns[i].getAttribute('data-fav');
        var has = false;
        for (var k = 0; k < favs.length; k++) {
          if (favIdOf(favs[k]) === String(fid)) { has = true; break; }
        }
        btns[i].classList.toggle('in-fav', has);
        btns[i].innerHTML = has ? '<span class="fav-ico">✓</span>' : '<svg class="fav-svg" viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v16.2a.8.8 0 0 1-1.28.64L12 16.9l-5.72 3.94A.8.8 0 0 1 5 20.2V4a1 1 0 0 1 1-1z"/></svg>';
        btns[i].title = has ? 'В коллекции' : 'В коллекцию';
      }
    } catch (_) {}
  }

  // ====== SECTIONS (ряды) ======
  function renderRow(rowId, films, opts) {
    var row = $(rowId);
    if (!row) return;
    var list = films.filter(function(f) { return posterOf(f); }).slice(0, 14);
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var r = ratingOf(f);
      var flag = App.CORE.flagOf ? App.CORE.flagOf(f) : '';
      // по Figma: рейтинг (зелёный бейдж) + год + флаг страны под названием
      html += '<div class="cyber-card" data-fid="' + esc(filmIdOf(f)) + '" data-title="' + esc(titleOf(f)) + '">' +
        '<div class="cyber-card-poster">' +
          '<img src="' + esc(posterOf(f)) + '" alt="' + esc(titleOf(f)) + '" loading="lazy" decoding="async">' +
          (opts && opts.isNew ? '<span class="cyber-card-new">NEW</span>' : '') +
        '</div>' +
        '<div class="cyber-card-title">' + esc(titleOf(f)) + '</div>' +
        '<div class="cyber-card-sub">' +
          (r ? '<span class="cyber-card-rate">' + esc(r) + '</span>' : '') +
          (f.year ? '<span>' + esc(f.year) + (flag ? ' ' + flag : '') + '</span>' : '') +
        '</div>' +
      '</div>';
    }
    row.innerHTML = html;
    row.addEventListener('click', function(e) {
      var card = e.target && e.target.closest ? e.target.closest('.cyber-card') : null;
      if (card && window.openPlayer) {
        var img = card.querySelector('img');
        window.openPlayer(card.dataset.fid, card.dataset.title, img ? img.src : '');
      }
    });
    // fade-in постеров
    var imgs = row.querySelectorAll('img');
    for (var k = 0; k < imgs.length; k++) {
      imgs[k].addEventListener('load', function() { this.classList.add('loaded'); });
      imgs[k].addEventListener('error', function() { this.style.opacity = '1'; this.style.filter = 'grayscale(1) brightness(.4)'; });
    }
  }

  // ====== ТОП РЕЙТИНГА (широкие карточки по Figma) ======
  function fetchTop() {
    // приоритет — свежий кеш топ-250 (уже прогрет app.js)
    var cached = readCatCache('top250', 1);
    if (cached && cached.length >= 6) return Promise.resolve({ items: cached });
    var url = App.CORE.resolveApi('/api/kinopoisk?q=v2.2/films&order=RATING&type=FILM&ratingFrom=8&ratingTo=10&page=1');
    return fetch(url).then(function(r) { return r.ok ? r.json() : null; }).catch(function() { return null; });
  }

  function renderTop(films) {
    var grid = $('pmTopRow');
    if (!grid) return;
    var list = films.filter(function(f) { return posterOf(f) && ratingOf(f); });
    if (list.length === 0) {
      var sec = grid.closest('.cyber-section');
      if (sec) sec.hidden = true;
      return;
    }
    // Единый вид карточек: 5 фильмов в ряд на ПК (запрос пользователя) —
    // тот же renderRow, что и для «Популярные»/«Новинки»
    renderRow('pmTopRow', list);
  }

  function ensureTop() {
    var grid = $('pmTopRow');
    if (!grid || grid.children.length > 0) return;
    fetchTop().then(function(data) {
      var films = (data && (data.items || data.films)) || [];
      if (films.length > 0) {
        App.MOVIES.filterAvailable(films).then(function(avail) {
          if (avail.length > 0 && $('pmTopRow').children.length === 0) renderTop(avail);
        });
      }
    });
  }

  function initSections() {
    var popCached = readCatCache('popular');
    if (popCached) renderRow('cyberRowPopular', popCached);
    // «Новинки» из localStorage НЕ берём: четверговый список должен быть
    // свежим — ensureNew() всегда идёт через /api/new-films

    function ensurePopular() {
      if ($('cyberRowPopular') && $('cyberRowPopular').children.length === 0) {
        fetchCat('popular').then(function(data) {
          var films = (data && (data.films || data.items)) || [];
          if (films.length > 0) {
            App.MOVIES.filterAvailable(films).then(function(avail) {
              if ($('cyberRowPopular').children.length > 0 || avail.length === 0) return;
              renderRow('cyberRowPopular', avail);
              try { if (App.TRACKING && App.TRACKING.cacheFilms) App.TRACKING.cacheFilms('popular', 1, { films: avail }); } catch (_) {}
            });
          }
        });
      }
    }
    function ensureNew() {
      if ($('cyberRowNew') && $('cyberRowNew').children.length === 0) {
        fetchCat('new').then(function(data) {
          var films = (data && (data.films || data.items)) || [];
          if (films.length > 0) {
            App.MOVIES.filterAvailable(films).then(function(avail) {
              if ($('cyberRowNew').children.length > 0 || avail.length === 0) return;
              renderRow('cyberRowNew', avail, { isNew: true });
            });
          }
        });
      }
    }
    // Прогрев app.js кладёт кеш на 0с (popular) и 3с (new) — подождём,
    // затем добираем сами, если пусто.
    setTimeout(function() { ensurePopular(); ensureNew(); ensureTop(); }, 3600);
    if (!popCached) setTimeout(ensurePopular, 1200);
    setTimeout(ensureTop, 1500);

    var secs = $('cyberSections');
    if (secs) secs.hidden = false;
    initChips();
  }

  // ====== GENRES ======
  var CURATED = ['боевик', 'драма', 'комедия', 'триллер', 'ужасы', 'фантастика',
    'фэнтези', 'мультфильм', 'детектив', 'приключения', 'мелодрама', 'криминал'];

  function initChips() {
    var box = $('cyberChips');
    if (!box) return;
    var genres = null;
    try {
      var raw = localStorage.getItem('filmotiv_genres');
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.genres && Date.now() - p.ts < FRESH) genres = p.genres;
      }
    } catch (_) {}
    if (genres) { renderChips(genres); return; }
    fetch(App.CORE.resolveApi('/api/kinopoisk?q=v2.2/films/filters'))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.genres) return;
        try { localStorage.setItem('filmotiv_genres', JSON.stringify({ genres: data.genres, ts: Date.now() })); } catch (_) {}
        renderChips(data.genres);
      }).catch(function() {});
  }

  function renderChips(all) {
    var box = $('cyberChips');
    if (!box || !all) return;
    // v2.2/films/filters отдаёт {id, genre}, старый формат — {id, name}
    function gname(g) { return g.genre || g.name || ''; }
    var picked = [];
    for (var c = 0; c < CURATED.length && picked.length < 12; c++) {
      for (var i = 0; i < all.length; i++) {
        if (gname(all[i]).toLowerCase().indexOf(CURATED[c]) === 0) { picked.push(all[i]); break; }
      }
    }
    var html = '';
    for (var k = 0; k < picked.length; k++) {
      html += '<button class="cyber-chip" data-genre="' + esc(picked[k].id) + '" data-gname="' + esc(gname(picked[k])) + '" type="button">' + esc(gname(picked[k])) + '</button>';
    }
    box.innerHTML = html;
    box.addEventListener('click', function(e) {
      var chip = e.target && e.target.closest ? e.target.closest('.cyber-chip') : null;
      if (chip) loadGenre({ id: chip.dataset.genre, name: chip.dataset.gname });
    });
  }

  // ====== RIGHT RAIL: «Последние фильмы» (3 последних открытых) ======
  // Заменяет прежние блоки «Продолжить просмотр»/«Избранное»/«Статистика».
  // Источник: localStorage filmotiv_recent_films (пишется в openPlayer),
  // при пустом локальном списке — серверная история watched_films (/api/me).
  function readRecent() {
    try {
      var raw = localStorage.getItem('filmotiv_recent_films');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function(x) { return x && x.filmId; }) : [];
    } catch (_) { return []; }
  }

  function renderRecent() {
    var box = $('railRecent'), empty = $('railRecentEmpty');
    if (!box) return;
    var rec = readRecent().slice(0, 3);
    if (empty) empty.hidden = rec.length > 0;
    if (rec.length === 0) { box.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < rec.length; i++) {
      var f = rec[i];
      var poster = f.poster || ('/api/poster?id=' + encodeURIComponent(f.filmId) + '&size=small');
      html += '<div class="gp-recent-item" data-fid="' + esc(f.filmId) + '" data-title="' + esc(f.title || '') + '">' +
        '<img src="' + esc(poster) + '" alt="" loading="lazy" decoding="async">' +
        '<div class="gp-recent-info">' +
          '<div class="gp-recent-title">' + esc(f.title || '—') + '</div>' +
          (f.year ? '<div class="gp-recent-sub">' + esc(f.year) + '</div>' : '') +
        '</div>' +
      '</div>';
    }
    box.innerHTML = html;
    var imgs = box.querySelectorAll('img');
    for (var k = 0; k < imgs.length; k++) {
      imgs[k].addEventListener('load', function() { this.classList.add('loaded'); });
      imgs[k].addEventListener('error', function() { this.style.opacity = '1'; this.style.filter = 'grayscale(1) brightness(.4)'; });
    }
    box.onclick = function(e) {
      var it = e.target && e.target.closest ? e.target.closest('.gp-recent-item') : null;
      if (it && window.openPlayer) window.openPlayer(it.dataset.fid, it.dataset.title);
    };
  }

  // (блоки «Продолжить просмотр»/«Избранное»/«Статистика» удалены по запросу —
  // вместо них в рейле «Последние фильмы» и цитата)

  // ====== РЕЖИМ ПОИСКА (FIX: «поиск не работает») ======
  // Раньше результаты рендерились в #content ПОД героем и секциями главной
  // (ниже первого экрана) — пользователь не видел ничего и считал поиск
  // сломанным. Теперь: при вводе — body.view-search (прячет hero+секции),
  // #content показывается сразу под топбаром; при очистке — возврат на главную.
  function bindSearchView() {
    var si = $('searchInput');
    if (!si) return;
    si.addEventListener('input', function() {
      var q = si.value.trim();
      try {
        if (q) {
          document.body.classList.add('view-search');
          var content = $('content');
          if (content) content.classList.remove('hidden');
        } else {
          var st = null;
          try { st = App.MOVIES.getState(); } catch (_) {}
          if (!st || !st.currentCategory) {
            var c2 = $('content');
            if (c2) c2.classList.add('hidden');
            var ld = $('loader');
            if (ld) ld.classList.add('hidden');
          }
          document.body.classList.remove('view-search');
        }
      } catch (_) {}
    });
    // Enter — мигом наверх, к результатам (на мобиле особенно важно)
    si.addEventListener('keydown', function(e) {
      if ((e.key === 'Enter' || e.keyCode === 13) && si.value.trim()) {
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
      }
    });
    var sc = $('searchClear');
    if (sc) sc.addEventListener('click', function() {
      document.body.classList.remove('view-search');
    });
    // ⌘K / Ctrl+K — фокус в поиск
    document.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K' || e.key === 'к' || e.key === 'К')) {
        e.preventDefault();
        try { si.focus(); } catch (_) {}
      }
    });
  }

  // ====== DRAWER (мобильный сайдбар) ======
  function bindDrawer() {
    var burger = $('gpBurger'), bd = $('gpBackdrop');
    function close() { document.body.classList.remove('gp-open'); }
    if (burger) burger.addEventListener('click', function() {
      document.body.classList.toggle('gp-open');
    });
    if (bd) bd.addEventListener('click', close);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') close();
    });
    var lm = $('cyberLogoM');
    if (lm) lm.addEventListener('click', goHome);
  }

  // ====== NAV BINDINGS ======
  function bindNav() {
    var nav = $('cyberNav');
    if (nav) {
      nav.addEventListener('click', function(e) {
        var item = e.target && e.target.closest ? e.target.closest('.cyber-nav-item') : null;
        if (!item) return;
        if (document.body.classList.contains('gp-open')) document.body.classList.remove('gp-open');
        if (item.dataset.nav === 'home') { goHome(); return; }
        if (item.dataset.nav === 'series') { loadSeries(); return; }
        var cat = item.dataset.cat;
        if (!cat) return;
        enterCategory(cat);
        try {
          if (cat === 'favorites') App.MOVIES.loadFavorites();
          else App.MOVIES.loadCategory(cat);
          scrollToGridTop();
        } catch (_) {}
      });
    }
    var logo = $('cyberLogo');
    if (logo) logo.addEventListener('click', goHome);
    var back = $('cyberBack');
    if (back) back.addEventListener('click', goHome);
    try { bindPmChips(); } catch (_) {}
    // «Все →» в секциях
    document.querySelectorAll('.cyber-section-all').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var cat = btn.dataset.cat;
        if (!cat) return;
        enterCategory(cat);
        try {
          App.MOVIES.loadCategory(cat);
          scrollToGridTop();
        } catch (_) {}
      });
    });
    // Легаси-кнопки категорий (chaos-grid/quest) — тоже включают view-category
    document.addEventListener('click', function(e) {
      var t = e.target && e.target.closest ? e.target.closest('.action-card[data-cat]') : null;
      if (t && !t.closest('.cyber-sidebar')) enterCategory(t.dataset.cat);
    }, true);
  }

  // ====== INIT ======
  function init() {
    try { bindNav(); } catch (_) {}
    try { bindDrawer(); } catch (_) {}
    try { bindSearchView(); } catch (_) {} // FIX: переключение в режим поиска
    try { renderRecent(); } catch (_) {} // «Последние фильмы» в рейле
    try { refreshFavButtons(); syncServerFavs(); } catch (_) {} // SYNC FIX: серверная коллекция в кнопки
    try { initSections(); } catch (_) {}
    // hero: из кеша сразу, иначе догружаем
    try {
      var pop = readCatCache('popular');
      if (pop) heroBuild(pop);
      else fetchCat('popular').then(function(data) {
        var films = (data && (data.films || data.items)) || [];
        if (films.length > 0) heroBuild(films);
      });
    } catch (_) {}
    try {
      window.addEventListener('pageshow', function() { renderRecent(); refreshFavButtons(); syncServerFavs(); });
    } catch (_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
