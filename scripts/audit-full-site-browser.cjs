#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const htmlRoot = path.join(repoRoot, 'html');
const widths = [360, 768, 900, 1280];
const mimeTypes = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
};

function walkHtml(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkHtml(target) : [target];
  });
}

function urlForFile(file) {
  const relative = path.relative(htmlRoot, file).split(path.sep).join('/');
  if (relative === 'index.html') return '/';
  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`;
  return `/${relative}`;
}

function safeFile(root, relative) {
  const target = path.resolve(root, relative);
  return target === root || target.startsWith(`${root}${path.sep}`) ? target : null;
}

function createServer() {
  let postAttempts = 0;
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      postAttempts += request.method === 'POST' ? 1 : 0;
      response.writeHead(405, { 'content-type': 'application/json' });
      response.end('{"error":"offline audit blocks writes"}');
      return;
    }

    let relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
    relative = relative.split('/').join(path.sep);
    if (!relative || requestUrl.pathname.endsWith('/')) relative = path.join(relative, 'index.html');
    let file = safeFile(htmlRoot, relative);
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if ((!file || !fs.existsSync(file)) && relative.startsWith(`images${path.sep}`)) {
      file = safeFile(repoRoot, relative);
    }
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file).pipe(response);
  });
  return { server, postAttempts: () => postAttempts };
}

async function installOfflineRouting(page, origin, counters, errors, label) {
  page.on('pageerror', (error) => errors.push(`${label}: pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: console error: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(origin)) {
      errors.push(`${label}: local request failed: ${request.method()} ${request.url()}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      errors.push(`${label}: local response ${response.status()}: ${response.url()}`);
    }
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin === origin) {
      if (request.method() === 'POST') {
        counters.blockedPosts += 1;
        errors.push(`${label}: unexpected POST ${target.pathname}`);
        await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
      } else {
        await route.continue();
      }
      return;
    }
    if (target.protocol === 'http:' || target.protocol === 'https:') {
      counters.externalRequestsIntercepted += 1;
      await route.fulfill({ status: 204, contentType: 'text/plain', body: '' });
      return;
    }
    await route.continue();
  });
}

async function auditAllPages(browser, origin, pages, counters, errors) {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    for (const pageUrl of pages) {
      const label = `${pageUrl}@${width}`;
      const page = await context.newPage();
      await installOfflineRouting(page, origin, counters, errors, label);
      try {
        const response = await page.goto(`${origin}${pageUrl}`, { waitUntil: 'load', timeout: 15_000 });
        if (!response || response.status() !== 200) {
          errors.push(`${label}: navigation status ${response ? response.status() : 'none'}`);
        }
        await page.waitForTimeout(25);
        const overflow = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        if (overflow.scrollWidth > overflow.clientWidth + 1) {
          errors.push(`${label}: horizontal overflow ${overflow.scrollWidth}>${overflow.clientWidth}`);
        }
      } catch (error) {
        errors.push(`${label}: navigation failed: ${error.message}`);
      } finally {
        counters.pageWidthRuns += 1;
        await page.close();
      }
    }
    await context.close();
  }
}

async function auditConsent(browser, origin, counters, errors) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let metrikaRequests = 0;
  await page.route('**/*', async (route) => {
    const target = new URL(route.request().url());
    if (target.hostname === 'mc.yandex.ru') metrikaRequests += 1;
    if (target.origin === origin) await route.continue();
    else await route.fulfill({ status: 204, contentType: 'text/plain', body: '' });
  });
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  const state = await page.evaluate(() => ({
    consent: localStorage.getItem('kepstroy_analytics_consent'),
    hasYm: typeof window.ym === 'function',
    metrikaTags: document.querySelectorAll('script[src*="mc.yandex.ru/metrika/tag.js"]').length,
    bannerVisible: Boolean(document.querySelector('#cookieBanner:not([hidden])')),
  }));
  if (state.consent !== null || state.hasYm || state.metrikaTags !== 0 || !state.bannerVisible || metrikaRequests !== 0) {
    errors.push(`consent-before-accept: ${JSON.stringify({ ...state, metrikaRequests })}`);
  }
  counters.consentChecks += 1;
  await context.close();
}

async function auditJourneys(browser, origin, counters, errors) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const target = new URL(route.request().url());
    if (target.origin === origin) await route.continue();
    else await route.fulfill({ status: 204, contentType: 'text/plain', body: '' });
  });

  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await page.evaluate(() => { const banner = document.getElementById('cookieBanner'); if (banner) banner.hidden = true; });
  await page.locator('.header__callback').click();
  const modalOpen = await page.locator('#modalOverlay').evaluate((element) => (
    element.classList.contains('active')
    && element.querySelector('[role="dialog"]')?.getAttribute('aria-modal') === 'true'
  ));
  if (!modalOpen) errors.push('journey-main-callback: modal did not open');
  counters.ctaJourneys += 1;

  await page.goto(`${origin}/krym/simferopol/septik-pod-kluch/`, { waitUntil: 'load' });
  await page.evaluate(() => { const banner = document.getElementById('cookieBanner'); if (banner) banner.hidden = true; });
  const costCta = page.getByRole('link', { name: 'Рассчитать стоимость' }).first();
  await costCta.click();
  const callbackReached = await page.waitForFunction(() => {
    const element = document.getElementById('callback');
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  }, null, { timeout: 3_000 }).then(() => true, () => false);
  if (!callbackReached) errors.push('journey-city-cost-cta: #callback was not reached');
  const phoneHref = await page.getByRole('link', { name: 'Заказать звонок' }).last().getAttribute('href');
  if (phoneHref !== 'tel:+79784615962') {
    errors.push(`journey-city-phone-cta: unexpected href ${phoneHref}`);
  }
  counters.ctaJourneys += 2;

  await page.goto(`${origin}/uslugi/septiki/`, { waitUntil: 'load' });
  await page.evaluate(() => { const banner = document.getElementById('cookieBanner'); if (banner) banner.hidden = true; });
  const submissions = [];
  await page.route(`${origin}/submit`, async (route) => {
    submissions.push(route.request().postData() || '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
  });
  await page.locator('label.calc-type-card[data-type="plastic"]').click();
  await page.locator('#calc-people').selectOption('5-6');
  await page.locator('#calc-region').selectOption('yalta');
  await page.locator('#calc-distance').fill('17');
  await page.locator('#calc-distance').dispatchEvent('input');
  await page.locator('#calc-name').fill('Локальный тест');
  await page.locator('#calc-phone').fill('+7 (978) 000-00-00');
  await page.locator('#calc-form input[name="consent"]').check();
  await page.locator('#calc-form button[type="submit"]').click();
  await page.waitForURL(`${origin}/spasibo/`, { timeout: 5_000 });
  if (submissions.length !== 1) {
    errors.push(`journey-calculator: expected exactly one intercepted POST, got ${submissions.length}`);
  } else {
    const body = new URLSearchParams(submissions[0]);
    const required = ['septic_type', 'region', 'distance', 'people', 'price'];
    const missing = required.filter((name) => !body.get(name));
    if (missing.length) errors.push(`journey-calculator: missing qualification fields ${missing.join(', ')}`);
  }
  counters.interceptedJourneyPosts += submissions.length;
  counters.formJourneys += 1;
  await context.close();
}

async function main() {
  const publicPages = walkHtml(htmlRoot)
    .filter((file) => file.endsWith('.html') && !path.basename(file).startsWith('yandex_'))
    .map(urlForFile)
    .sort();
  if (publicPages.length !== 55) {
    throw new Error(`Expected 55 public HTML pages including 404, found ${publicPages.length}`);
  }

  const local = createServer();
  await new Promise((resolve) => local.server.listen(0, '127.0.0.1', resolve));
  const address = local.server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const counters = {
    htmlPages: publicPages.length,
    normalPages: publicPages.filter((url) => url !== '/404.html').length,
    errorPages: publicPages.filter((url) => url === '/404.html').length,
    widths: widths.length,
    pageWidthRuns: 0,
    externalRequestsIntercepted: 0,
    blockedPosts: 0,
    consentChecks: 0,
    ctaJourneys: 0,
    formJourneys: 0,
    interceptedJourneyPosts: 0,
  };
  const errors = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    await auditAllPages(browser, origin, publicPages, counters, errors);
    console.log(`PAGE-WIDTH AUDIT COMPLETE: ${counters.pageWidthRuns} runs`);
    await auditConsent(browser, origin, counters, errors);
    await auditJourneys(browser, origin, counters, errors);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => local.server.close((error) => error ? reject(error) : resolve()));
  }
  if (local.postAttempts() !== 0) errors.push(`server received ${local.postAttempts()} write attempts`);

  if (errors.length) {
    console.error('BROWSER AUDIT FAILED');
    errors.forEach((error) => console.error(`  - ${error}`));
    console.error(JSON.stringify(counters, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log('BROWSER AUDIT OK');
  console.log(JSON.stringify(counters, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
