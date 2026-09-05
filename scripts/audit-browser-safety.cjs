'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PRODUCTION_HOSTS = new Set(['kepstroy.ru', 'www.kepstroy.ru']);

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function containedExistingFile(root, relative, fsApi = fs) {
  try {
    const lexicalRoot = path.resolve(root);
    const lexicalTarget = path.resolve(lexicalRoot, relative);
    if (!isWithin(lexicalRoot, lexicalTarget) || !fsApi.existsSync(lexicalTarget)) return null;

    const realRoot = fsApi.realpathSync(lexicalRoot);
    const realTarget = fsApi.realpathSync(lexicalTarget);
    if (!isWithin(realRoot, realTarget) || !fsApi.statSync(realTarget).isFile()) return null;
    return realTarget;
  } catch {
    return null;
  }
}

function resolveSiteFile(htmlRoot, imagesRoot, requestPath, fsApi = fs) {
  const relative = String(requestPath)
    .replace(/^[\\/]+/, '')
    .split(/[\\/]+/)
    .join(path.sep);
  const htmlFile = containedExistingFile(htmlRoot, relative, fsApi);
  if (htmlFile) return htmlFile;
  const imagesPrefix = `images${path.sep}`;
  const portfolioPrefix = `${imagesPrefix}portfolio${path.sep}`;
  if (relative.startsWith(portfolioPrefix)) {
    const portfolioRoot = path.join(imagesRoot, 'portfolio');
    return containedExistingFile(portfolioRoot, relative.slice(portfolioPrefix.length), fsApi);
  }
  return null;
}

function isProductionSiteUrl(value) {
  try {
    const target = new URL(value);
    if (!PRODUCTION_HOSTS.has(target.hostname.toLowerCase())) return false;
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
    const defaultPort = target.protocol === 'https:' ? '443' : '80';
    return target.port === '' || target.port === defaultPort;
  } catch {
    return false;
  }
}

function offlineContextOptions(viewport) {
  return {
    viewport,
    serviceWorkers: 'block',
    proxy: {
      server: 'http://127.0.0.1:9',
      bypass: '127.0.0.1',
    },
  };
}

function attachPageObservers(page, origin, errors, labelForPage) {
  const label = () => labelForPage(page);
  page.on('pageerror', (error) => errors.push(`${label()}: pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label()}: console error: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(origin)) {
      errors.push(`${label()}: local request failed: ${request.method()} ${request.url()}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      errors.push(`${label()}: local response ${response.status()}: ${response.url()}`);
    }
  });
}

async function createAuditedContext(browser, origin, counters, errors, viewport) {
  const context = await browser.newContext(offlineContextOptions(viewport));
  const labels = new WeakMap();
  const labelForPage = (page) => labels.get(page) || `popup:${page.url() || 'about:blank'}`;

  await context.route('**/*', async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (request.method() === 'POST') {
      counters.blockedPosts += 1;
      errors.push(`network-guard: unexpected POST ${target.pathname} (${target.origin})`);
      await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
      return;
    }
    if (target.origin === origin) {
      await route.continue();
      return;
    }
    if (isProductionSiteUrl(target.href)) {
      counters.sameSiteAliasRequests += 1;
      const localUrl = new URL(`${target.pathname}${target.search}`, origin).href;
      const response = await context.request.fetch(localUrl, { method: request.method() });
      if (response.status() >= 400) {
        errors.push(`network-guard: same-site alias response ${response.status()} ${target.pathname}`);
      }
      await route.fulfill({ response });
      return;
    }
    if (target.protocol === 'http:' || target.protocol === 'https:') {
      counters.externalRequestsIntercepted += 1;
      await route.fulfill({ status: 204, contentType: 'text/plain', body: '' });
      return;
    }
    await route.continue();
  });

  await context.routeWebSocket('**/*', async (webSocketRoute) => {
    counters.blockedWebSockets += 1;
    errors.push(`network-guard: blocked WebSocket ${webSocketRoute.url()}`);
    await webSocketRoute.close({ code: 1008, reason: 'Offline audit blocks WebSockets' });
  });

  context.on('page', (page) => attachPageObservers(page, origin, errors, labelForPage));

  return {
    context,
    async newPage(label) {
      const page = await context.newPage();
      labels.set(page, label);
      return page;
    },
    setPageLabel(page, label) {
      labels.set(page, label);
    },
  };
}

module.exports = {
  containedExistingFile,
  createAuditedContext,
  isProductionSiteUrl,
  offlineContextOptions,
  resolveSiteFile,
};
