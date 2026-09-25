/*
 * ADHD OS interaction layer — Filmotiv
 * Signature moments from the ADHD OS prototype:
 *   - confetti bursts (45 pieces, 6 neon colors, 720° spin)
 *   - glass toasts sliding from the top
 *   - haptics (Telegram HapticFeedback + navigator.vibrate)
 * Purely additive: never preventDefault, never touches app.js logic.
 */
(function () {
  'use strict';

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {}

  var tgHaptic = null;
  try {
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback) {
      tgHaptic = window.Telegram.WebApp.HapticFeedback;
    }
  } catch (_) {}

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern || 12);
    } catch (_) {}
  }

  function tapHaptic() {
    if (tgHaptic) {
      try { tgHaptic.impactOccurred('light'); } catch (_) {}
    }
    vibrate(12);
  }

  function successHaptic() {
    if (tgHaptic) {
      try { tgHaptic.notificationOccurred('success'); } catch (_) {}
    }
    vibrate([15, 40, 25]);
  }

  var COLORS = ['#8b5cf6', '#ec4899', '#38bdf8', '#34d399', '#facc15', '#fb923c'];

  function confetti(count) {
    if (reduceMotion || !document.body) return;
    count = count || 45;
    for (var i = 0; i < count; i++) {
      var el = document.createElement('div');
      el.className = 'adhd-confetti';
      el.style.left = (Math.random() * 100) + '%';
      el.style.top = (Math.random() * 20) + '%';
      el.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
      el.style.setProperty('--x', String(Math.random()));
      document.body.appendChild(el);
      (function (node) {
        setTimeout(function () { node.remove(); }, 1500);
      })(el);
    }
  }

  function toast(message) {
    var container = document.querySelector('.adhd-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'adhd-toast-container';
      document.body.appendChild(container);
    }
    var el = document.createElement('div');
    el.className = 'adhd-toast';
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () { el.remove(); }, 2900);
  }

  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || !target.closest) return;

    var card = target.closest('.action-card');
    if (card) {
      tapHaptic();
      var cat = card.getAttribute('data-cat');
      if (cat === 'random') {
        // Random pick = the ADHD OS "Реши за меня" moment
        setTimeout(function () { confetti(60); successHaptic(); }, 600);
      } else if (cat === 'favorites') {
        confetti(18);
      } else if (cat === 'top250') {
        toast('⭐ ТОП-250 ЛУЧШИХ ФИЛЬМОВ');
      }
      return;
    }

    if (target.closest('#fipOpen')) {
      successHaptic();
      confetti(30);
      return;
    }

    if (target.closest('#cookieAccept')) {
      successHaptic();
      confetti(25);
      // v191: текст тоста по запросу владельца (было «🍪 ГОТОВО. ПРИЯТНОГО КИНО!»)
      toast('Приятного просмотра 🍿');
    }
  }, true);

  // Exposed for future hooks
  window.AdhdOS = { confetti: confetti, toast: toast, vibrate: vibrate };
})();
