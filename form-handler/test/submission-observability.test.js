const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('../index');
const { EventEmitter } = require('node:events');
const { observeSubmission, reportSubmissionChannel } = require('../submission-observability');

test('disconnect leaves outcome unknown while late delivery keeps its own receipt', () => {
  const res = new EventEmitter(); res.locals = {}; res.setHeader = () => {}; res.statusCode = 200;
  const logs = []; const original = console.log; console.log = line => logs.push(JSON.parse(line));
  try {
    observeSubmission({ method: 'POST', path: '/submit', body: {} }, res, () => {});
    res.emit('close');
    reportSubmissionChannel(res, { channel: 'max', status: 'confirmed' });
    assert.equal(logs[0].outcome, 'unknown');
    assert.equal(logs[0].reason, 'request_aborted');
    assert.equal(logs[1].status, 'confirmed');
    assert.equal(logs[0].request_id, logs[1].request_id);
  } finally { console.log = original; }
});

test('refusals expose unique safe IDs and log outcomes without submitted values', async t => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args);
  t.after(() => { console.log = original; });
  const ids = [];
  for (const [fields, reason] of [
    [{ phone: '12345' }, 'invalid_phone'],
    [{ website: 'private.example' }, 'bot_check'],
    [{ form_source: 'untrusted' }, 'invalid_form'],
  ]) {
    const r = await fetch(base + '/submit', { method: 'POST', headers: {
      origin: 'https://kepstroy.ru', 'content-type': 'application/x-www-form-urlencoded',
      'X-Request-ID': 'untrusted-client-value',
    }, body: new URLSearchParams({ form_source: 'kepstroy', name: 'Private Name',
      phone: '12345', service: 'Солнечные панели и электростанции', ...fields }) });
    assert.equal(r.status, 400);
    assert.equal(r.headers.get('X-Form-Error'), reason);
    assert.match(r.headers.get('X-Request-ID'), /^[0-9a-f-]{36}$/);
    ids.push(r.headers.get('X-Request-ID'));
  }
  assert.equal(new Set(ids).size, 3);
  const outcomes = logs.map(args => args.length === 1 && typeof args[0] === 'string' ? (() => {
    try { return JSON.parse(args[0]); } catch { return null; }
  })() : null).filter(x => x?.event === 'form_submission');
  assert.equal(outcomes.length, 3);
  assert.deepEqual(outcomes.map(x => x.request_id), ids);
  assert.ok(outcomes.every(x => x.form === 'solar' && x.http_status === 400 && x.outcome === 'rejected'));
  assert.doesNotMatch(JSON.stringify(logs), /Private Name|12345|private\.example|untrusted-client-value/);
});

test('array-valued phone is rejected as a payload error before delivery', async t => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/submit`, { method: 'POST',
    headers: { origin: 'https://kepstroy.ru', 'content-type': 'application/json' },
    body: JSON.stringify({ form_source: 'kepstroy', phone: ['12345'] }) });
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('X-Form-Error'), 'invalid_payload');
});

test('malformed payload is observed without leaking parser exception or body', async t => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/submit`, { method: 'POST',
    headers: { origin: 'https://kepstroy.ru', 'content-type': 'application/json' }, body: '{ "secret phone":' });
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('X-Form-Error'), 'invalid_payload');
  assert.doesNotMatch(await r.text(), /secret phone|SyntaxError/);
});
