const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Mock only the external transport; exercise Express, validation and actual clients.
const fetchPath = require.resolve('node-fetch');
require(fetchPath);
let transport;
require.cache[fetchPath].exports = (...args) => transport(...args);
const baseEnv = { BOT_TOKEN: 'tg-test-secret', CHAT_ID: '-123', MAX_BOT_TOKEN: 'max-test-secret', MAX_CHAT_ID: '-456' };

async function fixture(t, mode, env = baseEnv) {
  for (const key of Object.keys(baseEnv)) {
    if (env[key]) process.env[key] = env[key]; else delete process.env[key];
  }
  const calls = [];
  transport = async (url, options) => {
    const channel = url.includes('max.ru') ? 'max' : 'telegram';
    calls.push({ channel, url, options });
    if (mode[channel] === 'hang') return new Promise(() => {});
    if (mode[channel] === 'fail') throw new Error('customer phone and tg-test-secret max-test-secret');
    const data = channel === 'max' ? { message: { body: { mid: 'mid.1' } } } : { ok: mode[channel] !== 'api-fail', result: { message_id: 123 } };
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  delete require.cache[require.resolve('../index')];
  const { app } = require('../index');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const submit = (overrides = {}, origin = 'https://kepstroy.ru') => fetch(`http://127.0.0.1:${server.address().port}/submit`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}) },
    body: new URLSearchParams({ form_source: 'kepstroy', name: 'Тестовый клиент', phone: '79781234567', service: 'Солнечные панели', city: 'Ялта', yclid: 'click-id', ...overrides })
  });
  return { calls, submit };
}

test('MAX delivers when Telegram fails', async (t) => {
  const { submit, calls } = await fixture(t, { telegram: 'fail', max: 'ok' });
  const response = await submit();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://kepstroy.ru/spasibo/');
  assert.deepEqual(calls.map((call) => call.channel).sort(), ['max', 'telegram']);
});

test('Telegram delivers when MAX fails; either success is enough', async (t) => {
  const { submit, calls } = await fixture(t, { telegram: 'ok', max: 'fail' });
  assert.equal((await submit()).status, 302);
  assert.equal(calls.length, 2);
});

test('hung Telegram does not hold a confirmed MAX submission', { timeout: 1500 }, async (t) => {
  const { submit } = await fixture(t, { telegram: 'hang', max: 'ok' });
  assert.equal((await submit()).status, 302);
});

test('all channels failed =>500; failed submission is not rate-limited as delivered', async (t) => {
  const { submit } = await fixture(t, { telegram: 'api-fail', max: 'fail' });
  assert.equal((await submit()).status, 500);
  assert.equal((await submit()).status, 500);
});

test('both channels receive full lead; confirmed submission gets cooldown', async (t) => {
  const { submit, calls } = await fixture(t, { telegram: 'ok', max: 'ok' });
  assert.equal((await submit()).status, 302);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.ok(JSON.parse(call.options.body).text.includes('YCLID: click-id'));
    assert.ok(call.options.signal);
  }
  assert.equal((await submit()).status, 429);
  assert.equal(calls.length, 2);
});

test('MAX-only does not call Telegram', async (t) => {
  const { submit, calls } = await fixture(t, { max: 'ok' }, { MAX_BOT_TOKEN: 'max-test-secret', MAX_CHAT_ID: '-456' });
  assert.equal((await submit()).status, 302);
  assert.deepEqual(calls.map((call) => call.channel), ['max']);
});

test('Telegram-only stays functional without MAX configuration', async (t) => {
  const { submit, calls } = await fixture(t, { telegram: 'ok' }, { BOT_TOKEN: 'tg-test-secret', CHAT_ID: '-123' });
  assert.equal((await submit()).status, 302);
  assert.deepEqual(calls.map((call) => call.channel), ['telegram']);
});

test('hung MAX does not hold a confirmed Telegram submission', { timeout: 1500 }, async (t) => {
  const { submit } = await fixture(t, { telegram: 'ok', max: 'hang' });
  assert.equal((await submit()).status, 302);
});

test('delivery logs contain neither tokens nor lead personal data', async (t) => {
  const lines = [];
  const log = console.log, error = console.error;
  console.log = console.error = (...args) => lines.push(JSON.stringify(args));
  t.after(() => { console.log = log; console.error = error; });
  const { submit } = await fixture(t, { telegram: 'fail', max: 'fail' });
  assert.equal((await submit()).status, 500);
  assert.ok(lines.join('').includes('failed'));
  for (const sensitive of ['tg-test-secret', 'max-test-secret', '79781234567', 'Тестовый клиент', 'customer phone']) {
    assert.ok(!lines.join('').includes(sensitive), sensitive);
  }
});

test('concurrent duplicate is blocked before first delivery completes; failure releases reservation', async (t) => {
  const { submit } = await fixture(t, { max: 'ok' }, { MAX_BOT_TOKEN: 'max-test-secret', MAX_CHAT_ID: '-456' });
  let release, entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  transport = async () => {
    entered();
    await gate;
    return { ok: false, status: 500, text: async () => '{}' };
  };
  const first = submit();
  await started;
  const second = submit();
  // Allow both HTTP requests to reach Express while transport is still waiting.
  await new Promise((resolve) => setTimeout(resolve, 30));
  release();
  assert.equal((await second).status, 429);
  assert.equal((await first).status, 500);
  assert.equal((await submit()).status, 500);
});

test('CI and anti-spam never send notifications', async (t) => {
  const { submit, calls } = await fixture(t, { telegram: 'ok', max: 'ok' });
  assert.equal((await submit({ name: 'CI Test' })).status, 302);
  assert.equal((await submit({}, '')).status, 403);
  assert.equal((await submit({ company: 'robot' })).status, 400);
  assert.equal((await submit({ locality: 'https://spam.example' })).status, 400);
  assert.equal(calls.length, 0);
});
