const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const mainScript = readFileSync('html/js/main.js', 'utf8');
const initialUrl = 'https://kepstroy.ru/uslugi/septiki/';

function createHarness({
  appendTracking = async () => {},
  fetchResult = async () => ({ ok: true }),
  formId = 'calc-form',
  honeypotValue = '',
  trackGoalThrows = false,
  errorGoal,
} = {}) {
  const listeners = new Map();
  const alerts = [];
  const goals = [];
  const goalDetails = [];
  let fetchCalls = 0;

  let buttonHtml = 'Отправить <span>расчёт</span>';
  let buttonText = 'Отправить расчёт';
  const button = {
    disabled: false,
    get innerHTML() {
      return buttonHtml;
    },
    set innerHTML(value) {
      buttonHtml = String(value);
      buttonText = buttonHtml.replace(/<[^>]*>/g, '');
    },
    get textContent() {
      return buttonText;
    },
    set textContent(value) {
      buttonText = String(value);
      buttonHtml = buttonText
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    },
  };
  const honeypotInputs = [
    { name: 'website', value: honeypotValue },
    { name: 'company', value: '' },
  ];
  const honeypot = { inputs: honeypotInputs };
  const form = {
    id: formId,
    dataset: { ...(errorGoal ? { errorGoal } : {}) },
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
      trackGoal(goal, params) {
        goals.push(goal);
        goalDetails.push({ goal, params });
        if (trackGoalThrows) throw new Error('analytics unavailable');
      },
    },
    addEventListener() {},
    innerHeight: 800,
    innerWidth: 1280,
    location: { href: initialUrl },
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
    goalDetails,
    window,
  };
}

function assertFormRestored(harness) {
  assert.equal(harness.form.dataset.submitting, undefined);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.innerHTML, 'Отправить <span>расчёт</span>');
}

function assertNoSuccessSideEffects(harness) {
  assert.ok(!harness.goals.includes('form_submit'));
  assert.equal(harness.window.location.href, initialUrl);
}

test('double submit while attribution is pending sends one POST', async () => {
  let releaseTracking;
  const trackingPending = new Promise(resolve => {
    releaseTracking = resolve;
  });
  const harness = createHarness({ appendTracking: () => trackingPending });

  const firstSubmit = harness.form.submit();
  const secondSubmit = harness.form.submit();
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.innerHTML, 'Отправка...');
  assert.equal(harness.button.textContent, 'Отправка...');
  releaseTracking();
  await Promise.all([firstSubmit, secondSubmit]);

  assert.equal(harness.fetchCalls, 1);
});

test('solar HTTP refusal reports a safe reason and server correlation ID', async () => {
  const requestId = 'e88a1445-0d18-4322-a474-df2081c3eab6';
  const h = createHarness({ errorGoal: 'solar_submit_error', fetchResult: async () => ({
    ok: false, status: 400,
    headers: { get: name => ({ 'X-Request-ID': requestId, 'X-Form-Error': 'invalid_phone' })[name] },
  }) });
  await h.form.submit();
  assert.deepEqual(h.goals, ['solar_submit_error']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.goalDetails[0].params)), {
    reason: 'invalid_phone', http_status: 400, request_id: requestId,
  });
  assertFormRestored(h);
});

test('network and preparation errors are distinct and do not report contact values', async () => {
  for (const [reason, options] of [
    ['network', { fetchResult: async () => { throw Error('secret phone +79781234567'); } }],
    ['prepare_request', { appendTracking: async () => { throw Error('secret input'); } }],
  ]) {
    const h = createHarness(options);
    await h.form.submit();
    assert.deepEqual(h.goals, ['form_submit_error']);
    assert.deepEqual(JSON.parse(JSON.stringify(h.goalDetails[0].params)), { reason, http_status: 0 });
    assertFormRestored(h);
  }
});

test('untrusted response diagnostics cannot enter analytics', async () => {
  const h = createHarness({ fetchResult: async () => ({ ok: false, status: 503,
    headers: { get: () => 'secret +79781234567 https://example.org/' },
  }) });
  await h.form.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(h.goalDetails[0].params)), { reason: 'http_error', http_status: 503 });
});

test('rejected attribution sends no POST and restores the form', async () => {
  let rejectTracking;
  const trackingPending = new Promise((resolve, reject) => {
    rejectTracking = reject;
  });
  const harness = createHarness({
    appendTracking: () => trackingPending,
  });

  const submit = harness.form.submit();
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.innerHTML, 'Отправка...');
  assert.equal(harness.button.textContent, 'Отправка...');
  rejectTracking(new Error('tracking unavailable'));
  await submit;

  assert.equal(harness.fetchCalls, 0);
  assertFormRestored(harness);
  assert.equal(harness.button.textContent, 'Отправить расчёт');
  assertNoSuccessSideEffects(harness);
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
    assert.equal(harness.button.textContent, 'Отправить расчёт');
    assertNoSuccessSideEffects(harness);
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

test('double submit on contact form while attribution is pending sends one POST', async () => {
  let releaseTracking;
  const trackingPending = new Promise(resolve => {
    releaseTracking = resolve;
  });
  const harness = createHarness({
    appendTracking: () => trackingPending,
    formId: 'contact-form',
  });

  const firstSubmit = harness.form.submit();
  const secondSubmit = harness.form.submit();
  assert.equal(harness.form.dataset.submitting, 'true');
  assert.equal(harness.button.disabled, true);
  releaseTracking();
  await Promise.all([firstSubmit, secondSubmit]);

  assert.equal(harness.fetchCalls, 1);
});

test('contact form restores retry after attribution failure', async () => {
  let appendAttempts = 0;
  const harness = createHarness({
    appendTracking: async () => {
      appendAttempts += 1;
      if (appendAttempts === 1) throw new Error('tracking unavailable');
    },
    formId: 'contact-form',
  });

  await harness.form.submit();
  assert.equal(harness.fetchCalls, 0);
  assertFormRestored(harness);
  assert.equal(harness.alerts.length, 1);

  await harness.form.submit();
  assert.equal(harness.fetchCalls, 1);
  assert.equal(appendAttempts, 2);
});

test('contact form success message makes no unsupported callback-time promise', async () => {
  const harness = createHarness({ formId: 'contact-form' });

  await harness.form.submit();

  assert.equal(harness.fetchCalls, 1);
  assert.match(harness.form.innerHTML, /Мы свяжемся с вами/);
  assert.doesNotMatch(harness.form.innerHTML, /15 минут/);
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
