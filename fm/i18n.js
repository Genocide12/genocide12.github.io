// i18n — internationalization for Filmotiv
// Detects user's language from browser (navigator.language) or Telegram
// (tg.from.language_code) and provides translated strings.
//
// Supported languages: 'ru' (Russian, default), 'en' (English)
// Falls back to 'ru' for any other language.

var TRANSLATIONS = {
  ru: {
    // Hero
    heroTitle: 'Filmotiv',
    heroSubtitle: '',
    // Search
    searchPlaceholder: 'Поиск фильмов...',
    searchClear: 'Очистить',
    // Categories
    catPopular: 'Популярные',
    catTop250: 'Топ 250',
    catNew: 'Новинки',
    catRandom: 'Случайный',
    catFavorites: 'Подборка',
    // Resume card
    resumeLabel: 'Продолжить просмотр',
    resumeContinue: 'Продолжить просмотр',
    // Login bar
    loginTelegram: 'Войти через Telegram',
    openInTelegram: 'Открыть в Telegram',
    // Content
    loading: 'Загрузка...',
    filmsNotFound: 'Фильмы не найдены',
    errorLoading: 'Ошибка загрузки',
    errorSearch: 'Ошибка поиска',
    // Favorites
    favoritesEmpty: 'В подборке пока пусто. Нажмите ❤️ в плеере, чтобы добавить фильм.',
    favoritesNeedLogin: 'Войдите через Telegram, чтобы видеть подборку',
    favoritesPosterError: 'Не удалось загрузить постеры фильмов из подборки',
    // Player
    playerLoading: 'Загрузка плеера...',
    playerResume: 'Продолжить с',
    // Rate overlay
    rateTitle: 'Как вам фильм?',
    rateThanks: 'Спасибо за оценку!',
    rateSkip: 'Пропустить',
    rateDone: 'Готово',
    rateHere: 'Здесь вы можете оценить фильм, а также порекомендовать другу',
    // PWA
    pwaInstallBtn: '📲 Установить приложение',
    pwaInstallIosTitle: '📲 Установка на iPhone/iPad',
    pwaInstallAndroidTitle: '📲 Установка на Android',
    pwaInstallGenericTitle: '📲 Установка приложения',
    pwaUnderstand: 'Понятно',
    // Theme
    themeDark: '🌙 Тёмная',
    themeLight: '☀️ Светлая',
    themeNight: '🌌 Ночная',
    themeAuto: '🔄 Авто (по времени)',
    // Settings
    settingsTitle: '⚙️ Настройки',
    settingsEffects: 'Эффекты',
    settingsZoom: 'Масштаб',
    settingsTheme: 'Тема',
    settingsReset: 'Сбросить настройки',
    // Long-press film info popup
    longpressHint: '💡 Зажмите карточку для информации',
    filmInfoClose: 'Закрыть',
    filmInfoWatch: '▶ Смотреть',
  },
  en: {
    heroTitle: 'Filmotiv',
    heroSubtitle: '',
    searchPlaceholder: 'Search movies...',
    searchClear: 'Clear',
    catPopular: 'Popular',
    catTop250: 'Top 250',
    catNew: 'New',
    catRandom: 'Random',
    catFavorites: 'Selection',
    resumeLabel: 'Continue watching',
    resumeContinue: 'Continue watching',
    loginTelegram: 'Login with Telegram',
    openInTelegram: 'Open in Telegram',
    loading: 'Loading...',
    filmsNotFound: 'No movies found',
    errorLoading: 'Loading error',
    errorSearch: 'Search error',
    favoritesEmpty: 'Your selection is empty. Press ❤️ in the player to add a movie.',
    favoritesNeedLogin: 'Login with Telegram to see your selection',
    favoritesPosterError: 'Failed to load movie posters from your selection',
    playerLoading: 'Loading player...',
    playerResume: 'Resume from',
    rateTitle: 'How was the movie?',
    rateThanks: 'Thanks for rating!',
    rateSkip: 'Skip',
    rateDone: 'Done',
    rateHere: 'Rate the movie and share it with a friend',
    pwaInstallBtn: '📲 Install app',
    pwaInstallIosTitle: '📲 Install on iPhone/iPad',
    pwaInstallAndroidTitle: '📲 Install on Android',
    pwaInstallGenericTitle: '📲 Install app',
    pwaUnderstand: 'Got it',
    themeDark: '🌙 Dark',
    themeLight: '☀️ Light',
    themeNight: '🌌 Night',
    themeAuto: '🔄 Auto (by time)',
    settingsTitle: '⚙️ Settings',
    settingsEffects: 'Effects',
    settingsZoom: 'Zoom',
    settingsTheme: 'Theme',
    settingsReset: 'Reset settings',
    // Long-press film info popup
    longpressHint: '💡 Long-press a card for info',
    filmInfoClose: 'Close',
    filmInfoWatch: '▶ Watch',
  }
};

// Detect user language
function detectLanguage() {
  // Try Telegram WebApp language first
  try {
    var t = window.Telegram && window.Telegram.WebApp;
    if (t && t.initDataUnsafe && t.initDataUnsafe.user && t.initDataUnsafe.user.language_code) {
      var code = t.initDataUnsafe.user.language_code;
      if (code && code.indexOf('ru') === 0) return 'ru';
      if (code && code.indexOf('en') === 0) return 'en';
    }
  } catch (_) {}
  // Fall back to browser language — but default to Russian
  // (site is primarily Russian, ignore browser language)
  return 'ru'; // default — always Russian unless Telegram user is explicitly English
}

// Get translation for a key
function t(key) {
  var lang = window.__filmotivLang || 'ru';
  var dict = TRANSLATIONS[lang] || TRANSLATIONS.ru;
  return dict[key] || TRANSLATIONS.ru[key] || key;
}

// Initialize language
window.__filmotivLang = detectLanguage();
