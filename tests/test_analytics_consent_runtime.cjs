const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const consentScript = readFileSync('html/js/analytics-consent.js', 'utf8');
const trackingScript = readFileSync('html/js/tracking.js', 'utf8');
const storageKey = 'kepstroy_metrika_notice_acknowledged';
const legacyConsentKey = 'kepstroy_analytics_consent';
const tagUrl = 'https://mc.yandex.ru/metrika/tag.js?id=109754800';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.className = '';
    this.hidden = false;
    this.id = '';
    this.parentNode = null;
    this.style = {};
    this._textContent = '';
    this.listeners = new Map();
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    this.ownerDocument.register(child);
    return child;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    for (const listener of this.listeners.get('click') || []) {
      listener({ preventDefault() {} });
    }
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, target: this });
    }
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
    this.ownerDocument.unregister(this);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  querySelector(selector) {
    return this.ownerDocument.findWithin(this, selector);
  }

  get classList() {
    return {
      add: (...tokens) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        tokens.forEach(token => classes.add(token));
        this.className = [...classes].join(' ');
      },
      contains: token => this.className.split(/\s+/).includes(token),
    };
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
  }
}

class FakeDocument {
  constructor(readyState = 'loading') {
    this.readyState = readyState;
    this.baseURI = 'https://kepstroy.ru/';
    this.referrer = '';
    this.listeners = new Map();
    this.elements = [];
    this.documentElement = new FakeElement('html', this);
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.documentElement.append(this.head, this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  register(element) {
    if (!this.elements.includes(element)) this.elements.push(element);
  }

  unregister(element) {
    this.elements = this.elements.filter(candidate => candidate !== element);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  fire(type) {
    if (type === 'DOMContentLoaded') this.readyState = 'complete';
    for (const listener of this.listeners.get(type) || []) listener();
  }

  getElementById(id) {
    return this.elements.find(element => element.id === id) || null;
  }

  querySelector(selector) {
    return this.findWithin(this.documentElement, selector);
  }

  querySelectorAll(selector) {
    const descendants = this.descendantsOf(this.documentElement);
    if (selector === 'script[src]') {
      return descendants.filter(element => element.tagName === 'SCRIPT' && element.src);
    }
    if (selector === 'a[href^="tel:"]') return [];
    return [];
  }

  descendantsOf(root) {
    const descendants = [];
    const visit = element => {
      for (const child of element.children) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(root);
    return descendants;
  }

  findWithin(root, selector) {
    const descendants = this.descendantsOf(root);

    if (selector === '.cookie-banner__btn') {
      return descendants.find(element => element.classList.contains('cookie-banner__btn')) || null;
    }
    if (selector === '[data-consent-status]') {
      return descendants.find(element => element.getAttribute('data-consent-status') !== null) || null;
    }
    if (selector === 'script[data-kepstroy-metrika]') {
      return descendants.find(element => (
        element.tagName === 'SCRIPT'
        && element.getAttribute('data-kepstroy-metrika') !== null
      )) || null;
    }
    if (selector === 'style[data-kepstroy-notice-styles]') {
      return descendants.find(element => (
        element.tagName === 'STYLE'
        && element.getAttribute('data-kepstroy-notice-styles') !== null
      )) || null;
    }
    return null;
  }
}

function createHarness({
  storedAcknowledgement = null,
  storedConsent = null,
  storageThrows = false,
  readyState = 'loading',
  preexistingYm,
  preexistingTagSrc,
} = {}) {
  const document = new FakeDocument(readyState);
  const storageWrites = [];
  const timeoutDelays = [];
  const storedValues = new Map([
    [storageKey, storedAcknowledgement],
    [legacyConsentKey, storedConsent],
  ]);
  const localStorage = {
    getItem(key) {
      assert.ok(storedValues.has(key), `unexpected storage key: ${key}`);
      if (storageThrows) throw new Error('storage unavailable');
      return storedValues.get(key);
    },
    setItem(key, value) {
      assert.equal(key, storageKey);
      if (storageThrows) throw new Error('storage unavailable');
      storedValues.set(key, value);
      storageWrites.push([key, value]);
    },
  };
  const sessionStorage = {
    getItem() { return null; },
    setItem() {},
  };
  const window = {
    document,
    innerHeight: 800,
    localStorage,
    location: { href: 'https://kepstroy.ru/?utm_source=test' },
    scrollY: 0,
    sessionStorage,
    addEventListener() {},
    setTimeout(callback, delay) {
      timeoutDelays.push(delay);
      if (delay <= 700) return setTimeout(callback, 0);
      return null;
    },
    clearTimeout(timer) {
      if (timer) clearTimeout(timer);
    },
  };
  if (preexistingYm) window.ym = preexistingYm;
  window.window = window;

  if (preexistingTagSrc) {
    const tag = document.createElement('script');
    tag.src = preexistingTagSrc;
    document.head.appendChild(tag);
  }

  const context = vm.createContext({
    console,
    document,
    localStorage,
    URL,
    URLSearchParams,
    window,
  });
  const runScript = () => vm.runInContext(consentScript, context);
  const runTrackingScript = () => vm.runInContext(trackingScript, context);
  runScript();

  return {
    document,
    runScript,
    runTrackingScript,
    storageWrites,
    timeoutDelays,
    window,
    acknowledge() {
      const button = document.querySelector('.cookie-banner__btn');
      assert.ok(button, 'notice acknowledgement button should be present');
      button.click();
    },
    completeDom() {
      document.fire('DOMContentLoaded');
    },
    metrikaScripts() {
      return document.elements.filter(element => (
        element.tagName === 'SCRIPT'
        && element.getAttribute('data-kepstroy-metrika') !== null
      ));
    },
    matchingMetrikaScripts() {
      return document.querySelectorAll('script[src]').filter(element => (
        new URL(element.src, document.baseURI).origin === 'https://mc.yandex.ru'
        && new URL(element.src, document.baseURI).pathname === '/metrika/tag.js'
      ));
    },
    ymCalls(command) {
      const queue = window.ym?.a || [];
      return queue.filter(args => args[1] === command);
    },
  };
}

test('Metrika initializes immediately and DOM readiness creates an informational notice', () => {
  const harness = createHarness();

  assert.equal(harness.window.KepstroyAnalytics.state, 'loading');
  assert.equal(harness.document.getElementById('cookieBanner'), null);
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.metrikaScripts()[0].src, tagUrl);
  assert.equal(harness.ymCalls('init').length, 1);
  harness.completeDom();

  const banner = harness.document.getElementById('cookieBanner');
  const button = harness.document.querySelector('.cookie-banner__btn');
  assert.ok(banner);
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /Яндекс\.Метрику.*сбора статистики о посещениях.*улучшения работы сайта/i);
  assert.equal(button.textContent, 'Понятно');
  assert.doesNotMatch(banner.textContent, /соглас|принять/i);
});

test('acknowledgement stores notice state and hides the banner without reinitializing Metrika', () => {
  const harness = createHarness();
  harness.completeDom();
  harness.acknowledge();

  const banner = harness.document.getElementById('cookieBanner');
  assert.deepEqual(harness.storageWrites, [[storageKey, 'true']]);
  assert.equal(banner.hidden, true);
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
  assert.equal(harness.window.KepstroyAnalytics.state, 'loading');
  assert.equal(harness.window.KepstroyAnalytics.isNoticeAcknowledged(), true);

  harness.metrikaScripts()[0].dispatch('load');
  assert.equal(harness.window.KepstroyAnalytics.state, 'loaded');

  harness.acknowledge();
  harness.runScript();
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
});

test('stored acknowledgement initializes once without showing the notice', () => {
  const harness = createHarness({ storedAcknowledgement: 'true', readyState: 'complete' });

  const banner = harness.document.getElementById('cookieBanner');
  assert.ok(banner);
  assert.equal(banner.hidden, true);
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
  assert.equal(harness.window.KepstroyAnalytics.state, 'loading');

  harness.runScript();
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
});

test('legacy consent counts as acknowledgement but never gates Metrika', () => {
  const harness = createHarness({ storedConsent: 'true', readyState: 'complete' });

  assert.equal(harness.document.getElementById('cookieBanner').hidden, true);
  assert.equal(harness.window.KepstroyAnalytics.isNoticeAcknowledged(), true);
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
});

test('unavailable localStorage does not block Metrika or closing the notice', () => {
  const harness = createHarness({ storageThrows: true });
  harness.completeDom();

  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
  assert.doesNotThrow(() => harness.acknowledge());
  const banner = harness.document.getElementById('cookieBanner');
  assert.equal(banner.hidden, true);
  assert.equal(harness.window.KepstroyAnalytics.isNoticeAcknowledged(), true);
});

test('trackGoal delegates normally before notice acknowledgement', () => {
  const harness = createHarness();
  harness.completeDom();

  assert.doesNotThrow(() => harness.window.KepstroyAnalytics.trackGoal('phone_click'));
  assert.equal(harness.window.KepstroyAnalytics.trackGoal('phone_click'), true);
  const reachGoalCall = Array.from(harness.ymCalls('reachGoal').at(-1));
  assert.equal(reachGoalCall[0], 109754800);
  assert.equal(reachGoalCall[1], 'reachGoal');
  assert.equal(reachGoalCall[2], 'phone_click');
});

test('failed owned tag resets state and a later explicit load retries once', () => {
  const harness = createHarness();
  harness.completeDom();

  const firstTag = harness.metrikaScripts()[0];
  assert.equal(harness.window.KepstroyAnalytics.state, 'loading');
  firstTag.dispatch('error');
  assert.equal(harness.window.KepstroyAnalytics.state, 'failed');
  assert.equal(harness.metrikaScripts().length, 0);
  assert.equal(harness.window.ym, undefined);

  assert.equal(harness.window.KepstroyAnalytics.load(), true);
  const secondTag = harness.metrikaScripts()[0];
  assert.notEqual(secondTag, firstTag);
  assert.equal(harness.window.KepstroyAnalytics.state, 'loading');
  assert.equal(harness.ymCalls('init').length, 1);

  secondTag.dispatch('load');
  assert.equal(harness.window.KepstroyAnalytics.state, 'loaded');
  assert.equal(harness.window.KepstroyAnalytics.load(), true);
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
});

test('existing ready Yandex loader without init evidence is initialized once', () => {
  const ymCalls = [];
  const harness = createHarness({
    readyState: 'complete',
    preexistingTagSrc: 'https://mc.yandex.ru:443/metrika/tag.js?id=109754800',
    preexistingYm(...args) { ymCalls.push(args); },
  });

  assert.equal(harness.matchingMetrikaScripts().length, 1);
  assert.equal(harness.metrikaScripts().length, 0);
  assert.equal(harness.window.KepstroyAnalytics.state, 'loaded');
  assert.deepEqual(ymCalls.map(args => args.slice(0, 2)), [[109754800, 'init']]);

  harness.runScript();
  assert.equal(harness.matchingMetrikaScripts().length, 1);
  assert.equal(ymCalls.length, 1);
});

test('existing Yandex loader URL variants are reused and receive one missing init', () => {
  for (const src of [
    'https://mc.yandex.ru/metrika/tag.js',
    'https://mc.yandex.ru/metrika/tag.js?id=109754800',
    'https://mc.yandex.ru/metrika/tag.js?historical=1#fragment',
  ]) {
    const queuedYm = function queuedYm(...args) {
      queuedYm.a.push(args);
    };
    queuedYm.a = [];
    const harness = createHarness({
      readyState: 'complete',
      preexistingTagSrc: src,
      preexistingYm: queuedYm,
    });

    assert.equal(harness.document.querySelectorAll('script[src]').length, 1, src);
    assert.equal(harness.matchingMetrikaScripts().length, 1, src);
    assert.equal(harness.ymCalls('init').length, 1, src);
    harness.runScript();
    assert.equal(harness.document.querySelectorAll('script[src]').length, 1, src);
    assert.equal(harness.ymCalls('init').length, 1, src);
  }
});

test('existing queued init is evidence that prevents duplicate initialization', () => {
  const queuedYm = function queuedYm(...args) {
    queuedYm.a.push(args);
  };
  queuedYm.a = [[109754800, 'init', { clickmap: true }]];
  const harness = createHarness({
    readyState: 'complete',
    preexistingTagSrc: 'https://mc.yandex.ru/metrika/tag.js',
    preexistingYm: queuedYm,
  });

  assert.equal(harness.document.querySelectorAll('script[src]').length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
});

test('similar but untrusted script URLs are not treated as the Yandex loader', () => {
  for (const src of [
    'https://mc.yandex.ru.evil.test/metrika/tag.js',
    'http://mc.yandex.ru/metrika/tag.js',
    'https://mc.yandex.ru/metrika/other.js',
  ]) {
    const harness = createHarness({
      readyState: 'complete',
      preexistingTagSrc: src,
    });

    assert.equal(harness.document.querySelectorAll('script[src]').length, 2, src);
    assert.equal(harness.matchingMetrikaScripts().length, 1, src);
    assert.equal(harness.metrikaScripts().length, 1, src);
    assert.equal(harness.ymCalls('init').length, 1, src);
  }
});

test('tracking client uses the analytics API before notice acknowledgement', async () => {
  const directYmCalls = [];
  const harness = createHarness({
    preexistingYm(...args) {
      directYmCalls.push(args);
      if (args[1] === 'getClientID') args[2]('test-client-id');
    },
  });
  harness.completeDom();
  harness.runTrackingScript();

  harness.window.KepstroyTracking.trackGoal('phone_click');
  const params = new URLSearchParams();
  await harness.window.KepstroyTracking.appendTo(params);

  assert.equal(params.get('client_id'), 'test-client-id');
  assert.deepEqual(directYmCalls.map(args => args[1]), ['init', 'reachGoal', 'getClientID']);
  assert.ok(harness.timeoutDelays.includes(700));
});
