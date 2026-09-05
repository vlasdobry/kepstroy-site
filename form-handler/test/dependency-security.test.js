const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const express = require('express');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

test('patched parser dependencies are pinned across config, lockfile, and installed tree', () => {
  assert.deepEqual(packageJson.overrides, {
    'body-parser': '1.20.6',
    qs: '6.16.0'
  });
  assert.equal(packageLock.packages['node_modules/body-parser'].version, '1.20.6');
  assert.equal(packageLock.packages['node_modules/qs'].version, '6.16.0');
  assert.equal(require('body-parser/package.json').version, '1.20.6');
  assert.equal(require('qs/package.json').version, '6.16.0');
});

test('overridden urlencoded parser preserves expected inputs and rejects oversized bodies', async (t) => {
  const app = express();
  app.use(express.urlencoded({ extended: true, limit: '20kb' }));
  app.post('/parse', (request, response) => response.json(request.body));
  app.use((error, request, response, next) => {
    void request;
    void next;
    response.status(error.status || 500).json({ error: error.type || 'parser_error' });
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  async function send(body) {
    return fetch(`http://127.0.0.1:${port}/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
  }

  const normal = await send('name=Ivan&nested[value]=yes&item=one&item=two');
  assert.equal(normal.status, 200);
  assert.deepEqual(await normal.json(), {
    name: 'Ivan',
    nested: { value: 'yes' },
    item: ['one', 'two']
  });

  const empty = await send('');
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {});

  const malformed = await send('name=%E0%A4%A');
  assert.notEqual(malformed.status, 500);

  const oversized = await send(`message=${'x'.repeat(21 * 1024)}`);
  assert.equal(oversized.status, 413);
});
