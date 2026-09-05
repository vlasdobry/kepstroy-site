'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  containedExistingFile,
  createAuditedContext,
  offlineContextOptions,
} = require('../scripts/audit-browser-safety.cjs');

test('containedExistingFile rejects traversal and resolved paths outside the root', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kepstroy-audit-path-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'root');
  const outside = path.join(parent, 'outside.txt');
  const candidate = path.join(root, 'inside.txt');
  fs.mkdirSync(root);
  fs.writeFileSync(candidate, 'inside');
  fs.writeFileSync(outside, 'outside');

  assert.equal(containedExistingFile(root, 'inside.txt'), fs.realpathSync(candidate));
  assert.equal(containedExistingFile(root, '..' + path.sep + 'outside.txt'), null);

  const redirectedFs = {
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    realpathSync(value) {
      return path.resolve(value) === path.resolve(candidate)
        ? fs.realpathSync(outside)
        : fs.realpathSync(value);
    },
  };
  assert.equal(containedExistingFile(root, 'inside.txt', redirectedFs), null);
});

test('containedExistingFile rejects a real symlink or junction that escapes when supported', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kepstroy-audit-link-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'root');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  try {
    fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`directory links unavailable: ${error.code || error.message}`);
    return;
  }
  assert.equal(containedExistingFile(root, path.join('escape', 'secret.txt')), null);
});

test('offline context blocks service workers and sends non-loopback egress to a dead proxy', () => {
  assert.deepEqual(offlineContextOptions({ width: 360, height: 900 }), {
    viewport: { width: 360, height: 900 },
    serviceWorkers: 'block',
    proxy: {
      server: 'http://127.0.0.1:9',
      bypass: '127.0.0.1',
    },
  });
});

test('createAuditedContext installs HTTP, WebSocket, and popup guards before pages', async () => {
  const calls = [];
  const pageHandlers = new Map();
  const context = {
    async route(pattern, handler) { calls.push(['route', pattern]); this.httpHandler = handler; },
    async routeWebSocket(pattern, handler) { calls.push(['websocket', pattern]); this.wsHandler = handler; },
    on(event, handler) { calls.push(['on', event]); this.pageHandler = handler; },
    async newPage() {
      calls.push(['newPage']);
      const page = {
        on(event, handler) { pageHandlers.set(event, handler); },
        url() { return 'about:blank'; },
      };
      this.pageHandler(page);
      return page;
    },
  };
  const browser = {
    async newContext(options) { calls.push(['newContext', options]); return context; },
  };
  const counters = { externalRequestsIntercepted: 0, blockedPosts: 0, blockedWebSockets: 0 };
  const errors = [];
  const audited = await createAuditedContext(
    browser,
    'http://127.0.0.1:4321',
    counters,
    errors,
    { width: 360, height: 900 },
  );

  assert.equal(calls[0][0], 'newContext');
  assert.deepEqual(calls.slice(1, 4), [
    ['route', '**/*'],
    ['websocket', '**/*'],
    ['on', 'page'],
  ]);
  const page = await audited.newPage('fixture@360');
  assert.equal(calls.at(-1)[0], 'newPage');
  assert.deepEqual(
    [...pageHandlers.keys()].sort(),
    ['console', 'pageerror', 'requestfailed', 'response'],
  );

  let closed;
  await context.wsHandler({
    url() { return 'wss://outside.example/socket'; },
    async close(options) { closed = options; },
  });
  assert.equal(counters.blockedWebSockets, 1);
  assert.equal(closed.code, 1008);
  assert.match(errors.at(-1), /blocked WebSocket/);
  assert.ok(page);
});
