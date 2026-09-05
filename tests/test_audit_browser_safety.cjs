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
  resolveSiteFile,
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

test('resolveSiteFile confines the images fallback to the dedicated images root', (t) => {
  assert.equal(typeof resolveSiteFile, 'function');
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kepstroy-audit-site-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const htmlRoot = path.join(parent, 'html');
  const imagesRoot = path.join(parent, 'images');
  const outside = path.join(parent, 'repo-secret.txt');
  fs.mkdirSync(htmlRoot);
  fs.mkdirSync(path.join(htmlRoot, 'images'));
  fs.mkdirSync(imagesRoot);
  fs.writeFileSync(path.join(htmlRoot, 'index.html'), 'home');
  fs.writeFileSync(path.join(htmlRoot, 'images', 'logo.png'), 'site image');
  fs.writeFileSync(path.join(imagesRoot, 'photo.webp'), 'image');
  fs.writeFileSync(outside, 'outside');

  assert.equal(resolveSiteFile(htmlRoot, imagesRoot, 'index.html'), fs.realpathSync(path.join(htmlRoot, 'index.html')));
  assert.equal(resolveSiteFile(htmlRoot, imagesRoot, path.join('images', 'logo.png')), fs.realpathSync(path.join(htmlRoot, 'images', 'logo.png')));
  assert.equal(resolveSiteFile(htmlRoot, imagesRoot, path.join('images', 'photo.webp')), fs.realpathSync(path.join(imagesRoot, 'photo.webp')));
  assert.equal(resolveSiteFile(htmlRoot, imagesRoot, path.join('images', '..', 'repo-secret.txt')), null);

  const imageCandidate = path.join(imagesRoot, 'photo.webp');
  const redirectedFs = {
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    realpathSync(value) {
      return path.resolve(value) === path.resolve(imageCandidate)
        ? fs.realpathSync(outside)
        : fs.realpathSync(value);
    },
  };
  assert.equal(resolveSiteFile(htmlRoot, imagesRoot, path.join('images', 'photo.webp'), redirectedFs), null);

  try {
    fs.symlinkSync(parent, path.join(imagesRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.diagnostic(`real directory link unavailable: ${error.code || error.message}`);
    return;
  }
  assert.equal(resolveSiteFile(htmlRoot, imagesRoot, path.join('images', 'escape', 'repo-secret.txt')), null);
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

  async function invokeHttp(url, method) {
    const actions = [];
    await context.httpHandler({
      request() {
        return { url: () => url, method: () => method };
      },
      async fulfill(options) { actions.push(['fulfill', options]); },
      async continue() { actions.push(['continue']); },
    });
    return actions;
  }

  assert.deepEqual(await invokeHttp('https://external.example/asset.js', 'GET'), [
    ['fulfill', { status: 204, contentType: 'text/plain', body: '' }],
  ]);
  assert.equal(counters.externalRequestsIntercepted, 1);
  assert.deepEqual(await invokeHttp('http://127.0.0.1:4321/app.js', 'GET'), [['continue']]);
  assert.deepEqual(await invokeHttp('http://127.0.0.1:4321/submit', 'POST'), [
    ['fulfill', { status: 405, contentType: 'application/json', body: '{}' }],
  ]);
  assert.equal(counters.blockedPosts, 1);
  assert.match(errors.at(-1), /unexpected POST \/submit/);

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
