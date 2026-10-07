const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const base = path.resolve('html');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(base, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404).end(); return;
    }
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let cases = 0;
  let submissions = 0;
  try {
    browser = await chromium.launch({ headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const urlPath of ['/uslugi/solnechnye-paneli/', '/krym/simferopol/solnechnye-paneli/', '/']) {
      for (const width of [320, 360, 390, 768, 1024, 1440]) {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        try {
          await context.route('**/*', route => {
            const request = route.request();
            if (request.url().includes('/submit')) { submissions++; return route.abort(); }
            if (request.url().startsWith(origin)) return route.continue();
            return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
          });
          await context.addInitScript(() => {
            window.__qaCalls = [];
            window.ym = (...args) => window.__qaCalls.push(args);
            document.addEventListener('click', event => {
              if (event.target.closest('a[href^="tel:"]')) event.preventDefault();
            }, true);
          });
          const page = await context.newPage();
          await page.goto(origin + urlPath, { waitUntil: 'networkidle' });
          const banner = page.locator('#cookieBanner');
          await banner.waitFor({ state: 'visible' });
          const panel = page.locator(urlPath === '/' ? '.sticky-phone' : '.solar-mobile-cta');
          if (width <= (urlPath === '/' ? 768 : 760)) {
            if (urlPath === '/') {
              await page.evaluate(() => window.scrollTo(0, 600));
              await page.locator('.sticky-phone.is-visible').waitFor({ state: 'visible' });
              // Wait for the existing slide-in animation to finish.
              await page.waitForTimeout(400);
            }
            const noticeBox = await banner.boundingBox();
            const panelBox = await panel.boundingBox();
            assert.ok(noticeBox.y + noticeBox.height <= panelBox.y - 8,
              `${urlPath} at ${width}px: notice overlaps the call panel`);
            const phone = urlPath === '/' ? panel.locator('button') : panel.locator('a[href^="tel:"]');
            await phone.click({ timeout: 2000 });
            assert.equal(await banner.isVisible(), true, 'calling must not require notice dismissal');
            assert.equal(await page.evaluate(() => window.__qaCalls.filter(a => a[1] === 'reachGoal' && a[2] === 'phone_click').length), 1);
          }
          assert.equal(await page.evaluate(() => window.__qaCalls.filter(a => a[2] === 'analytics_notice_shown').length), 1);
          await page.setViewportSize({ width: width <= 768 ? 1024 : 390, height: 844 });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          if (width > 768) {
            if (urlPath === '/') {
              await page.evaluate(() => window.scrollTo(0, 600));
              await page.locator('.sticky-phone.is-visible').waitFor({ state: 'visible' });
              await page.waitForTimeout(400);
            }
            const panelBox = await panel.boundingBox();
            const noticeBox = await banner.boundingBox();
            assert.ok(noticeBox.y + noticeBox.height <= panelBox.y - 8, 'resize must reserve the call panel');
          }
          assert.equal(await page.evaluate(() => window.__qaCalls.filter(a => a[2] === 'analytics_notice_shown').length), 1);
          await banner.locator('button').click();
          await banner.waitFor({ state: 'hidden' });
          assert.equal(await page.evaluate(() => window.__qaCalls.filter(a => a[2] === 'analytics_notice_dismissed').length), 1);
          await page.reload({ waitUntil: 'networkidle' });
          assert.equal(await banner.isVisible(), false);
          assert.equal(await page.evaluate(() => window.__qaCalls.filter(a => /^analytics_notice_/.test(a[2])).length), 0);
          cases++;
          console.log(`PASS ${urlPath} ${width}px`);
        } finally { await context.close(); }
      }
    }
    assert.equal(submissions, 0);
    console.log(`PASS ${cases} browser cases; submissions: ${submissions}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
