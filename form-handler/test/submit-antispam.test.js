const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fetchPath = require.resolve('node-fetch');
require(fetchPath);
let transport;
require.cache[fetchPath].exports = (...args) => transport(...args);

async function fixture(t, statePath) {
  delete process.env.BOT_TOKEN;
  delete process.env.CHAT_ID;
  process.env.MAX_BOT_TOKEN = 'local-test-secret';
  process.env.MAX_CHAT_ID = '-123';
  if (statePath) process.env.LEAD_STATE_PATH = statePath;
  else delete process.env.LEAD_STATE_PATH;
  const calls = [];
  transport = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ message: { body: { mid: 'mid.test' } } }) };
  };
  delete require.cache[require.resolve('../index')];
  const { app } = require('../index');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const submit = (overrides = {}, ip = '203.0.113.1') => fetch(`http://127.0.0.1:${server.address().port}/submit`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://kepstroy.ru', 'x-forwarded-for': ip },
    body: new URLSearchParams({ form_source: 'kepstroy', name: 'Заказчик', phone: '79781234567', service: 'septiki', message: '', ...overrides })
  });
  return { submit, calls };
}

for (const message of [
  'Я профессионально занимаюсь созданием сайтов. К Вам есть предложение — разработать сайт любой сложности для Вашей организации.',
  'Случайно посетил Ваш web сайт. Я много лет занимаюсь оптимизацией сайтов в поисковых системах. Смогу продвинуть Ваш сайт в топовые позиции.',
  'Хотели бы предложить Внесли Вашу организацию в реестр продукции в реестр Минпромторга. Доступ к тендерам и субсидиям.',
  'Я занимаюсь созда\u200bнием\u00a0сайтов. Предлагаю разработать сайт.',
]) {
  test(`rejects unsolicited service offer: ${message.slice(0, 45)}`, async t => {
    const { submit, calls } = await fixture(t);
    const r = await submit({ message });
    assert.equal(r.status, 400);
    assert.equal(r.headers.get('X-Form-Error'), 'rejected_content');
    assert.equal(calls.length, 0);
  });
}

for (const message of [
  'На вашем сайте нашёл предложение по монтажу септика. Хочу узнать стоимость.',
  'У меня интернет-магазин, нужен септик на складе.',
  'Нужен септик, документы и выписка из реестра. Мой email: client@example.org',
  'Интересуют солнечные панели 650 ват, 52 Вольта, монокристаллические, двухсторонние.',
]) {
  test(`accepts ordinary customer text: ${message.slice(0, 45)}`, async t => {
    const { submit, calls } = await fixture(t);
    assert.equal((await submit({ message })).status, 302);
    assert.equal(calls.length, 1);
  });
}

function clock(t) {
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  t.after(() => { Date.now = real; });
  return ms => { now += ms; };
}

test('same lead with new IP, Client ID and tracking is a duplicate after phone cooldown', async t => {
  const advance = clock(t);
  const { submit, calls } = await fixture(t);
  assert.equal((await submit({ client_id: 'first-browser' })).status, 302);
  advance(31 * 60 * 1000);
  const r = await submit({ name: 'Другой вариант имени', phone: '8 (978) 123-45-67', client_id: 'new-browser', utm_source: 'other', page: 'https://kepstroy.ru/other/' }, '203.0.113.2');
  assert.equal(r.status, 409);
  assert.equal(r.headers.get('X-Form-Error'), 'duplicate_submission');
  assert.equal(calls.length, 1);
});

test('immediate confirmed duplicate gets the explanatory response rather than generic throttling', async t => {
  const { submit, calls } = await fixture(t);
  assert.equal((await submit()).status, 302);
  const r = await submit();
  assert.equal(r.status, 409);
  assert.equal(r.headers.get('X-Form-Error'), 'duplicate_submission');
  assert.equal(calls.length, 1);
});

test('duplicate protection persists across application recreation without storing personal data', async t => {
  const advance = clock(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kepstroy-dedupe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'state.json');
  const first = await fixture(t, statePath);
  assert.equal((await first.submit()).status, 302);
  advance(66 * 60 * 60 * 1000);
  const second = await fixture(t, statePath);
  assert.equal((await second.submit({}, '203.0.113.9')).status, 409);
  assert.equal(second.calls.length, 0);
  const state = fs.readFileSync(statePath, 'utf8');
  assert.ok(!state.includes('79781234567'));
  assert.ok(!state.includes('Заказчик'));
});

test('new information remains deliverable after normal phone cooldown; exact repeat expires at 72 hours', async t => {
  const advance = clock(t);
  const { submit, calls } = await fixture(t);
  assert.equal((await submit()).status, 302);
  advance(31 * 60 * 1000);
  assert.equal((await submit({ message: 'Уточнение: участок в Ялте' })).status, 302);
  advance(72 * 60 * 60 * 1000);
  assert.equal((await submit()).status, 302);
  assert.equal(calls.length, 3);
});

test('failed delivery does not consume duplicate protection', async t => {
  const { submit, calls } = await fixture(t);
  transport = async () => { throw new Error('local failure'); };
  assert.equal((await submit()).status, 500);
  transport = async () => {
    calls.push('delivered');
    return { ok: true, status: 200, text: async () => JSON.stringify({ message: { body: { mid: 'mid.test' } } }) };
  };
  assert.equal((await submit()).status, 302);
  assert.equal(calls.length, 1);
});
