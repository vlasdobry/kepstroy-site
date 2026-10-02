const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const { createMaxClient, maxAgent } = require('../max-client');
const { buildLeadMessage } = require('../lead-message');
const reply = (data = { message: { body: { mid: 'mid.test' } } }, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(data) });

test('MAX uses official endpoint, header token, plain lossless lead and call button', async () => {
  const calls = [];
  const client = createMaxClient({ token: 'test-secret', chatId: '-9223372036854775808', fetchImpl: async (...args) => { calls.push(args); return reply(); } });
  await client.sendLead(buildLeadMessage({ name: '<Иван> & "сын" &lt;', phone: '+7 (978) 123-45-67', city: 'Ялта', yclid: 'yclid-1', message: 'Нужен резерв' }), '79781234567');
  const [url, options] = calls[0];
  assert.equal(url, 'https://platform-api2.max.ru/messages?chat_id=-9223372036854775808&disable_link_preview=true');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'test-secret');
  assert.equal(options.redirect, 'error');
  assert.equal(options.agent, maxAgent);
  assert.ok(options.signal);
  const body = JSON.parse(options.body);
  assert.ok(body.text.includes('<Иван> & "сын" &lt;'));
  assert.ok(body.text.includes('YCLID: yclid-1'));
  assert.equal(body.format, undefined);
  assert.deepEqual(body.attachments[0].payload.buttons, [[{ type: 'link', text: '📞 Позвонить', url: 'https://kepstroy.ru/call/?phone=79781234567' }]]);
});

test('errors/invalid acknowledgements never count as delivery and do not expose remote details', async () => {
  for (const response of [reply({ message: 'test-secret customer' }, 401), reply({}), reply({ message: { body: {} } })]) {
    const client = createMaxClient({ token: 'test-secret', chatId: '-1', fetchImpl: async () => response });
    await assert.rejects(client.sendLead('lead', ''), (error) => !error.message.includes('test-secret') && /max_/.test(error.message));
  }
  const client = createMaxClient({ token: 'test-secret', chatId: '-1', fetchImpl: async () => { throw new Error('https://host/test-secret'); } });
  await assert.rejects(client.sendLead('lead', ''), /max_request_failed/);
});

test('long Unicode leads are split losslessly, all chunks confirmed, requests paced across leads', async () => {
  const sent = [], delays = [];
  const client = createMaxClient({ token: 'test', chatId: '-1', delay: async (ms) => delays.push(ms), fetchImpl: async (url, options) => { sent.push(JSON.parse(options.body)); return reply(); } });
  const text = '🌞'.repeat(4100) + '\nКонец';
  await client.sendLead(text, '79781234567');
  await client.sendLead('Вторая', '');
  assert.equal(sent.length, 3);
  assert.equal(sent.slice(0, 2).map((body) => body.text).join(''), text);
  assert.ok(sent.every((body) => Array.from(body.text).length <= 4000));
  assert.equal(sent.filter((body) => body.attachments).length, 1);
  assert.equal(delays.length, 2);
  assert.ok(delays.every((ms) => ms >= 500));
});

test('a failed later chunk rejects whole lead, no blind retry and queue recovers', async () => {
  let count = 0;
  const client = createMaxClient({ token: 'test', chatId: '-1', delay: async () => {}, fetchImpl: async () => ++count === 2 ? reply({}, 500) : reply() });
  await assert.rejects(client.sendLead('x'.repeat(4001), ''), /max_/);
  assert.equal(count, 2);
  await client.sendLead('next', '');
  assert.equal(count, 3);
});

test('TLS verifies peers and adds pinned CA only to MAX agent', () => {
  const pem = fs.readFileSync(path.join(__dirname, '../certs/russian-trusted-root-ca.crt'), 'utf8');
  const cert = new X509Certificate(pem);
  assert.equal(cert.ca, true);
  assert.equal(cert.fingerprint256, 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31');
  assert.equal(cert.verify(cert.publicKey), true);
  assert.equal(maxAgent.options.rejectUnauthorized, true);
  assert.deepEqual(maxAgent.options.ca.slice(0, -1), tls.rootCertificates);
  assert.equal(maxAgent.options.ca.at(-1), pem);
});

test('queue admission is bounded and expired waiting leads are never sent later', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sent = [];
  const client = createMaxClient({ token: 'test', chatId: '-1', queueLimit: 1, queueTimeoutMs: 20, delay: async () => {}, fetchImpl: async (url, options) => {
    sent.push(JSON.parse(options.body).text);
    if (sent.length === 1) await gate;
    return reply();
  } });
  try {
    const first = client.sendLead('first', '');
    await new Promise((resolve) => setImmediate(resolve));
    const expired = client.sendLead('expired', '');
    await assert.rejects(client.sendLead('overflow', ''), /max_queue_full/);
    await assert.rejects(expired, /max_queue_expired/);
    release();
    await first;
    await client.sendLead('next', '');
    assert.deepEqual(sent, ['first', 'next']);
  } finally { release(); clearTimeout(keepAlive); }
});

test('active lead has a total budget, not an unbounded per-chunk timeout', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  const client = createMaxClient({ token: 'test', chatId: '-1', deliveryTimeoutMs: 20, fetchImpl: async () => new Promise(() => {}) });
  try { await assert.rejects(client.sendLead('lead', ''), /max_request_failed/); }
  finally { clearTimeout(keepAlive); }
});
