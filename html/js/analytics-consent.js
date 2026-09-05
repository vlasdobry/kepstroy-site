(function installKepstroyAnalytics(root) {
  'use strict';

  if (!root || !root.document || root.KepstroyAnalytics) return;

  const COUNTER_ID = 109754800;
  const STORAGE_KEY = 'kepstroy_analytics_consent';
  const TAG_URL = `https://mc.yandex.ru/metrika/tag.js?id=${COUNTER_ID}`;
  const document = root.document;
  let consentGranted = readConsent();
  let metrikaStarted = false;

  function readConsent() {
    try {
      return root.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function storeConsent() {
    try {
      root.localStorage.setItem(STORAGE_KEY, 'true');
      consentGranted = true;
      return true;
    } catch {
      consentGranted = false;
      return false;
    }
  }

  function installYmQueue() {
    if (typeof root.ym === 'function') return;

    const ym = function queueYandexMetrikaCall() {
      (ym.a = ym.a || []).push(arguments);
    };
    ym.l = Number(new Date());
    root.ym = ym;
  }

  function loadMetrika() {
    if (!consentGranted) return false;
    if (metrikaStarted) return true;

    metrikaStarted = true;
    installYmQueue();

    let tag = document.querySelector('script[data-kepstroy-metrika]');
    if (!tag) {
      tag = document.createElement('script');
      tag.async = true;
      tag.src = TAG_URL;
      tag.setAttribute('data-kepstroy-metrika', '109754800');
      document.head.appendChild(tag);
    }

    root.ym(COUNTER_ID, 'init', {
      webvisor: true,
      clickmap: true,
      accurateTrackBounce: true,
      trackLinks: true,
    });
    return true;
  }

  function trackGoal(goal) {
    if (!consentGranted || !goal) return false;
    if (!loadMetrika() || typeof root.ym !== 'function') return false;

    try {
      root.ym(COUNTER_ID, 'reachGoal', goal);
      return true;
    } catch {
      return false;
    }
  }

  function installBannerStyles() {
    if (document.querySelector('style[data-kepstroy-consent-styles]')) return;

    const style = document.createElement('style');
    style.setAttribute('data-kepstroy-consent-styles', '');
    style.textContent = `
      #cookieBanner {
        position: fixed;
        right: 1rem;
        bottom: 1rem;
        left: 1rem;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        max-width: 72rem;
        margin: 0 auto;
        padding: 1rem 1.25rem;
        border: 1px solid #d8dee9;
        border-radius: 0.75rem;
        background: #fff;
        box-shadow: 0 0.75rem 2rem rgba(15, 23, 42, 0.18);
        color: #1f2937;
        font: 500 0.875rem/1.5 Inter, Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #cookieBanner[hidden] { display: none !important; }
      #cookieBanner p { margin: 0; }
      #cookieBanner a { color: #166534; text-decoration: underline; }
      #cookieBanner .cookie-banner__btn {
        flex: 0 0 auto;
        padding: 0.7rem 1rem;
        border: 0;
        border-radius: 0.5rem;
        background: #166534;
        color: #fff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      #cookieBanner .cookie-banner__btn:focus-visible {
        outline: 3px solid #f59e0b;
        outline-offset: 2px;
      }
      #cookieBanner [data-consent-status] { color: #991b1b; }
      @media (max-width: 640px) {
        #cookieBanner { align-items: stretch; flex-direction: column; text-align: center; }
        #cookieBanner .cookie-banner__btn { width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }

  function createBanner() {
    const banner = document.createElement('section');
    banner.id = 'cookieBanner';
    banner.className = 'cookie-banner';
    banner.setAttribute('aria-label', 'Настройки аналитических cookies');

    const message = document.createElement('p');
    message.textContent = 'Мы используем аналитические cookies Яндекс.Метрики. Метрика загрузится только после вашего согласия. ';

    const policyLink = document.createElement('a');
    policyLink.href = '/politika-konfidencialnosti/';
    policyLink.textContent = 'Подробнее в политике конфиденциальности';
    message.appendChild(policyLink);

    const acceptButton = document.createElement('button');
    acceptButton.type = 'button';
    acceptButton.className = 'cookie-banner__btn';
    acceptButton.textContent = 'Принять аналитические cookies';

    const status = document.createElement('span');
    status.setAttribute('data-consent-status', '');
    status.setAttribute('role', 'status');
    status.hidden = true;

    banner.append(message, acceptButton, status);
    document.body.appendChild(banner);

    acceptButton.addEventListener('click', function acceptAnalyticsCookies() {
      if (!storeConsent()) {
        status.textContent = 'Не удалось сохранить выбор. Аналитика не загружена; попробуйте ещё раз.';
        status.hidden = false;
        return;
      }

      status.hidden = true;
      banner.hidden = true;
      loadMetrika();
    });

    return banner;
  }

  function setupBanner() {
    installBannerStyles();
    const banner = document.getElementById('cookieBanner') || createBanner();
    banner.hidden = consentGranted;
  }

  root.KepstroyAnalytics = Object.freeze({
    counterId: COUNTER_ID,
    storageKey: STORAGE_KEY,
    hasConsent: function hasConsent() {
      return consentGranted;
    },
    load: loadMetrika,
    trackGoal,
  });

  if (consentGranted) loadMetrika();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupBanner, { once: true });
  } else {
    setupBanner();
  }
})(typeof window !== 'undefined' ? window : globalThis);
