/* Run only against a local static server. Every POST and external request is intercepted. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://127.0.0.1:8765';
const origin = new URL(base).origin;
assert.equal(new URL(base).hostname, '127.0.0.1', 'Local server only');

const screenshotDirectory = path.resolve(__dirname, '../html/screenshots/solnechnye-paneli');
fs.mkdirSync(screenshotDirectory, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  });
  const errors = [];
  const submissions = [];
  let submitStatus = 200;

  await context.addInitScript(() => {
    window.__solarScrollOptions = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function recordScroll(options) {
      window.__solarScrollOptions.push(options || null);
      return original.call(this, options);
    };
  });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) {
      if (url.pathname === '/submit') {
        submissions.push(new URLSearchParams(request.postData() || ''));
        await route.fulfill({
          status: submitStatus,
          contentType: 'application/json',
          body: submitStatus === 200 ? '{"success":true}' : '{"error":"Local test error"}',
        });
        return;
      }
      await route.continue();
      return;
    }
    if (url.hostname === 'mc.yandex.ru') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.ym=function(id,op,arg){
          if(op==='getClientID') arg('solar-test-client');
          if(op==='reachGoal') (window.__goals=window.__goals||[]).push(arg);
        };`,
      });
      return;
    }
    await route.fulfill({ status: 204, contentType: 'text/plain', body: '' });
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(`${origin}/uslugi/solnechnye-paneli/?utm_source=test&utm_medium=cpc&utm_campaign=solar&yclid=12345`);
  await page.locator('#cookieBanner button').click();

  await page.locator('.solar-skip').focus();
  await page.keyboard.press('Enter');
  const skipState = await page.evaluate(() => ({
    activeId: document.activeElement.id,
    activeClass: document.activeElement.className,
    scrollOptions: window.__solarScrollOptions,
    menuInert: document.getElementById('solar-menu').inert,
  }));
  assert.equal(skipState.activeId, 'main', `Skip link must move keyboard focus: ${JSON.stringify(skipState)}`);
  assert.equal(
    await page.evaluate(() => window.__solarScrollOptions.at(-1)?.behavior),
    'instant',
    'Reduced-motion navigation must not request smooth scrolling',
  );

  for (const width of [360, 390, 768, 900, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const state = await page.evaluate(() => {
      const visible = (selector) => [...document.querySelectorAll(selector)].some((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        navigation: visible('.nav-main, .menu-toggle'),
        cta: visible('.solar-actions .btn, .solar-mobile-cta .btn, .header__callback'),
      };
    });
    if (state.overflow) errors.push(`horizontal overflow at ${width}px`);
    if (!state.navigation) errors.push(`no visible navigation at ${width}px`);
    if (!state.cta) errors.push(`no visible CTA at ${width}px`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.menu-toggle').click();
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#solar-menu').evaluate((element) => element.inert), false);
  await page.locator('#solar-menu a').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.menu-toggle').evaluate((element) => element === document.activeElement), true, 'Menu focus must wrap');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#solar-menu a').last().evaluate((element) => element === document.activeElement), true, 'Reverse menu focus must wrap');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.menu-toggle').evaluate((element) => element === document.activeElement), true, 'Escape must restore menu-toggle focus');

  await page.locator('#questions summary').first().click();
  assert.equal(await page.locator('#questions details').first().evaluate((element) => element.open), true, 'FAQ must open');

  await page.locator('#panel-quantity').fill('10');
  await page.locator('#solar-calculate').click();
  assert.equal(await page.locator('#solar-result-power').textContent(), '6,5 кВт');
  assert.equal(await page.locator('#solar-result-price').textContent(), 'Стоимость панелей: 200 000 ₽');

  const form = page.locator('#solar-request-form');
  await form.locator('button[type="submit"]').click();
  assert.equal(submissions.length, 0, 'Required phone and consent must block submit');
  await form.locator('#solar-phone').fill('+7 (978) 123-45-67');
  await form.locator('button[type="submit"]').click();
  assert.equal(submissions.length, 0, 'Consent must be required');
  await form.locator('[name="consent"]').check();
  await form.locator('#solar-name').fill('Локальный тест');
  await form.locator('#solar-comment').fill('Дом в Алуште, нужна гибридная система');
  await page.locator('#system-type').selectOption('hybrid');
  await page.locator('#placement').selectOption('roof');
  await page.locator('#solar-locality').fill('Алушта');

  submitStatus = 500;
  page.once('dialog', (dialog) => dialog.accept());
  await form.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#solar-request-form button[type="submit"]').disabled);
  assert.equal(await form.locator('#solar-comment').inputValue(), 'Дом в Алуште, нужна гибридная система', 'Error must preserve form data');
  assert.equal(submissions.length, 1);
  const failedGoals = await page.evaluate(() => window.__goals || []);
  assert.equal(failedGoals.includes('form_submit'), false, 'Failed submit must not emit form_submit');
  assert.equal(failedGoals.includes('solar_submit_error'), true, 'Failed submit must emit solar_submit_error');

  submitStatus = 200;
  await form.locator('button[type="submit"]').dblclick();
  await page.waitForURL('**/spasibo/');
  assert.equal(submissions.length, 2, 'Double click must create exactly one successful POST');
  const payload = submissions[1];
  for (const [key, value] of Object.entries({
    service: 'Солнечные панели и электростанции',
    form_source: 'kepstroy',
    phone: '+7 (978) 123-45-67',
    name: 'Локальный тест',
    consent: 'on',
    utm_source: 'test',
    utm_medium: 'cpc',
    utm_campaign: 'solar',
    yclid: '12345',
    client_id: 'solar-test-client',
  })) assert.equal(payload.get(key), value, key);
  assert.match(payload.get('message') || '', /0,65 × 10 = 6,5 кВт/);
  assert.match(payload.get('message') || '', /Стоимость панелей: 200 000 ₽/);
  assert.match(payload.get('message') || '', /Тип системы: Гибридная/);
  assert.match(payload.get('message') || '', /Населённый пункт: Алушта/);
  assert.match(payload.get('landing_page') || '', /\/uslugi\/solnechnye-paneli\//);
  assert.match(payload.get('current_page') || '', /\/uslugi\/solnechnye-paneli\//);
  assert.equal(payload.get('website'), '');
  assert.equal(payload.get('company'), '');

  await page.goto(`${origin}/uslugi/solnechnye-paneli/`);
  await page.evaluate(() => document.fonts.ready);
  for (const image of await page.locator('.solar-page img').all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => element.decode());
    assert.equal(await image.evaluate((element) => element.naturalWidth > 0), true, 'Image must decode');
  }
  assert.equal(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    true,
    'Reduced motion must be active in the test context',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(screenshotDirectory, 'mobile-hero.png') });
  await page.screenshot({ path: path.join(screenshotDirectory, 'mobile-full.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(screenshotDirectory, 'desktop-hero.png') });
  await page.screenshot({ path: path.join(screenshotDirectory, 'desktop-full.png'), fullPage: true });

  for (const route of ['/', '/krym/', '/krym/simferopol/', '/uslugi/generatory/', '/uslugi/elektrosnabzhenie/']) {
    await page.goto(origin + route);
    assert.ok(await page.locator('a[href="/uslugi/solnechnye-paneli/"]').count(), `Missing solar entry point on ${route}`);
  }

  await browser.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ submitted: submissions.length, screenshotDirectory }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
