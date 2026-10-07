/* Local only: all outside requests and form submissions are intercepted. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { cities } = require('../generators/city-septik-data.json');

async function main() {
  const root = path.resolve('html');
  let networkSubmissions = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET') { networkSubmissions++; res.writeHead(405).end(); return; }
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + urlPath, urlPath.endsWith('/') ? 'index.html' : '');
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let cases = 0;
  const intercepted = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const urlPath of ['/uslugi/solnechnye-paneli/', ...cities.map(c => `/krym/${c.slug}/solnechnye-paneli/`)]) {
      for (const width of [390, 1280]) {
        const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: width === 390 ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
        const errors = [];
        try {
          await context.route('**/*', route => {
            const request = route.request();
            if (new URL(request.url()).pathname === '/submit') {
              intercepted.push(new URLSearchParams(request.postData()).get('message'));
              return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA intercepted"}' });
            }
            if (request.url().startsWith(origin + '/')) return route.continue();
            return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
          });
          await context.addInitScript(() => {
            window.__qaGoals = [];
            window.ym = (...args) => window.__qaGoals.push(args);
          });
          const page = await context.newPage();
          page.setDefaultTimeout(5000);
          const clickLink = async (selector) => {
            await page.locator(selector).click();
            if (width === 1280) {
              // Let the real smooth-scroll handler settle before the next action.
              await page.waitForFunction(() => {
                const now = performance.now();
                if (!window.__qaScroll || window.__qaScroll.y !== scrollY) {
                  window.__qaScroll = { y: scrollY, at: now };
                  return false;
                }
                return now - window.__qaScroll.at > 180;
              });
            }
          };
          page.on('pageerror', e => errors.push(e.message));
          const response = await page.goto(origin + urlPath, { waitUntil: 'networkidle' });
          assert.equal(response.status(), 200);
          await page.locator('#cookieBanner button').click();
          const scenario = page.locator('#order-scenario');
          const message = page.locator('#solar-message');
          const submit = page.locator('#solar-request-form button[type="submit"]');
          await clickLink('.solar-actions [data-solar-intent="panels"]');
          assert.equal(await scenario.inputValue(), 'panels', 'hero panels choice must reach the qualification');
          assert.equal(await page.locator('#primary-task').inputValue(), 'panels');
          assert.match(await page.locator('#request h2').innerText(), /наличие.*LONGi.*650/);
          assert.equal(await submit.innerText(), 'Уточнить наличие');
          await page.locator('#panel-quantity').fill('3');
          await page.locator('#object-type').selectOption('business');
          await page.locator('#solar-comment').fill('Три панели для моего объекта');
          await clickLink('#panel a[href="#request"]');
          assert.match(await message.inputValue(), /Что требуется: Только панели[\s\S]*Количество: 3 панели/);
          assert.match(await message.inputValue(), /Комментарий: Три панели для моего объекта/);
          await clickLink('.solar-actions [data-solar-intent="turnkey"]');
          assert.equal(await scenario.inputValue(), 'turnkey');
          assert.equal(await page.locator('#primary-task').inputValue(), 'consult');
          assert.equal(await page.locator('#object-type').inputValue(), 'business');
          assert.equal(await page.locator('#solar-comment').inputValue(), 'Три панели для моего объекта');
          assert.equal(await page.locator('#panel-quantity').inputValue(), '3');
          assert.match(await page.locator('#request h2').innerText(), /подбор системы/);
          assert.equal(await submit.innerText(), 'Обсудить систему');
          assert.doesNotMatch(await message.inputValue(), /Стоимость панелей|Количество: 3/);
          await clickLink('#orders [data-solar-intent="panels"]');
          assert.equal(await scenario.inputValue(), 'panels');
          await clickLink('#orders [data-solar-intent="installation"]');
          assert.equal(await scenario.inputValue(), 'installation');
          assert.match(await message.inputValue(), /Что требуется: Панели с монтажом/);
          assert.equal(await submit.innerText(), 'Обсудить монтаж');
          await scenario.selectOption('panels');
          assert.equal(await submit.innerText(), 'Уточнить наличие');
          await page.locator('#solar-calculate').click();
          await clickLink('.solar-calculator__request');
          await page.locator('#solar-phone').fill('+7 (978) 000-00-00');
          await page.locator('input[name="consent"]').check();
          const before = intercepted.length;
          await submit.click();
          await page.waitForFunction(() => !document.querySelector('#solar-request-form button[type="submit"]').disabled);
          assert.equal(intercepted.length, before + 1);
          assert.match(intercepted.at(-1), /Что требуется: Только панели/);
          assert.match(intercepted.at(-1), /Количество: 3 панели/);
          for (const goal of ['solar_calculator_start', 'solar_calculator_result', 'solar_form_start']) {
            assert.equal(await page.evaluate(g => window.__qaGoals.filter(a => a[1] === 'reachGoal' && a[2] === g).length, goal), 1, goal + ' once');
          }
          await page.locator('#panel-quantity').fill('101');
          await clickLink('.solar-actions [data-solar-intent="turnkey"]');
          await clickLink('#panel a[href="#request"]');
          assert.equal(await scenario.inputValue(), 'panels');
          const invalidBefore = intercepted.length;
          await submit.click();
          await page.waitForTimeout(1200);
          assert.equal(intercepted.length, invalidBefore, 'invalid panel quantity must not send stale qualification');
          assert.equal(await page.evaluate(() => document.activeElement.id), 'panel-quantity');
          await page.locator('#panel-quantity').fill('');
          assert.match(await message.inputValue(), /Что требуется: Только панели[\s\S]*Количество панелей: уточнить/);
          await page.goto(origin + urlPath + '#panel', { waitUntil: 'networkidle' });
          await page.reload({ waitUntil: 'networkidle' });
          assert.equal(await scenario.inputValue(), 'panels', 'direct product URL must select panels');
          await page.goto(origin + urlPath + '#calculator', { waitUntil: 'networkidle' });
          await page.reload({ waitUntil: 'networkidle' });
          assert.equal(await scenario.inputValue(), 'turnkey', 'direct system URL must select turnkey');
          assert.deepEqual(errors, []);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          cases++;
          console.log(`PASS ${urlPath} ${width}px`);
        } finally { await context.close(); }
      }
    }
    assert.equal(networkSubmissions, 0);
    console.log(JSON.stringify({ cases, interceptedPosts: intercepted.length, networkSubmissions }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
