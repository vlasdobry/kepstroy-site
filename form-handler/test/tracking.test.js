const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectAttribution,
  resolveSmartCallAction,
  toTrackingFields
} = require('../../html/js/tracking.js');

test('captures campaign and click identifiers on the landing page', () => {
  const attribution = collectAttribution({
    url: 'https://kepstroy.ru/?utm_source=yandex&utm_medium=cpc&utm_campaign=septiki&yclid=123',
    referrer: 'https://yandex.ru/search/',
    stored: null
  });

  assert.deepEqual(attribution, {
    utm_source: 'yandex',
    utm_medium: 'cpc',
    utm_campaign: 'septiki',
    yclid: '123',
    landing_page: 'https://kepstroy.ru/?utm_source=yandex&utm_medium=cpc&utm_campaign=septiki&yclid=123',
    original_referrer: 'https://yandex.ru/search/'
  });
});

test('does not overwrite attribution during an internal navigation', () => {
  const stored = {
    utm_source: 'yandex',
    utm_medium: 'cpc',
    utm_campaign: 'septiki',
    yclid: '123',
    landing_page: 'https://kepstroy.ru/?utm_source=yandex',
    original_referrer: 'https://yandex.ru/search/'
  };

  const attribution = collectAttribution({
    url: 'https://kepstroy.ru/uslugi/septiki/',
    referrer: 'https://kepstroy.ru/',
    stored
  });

  assert.deepEqual(attribution, stored);
});

test('replaces campaign data only when a new attributed visit is present', () => {
  const stored = {
    utm_source: 'yandex',
    utm_medium: 'cpc',
    landing_page: 'https://kepstroy.ru/',
    original_referrer: 'https://yandex.ru/'
  };

  const attribution = collectAttribution({
    url: 'https://kepstroy.ru/uslugi/septiki/?utm_source=maps&utm_medium=organic',
    referrer: 'https://yandex.ru/maps/',
    stored
  });

  assert.deepEqual(attribution, {
    utm_source: 'maps',
    utm_medium: 'organic',
    landing_page: 'https://kepstroy.ru/uslugi/septiki/?utm_source=maps&utm_medium=organic',
    original_referrer: 'https://yandex.ru/maps/'
  });
});

test('serializes only known tracking fields', () => {
  assert.deepEqual(toTrackingFields({
    utm_source: 'yandex',
    yclid: '123',
    landing_page: 'https://kepstroy.ru/',
    unexpected: 'do-not-send'
  }), {
    utm_source: 'yandex',
    yclid: '123',
    landing_page: 'https://kepstroy.ru/'
  });
});

test('uses a phone call when no callback modal exists', () => {
  assert.equal(resolveSmartCallAction({ isMobile: false, hasModal: false }), 'phone');
  assert.equal(resolveSmartCallAction({ isMobile: true, hasModal: true }), 'phone');
  assert.equal(resolveSmartCallAction({ isMobile: false, hasModal: true }), 'callback');
});