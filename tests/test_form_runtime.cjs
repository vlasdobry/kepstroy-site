const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const mainScript = readFileSync('html/js/main.js', 'utf8');

function createHarness({
  appendTracking = async () => {},
  fetchResult = async () => ({ ok: true }),
  formId = 'calc-form',
  honeypotValue = '',
  trackGoalThrows = false,
} = {}) {
  const listeners = new Map();
  const alerts = [];
  const goals = [];
  let fetchCalls = 0;

  const button = {
    disabled: false,
    innerHTML: 'Отправить <span>расчёт</span>',
    textContent: 'Отправить расчёт',
  };
  const honeypotInputs = [
    { name: 'website', value: honeypotValue },
    { name: 'company', value: '' },
  ];
  const honeypot = { inputs: honeypotInputs };
  const form = {
    id: formId,
    dataset: {},
    fields: [
      ['name', 'Тест'],
      ['phone', '+79780000000'],
    ],
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    querySelector(selector) {
      if (selector === '.form-honeypot') return honeypot;
      if (selector === 'button[type="submit"]') return button;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.form-honeypot input') return honeypotInputs;
      return [];
    },
    async submit() {
      const event = { preventDefault() {} };
      await Promise.all((listeners.get('submit') || []).map(listener => listener(event)));
    },
  };

  class FakeFormData {
    constructor(target) {
      this.entries = target.fields;
    }

    [Symbol.iterator]() {
      return this.entries[Symbol.iterator]();
    }
  }

  const window = {
    KepstroyTracking: {
      appendTo: appendTracking,
      trackGoal(goal) {
        goals.push(goal);
        if (trackGoalThrows) throw new Error('analytics unavailable');
      },
    },
    addEventListener() {},
    innerHeight: 800,
    innerWidth: 1280,
    location: { href: 'https://kepstroy.ru/uslugi/septiki/' },
    scrollY: 0,
  };
  const document = {
    body: { style: {} },
    referrer: '',
    addEventListener() {},
    getElementById(id) {
      return id === 'contact-form' && form.id === id ? form : null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'form[action="/submit"]') return [form];
      return [];
    },
  };

  vm.runInNewContext(mainScript, {
    FormData: FakeFormData,
    URLSearchParams,
    alert(message) {
      alerts.push(message);
    },
    console,
    document,
    async fetch(url, options) {
      fetchCalls += 1;
      assert.equal(url, '/submit');
      assert.equal(options.method, 'POST');
      return fetchResult();
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    window,
  });

  return {
    alerts,
    button,
    form,
    get fetchCalls() {
      return fetchCalls;
    },
    goals,
    window,
  };
}

function assertFormRestored(harness) {
  assert.equal(harness.form.dataset.submitting, undefined);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.innerHTML, 'Отправить <span>расчёт</span>');
}

test('double submit while attribution is pending sends one POST', async () => {
  let releaseTracking;
  const trackingPending = new Promise(resolve => {
    releaseTracking = resolve;
  });
  const harness = createHarness({ appendTracking: () => trackingPending });

  const firstSubmit = harness.form.submit();
  const secondSubmit = harness.form.submit();
  releaseTracking();
  await Promise.all([firstSubmit, secondSubmit]);

  assert.equal(harness.fetchCalls, 1);
});

test('rejected attribution sends no POST and restores the form', async () => {
  const harness = createHarness({
    appendTracking: async () => {
      throw new Error('tracking unavailable');
    },
  });

  await harness.form.submit();

  assert.equal(harness.fetchCalls, 0);
  assertFormRestored(harness);
  assert.equal(harness.alerts.length, 1);
});

for (const [name, fetchResult] of [
  ['non-ok response', async () => ({ ok: false })],
  ['rejected request', async () => { throw new Error('network unavailable'); }],
]) {
  test(`${name} restores the form`, async () => {
    const harness = createHarness({ fetchResult });

    await harness.form.submit();

    assert.equal(harness.fetchCalls, 1);
    assertFormRestored(harness);
    assert.equal(harness.alerts.length, 1);
  });
}

test('filled nested honeypot sends no POST', async () => {
  const harness = createHarness({ honeypotValue: 'https://spam.example' });

  await harness.form.submit();

  assert.equal(harness.fetchCalls, 0);
  assert.equal(harness.form.dataset.submitting, undefined);
});

test('filled nested honeypot on contact form sends no POST', async () => {
  const harness = createHarness({
    formId: 'contact-form',
    honeypotValue: 'https://spam.example',
  });

  await harness.form.submit();

  assert.equal(harness.fetchCalls, 0);
});

test('successful delivery records one goal and redirects', async () => {
  const harness = createHarness();

  await harness.form.submit();

  assert.equal(harness.fetchCalls, 1);
  assert.deepEqual(harness.goals, ['form_submit']);
  assert.equal(harness.window.location.href, '/spasibo/');
  assert.equal(harness.alerts.length, 0);
});

test('analytics failure after delivery still redirects without enabling retry', async () => {
  const harness = createHarness({ trackGoalThrows: true });

  await harness.form.submit();

  assert.equal(harness.fetchCalls, 1);
  assert.deepEqual(harness.goals, ['form_submit']);
  assert.equal(harness.window.location.href, '/spasibo/');
  assert.equal(harness.alerts.length, 0);
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.form.dataset.submitting, 'true');
});
