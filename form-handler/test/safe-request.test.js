const test = require('node:test');
const assert = require('node:assert/strict');
const { requestJson } = require('../safe-request');

test('deadline aborts a hung connection and a hung response body without exposing secrets', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    for (const hungBody of [false, true]) {
      let signal;
      const fetchImpl = async (url, options) => {
        signal = options.signal;
        if (!hungBody) return new Promise(() => {});
        return { ok: true, text: () => new Promise(() => {}) };
      };
      await assert.rejects(requestJson('https://test/secret', {}, { channel: 'test', timeoutMs: 20, fetchImpl }), /test_request_failed/);
      assert.equal(signal.aborted, true);
    }
  } finally { clearTimeout(keepAlive); }
});

test('discovery preserves int64 IDs from raw JSON and rejects invalid JSON', async () => {
  const data = await requestJson('https://test', {}, { channel: 'max', preserveIds: true, fetchImpl: async () => ({ ok: true, text: async () => '{"updates":[{"chat_id":-9223372036854775808}],"marker":9223372036854775807}' }) });
  assert.equal(data.updates[0].chat_id, '-9223372036854775808');
  assert.equal(data.marker, '9223372036854775807');
  await assert.rejects(requestJson('https://test', {}, { channel: 'max', fetchImpl: async () => ({ ok: true, text: async () => 'secret garbage' }) }), /max_request_failed/);
});

test('HTTP failure aborts the unconsumed response instead of leaving a socket open', async () => {
  let signal;
  await assert.rejects(requestJson('https://test/secret', {}, { channel: 'max', fetchImpl: async (url, options) => {
    signal = options.signal;
    return { ok: false, status: 401, text: () => new Promise(() => {}) };
  } }), /max_request_failed/);
  assert.equal(signal.aborted, true);
});
