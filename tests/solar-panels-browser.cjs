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

async function exerciseKeyboardNavigation(page, label) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.solar-skip').focus();
  await page.keyboard.press('Enter');
  const skipState = await page.evaluate(() => ({
    activeId: document.activeElement.id,
    scrollOptions: window.__solarScrollOptions,
  }));
  assert.equal(skipState.activeId, 'main', `${label}: skip link must move keyboard focus`);
  assert.equal(
    skipState.scrollOptions.at(-1)?.behavior,
    'instant',
    `${label}: reduced-motion navigation must not request smooth scrolling`,
  );

  await page.locator('.menu-toggle').click();
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true', `${label}: menu opens`);
  assert.equal(await page.locator('#solar-menu').evaluate((element) => element.inert), false, `${label}: open menu is interactive`);
  await page.locator('#solar-menu a').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.locator('.menu-toggle').evaluate((element) => element === document.activeElement),
    true,
    `${label}: menu focus must wrap`,
  );
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await page.locator('#solar-menu a').last().evaluate((element) => element === document.activeElement),
    true,
    `${label}: reverse menu focus must wrap`,
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false', `${label}: Escape closes menu`);
  assert.equal(
    await page.locator('.menu-toggle').evaluate((element) => element === document.activeElement),
    true,
    `${label}: Escape must restore menu-toggle focus`,
  );
}

let browser;

(async () => {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
  });
  context.setDefaultTimeout(7_500);
  context.setDefaultNavigationTimeout(15_000);
  const errors = [];
  const submissions = [];
  let activePageLabel = 'startup';
  let externalHttpRequests = 0;
  let webSocketAttempts = 0;
  let submitStatus = 200;

  await context.addInitScript(() => {
    window.__solarScrollOptions = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function recordScroll(options) {
      window.__solarScrollOptions.push(options || null);
      return original.call(this, options);
    };
    window.__solarIsLayoutVisible = (element) => {
      if (!(element instanceof Element) || !element.isConnected) return false;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || Number.parseFloat(style.opacity) === 0
        ) return false;
      }
      const rect = element.getBoundingClientRect();
      return element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0;
    };
  });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin === origin) {
      if (url.pathname === '/submit' && method === 'POST') {
        submissions.push(new URLSearchParams(request.postData() || ''));
        await route.fulfill({
          status: submitStatus,
          contentType: 'application/json',
          body: submitStatus === 200 ? '{"success":true}' : '{"error":"Local test error"}',
        });
        return;
      }
      if (method !== 'GET' && method !== 'HEAD') {
        errors.push(`${activePageLabel}: unexpected local ${method} ${url.pathname}`);
        await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.continue();
      return;
    }
    externalHttpRequests += 1;
    if (method !== 'GET' && method !== 'HEAD') {
      errors.push(`${activePageLabel}: unexpected external ${method} ${url.href}`);
      await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
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

  await context.routeWebSocket('**/*', async (route) => {
    webSocketAttempts += 1;
    errors.push(`${activePageLabel}: unexpected WebSocket ${route.url()}`);
    await route.close({ code: 1008, reason: 'Local browser test blocks WebSockets' });
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${activePageLabel}: pageerror: ${error.message}`));

  activePageLabel = 'main solar interactive';
  await page.goto(`${origin}/uslugi/solnechnye-paneli/?utm_source=test&utm_medium=cpc&utm_campaign=solar&yclid=12345`);
  await page.locator('#cookieBanner button').click();
  await exerciseKeyboardNavigation(page, 'Main solar page');

  for (const width of [360, 390, 768, 900, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const state = await page.evaluate(() => {
      const visible = (selector) => [...document.querySelectorAll(selector)].some(window.__solarIsLayoutVisible);
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        navigation: visible('.nav-main, .menu-toggle'),
        cta: visible('.solar-actions .solar-intent-card, .solar-mobile-cta .btn, .header__callback'),
      };
    });
    if (state.overflow) errors.push(`horizontal overflow at ${width}px`);
    if (!state.navigation) errors.push(`no visible navigation at ${width}px`);
    if (!state.cta) errors.push(`no visible CTA at ${width}px`);
  }

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
  const matrixFailures = [];
  let cityWidthRuns = 0;
  for (const [slug, city, cityPrepositional] of citySolarPages) {
    const route = `/krym/${slug}/solnechnye-paneli/`;
    for (const width of cityWidths) {
      const label = `${route}@${width}`;
      const comboFailures = [];
      const expect = (condition, message) => {
        if (!condition) comboFailures.push(message);
      };
      activePageLabel = label;
      try {
        await page.setViewportSize({ width, height: 900 });
        const response = await page.goto(origin + route, { waitUntil: 'load' });
        expect(response?.status() === 200, `HTTP status ${response?.status() ?? 'none'}, expected 200`);
        const state = await page.evaluate(({ route, city, cityPrepositional }) => {
          const visible = window.__solarIsLayoutVisible;
          const form = document.getElementById('solar-request-form');
          const h1 = document.querySelector('h1');
          const offer = document.querySelector('.solar-lead');
          const navMain = document.querySelector('.nav-main');
          const menuToggle = document.querySelector('.menu-toggle');
          const phone = form?.querySelector('[name="phone"]');
          const submit = form?.querySelector('button[type="submit"]');
          const cityHub = `/krym/${route.split('/')[2]}/`;
          const usableControl = (element) => visible(element) && !element.matches(':disabled') && (
            element.tagName !== 'A' || Boolean(element.getAttribute('href'))
          );
          return {
            canonical: document.querySelector('link[rel="canonical"]')?.href || '',
            h1: h1?.textContent.trim() || '',
            h1Visible: visible(h1),
            offer: offer?.textContent.replace(/\s+/g, ' ').trim() || '',
            offerVisible: visible(offer),
            localVisible: visible(document.querySelector('[data-solar-city-content]')),
            localParagraphs: document.querySelectorAll('[data-solar-city-content] .solar-local__copy > p').length,
            localPoints: document.querySelectorAll('[data-solar-city-content] .solar-local__copy li').length,
            mainSolarLinkVisible: [...document.querySelectorAll('a[href="/uslugi/solnechnye-paneli/"]')].some(visible),
            cityHubLinkVisible: [...document.querySelectorAll(`a[href="${cityHub}"]`)].some(visible),
            neighborLinksVisible: [...document.querySelectorAll('[data-solar-neighbors] a[href$="/solnechnye-paneli/"]')].filter(visible).length,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
            navMainVisible: visible(navMain),
            navMainUsable: visible(navMain) && [...navMain.querySelectorAll('a[href]')].some(usableControl),
            menuToggleVisible: visible(menuToggle),
            menuToggleUsable: usableControl(menuToggle) && menuToggle.getAttribute('aria-controls') === 'solar-menu',
            ctaUsable: [...document.querySelectorAll('.solar-actions .btn, .solar-mobile-cta .btn, .solar-product__copy .btn')].some(usableControl),
            formVisible: visible(form),
            phoneUsable: usableControl(phone) && phone.matches(':read-write'),
            submitUsable: usableControl(submit),
            cityField: form?.querySelector('[name="city"]')?.value || '',
            expectedH1: `Солнечные панели и электростанции в ${cityPrepositional}`,
            city,
          };
        }, { route, city, cityPrepositional });
        expect(state.canonical === `https://kepstroy.ru${route}`, `canonical ${JSON.stringify(state.canonical)} is not self`);
        expect(state.h1 === state.expectedH1, `H1 ${JSON.stringify(state.h1)} does not match ${JSON.stringify(state.expectedH1)}`);
        expect(state.h1Visible, 'H1 is not layout-visible');
        expect(/LONGi Hi-MO X10 Scientist 650 Вт/.test(state.offer), 'primary offer misses product');
        expect(/20 000 ₽/.test(state.offer), 'primary offer misses price');
        expect(new RegExp(cityPrepositional).test(state.offer), 'primary offer misses city');
        expect(state.offerVisible, 'primary offer is not layout-visible');
        expect(state.localVisible, 'local block is not layout-visible');
        expect(state.localParagraphs >= 2, `local block has ${state.localParagraphs} paragraphs, expected at least 2`);
        expect(state.localPoints >= 3, `local block has ${state.localPoints} planning points, expected at least 3`);
        expect(state.mainSolarLinkVisible, 'main solar link is not layout-visible');
        expect(state.cityHubLinkVisible, 'city hub link is not layout-visible');
        expect(state.neighborLinksVisible >= 1 && state.neighborLinksVisible <= 4, `visible neighbor links ${state.neighborLinksVisible}, expected 1..4`);
        expect(!state.overflow, 'horizontal overflow detected');
        expect(state.navMainVisible !== state.menuToggleVisible, 'expected exactly one visible navigation path');
        expect(state.navMainVisible ? state.navMainUsable : state.menuToggleUsable, 'visible navigation path is not usable');
        expect(state.ctaUsable, 'no layout-visible usable CTA');
        expect(state.formVisible, 'form is not layout-visible');
        expect(state.phoneUsable, 'phone field is not layout-visible and editable');
        expect(state.submitUsable, 'submit button is not layout-visible and enabled');
        expect(state.cityField === city, `qualified city ${JSON.stringify(state.cityField)} does not match ${JSON.stringify(city)}`);
        cityHeadings.add(state.h1);

        await page.locator('#panel-quantity').fill('3');
        await page.locator('#solar-calculate').click();
        expect(await page.locator('#solar-result-power').textContent() === '1,95 кВт', 'calculator power is incorrect');
        expect(await page.locator('#solar-result-price').textContent() === 'Стоимость панелей: 60 000 ₽', 'calculator price is incorrect');
      } catch (error) {
        comboFailures.push(`browser action failed: ${error.message}`);
      } finally {
        cityWidthRuns += 1;
      }
      if (comboFailures.length) matrixFailures.push(`${label}: ${comboFailures.join('; ')}`);
    }
  }
  assert.equal(cityWidthRuns, 84, `City matrix must execute exactly 84 combinations, got ${cityWidthRuns}`);
  if (cityHeadings.size !== citySolarPages.length) {
    matrixFailures.push(`matrix: found ${cityHeadings.size} unique H1 values, expected ${citySolarPages.length}`);
  }
  assert.deepEqual(matrixFailures, [], `City matrix failures (${matrixFailures.length}/${cityWidthRuns})`);

  for (const [slug] of citySolarPages) {
    const route = `/krym/${slug}/solnechnye-paneli/`;
    activePageLabel = `${route} content checks`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + route, { waitUntil: 'load' });
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

  submissions.length = 0;
  activePageLabel = 'Yalta full interactive journey';
  await page.goto(`${origin}/krym/jalta/solnechnye-paneli/?utm_source=city-test&utm_medium=cpc&utm_campaign=solar-jalta&yclid=jalta-123`);
  await exerciseKeyboardNavigation(page, 'Yalta city solar page');
  assert.equal(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    true,
    'Yalta city page must run in the reduced-motion context',
  );
  await page.locator('#questions summary').first().click();
  assert.equal(await page.locator('#questions details').first().evaluate((element) => element.open), true, 'Yalta FAQ must open');
  await page.locator('#panel-quantity').fill('10');
  await page.locator('#system-type').selectOption('hybrid');
  await page.locator('#placement').selectOption('roof');
  await page.locator('#solar-calculate').click();
  assert.equal(await page.locator('#solar-result-power').textContent(), '6,5 кВт', 'Yalta calculator power');
  assert.equal(await page.locator('#solar-result-price').textContent(), 'Стоимость панелей: 200 000 ₽', 'Yalta calculator price');

  const cityForm = page.locator('#solar-request-form');
  assert.equal(await cityForm.locator('#solar-locality').isEditable(), true);
  await cityForm.locator('button[type="submit"]').click();
  assert.equal(submissions.length, 0, 'Yalta required phone and consent must block submit');
  await cityForm.locator('#solar-locality').fill('Гурзуф');
  await cityForm.locator('#solar-phone').fill('+7 (978) 123-45-67');
  await cityForm.locator('button[type="submit"]').click();
  assert.equal(submissions.length, 0, 'Yalta consent must be required');
  await cityForm.locator('[name="consent"]').check();
  await cityForm.locator('#solar-name').fill('Локальный тест');
  await cityForm.locator('#solar-comment').fill('Сохранить данные после ошибки');
  await cityForm.locator('[name="city"]').evaluate((input) => { input.value = 'Москва'; });

  submitStatus = 500;
  page.once('dialog', (dialog) => dialog.accept());
  await cityForm.locator('button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('#solar-request-form button[type="submit"]').disabled);
  assert.equal(submissions.length, 1, 'Yalta simulated error must issue one intercepted POST');
  assert.equal(await cityForm.locator('#solar-locality').inputValue(), 'Гурзуф', 'Yalta error must retain locality');
  assert.equal(await cityForm.locator('#solar-phone').inputValue(), '+7 (978) 123-45-67', 'Yalta error must retain phone');
  assert.equal(await cityForm.locator('#solar-name').inputValue(), 'Локальный тест', 'Yalta error must retain name');
  assert.equal(await cityForm.locator('#solar-comment').inputValue(), 'Сохранить данные после ошибки', 'Yalta error must retain comment');
  assert.equal(await cityForm.locator('[name="consent"]').isChecked(), true, 'Yalta error must retain consent');
  assert.equal(await page.locator('#system-type').inputValue(), 'hybrid', 'Yalta error must retain system type');
  assert.equal(await page.locator('#placement').inputValue(), 'roof', 'Yalta error must retain placement');
  const cityFailedGoals = await page.evaluate(() => window.__goals || []);
  assert.equal(cityFailedGoals.includes('form_submit'), false, 'Yalta failed submit must not emit form_submit');
  assert.equal(cityFailedGoals.includes('solar_submit_error'), true, 'Yalta failed submit must emit solar_submit_error');

  submissions.length = 0;
  submitStatus = 200;
  await cityForm.locator('[name="city"]').evaluate((input) => { input.value = 'Москва'; });
  await cityForm.locator('button[type="submit"]').dblclick();
  await page.waitForURL('**/spasibo/');
  assert.equal(submissions.length, 1, 'Yalta successful double click must create exactly one intercepted POST');
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
  console.log(JSON.stringify({
    cityWidthRuns,
    submitted: submissions.length,
    externalHttpRequests,
    webSocketAttempts,
    screenshotDirectory,
  }, null, 2));
})().catch(async (error) => {
  if (browser) await browser.close().catch(() => {});
  console.error(error);
  process.exitCode = 1;
});
