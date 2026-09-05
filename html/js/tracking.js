(function (root) {
  'use strict';

  const STORAGE_KEY = 'kepstroy_attribution';
  const ATTRIBUTION_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'yclid',
    'gclid',
    'openstat'
  ];
  const TRACKING_KEYS = [
    ...ATTRIBUTION_KEYS,
    'landing_page',
    'original_referrer'
  ];

  const isExternalReferrer = (referrer, currentUrl) => {
    if (!referrer) return false;

    try {
      return new URL(referrer).hostname !== new URL(currentUrl).hostname;
    } catch {
      return false;
    }
  };

  const resolveSmartCallAction = ({ isMobile, hasModal }) => (
    isMobile || !hasModal ? 'phone' : 'callback'
  );
  const collectAttribution = ({ url, referrer = '', stored = null }) => {
    const currentUrl = new URL(url);
    const currentCampaign = {};

    ATTRIBUTION_KEYS.forEach((key) => {
      const value = currentUrl.searchParams.get(key);
      if (value) currentCampaign[key] = value;
    });

    if (Object.keys(currentCampaign).length === 0 && stored) {
      return { ...stored };
    }

    if (Object.keys(currentCampaign).length > 0) {
      return {
        ...currentCampaign,
        landing_page: url,
        original_referrer: isExternalReferrer(referrer, url) ? referrer : ''
      };
    }

    return {
      landing_page: url,
      original_referrer: isExternalReferrer(referrer, url) ? referrer : ''
    };
  };

  const toTrackingFields = (attribution) => {
    const fields = {};
    TRACKING_KEYS.forEach((key) => {
      const value = attribution?.[key];
      if (value) fields[key] = value;
    });
    return fields;
  };

  const readStoredAttribution = () => {
    try {
      return JSON.parse(root.sessionStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  };

  const writeStoredAttribution = (attribution) => {
    try {
      root.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution));
    } catch {
      // Tracking must never block navigation or lead submission.
    }
  };

  const getYandexClientId = () => {
    const analytics = root.KepstroyAnalytics;
    if (!analytics || typeof analytics.getClientID !== 'function') {
      return Promise.resolve(null);
    }
    return analytics.getClientID();
  };

  const trackGoal = (goal) => {
    const analytics = root.KepstroyAnalytics;
    if (analytics && typeof analytics.trackGoal === 'function') {
      analytics.trackGoal(goal);
    }
  };

  const createBrowserApi = () => {
    const attribution = collectAttribution({
      url: root.location.href,
      referrer: root.document.referrer,
      stored: readStoredAttribution()
    });
    writeStoredAttribution(attribution);

    const appendTo = async (formData) => {
      const fields = toTrackingFields(attribution);
      Object.entries(fields).forEach(([key, value]) => formData.set(key, value));
      formData.set('current_page', root.location.href);

      const clientId = await getYandexClientId();
      if (clientId) formData.set('client_id', clientId);
    };

    return { appendTo, attribution: { ...attribution }, resolveSmartCallAction, trackGoal };
  };

  const installBrowserTracking = () => {
    const api = createBrowserApi();
    root.KepstroyTracking = api;

    root.document.querySelectorAll('a[href^="tel:"]').forEach((link) => {
      link.addEventListener('click', () => api.trackGoal('phone_click'));
    });

    let scrollTracked = false;
    root.addEventListener('scroll', () => {
      if (scrollTracked) return;
      const height = root.document.documentElement.scrollHeight;
      const percent = (root.scrollY + root.innerHeight) / height * 100;
      if (percent < 50) return;
      scrollTracked = true;
      api.trackGoal('scroll_50');
    }, { passive: true });

    root.setTimeout(() => api.trackGoal('time_2min'), 120000);
  };

  const exported = { collectAttribution, resolveSmartCallAction, toTrackingFields };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }

  if (root?.document && root?.location) {
    installBrowserTracking();
  }
})(typeof window !== 'undefined' ? window : globalThis);
