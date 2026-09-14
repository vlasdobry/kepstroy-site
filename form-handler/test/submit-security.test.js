const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { app } = require('../index');

async function serveApp(t) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function submit(base, fields, origin = 'https://kepstroy.ru') {
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (origin) headers.origin = origin;
  return fetch(`${base}/submit`, {
    method: 'POST',
    redirect: 'manual',
    headers,
    body: new URLSearchParams({
      form_source: 'kepstroy',
      name: 'CI Test',
      phone: '+7 (999) 999-99-99',
      service: 'Солнечные панели и электростанции',
      message: 'CI test',
      ...fields,
    }),
  });
}

test('form handler can be exercised without starting production polling', async (t) => {
  const base = await serveApp(t);

  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('rejects links and SEO spam in structured city and locality fields', async (t) => {
  const base = await serveApp(t);
  const payloads = [
    { city: 'https://spam.example/path', locality: 'Ялта' },
    { city: 'Ялта', locality: 'google search index' },
  ];

  for (const payload of payloads) {
    const response = await submit(base, payload);
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.equal(await response.text(), 'Spam detected');
  }
});

test('accepts normal Unicode city and locality values', async (t) => {
  const base = await serveApp(t);
  const response = await submit(base, {
    city: 'Севастополь',
    locality: 'посёлок Новый Свет',
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://kepstroy.ru/spasibo/');
});

test('keeps origin and honeypot protections ahead of delivery', async (t) => {
  const base = await serveApp(t);
  assert.equal((await submit(base, {}, '')).status, 403);
  assert.equal((await submit(base, { website: 'robot' })).status, 400);
});
