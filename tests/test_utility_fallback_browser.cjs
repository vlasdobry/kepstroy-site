const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const origin='http://127.0.0.1:8094';
async function main(){
  const browser=await chromium.launch({headless:true});
  let requests=0;
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}});
    let mode='success',body;
    await context.route('**/*',route=>{
      const r=route.request();
      if(!r.url().startsWith(origin))return route.fulfill({status:200,body:''});
      if(new URL(r.url()).pathname==='/submit'){
        requests++;body=new URLSearchParams(r.postData());
        if(mode==='network')return route.abort('timedout');
        return route.fulfill({status:mode==='success'?200:Number(mode),headers:{'Content-Type':'application/json','X-Form-Error':mode==='409'?'duplicate_submission':mode==='429'?'rate_limit':'internal_error'},body:'{}'});
      }
      return route.continue();
    });
    await context.addInitScript(()=>{
      window.ym=(...a)=>{if(a[1]==='getClientID')return a[2]('qa');if(a[1]==='reachGoal'){const history=JSON.parse(sessionStorage.getItem('qa_goals')||'[]');history.push([a[2],a[3]]);sessionStorage.setItem('qa_goals',JSON.stringify(history));}};
      document.addEventListener('click',e=>{if(e.target.closest('a[href^="tel:"]'))e.preventDefault();},true);
    });
    const page=await context.newPage();
    await page.goto(origin+'/uslugi/vodosnabzhenie/#zayavka',{waitUntil:'networkidle'});
    const goals=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('qa_goals')||'[]'));
    assert.equal((await goals()).filter(a=>a[0]==='analytics_notice_shown').length,0,'offscreen notice is not shown');
    await page.evaluate(()=>scrollTo(0,0));
    await page.waitForTimeout(650);
    assert.equal((await goals()).filter(a=>a[0]==='analytics_notice_shown').length,1,'scrolling to notice shows it once');
    const form=page.locator('#utility-form');
    await form.locator('[name="phone"]').fill('+7 (900) 000-00-01');
    await form.locator('[name="consent"]').check();
    for(const fail of ['400','429','500','409','network']){
      mode=fail;
      await form.locator('[type="submit"]').click();
      await page.locator('[data-utility-error]').waitFor({state:'visible'});
      if(fail==='409')assert.match(await page.locator('[data-utility-error]').innerText(),/уже получена/);
      assert.equal((await goals()).filter(a=>a[0]==='form_submit').length,0);
      assert.equal(await form.locator('[type="submit"]').isEnabled(),true);
    }
    mode='success';
    await form.locator('[type="submit"]').click();
    await page.waitForURL('**/spasibo/');
    assert.equal((await goals()).filter(a=>a[0]==='form_submit').length,1);
    assert.equal((await goals()).filter(a=>a[0]==='water_form_success').length,1);
    assert.equal((await goals()).filter(a=>a[0]==='water_calc_success').length,0,'direct request is not selector completion');
    assert.match(body.get('message'),/не пройден/);
    assert.ok((await goals()).every(a=>!JSON.stringify(a[1]||{}).includes('900')));
    await page.goto(origin+'/uslugi/kanalizaciya/',{waitUntil:'networkidle'});
    const start=page.locator('[data-utility-start]');
    await start.focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-utility-progress]').evaluate(e=>document.activeElement===e),true);
    await page.locator('[name="object"][value="home"]').focus();await page.keyboard.press('Space');
    await page.locator('[name="location"][value="outside"]').focus();await page.keyboard.press('Space');
    await page.locator('[data-utility-next]').focus();await page.keyboard.press('Enter');
    assert.match(await page.locator('[data-utility-progress]').innerText(),/2 из 3/);
    await page.locator('[data-utility-route]').click();
    await page.waitForURL('**/uslugi/septiki/');
    assert.equal((await goals()).filter(a=>a[0]==='utility_route').length,1);
    assert.equal((await goals()).filter(a=>a[0]==='sewer_calc_result').length,0);
    await context.close();
    const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:360,height:640}});
    const fallback=await nojs.newPage();
    await fallback.goto(origin+'/uslugi/vodosnabzhenie/');
    assert.equal(await fallback.locator('#utility-form').isVisible(),true);
    assert.ok(await fallback.locator('a[href="tel:+79784615962"]').count()>0);
    await nojs.close();
    assert.equal(requests,6);
    console.log('PASS hash notice, 5 failure modes, direct success, keyboard, service routing and no-JS; 6 localhost mocks');
  } finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
