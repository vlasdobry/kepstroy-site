(function installKepstroyAnalytics(root) {
  'use strict';

  if (!root || !root.document || root.KepstroyAnalytics) return;

  const COUNTER_ID = 109754800;
  const STORAGE_KEY = 'kepstroy_analytics_consent';
  const TAG_URL = `https://mc.yandex.ru/metrika/tag.js?id=${COUNTER_ID}`;
  const document = root.document;
  // Do not migrate the legacy `cookiesAccepted` key: it is outside this
  // explicit analytics-consent contract, so it cannot enable the counter.
  let consentGranted = readConsent();
  let loaderState = 'idle';
  let ownedTag = null;
  let ownedYmQueue = null;

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
    if (typeof root.ym === 'function') return root.ym;

    const ym = function queueYandexMetrikaCall() {
      (ym.a = ym.a || []).push(arguments);
    };
    ym.l = Number(new Date());
    ym.kepstroyConsentQueue = true;
    ownedYmQueue = ym;
    root.ym = ym;
    return ym;
  }

  function findExistingTag() {
    return Array.from(document.querySelectorAll('script[src]')).find((tag) => {
      try {
        const url = new URL(tag.src || tag.getAttribute('src'), document.baseURI || root.location?.href);
        return url.origin === 'https://mc.yandex.ru' && url.pathname === '/metrika/tag.js';
      } catch {
        return false;
      }
    }) || null;
  }

  function hasCounterInit(tag) {
    if (tag.getAttribute('data-kepstroy-metrika-init') === 'true') return true;
    const queue = typeof root.ym === 'function' && Array.isArray(root.ym.a) ? root.ym.a : [];
    return queue.some((args) => Number(args[0]) === COUNTER_ID && args[1] === 'init');
  }

  function resetOwnedQueue() {
    if (root.ym === ownedYmQueue) {
      try {
        delete root.ym;
      } catch {
        root.ym = undefined;
      }
    }
    ownedYmQueue = null;
  }

  function observeOwnedTag(tag) {
    tag.addEventListener('load', () => {
      if (tag !== ownedTag) return;
      loaderState = 'loaded';
    }, { once: true });
    tag.addEventListener('error', () => {
      if (tag !== ownedTag) return;
      tag.remove();
      ownedTag = null;
      resetOwnedQueue();
      loaderState = 'failed';
    }, { once: true });
  }

  function observeExternalTag(tag) {
    if (tag.kepstroyConsentObserved) return;
    tag.kepstroyConsentObserved = true;
    tag.addEventListener('load', () => {
      loaderState = 'loaded';
    }, { once: true });
    tag.addEventListener('error', () => {
      loaderState = 'failed';
    }, { once: true });
  }

  function initCounter() {
    root.ym(COUNTER_ID, 'init', {
      webvisor: true,
      clickmap: true,
      accurateTrackBounce: true,
      trackLinks: true,
    });
  }

  function loadMetrika() {
    if (!consentGranted) return false;
    if (loaderState === 'loading' || loaderState === 'loaded') return true;

    const existingTag = findExistingTag();
    if (existingTag) {
      const isOwned = existingTag.getAttribute('data-kepstroy-metrika') === String(COUNTER_ID);
      if (!isOwned) {
        const ymIsReady = typeof root.ym === 'function' && !Array.isArray(root.ym.a);
        loaderState = ymIsReady ? 'loaded' : 'loading';
        observeExternalTag(existingTag);
        if (!hasCounterInit(existingTag)) {
          installYmQueue();
          existingTag.setAttribute('data-kepstroy-metrika-init', 'true');
          try {
            initCounter();
          } catch {
            existingTag.removeAttribute('data-kepstroy-metrika-init');
            loaderState = 'failed';
            return false;
          }
        }
        return true;
      }

      ownedTag = existingTag;
      loaderState = 'loading';
      observeOwnedTag(existingTag);
      installYmQueue();
      if (existingTag.getAttribute('data-kepstroy-metrika-init') !== 'true') {
        existingTag.setAttribute('data-kepstroy-metrika-init', 'true');
        try {
          initCounter();
        } catch {
          existingTag.remove();
          ownedTag = null;
          resetOwnedQueue();
          loaderState = 'failed';
          return false;
        }
      }
      return true;
    }

    installYmQueue();
    const tag = document.createElement('script');
    tag.async = true;
    tag.src = TAG_URL;
    tag.setAttribute('data-kepstroy-metrika', String(COUNTER_ID));
    tag.setAttribute('data-kepstroy-metrika-init', 'true');
    ownedTag = tag;
    loaderState = 'loading';
    observeOwnedTag(tag);
    document.head.appendChild(tag);

    try {
      initCounter();
    } catch {
      tag.remove();
      ownedTag = null;
      resetOwnedQueue();
      loaderState = 'failed';
      return false;
    }
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

  function getClientID() {
    if (!consentGranted) return Promise.resolve(null);
    if (!loadMetrika() || typeof root.ym !== 'function') return Promise.resolve(null);

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer !== null && typeof root.clearTimeout === 'function') {
          root.clearTimeout(timer);
        }
        resolve(value || null);
      };

      timer = root.setTimeout(() => finish(null), 700);
      try {
        root.ym(COUNTER_ID, 'getClientID', finish);
      } catch {
        finish(null);
      }
    });
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
    get state() {
      return loaderState;
    },
    hasConsent: function hasConsent() {
      return consentGranted;
    },
    getClientID,
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
