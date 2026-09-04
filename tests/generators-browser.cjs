/* Run against a LOCAL static server. POST /submit is intercepted: no real lead is sent.
   NODE_PATH=<bundled node_modules> node tests/generators-browser.cjs http://127.0.0.1:8765 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const base = process.argv[2] || 'http://127.0.0.1:8765';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Local server only');
const output = path.resolve(__dirname, '../html/screenshots/generators');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const errors = [];
  const requests = [];
  let status = 200;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) {
      if (url.pathname === '/submit') {
        requests.push(new URLSearchParams(route.request().postData()));
        return route.fulfill({ status, contentType: 'application/json', body: status === 200 ? '{"success":true}' : '{"error":"Test error"}' });
      }
      return route.continue();
    }
    if (url.hostname === 'mc.yandex.ru') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.ym=function(id,op,arg){if(op==="getClientID")arg("test-client");if(op==="reachGoal"){window.__goals=window.__goals||[];window.__goals.push(arg)}};' });
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/uslugi/generatory/?utm_source=test&utm_medium=cpc&utm_campaign=generators&yclid=12345');
  await page.locator('#cookieBanner button').click();
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.power-skip').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main', 'Skip link must move keyboard focus');
  for (const width of [360, 390, 768, 900, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const state = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      navigation: [...document.querySelectorAll('.nav-main, .menu-toggle')].some(x => getComputedStyle(x).display !== 'none'),
    }));
    if (state.overflow) errors.push(`Horizontal overflow at ${width}`);
    if (!state.navigation) errors.push(`No visible navigation at ${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.menu-toggle').click();
  await page.waitForFunction(() => document.querySelector('.menu-toggle').getAttribute('aria-expanded') === 'true');
  assert.equal(await page.locator('#power-menu').evaluate(x => x.inert), false);
  await page.locator('#power-menu a').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.menu-toggle').evaluate(x => x === document.activeElement), true, 'Menu focus must wrap');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#power-menu a').last().evaluate(x => x === document.activeElement), true, 'Reverse menu focus must wrap');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.menu-toggle').getAttribute('aria-expanded') === 'false');
  await page.locator('.menu-toggle').click();
  await page.locator('#power-menu a[href="#equipment"]').click();
  await page.waitForFunction(() => !document.querySelector('#power-menu').classList.contains('active'));
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  await page.locator('#questions summary').first().click();
  assert.equal(await page.locator('#questions details').first().getAttribute('open'), '');
  await page.locator('.power-mobile-cta a[href="#request"]').click();
  const form = page.locator('#generator-form');
  await form.locator('button').click();
  assert.equal(requests.length, 0, 'Required phone/consent must prevent submit');
  await page.locator('#power-phone').fill('+7 (978) 123-45-67');
  await page.locator('#power-message').fill('Тест: дом, насос и холодильник');
  await form.locator('button').click();
  assert.equal(requests.length, 0, 'Consent must be required');
  await form.locator('[name="consent"]').check();
  status = 500;
  page.once('dialog', dialog => dialog.accept());
  await form.locator('button').click();
  await page.waitForFunction(() => !document.querySelector('#generator-form button').disabled);
  await page.waitForFunction(() => document.querySelector('#generator-form button').textContent.includes('Подобрать'));
  assert.equal(await page.locator('#power-message').inputValue(), 'Тест: дом, насос и холодильник');
  assert.equal(requests.length, 1);
  assert.equal(await page.evaluate(() => (window.__goals || []).includes('form_submit')), false);
  status = 200;
  await form.locator('button').click();
  await page.waitForURL('**/spasibo/');
  assert.equal(requests.length, 2);
  const payload = requests[1];
  for (const [key, value] of Object.entries({ service: 'Генераторы с установкой', form_source: 'kepstroy', utm_source: 'test', utm_medium: 'cpc', utm_campaign: 'generators', yclid: '12345', client_id: 'test-client', name: '', consent: 'on' })) assert.equal(payload.get(key), value, key);
  assert.ok(payload.get('landing_page').includes('/uslugi/generatory/'));
  assert.ok(payload.get('current_page').includes('/uslugi/generatory/'));
  assert.equal(payload.get('website'), '');
  assert.equal(payload.get('company'), '');
  await page.goto(base + '/uslugi/generatory/');
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('kepstroy_attribution')).utm_source), 'test');
  for (const img of await page.locator('.power-page img').all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate(x => x.decode());
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  await page.screenshot({ path: path.join(output, 'mobile-hero.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.screenshot({ path: path.join(output, 'desktop-hero.png') });
  // Check the newly added entry points, without touching unrelated city layouts.
  for (const route of ['/', '/krym/', '/krym/simferopol/', '/uslugi/gazosnabzhenie/', '/uslugi/elektrosnabzhenie/']) {
    await page.goto(base + route);
    assert.ok(await page.locator('a[href="/uslugi/generatory/"]').count(), route);
  }
  console.log(JSON.stringify({ errors, submitted: requests.length, screenshotDirectory: output }, null, 2));
  await browser.close();
  assert.deepEqual(errors, []);
})().catch(error => { console.error(error); process.exit(1); });
