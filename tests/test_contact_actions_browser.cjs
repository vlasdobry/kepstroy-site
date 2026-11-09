const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const base = path.resolve('html');
const out = path.resolve('tmp/utility-qa');
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(base, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp', '.jpg':'image/jpeg', '.svg':'image/svg+xml' }[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
async function hit(page, loc, label, scroll = true) {
  if(scroll) await loc.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(80);
  assert.equal(await loc.evaluate(el => {
    const r=el.getBoundingClientRect();
    return [0.3,0.5,0.7].every(p=>el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height*p)));
  }), true, label+' is covered');
}
async function main() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  let submissions=0;
  try {
    for(const height of [640,844]) for(const width of [360,390]) for(const url of ['/', '/uslugi/septiki/']) {
      const context=await browser.newContext({viewport:{width,height}});
      await context.route('**/*', route=>route.request().url().startsWith(origin)?route.continue():route.fulfill({status:200,body:''}));
      await context.addInitScript(()=>{window.ym=()=>{};document.addEventListener('click',e=>{if(e.target.closest('a[href^="tel:"]'))e.preventDefault();},true);});
      const page=await context.newPage();
      await page.goto(origin+url,{waitUntil:'networkidle'});
      const ctas=page.locator('.hero a.btn, .hero button.btn');
      assert.ok(await ctas.count()>=2, 'two hero actions exist');
      const initialNotice=await page.locator('#cookieBanner').boundingBox();
      for(let n=0;n<await ctas.count();n++) {
        const r=await ctas.nth(n).boundingBox();
        const overlap=Math.max(0,Math.min(r.x+r.width,initialNotice.x+initialNotice.width)-Math.max(r.x,initialNotice.x))*Math.max(0,Math.min(r.y+r.height,initialNotice.y+initialNotice.height)-Math.max(r.y,initialNotice.y));
        assert.equal(overlap,0,url+' '+width+' initial CTA'+n+' overlaps analytics notice');
      }
      for(let n=0;n<await ctas.count();n++) await hit(page,ctas.nth(n),url+' '+width+' CTA'+n);
      await page.evaluate(()=>{scrollTo(0,0);openModal();});
      await hit(page,page.locator('#modalOverlay button[aria-label="Закрыть"]'), 'modal close at '+height, false);
      await hit(page,page.locator('#modalOverlay button[type="submit"]'), 'modal submit');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#cookieBanner').isVisible(),true);
      console.log('PASS CTA '+url+' '+width+'x'+height);
      await context.close();
    }
    console.log('PASS 8 CTA cases; no submissions');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
