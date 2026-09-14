/* Run only against a local static server. Every POST and external request is intercepted. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { buildLeadMessage } = require('../form-handler/lead-message');

const base = process.argv[2] || 'http://127.0.0.1:8765';
const origin = new URL(base).origin;
assert.equal(new URL(base).hostname, '127.0.0.1', 'Local server only');

const citySolarPages = [
  ['simferopol', 'Симферополь', 'Симферополе'],
  ['sevastopol', 'Севастополь', 'Севастополе'],
  ['jalta', 'Ялта', 'Ялте'],
  ['evpatorija', 'Евпатория', 'Евпатории'],
  ['kerch', 'Керчь', 'Керчи'],
  ['feodosija', 'Феодосия', 'Феодосии'],
  ['alushta', 'Алушта', 'Алуште'],
  ['sudak', 'Судак', 'Судаке'],
  ['dzhankoj', 'Джанкой', 'Джанкое'],
  ['saki', 'Саки', 'Саках'],
  ['bahchisaraj', 'Бахчисарай', 'Бахчисарае'],
  ['armjansk', 'Армянск', 'Армянске'],
];
const cityWidths = [360, 390, 768, 900, 1024, 1280, 1440];

const screenshotDirectory = path.resolve(__dirname, '../html/screenshots/solnechnye-paneli');
fs.mkdirSync(screenshotDirectory, { recursive: true });

let browser;

(async () => {
  browser = await chromium.launch({ headless: true });
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
  assert.equal(payload.get('locality'), 'Алушта');
  assert.doesNotMatch(payload.get('message') || '', /Населённый пункт:/);
  assert.match(buildLeadMessage(Object.fromEntries(payload)), /Населённый пункт: Алушта/);
  assert.match(payload.get('landing_page') || '', /\/uslugi\/solnechnye-paneli\//);
  assert.match(payload.get('current_page') || '', /\/uslugi\/solnechnye-paneli\//);
  assert.equal(payload.get('city'), null, 'Main solar page must not invent a city');
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

  const cityHeadings = new Set();
  for (const [slug, city, cityPrepositional] of citySolarPages) {
    const route = `/krym/${slug}/solnechnye-paneli/`;
    for (const width of cityWidths) {
      await page.setViewportSize({ width, height: 900 });
      const response = await page.goto(origin + route, { waitUntil: 'load' });
      assert.equal(response?.status(), 200, `${route}@${width}: HTTP 200`);
      const state = await page.evaluate(({ route, city, cityPrepositional }) => {
        const visible = (element) => {
          if (!element) return false;
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden';
        };
        const form = document.getElementById('solar-request-form');
        const cityHub = `/krym/${route.split('/')[2]}/`;
        return {
          canonical: document.querySelector('link[rel="canonical"]')?.href || '',
          h1: document.querySelector('h1')?.textContent.trim() || '',
          offer: document.querySelector('.solar-lead')?.textContent.replace(/\s+/g, ' ').trim() || '',
          localVisible: visible(document.querySelector('[data-solar-city-content]')),
          localParagraphs: document.querySelectorAll('[data-solar-city-content] .solar-local__copy > p').length,
          localPoints: document.querySelectorAll('[data-solar-city-content] .solar-local__copy li').length,
          mainSolarLink: Boolean(document.querySelector('a[href="/uslugi/solnechnye-paneli/"]')),
          cityHubLink: Boolean(document.querySelector(`a[href="${cityHub}"]`)),
          neighborLinks: document.querySelectorAll('[data-solar-neighbors] a[href$="/solnechnye-paneli/"]').length,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          ctaVisible: [...document.querySelectorAll('.solar-actions .btn, .solar-mobile-cta .btn, .solar-product__copy .btn')].some(visible),
          formVisible: visible(form),
          phoneEditable: Boolean(form?.querySelector('[name="phone"]')?.matches(':enabled:not([readonly])')),
          submitUsable: Boolean(form?.querySelector('button[type="submit"]')?.matches(':enabled')),
          cityField: form?.querySelector('[name="city"]')?.value || '',
          expectedH1: `Солнечные панели и электростанции в ${cityPrepositional}`,
          city,
        };
      }, { route, city, cityPrepositional });
      assert.equal(state.canonical, `https://kepstroy.ru${route}`, `${route}@${width}: self canonical`);
      assert.equal(state.h1, state.expectedH1, `${route}@${width}: H1`);
      assert.match(state.offer, /LONGi Hi-MO X10 Scientist 650 Вт/, `${route}@${width}: product in primary offer`);
      assert.match(state.offer, /20 000 ₽/, `${route}@${width}: price in primary offer`);
      assert.match(state.offer, new RegExp(cityPrepositional), `${route}@${width}: city in primary offer`);
      assert.equal(state.localVisible, true, `${route}@${width}: local block visible`);
      assert.ok(state.localParagraphs >= 2, `${route}@${width}: local paragraphs`);
      assert.ok(state.localPoints >= 3, `${route}@${width}: local planning points`);
      assert.equal(state.mainSolarLink, true, `${route}@${width}: main solar link`);
      assert.equal(state.cityHubLink, true, `${route}@${width}: city hub link`);
      assert.ok(state.neighborLinks >= 1 && state.neighborLinks <= 4, `${route}@${width}: neighbor links`);
      assert.equal(state.overflow, false, `${route}@${width}: horizontal overflow`);
      assert.equal(state.ctaVisible, true, `${route}@${width}: visible CTA`);
      assert.equal(state.formVisible, true, `${route}@${width}: visible form`);
      assert.equal(state.phoneEditable, true, `${route}@${width}: editable phone`);
      assert.equal(state.submitUsable, true, `${route}@${width}: enabled submit`);
      assert.equal(state.cityField, city, `${route}@${width}: qualified city`);

      await page.locator('#panel-quantity').fill('3');
      await page.locator('#solar-calculate').click();
      assert.equal(await page.locator('#solar-result-power').textContent(), '1,95 кВт', `${route}@${width}: calculator power`);
      assert.equal(await page.locator('#solar-result-price').textContent(), 'Стоимость панелей: 60 000 ₽', `${route}@${width}: calculator price`);
    }
    cityHeadings.add(await page.locator('h1').textContent());

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#questions summary').first().click();
    assert.equal(await page.locator('#questions details').first().evaluate((element) => element.open), true, `${route}: FAQ opens`);
    for (const image of await page.locator('.solar-page img').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((element) => element.decode());
      assert.equal(await image.evaluate((element) => element.naturalWidth > 0), true, `${route}: image decodes`);
    }
    if (slug === 'jalta') {
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(screenshotDirectory, 'jalta-mobile-hero.png') });
      await page.screenshot({ path: path.join(screenshotDirectory, 'jalta-mobile-full.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: path.join(screenshotDirectory, 'jalta-desktop-hero.png') });
      await page.screenshot({ path: path.join(screenshotDirectory, 'jalta-desktop-full.png'), fullPage: true });
    }
  }
  assert.equal(cityHeadings.size, citySolarPages.length, 'City H1 values must be unique');

  submissions.length = 0;
  await page.goto(`${origin}/krym/jalta/solnechnye-paneli/?utm_source=city-test&utm_medium=cpc&utm_campaign=solar-jalta&yclid=jalta-123`);
  const cityForm = page.locator('#solar-request-form');
  assert.equal(await cityForm.locator('#solar-locality').isEditable(), true);
  await cityForm.locator('#solar-locality').fill('Гурзуф');
  await cityForm.locator('#solar-phone').fill('+7 (978) 123-45-67');
  await cityForm.locator('[name="consent"]').check();
  await cityForm.locator('[name="city"]').evaluate((input) => { input.value = 'Москва'; });
  await cityForm.locator('button[type="submit"]').dblclick();
  await page.waitForURL('**/spasibo/');
  assert.equal(submissions.length, 1, 'City solar double click must create exactly one POST');
  const cityPayload = submissions[0];
  for (const [key, value] of Object.entries({
    service: 'Солнечные панели и электростанции',
    form_source: 'kepstroy',
    city: 'Ялта',
    utm_source: 'city-test',
    utm_medium: 'cpc',
    utm_campaign: 'solar-jalta',
    yclid: 'jalta-123',
    client_id: 'solar-test-client',
  })) assert.equal(cityPayload.get(key), value, `city payload ${key}`);
  assert.equal(cityPayload.get('locality'), 'Гурзуф');
  assert.doesNotMatch(cityPayload.get('message') || '', /Город страницы:/);
  assert.doesNotMatch(cityPayload.get('message') || '', /Населённый пункт: Ялта/);
  assert.doesNotMatch(cityPayload.get('message') || '', /Гурзуф/);
  assert.match(cityPayload.get('message') || '', /0,65 × 10 = 6,5 кВт/);
  assert.match(cityPayload.get('message') || '', /Стоимость панелей: 200 000 ₽/);
  assert.match(cityPayload.get('landing_page') || '', /\/krym\/jalta\/solnechnye-paneli\//);
  assert.match(cityPayload.get('current_page') || '', /\/krym\/jalta\/solnechnye-paneli\//);
  const renderedLead = buildLeadMessage(Object.fromEntries(cityPayload));
  assert.equal((renderedLead.match(/Ялта/g) || []).length, 1);
  assert.equal((renderedLead.match(/Гурзуф/g) || []).length, 1);
  assert.match(renderedLead, /Город страницы: Ялта/);
  assert.match(renderedLead, /Населённый пункт: Гурзуф/);

  await browser.close();
  browser = null;
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ submitted: submissions.length, screenshotDirectory }, null, 2));
})().catch(async (error) => {
  if (browser) await browser.close().catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
