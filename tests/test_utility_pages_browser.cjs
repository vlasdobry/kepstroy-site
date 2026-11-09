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
    if(process.argv.includes('--cta')) return;
    for(const service of ['water','sewer']) for(const width of [360,390,768,1440]) {
      const url=service==='water'?'/uslugi/vodosnabzhenie/':'/uslugi/kanalizaciya/';
      const context=await browser.newContext({viewport:{width,height:900}, reducedMotion:'reduce'});
      let body=null, fail=false;
      await context.route('**/*',route=>{
        const request=route.request();
        if(!request.url().startsWith(origin))return route.fulfill({status:200,body:''});
        if(new URL(request.url()).pathname==='/submit'){
          submissions++;body=new URLSearchParams(request.postData());
          return route.fulfill({status:fail?500:200,contentType:'application/json',body:fail?'{}':'{"success":true}'});
        }
        return route.continue();
      });
      await context.addInitScript(()=>{
        window.__goals=JSON.parse(sessionStorage.getItem('utility_qa_goals')||'[]');
        window.ym=(...a)=>{if(a[1]==='getClientID')a[2]('123456789');else {window.__goals.push(a);sessionStorage.setItem('utility_qa_goals',JSON.stringify(window.__goals));}};
        document.addEventListener('click',e=>{if(e.target.closest('a[href^="tel:"]'))e.preventDefault();},true);
      });
      const page=await context.newPage();
      const errors=[];page.on('pageerror', e=>errors.push(e.message));
      await page.goto(origin+url+'?utm_source=qa&yclid=qa-click',{waitUntil:'networkidle'});
      assert.equal(await page.locator('h1').count(),1);
      assert.ok((await page.locator('body').innerText()).includes('5 000'));
      assert.ok(await page.locator('a[href="tel:+79784615962"]').count()>0);
      assert.equal(await page.locator('.sticky-phone a[href="tel:+79784615962"]').count(),1,'desktop and mobile call without a missing modal');
      assert.equal(await page.locator('.utility-page .btn--outline').first().evaluate(el=>getComputedStyle(el).color==='rgb(255, 255, 255)'),false,'outline text readable on light background');
      const form=page.locator('#utility-form');
      assert.equal(await form.isVisible(),true,'direct form is available before selection');
      await page.locator('[data-utility-start]').click();
      await page.locator('[name="object"][value="home"]').check();
      await page.locator('[name="location"][value="outside"]').check();
      await page.locator('[data-utility-next]').click();
      await page.locator('[name="connection"][value="unknown"]').check();
      await page.locator('[name="documents"][value="unknown"]').check();
      await page.locator('[data-utility-next]').click();
      await page.locator('[name="length"][value="unknown"]').check();
      await page.locator('[name="surface"][value="unknown"]').check();
      await page.locator('[data-utility-next]').click();
      const result=page.locator('[data-utility-result]');
      assert.equal(await result.isVisible(),true,'result precedes phone');
      assert.match(await result.innerText(),/видео/i);
      assert.doesNotMatch(await result.innerText(),/итого|итоговая стоимость/i);
      // Going back and editing updates the result without duplicating milestones.
      await page.locator('[data-utility-edit]').click();
      await page.locator('[name="object"][value="commercial"]').check();
      await page.locator('[data-utility-next]').click();
      await page.locator('[data-utility-next]').click();
      await page.locator('[data-utility-next]').click();
      assert.match(await result.innerText(),/внутренн/i);
      const before=await page.evaluate(()=>window.__goals.filter(a=>a[1]==='reachGoal'));
      for(const suffix of ['calc_start','calc_step1','calc_step2','calc_result'])assert.equal(before.filter(a=>a[2]===service+'_'+suffix).length,1, suffix+' once');
      assert.ok(before.every(a=>!JSON.stringify(a[3]||{}).includes('qa-click')));
      await form.locator('[name="phone"]').fill('+7 (900) 000-00-01');
      await form.locator('[name="consent"]').check();
      fail=true;
      await form.locator('[type="submit"]').click();
      await page.locator('[data-utility-error]').waitFor({state:'visible'});
      assert.equal(await form.locator('[type="submit"]').isEnabled(),true);
      assert.equal((await page.evaluate(()=>window.__goals)).filter(a=>a[2]==='form_submit').length,0);
      fail=false;
      const successes=submissions;
      await form.locator('[type="submit"]').dblclick();
      await page.waitForURL('**/spasibo/');
      assert.equal((await page.evaluate(()=>window.__goals)).filter(a=>a[2]==='form_submit').length,1,'one general success');
      assert.equal((await page.evaluate(()=>window.__goals)).filter(a=>a[2]===service+'_calc_success').length,1,'one selector success');
      assert.equal(submissions,successes+1,'no double submission');
      assert.equal(body.get('utm_source'),'qa');assert.equal(body.get('yclid'),'qa-click');
      assert.equal(body.get('client_id'),'123456789');assert.ok(body.get('service'));
      assert.match(body.get('message'),/коммерческий/i);
      assert.ok(body.get('message').length<=1000);
      assert.deepEqual(errors,[]);
      // A fresh render for export and layout checks, with the notice open.
      await page.goto(origin+url,{waitUntil:'networkidle'});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
      await page.screenshot({path:path.join(out,service+'-'+width+'.png'),fullPage:true});
      console.log('PASS utility '+service+' '+width);
      await context.close();
    }
    console.log('PASS utility browser suite; localhost mock submissions: '+submissions);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
