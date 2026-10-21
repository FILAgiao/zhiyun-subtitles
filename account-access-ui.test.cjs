const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

// All public-account API calls and QR images are mocked. No registration,
// verification email, application, order, or payment request can be sent.
const BASE_URL = process.env.ZY_STUDY_TEST_URL || 'http://127.0.0.1:5173';
const QR_URL = 'https://account-contact.example.test/contact-qr.png';
const QR_BROKEN = 'https://account-contact.example.test/missing-qr.png';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK3sAAAAASUVORK5CYII=', 'base64');
const ids = name => 'account-' + name;
const closed = () => ({enabled:false,qr_url:'',instructions:'',contact:'',status:'暂未开放'});
const config = (registration=closed(),recharge=closed()) => ({registration,recharge,manual:true,email_registration:false});
const open = (label='账号申请') => ({enabled:true,qr_url:QR_URL,instructions:label+'请联系管理员，人工确认后办理。',contact:'测试联系人：个人账号管理员',status:'联系管理员办理'});

(async () => {
  let browser, page;
  let response = config(), responseStatus = 200;
  const calls = [], unexpected = [], pageErrors = [];
  const output = path.join(__dirname, '.test-media');
  fs.mkdirSync(output,{recursive:true});
  try {
    browser = await chromium.launch({headless:true,executablePath:process.env.ZY_TEST_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const origin = new URL(BASE_URL).origin;
    await context.route('**/*',async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.url() === QR_URL) return route.fulfill({status:200,contentType:'image/png',body:png});
      if (request.url() === QR_BROKEN) return route.fulfill({status:404,contentType:'text/plain',body:'fixture QR missing'});
      if (url.pathname.startsWith('/api/gateway/')) {
        calls.push({path:url.pathname,method:request.method()});
        if (url.pathname === '/api/gateway/v1/account/access' && request.method()==='GET') return route.fulfill({status:responseStatus,contentType:'application/json',body:JSON.stringify(response)});
        unexpected.push(request.method()+' '+url.pathname);
        return route.fulfill({status:501,contentType:'application/json',body:JSON.stringify({error:'Unmocked account operation is blocked'})});
      }
      if (url.origin!==origin && /^https?:$/.test(url.protocol)) return route.abort('blockedbyclient');
      return route.continue();
    });
    page = await context.newPage();
    page.on('pageerror',error => pageErrors.push(error.message));
    const element = name => page.getByTestId(ids(name));
    const fits = async label => assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label);
    const quiet = async () => {
      assert.equal(await page.locator('input[type="password"],input[autocomplete="one-time-code"],input[name="amount"]').count(),0,'manual account access must not expose password, email-code, or payment amount inputs');
      assert.doesNotMatch(await element('access-page').innerText(),/扫码(?:后|即)自动到账|付款后自动到账|付款成功|订单已创建|验证码已发送/,'manual account flow must not claim a real transaction');
    };
    const unavailable = async () => {
      await element('unavailable').filter({hasText:'暂未开放'}).waitFor({state:'visible'});
      assert.equal(await element('qr').isVisible(),false,'closed or invalid QR must not be visible');
      assert.equal(await element('contact').isVisible(),false,'contact is only available after a configured QR loaded');
      await quiet();
    };
    const visit = async (tab='register') => {
      await page.goto(new URL('/account?tab='+tab,BASE_URL).href,{waitUntil:'networkidle'});
      await element('access-page').waitFor({state:'visible'});
    };

    // The default can be used safely before any contact QR is configured.
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:width===1440?1000:844});
      response=config(); responseStatus=200;
      await visit();
      await unavailable();
      await fits('closed registration page overflow at '+width);
      await element('tab-recharge').click();
      await unavailable();
      await fits('closed recharge page overflow at '+width);
      await element('tab-register').click();
      await unavailable();
      const login = element('login-link');
      assert.equal(await login.isVisible(),true,'existing account login must remain available');
      const href = new URL(await login.getAttribute('href'),BASE_URL);
      assert.equal(href.pathname,'/');
      assert.equal(href.searchParams.get('view'),'study');
      assert.equal(href.searchParams.get('login'),'1');
      if (width===1440 || width===390) await page.screenshot({path:path.join(output,'account-access-closed-'+width+'.png'),fullPage:true});
      if (width===1440) {
        await page.screenshot({path:path.join(__dirname,'account-access-closed-preview.png'),fullPage:true});
        await element('tab-recharge').click();
        await unavailable();
        await page.screenshot({path:path.join(__dirname,'account-recharge-closed-preview.png'),fullPage:true});
      }
      if (width===390) await page.screenshot({path:path.join(__dirname,'account-access-mobile-preview.png'),fullPage:true});
    }

    // Backend fields alone are insufficient: an empty/unsafe URL must stay closed.
    await page.setViewportSize({width:390,height:844});
    for (const qr of ['', 'http://account-contact.example.test/qr.png', 'javascript:alert(1)']) {
      response=config({...open(),qr_url:qr});
      await visit();
      await unavailable();
    }
    response=config({...open(),enabled:false});
    await visit();
    await unavailable();

    // A server error or broken QR also cannot display usable payment/contact details.
    responseStatus=503; response={error:'fixture account configuration is not available'};
    await visit('recharge');
    await unavailable();
    responseStatus=200; response=config({...open(),qr_url:QR_BROKEN},{...open('充值续用'),qr_url:QR_BROKEN});
    await visit();
    await unavailable();
    await element('tab-recharge').click();
    await unavailable();

    // A configured QR and contact are shown only after its image loads.
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:width===1440?1000:844});
      response=config(open(),open('充值续用'));
      await visit();
      await element('qr').waitFor({state:'visible'});
      await page.waitForFunction(()=>{const qr=document.querySelector('[data-testid="account-qr"]');return qr instanceof HTMLImageElement && qr.complete && qr.naturalWidth>0});
      await element('contact').filter({hasText:'测试联系人'}).waitFor({state:'visible'});
      assert.equal(await element('qr').getAttribute('src'),QR_URL);
      assert.equal(await element('unavailable').isVisible(),false);
      assert.match(await element('access-page').innerText(),/人工|管理员/);
      await quiet(); await fits('configured account page overflow at '+width);
      await element('tab-recharge').click();
      await element('contact').waitFor({state:'visible'});
      assert.match(await element('access-page').innerText(),/充值续用/);
      await quiet(); await fits('configured recharge page overflow at '+width);
      if (width===1440 || width===390) await page.screenshot({path:path.join(output,'account-access-configured-'+width+'.png'),fullPage:true});
    }

    // Each tab is independently configured. A usable register QR must never
    // remain visible after switching to an unavailable recharge tab.
    response=config(open(),closed());
    await visit();
    await element('contact').waitFor({state:'visible'});
    await element('tab-recharge').click();
    await unavailable();
    await element('tab-register').click();
    await element('contact').waitFor({state:'visible'});

    // Administrator-entered instructions and contact details stay plain text.
    const untrusted='<img src=x onerror="window.__accountMarkup=1">';
    response=config({...open(),instructions:untrusted,contact:'联系人 '+untrusted});
    await visit();
    await element('contact').waitFor({state:'visible'});
    assert.match(await element('access-page').innerText(),/<img src=x onerror=/);
    assert.equal(await element('contact').locator('img,script').count(),0);
    assert.equal(await page.evaluate(()=>window.__accountMarkup),undefined);
    await quiet();

    // Legacy links and public registration entry points converge on the new page.
    response=config();
    await page.goto(new URL('/?auth=register',BASE_URL).href,{waitUntil:'networkidle'});
    await page.waitForURL(url=>url.pathname==='/account' && url.searchParams.get('tab')==='register');
    await unavailable();
    await page.goto(BASE_URL,{waitUntil:'networkidle'});
    const entry = page.getByRole('button',{name:'申请学习账号 ↗',exact:true});
    await entry.waitFor({state:'visible'});
    await entry.click();
    await page.waitForURL(url=>url.pathname==='/account' && url.searchParams.get('tab')==='register');
    await unavailable();
    await element('login-link').click();
    await page.getByRole('dialog').waitFor({state:'visible'});
    assert.equal(await page.getByRole('dialog').locator('input[type="password"]').count(),1,'existing accounts can return to their normal login');
    assert.equal(calls.every(call=>call.method==='GET'),true,'manual account access never creates requests, sends codes, or takes payment');
    assert.deepEqual(unexpected,[]);
    assert.deepEqual(pageErrors,[]);
    console.log('PASS: manual account access closed by default, registration/recharge tabs, configured QR/contact, missing/unsafe/failed QR and API failure, 1440/390/320 px, legacy and homepage entries, existing account login; all remote requests mocked.');
  } catch(error) {
    fs.writeFileSync(path.join(output,'account-access-api-trace.json'),JSON.stringify(calls,null,2));
    await page?.screenshot({path:path.join(output,'account-access-failure.png'),fullPage:true}).catch(()=>{});
    throw error;
  } finally { await browser?.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
