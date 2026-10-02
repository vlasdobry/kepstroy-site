const test = require('node:test');
const assert = require('node:assert/strict');
const { runSetup, checkMax } = require('../max-setup');
const { checkDelivery } = require('../check-delivery');
const env = { MAX_BOT_TOKEN: 'test-secret', MAX_CHAT_ID: '-123' };
const response = (data) => ({ ok: true, text: async () => JSON.stringify(data) });

test('discover reads bot_added group IDs only, no message or subscription mutation', async () => {
  const calls = [], lines = [];
  await runSetup('discover', { MAX_BOT_TOKEN: 'test-secret' }, { print: (line) => lines.push(line), fetchImpl: async (url, options) => {
    calls.push([url, options]);
    return { ok: true, text: async () => '{"updates":[{"update_type":"bot_added","chat_id":-9223372036854775808,"is_channel":false,"user":{"first_name":"private"}},{"update_type":"bot_started","chat_id":12}],"marker":123}' };
  } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].includes('/updates?'));
  assert.equal(calls[0][1].method, 'GET');
  assert.ok(lines.join('').includes('-9223372036854775808'));
  assert.ok(!lines.join('').includes('private'));
  assert.ok(!lines.join('').includes('test-secret'));
});

test('check is read-only and confirms bot identity and membership', async () => {
  const calls = [];
  await runSetup('check', env, { print: () => {}, fetchImpl: async (url, options) => {
    calls.push([url, options]);
    return response({ is_bot: true, user_id: 123, is_admin: true });
  } });
  assert.deepEqual(calls.map(([url]) => new URL(url).pathname), ['/me', '/chats/-123/members/me']);
  assert.ok(calls.every(([, options]) => options.method === 'GET'));
  await assert.rejects(checkMax(env, async () => response({ is_bot: false })), /max_check_failed/);
});

test('only explicit send-test sends synthetic text without phone or attribution', async () => {
  const calls = [];
  await runSetup('send-test', env, { print: () => {}, fetchImpl: async (url, options) => {
    calls.push([url, options]);
    return response({ message: { body: { mid: 'mid.test' } } });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].method, 'POST');
  const body = JSON.parse(calls[0][1].body);
  assert.ok(body.text.includes('ТЕСТ'));
  assert.equal(body.attachments, undefined);
  assert.ok(!body.text.includes('7999'));
  await assert.rejects(runSetup('invalid', env), /invalid_setup_mode/);
  await assert.rejects(runSetup('check', { MAX_BOT_TOKEN: 'test-secret' }), /configuration/);
});

test('deploy connectivity tolerates Telegram outage if MAX bot and membership are verified', async () => {
  const calls = [];
  const allEnv = { ...env, BOT_TOKEN: 'tg-secret', CHAT_ID: '-456' };
  assert.equal(await checkDelivery(allEnv, async (url, options) => {
    calls.push(options);
    if (url.includes('telegram')) throw new Error('tg-secret');
    return response({ is_bot: true, user_id: 123, is_admin: true });
  }, () => {}), 'max');
  assert.ok(calls.every((options) => options.method === 'GET'));
  await assert.rejects(checkDelivery(allEnv, async () => { throw new Error('secret'); }, () => {}), /delivery_failed/);
});
