const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function runCheck(maxAvailable) {
  // Model the observed proxy TCP handle that survives an aborted HTTP request.
  // Only the external transport is replaced; the real CLI and checks execute.
  const script = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function (name, ...args) {
      if (name === 'node-fetch') return async (url) => {
        if (url.includes('telegram')) {
          setInterval(() => {}, 60000);
          throw new Error('proxy unavailable');
        }
        if (!${maxAvailable}) throw new Error('max unavailable');
        return { ok: true, text: async () => JSON.stringify({ is_bot: true, user_id: 123, is_admin: true }) };
      };
      return originalLoad.call(this, name, ...args);
    };
    process.argv = [process.execPath, ${JSON.stringify(path.resolve(__dirname, '../check-delivery.js'))}];
    Module.runMain(process.argv[1]);
  `;
  return spawnSync(process.execPath, ['-e', script], {
    timeout: 2000, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, BOT_TOKEN: 'test-token', CHAT_ID: '-123', TELEGRAM_PROXY_URL: '', MAX_BOT_TOKEN: 'max-test-token', MAX_CHAT_ID: '-456' }
  });
}

test('read-only CLI exits successfully once MAX is verified despite a lingering proxy handle', () => {
  const result = runCheck(true);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /channel: 'max', status: 'confirmed'/);
});

test('read-only CLI exits with failure when every channel fails despite lingering handles', () => {
  const result = runCheck(false);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No configured delivery channel/);
});
