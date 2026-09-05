const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const consentScript = readFileSync('html/js/analytics-consent.js', 'utf8');
const storageKey = 'kepstroy_analytics_consent';

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

  findWithin(root, selector) {
    const descendants = [];
    const visit = element => {
      for (const child of element.children) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(root);

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
    return null;
  }
}

function createHarness({ storedConsent = null, storageThrows = false, readyState = 'loading' } = {}) {
  const document = new FakeDocument(readyState);
  const storageWrites = [];
  let storedValue = storedConsent;
  const localStorage = {
    getItem(key) {
      assert.equal(key, storageKey);
      if (storageThrows) throw new Error('storage unavailable');
      return storedValue;
    },
    setItem(key, value) {
      assert.equal(key, storageKey);
      if (storageThrows) throw new Error('storage unavailable');
      storedValue = value;
      storageWrites.push([key, value]);
    },
  };
  const window = { document, localStorage };
  window.window = window;

  const context = vm.createContext({ console, document, localStorage, window });
  const runScript = () => vm.runInContext(consentScript, context);
  runScript();

  return {
    document,
    runScript,
    storageWrites,
    window,
    accept() {
      const button = document.querySelector('.cookie-banner__btn');
      assert.ok(button, 'consent button should be present');
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
    ymCalls(command) {
      const queue = window.ym?.a || [];
      return queue.filter(args => args[1] === command);
    },
  };
}

test('before consent DOM readiness creates a clear banner without analytics activity', () => {
  const harness = createHarness();

  assert.equal(harness.document.getElementById('cookieBanner'), null);
  assert.equal(harness.metrikaScripts().length, 0);
  assert.equal(harness.window.ym, undefined);
  harness.completeDom();

  const banner = harness.document.getElementById('cookieBanner');
  const button = harness.document.querySelector('.cookie-banner__btn');
  assert.ok(banner);
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /Метрика.*только после/i);
  assert.match(button.textContent, /Принять/i);
  assert.equal(harness.metrikaScripts().length, 0);
  assert.equal(harness.window.ym, undefined);
});

test('accept stores consent, hides the banner, and initializes Metrika exactly once', () => {
  const harness = createHarness();
  harness.completeDom();
  harness.accept();

  const banner = harness.document.getElementById('cookieBanner');
  assert.deepEqual(harness.storageWrites, [[storageKey, 'true']]);
  assert.equal(banner.hidden, true);
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.metrikaScripts()[0].src, 'https://mc.yandex.ru/metrika/tag.js?id=109754800');
  assert.equal(harness.ymCalls('init').length, 1);

  harness.accept();
  harness.runScript();
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
});

test('stored consent initializes once on the next page load without showing the banner', () => {
  const harness = createHarness({ storedConsent: 'true', readyState: 'complete' });

  const banner = harness.document.getElementById('cookieBanner');
  assert.ok(banner);
  assert.equal(banner.hidden, true);
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);

  harness.runScript();
  assert.equal(harness.metrikaScripts().length, 1);
  assert.equal(harness.ymCalls('init').length, 1);
});

test('unavailable localStorage keeps the banner usable and fails privacy-safe', () => {
  const harness = createHarness({ storageThrows: true });
  harness.completeDom();

  assert.doesNotThrow(() => harness.accept());
  const banner = harness.document.getElementById('cookieBanner');
  const status = harness.document.querySelector('[data-consent-status]');
  assert.equal(banner.hidden, false);
  assert.match(status.textContent, /не удалось сохранить/i);
  assert.equal(harness.metrikaScripts().length, 0);
  assert.equal(harness.window.ym, undefined);
});

test('trackGoal is harmless before consent and delegates normally after loading', () => {
  const harness = createHarness();
  harness.completeDom();

  assert.doesNotThrow(() => harness.window.KepstroyAnalytics.trackGoal('phone_click'));
  assert.equal(harness.window.KepstroyAnalytics.trackGoal('phone_click'), false);
  assert.equal(harness.window.ym, undefined);

  harness.accept();
  assert.equal(harness.window.KepstroyAnalytics.trackGoal('phone_click'), true);
  const reachGoalCall = Array.from(harness.ymCalls('reachGoal')[0]);
  assert.equal(reachGoalCall[0], 109754800);
  assert.equal(reachGoalCall[1], 'reachGoal');
  assert.equal(reachGoalCall[2], 'phone_click');
});
