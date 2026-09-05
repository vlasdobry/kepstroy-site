const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const mainScript = readFileSync('html/js/main.js', 'utf8');
const blogAccordionScript = readFileSync('html/js/blog-accordion.js', 'utf8');
const analyticsConsentScript = readFileSync('html/js/analytics-consent.js', 'utf8');

class FakeClassList {
  constructor(names = []) {
    this.names = new Set(names);
  }

  add(name) {
    this.names.add(name);
  }

  remove(name) {
    this.names.delete(name);
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.contains(name) : Boolean(force);
    if (shouldAdd) this.add(name);
    else this.remove(name);
    return shouldAdd;
  }
}

class FakeElement {
  constructor({ tagName = 'DIV', classes = [], ownerDocument = null } = {}) {
    this.tagName = tagName;
    this.classList = new FakeClassList(classes);
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.disabled = false;
    this.hidden = false;
    this.isConnected = true;
    this.listeners = new Map();
    this.style = {};
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, init = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...init,
    };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  click() {
    this.dispatch('click');
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

function createMainHarness() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    activeElement: null,
    referrer: '',
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    dispatch(type, init = {}) {
      const event = {
        type,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...init,
      };
      for (const listener of documentListeners.get(type) || []) listener(event);
      return event;
    },
  };
  document.body = new FakeElement({ tagName: 'BODY', ownerDocument: document });

  const menuToggle = new FakeElement({ tagName: 'BUTTON', classes: ['menu-toggle'], ownerDocument: document });
  menuToggle.setAttribute('aria-expanded', 'false');
  const menuLink = new FakeElement({ tagName: 'A', ownerDocument: document });
  const lastMenuLink = new FakeElement({ tagName: 'A', ownerDocument: document });
  const backgroundButton = new FakeElement({ tagName: 'BUTTON', ownerDocument: document });
  const mobileMenu = new FakeElement({ classes: ['mobile-menu'], ownerDocument: document });
  mobileMenu.querySelectorAll = selector => selector.includes('a[href]') || selector === 'a'
    ? [menuLink, lastMenuLink]
    : [];

  const modalTrigger = new FakeElement({ tagName: 'BUTTON', ownerDocument: document });
  const closeButton = new FakeElement({ tagName: 'BUTTON', classes: ['modal__close'], ownerDocument: document });
  const honeypotInput = new FakeElement({ tagName: 'INPUT', ownerDocument: document });
  honeypotInput.setAttribute('tabindex', '-1');
  const firstInput = new FakeElement({ tagName: 'INPUT', ownerDocument: document });
  const consent = new FakeElement({ tagName: 'INPUT', ownerDocument: document });
  const submit = new FakeElement({ tagName: 'BUTTON', ownerDocument: document });
  const focusables = [closeButton, firstInput, consent, submit];
  const dialog = new FakeElement({ classes: ['modal'], ownerDocument: document });
  dialog.querySelectorAll = selector => selector.includes(':not([tabindex="-1"])')
    ? focusables
    : [honeypotInput, ...focusables];
  const overlay = new FakeElement({ classes: ['modal-overlay'], ownerDocument: document });
  overlay.querySelector = selector => {
    if (selector === '[role="dialog"]' || selector === '.modal') return dialog;
    if (selector.includes('input:not([type="hidden"])')) {
      return selector.includes(':not([tabindex="-1"])') ? firstInput : honeypotInput;
    }
    return null;
  };

  const header = new FakeElement({ tagName: 'HEADER', classes: ['header'], ownerDocument: document });
  document.querySelector = selector => ({
    '.menu-toggle': menuToggle,
    '.mobile-menu': mobileMenu,
    '.sticky-phone': null,
    '.header': header,
  })[selector] ?? null;
  document.querySelectorAll = selector => ({
    '.js-smart-call': [],
    'form[action="/submit"]': [],
    'a[href^="#"]': [],
  })[selector] ?? [];
  document.getElementById = id => id === 'modalOverlay' ? overlay : null;

  const mediaListeners = [];
  const desktopMedia = {
    matches: false,
    addEventListener(type, listener) {
      if (type === 'change') mediaListeners.push(listener);
    },
    change(matches) {
      this.matches = matches;
      for (const listener of mediaListeners) listener({ matches });
    },
  };
  const window = {
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    innerHeight: 800,
    innerWidth: 900,
    location: { href: 'https://kepstroy.ru/' },
    matchMedia(query) {
      assert.equal(query, '(min-width: 1024px)');
      return desktopMedia;
    },
    scrollY: 0,
  };

  const sandbox = {
    URLSearchParams,
    alert() {},
    console,
    document,
    fetch: async () => ({ ok: true }),
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    window,
  };
  vm.runInNewContext(mainScript, sandbox);

  return {
    backgroundButton,
    closeButton,
    consent,
    desktopMedia,
    dialog,
    document,
    firstInput,
    honeypotInput,
    lastMenuLink,
    menuLink,
    menuToggle,
    mobileMenu,
    modalTrigger,
    overlay,
    sandbox,
    submit,
  };
}

test('mobile menu synchronizes aria state and Escape restores toggle focus', () => {
  const harness = createMainHarness();

  harness.menuToggle.click();
  assert.equal(harness.menuToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(harness.menuToggle.getAttribute('aria-label'), 'Закрыть меню');
  assert.equal(harness.mobileMenu.classList.contains('active'), true);
  assert.equal(harness.document.body.style.overflow, 'hidden');

  harness.document.activeElement = harness.menuLink;
  harness.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(harness.menuToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.menuToggle.getAttribute('aria-label'), 'Открыть меню');
  assert.equal(harness.mobileMenu.classList.contains('active'), false);
  assert.equal(harness.document.body.style.overflow, '');
  assert.equal(harness.document.activeElement, harness.menuToggle);
});

test('mobile menu traps Tab and closes when desktop navigation appears', () => {
  const harness = createMainHarness();
  harness.menuToggle.click();

  harness.document.activeElement = harness.lastMenuLink;
  let event = harness.document.dispatch('keydown', { key: 'Tab', shiftKey: false });
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.document.activeElement, harness.menuToggle);

  event = harness.document.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.document.activeElement, harness.lastMenuLink);

  harness.document.activeElement = harness.backgroundButton;
  event = harness.document.dispatch('keydown', { key: 'Tab', shiftKey: false });
  assert.equal(event.defaultPrevented, true);
  assert.equal(harness.document.activeElement, harness.menuToggle);

  harness.desktopMedia.change(true);
  assert.equal(harness.menuToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.mobileMenu.classList.contains('active'), false);
  assert.equal(harness.document.body.style.overflow, '');
});

test('modal moves focus, traps Tab, closes on Escape and restores its trigger', () => {
  const harness = createMainHarness();
  harness.document.activeElement = harness.modalTrigger;

  harness.sandbox.openModal();
  assert.equal(harness.overlay.classList.contains('active'), true);
  assert.equal(harness.document.activeElement, harness.firstInput);

  harness.document.activeElement = harness.submit;
  const forwardTab = harness.document.dispatch('keydown', { key: 'Tab', shiftKey: false });
  assert.equal(forwardTab.defaultPrevented, true);
  assert.equal(harness.document.activeElement, harness.closeButton);

  const reverseTab = harness.document.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(reverseTab.defaultPrevented, true);
  assert.equal(harness.document.activeElement, harness.submit);

  harness.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(harness.overlay.classList.contains('active'), false);
  assert.equal(harness.document.activeElement, harness.modalTrigger);
});

test('repeated modal open preserves the original trigger and current focus', () => {
  const harness = createMainHarness();
  harness.document.activeElement = harness.modalTrigger;

  harness.sandbox.openModal();
  harness.document.activeElement = harness.submit;
  harness.sandbox.openModal();

  assert.equal(harness.document.activeElement, harness.submit);
  harness.sandbox.closeModal();
  assert.equal(harness.document.activeElement, harness.modalTrigger);
});

test('modal close falls back safely when its trigger was disconnected', () => {
  const harness = createMainHarness();
  harness.document.activeElement = harness.modalTrigger;

  harness.sandbox.openModal();
  harness.modalTrigger.isConnected = false;
  harness.sandbox.closeModal();

  assert.equal(harness.document.activeElement, harness.document.body);

  const hiddenHarness = createMainHarness();
  hiddenHarness.document.activeElement = hiddenHarness.modalTrigger;
  hiddenHarness.sandbox.openModal();
  hiddenHarness.modalTrigger.hidden = true;
  hiddenHarness.sandbox.closeModal();
  assert.equal(hiddenHarness.document.activeElement, hiddenHarness.document.body);
});

function createBlogAccordionHarness() {
  const listeners = new Map();
  const document = {
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) || []) listener({ type });
    },
  };

  function createItem(index) {
    const question = new FakeElement({ tagName: 'BUTTON', classes: ['blog-faq__question'], ownerDocument: document });
    question.setAttribute('aria-expanded', 'false');
    question.setAttribute('aria-controls', `answer-${index}`);
    const answer = new FakeElement({ tagName: 'P', classes: ['blog-faq__answer'], ownerDocument: document });
    answer.setAttribute('id', `answer-${index}`);
    const item = new FakeElement({ classes: ['blog-faq__item'], ownerDocument: document });
    item.querySelector = selector => selector === '.blog-faq__question' ? question : answer;
    return { answer, item, question };
  }

  const entries = [createItem(1), createItem(2)];
  const table = new FakeElement({ tagName: 'TABLE', ownerDocument: document });
  document.querySelectorAll = selector => ({
    '.blog-faq__item': entries.map(entry => entry.item),
    '.blog-article table': [table],
  })[selector] ?? [];
  vm.runInNewContext(blogAccordionScript, { document });
  document.dispatch('DOMContentLoaded');
  return { entries, table };
}

function pressNativeButton(button, key) {
  const event = button.dispatch('keydown', { key });
  if (!event.defaultPrevented && button.tagName === 'BUTTON' && (key === 'Enter' || key === ' ')) {
    button.click();
  }
}

test('blog FAQ supports Enter and Space while keeping one aria-expanded item open', () => {
  const [first, second] = createBlogAccordionHarness().entries;

  pressNativeButton(first.question, 'Enter');
  assert.equal(first.question.getAttribute('aria-expanded'), 'true');
  assert.equal(first.answer.style.display, 'block');

  pressNativeButton(second.question, ' ');
  assert.equal(first.question.getAttribute('aria-expanded'), 'false');
  assert.equal(first.answer.style.display, 'none');
  assert.equal(second.question.getAttribute('aria-expanded'), 'true');
  assert.equal(second.answer.style.display, 'block');

  pressNativeButton(second.question, ' ');
  assert.equal(second.question.getAttribute('aria-expanded'), 'false');
  assert.equal(second.answer.style.display, 'none');
});

test('blog accordion initializes article tables as keyboard scroll regions', () => {
  const { table } = createBlogAccordionHarness();

  assert.equal(table.getAttribute('tabindex'), '0');
  assert.equal(table.getAttribute('aria-label'), 'Прокручиваемая таблица');
});

function selectValues(page, id) {
  const select = page.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/select>`));
  assert.ok(select, `Missing select #${id}`);
  return [...select[1].matchAll(/<option[^>]*value="([^"]+)"/g)].map(match => match[1]);
}

test('calculator updates all 2880 HTML-declared combinations without missing data or NaN', () => {
  const page = readFileSync('html/uslugi/septiki/index.html', 'utf8');
  const start = page.indexOf('// ========== CALCULATOR ==========');
  const end = page.indexOf('// Modal', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const calculatorScript = page.slice(start, end);

  const typePrices = {
    zb2: 140000,
    zb3: 180000,
    plastic: 160000,
    drain: 60000,
  };
  const typeValues = [...page.matchAll(/<input[^>]*type="radio"[^>]*name="septic_type"[^>]*value="([^"]+)"/g)]
    .map(match => match[1]);
  const regions = selectValues(page, 'calc-region');
  const peopleValues = selectValues(page, 'calc-people');
  const range = page.match(/<input[^>]*type="range"[^>]*id="calc-distance"[^>]*min="(\d+)"[^>]*max="(\d+)"/);
  assert.ok(range, 'Missing calculator distance range bounds');
  const distances = Array.from(
    { length: Number(range[2]) - Number(range[1]) + 1 },
    (_, index) => String(Number(range[1]) + index),
  );
  assert.deepEqual([...typeValues].sort(), Object.keys(typePrices).sort());
  const controls = new Map();
  for (const id of [
    'calc-region', 'calc-people', 'people-recommendation', 'calc-distance', 'range-value',
    'label-base', 'val-base', 'val-total', 'form-type', 'form-region', 'form-people',
    'form-distance', 'form-price',
  ]) {
    controls.set(id, new FakeElement({ tagName: 'INPUT' }));
  }
  controls.get('calc-region').value = regions[0];
  controls.get('calc-people').value = peopleValues[0];
  controls.get('calc-distance').value = distances[0];
  const radios = typeValues.map((value, index) => {
    const radio = new FakeElement({ tagName: 'INPUT' });
    radio.value = value;
    radio.checked = index === 0;
    return radio;
  });
  const document = {
    getElementById(id) {
      return controls.get(id) || null;
    },
    querySelector(selector) {
      if (selector === 'input[name="septic_type"]:checked') {
        return radios.find(radio => radio.checked) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === 'input[name="septic_type"]' ? radios : [];
    },
  };

  vm.runInNewContext(calculatorScript, { document });

  let combinations = 0;
  for (const radio of radios) {
    radios.forEach(candidate => { candidate.checked = candidate === radio; });
    for (const region of regions) {
      controls.get('calc-region').value = region;
      for (const people of peopleValues) {
        controls.get('calc-people').value = people;
        for (const distance of distances) {
          controls.get('calc-distance').value = distance;
          controls.get('calc-distance').dispatch('input');
          combinations += 1;

          const visibleAndHidden = [
            'people-recommendation', 'label-base', 'val-base', 'val-total', 'range-value',
            'form-type', 'form-region', 'form-people', 'form-distance', 'form-price',
          ].map(id => `${controls.get(id).textContent || ''}${controls.get(id).value || ''}`);
          for (const value of visibleAndHidden) {
            assert.notEqual(value, '');
            assert.doesNotMatch(value, /NaN|undefined|null/);
          }
          assert.equal(controls.get('form-people').value, people);
          assert.equal(controls.get('form-distance').value, `${distance} м`);
          const numericBase = controls.get('val-base').textContent.replace(/\D/g, '');
          assert.equal(Number(numericBase), typePrices[radio.value]);
          assert.match(controls.get('form-price').value, /Предварительно от/);
        }
      }
    }
  }
  assert.equal(combinations, 2880);
});

let chromium = null;
let playwrightLoadError = null;
try {
  ({ chromium } = require('playwright'));
} catch (error) {
  playwrightLoadError = error;
}
if (!chromium && process.env.CI && process.env.CI !== 'false') {
  throw new Error(`Playwright is mandatory in CI: ${playwrightLoadError && playwrightLoadError.message}`);
}

test('consent loader reuses no-query and id-query Yandex tags with one init', { skip: !chromium }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const tagUrl of [
      'https://mc.yandex.ru/metrika/tag.js',
      'https://mc.yandex.ru/metrika/tag.js?id=109754800',
    ]) {
      const page = await browser.newPage();
      await page.route('https://kepstroy.ru/consent-fixture', route => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head>
          <script>
            localStorage.setItem('kepstroy_analytics_consent', 'true');
            window.ym = function () { (window.ym.a = window.ym.a || []).push(arguments); };
            window.ym.a = [];
          </script>
          <script src="${tagUrl}"></script>
          <script>${analyticsConsentScript}</script>
        </head><body></body></html>`,
      }));
      await page.route('https://mc.yandex.ru/**', route => route.fulfill({
        contentType: 'application/javascript',
        body: '',
      }));

      await page.goto('https://kepstroy.ru/consent-fixture');
      const state = await page.evaluate(() => ({
        initCount: window.ym.a.filter(args => args[0] === 109754800 && args[1] === 'init').length,
        scriptCount: [...document.querySelectorAll('script[src]')].filter((script) => {
          const url = new URL(script.src);
          return url.origin === 'https://mc.yandex.ru' && url.pathname === '/metrika/tag.js';
        }).length,
      }));

      assert.deepEqual(state, { initCount: 1, scriptCount: 1 }, tagUrl);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('wide article tables stay inside a 360px document viewport', { skip: !chromium }, async () => {
  const css = readFileSync('html/css/blog.css', 'utf8');
  const articlePage = readFileSync('html/blog/vodosnabzhenie-chastnogo-doma-krym/index.html', 'utf8');
  const article = articlePage.match(/<article class="blog-article">[\s\S]*?<\/article>/);
  assert.ok(article);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    await page.setContent(`<style>${css}</style>${article[0]}`);
    await page.addScriptTag({ content: blogAccordionScript });
    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      tables: [...document.querySelectorAll('table')].map(table => ({
        clientWidth: table.clientWidth,
        scrollWidth: table.scrollWidth,
      })),
    }));

    assert.ok(layout.documentWidth <= layout.viewportWidth, JSON.stringify(layout));
    assert.ok(layout.tables.some(table => table.scrollWidth > table.clientWidth), JSON.stringify(layout));
    for (const table of await page.locator('table').all()) {
      assert.equal(await table.getAttribute('tabindex'), '0');
      assert.equal(await table.getAttribute('aria-label'), 'Прокручиваемая таблица');
    }
  } finally {
    await browser.close();
  }
});

test('navigation always exposes exactly one control path at supported widths', { skip: !chromium }, async () => {
  const css = readFileSync('html/css/style.css', 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [360, 768, 900, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.setContent(`
        <style>${css}</style>
        <nav class="nav-main"><a href="#">Услуги</a></nav>
        <button type="button" class="menu-toggle">Меню</button>
      `);
      const state = await page.evaluate(() => ({
        nav: getComputedStyle(document.querySelector('.nav-main')).display,
        toggle: getComputedStyle(document.querySelector('.menu-toggle')).display,
      }));
      if (width < 1024) {
        assert.equal(state.nav, 'none', `${width}: desktop nav visible`);
        assert.notEqual(state.toggle, 'none', `${width}: menu toggle hidden`);
      } else {
        assert.equal(state.nav, 'flex', `${width}: desktop nav hidden`);
        assert.equal(state.toggle, 'none', `${width}: menu toggle visible`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
