const test = require('node:test');
const assert = require('node:assert/strict');
const { deliverLead, deliveryConfig } = require('../lead-delivery');

test('starts both channels, succeeds without waiting for a hung channel', async () => {
  const calls = [];
  const result = await deliverLead({
    telegram: () => { calls.push('telegram'); return new Promise(() => {}); },
    max: () => { calls.push('max'); return Promise.resolve(); }
  }, () => {});
  assert.equal(result, 'max');
  assert.deepEqual(calls, ['telegram', 'max']);
});

test('falls back in either direction and handles synchronous throws', async () => {
  for (const failed of ['telegram', 'max']) {
    const good = failed === 'max' ? 'telegram' : 'max';
    const events = [];
    assert.equal(await deliverLead({
      [failed]: () => { throw new Error('secret and customer data'); },
      [good]: async () => {}
    }, (event) => events.push(event)), good);
    assert.ok(events.some((event) => event.channel === failed && event.status === 'failed'));
    assert.ok(!JSON.stringify(events).includes('secret'));
  }
});

test('rejects when every channel fails or none is configured', async () => {
  await assert.rejects(deliverLead({ max: async () => { throw new Error('secret'); } }, () => {}), /delivery_failed/);
  await assert.rejects(deliverLead({}, () => {}), /delivery_failed/);
});

test('configuration supports Telegram-only, MAX-only and both; preserves int64 chat IDs', () => {
  assert.deepEqual(deliveryConfig({}), { telegram: false, max: false });
  assert.deepEqual(deliveryConfig({ BOT_TOKEN: 'tg', CHAT_ID: '-123' }), { telegram: true, max: false });
  assert.deepEqual(deliveryConfig({ MAX_BOT_TOKEN: 'max', MAX_CHAT_ID: '-9223372036854775808' }), { telegram: false, max: true });
  assert.deepEqual(deliveryConfig({ BOT_TOKEN: 'tg', CHAT_ID: '-123', MAX_BOT_TOKEN: 'max', MAX_CHAT_ID: '-321' }), { telegram: true, max: true });
  for (const env of [{ BOT_TOKEN: 'tg' }, { CHAT_ID: '-1' }, { MAX_BOT_TOKEN: 'max' }, { MAX_CHAT_ID: '1' }, { MAX_BOT_TOKEN: 'max', MAX_CHAT_ID: 'NaN' }, { MAX_BOT_TOKEN: 'max', MAX_CHAT_ID: '9223372036854775808' }]) {
    assert.throws(() => deliveryConfig(env), /configuration/);
  }
});
