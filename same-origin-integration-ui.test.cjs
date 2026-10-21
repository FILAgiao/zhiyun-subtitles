const assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),{chromium}=require('playwright');
(async()=>{
 const fixture=cp.spawn('python',['-u','-c',`import json,tempfile,threading,sys
from backend.public_preview import make_preview_server,seed_preview
from backend.server import Gateway
with tempfile.TemporaryDirectory() as folder:
 def blocked(*args,**kwargs):raise AssertionError('No external service allowed in website verification')
 gateway=Gateway(folder+'/test.sqlite3',upstream=blocked,upstream_stream=blocked)
 demo=seed_preview(gateway)
 server=make_preview_server(gateway);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 print(json.dumps({'port':server.server_port,'demo':demo}),flush=True)
 sys.stdin.readline();server.shutdown();server.server_close();thread.join()
`],{stdio:['pipe','pipe','inherit']});let browser;
 try{
  const setup=await new Promise((resolve,reject)=>{let out='';fixture.stdout.on('data',d=>{out+=d;try{resolve(JSON.parse(out.trim()));}catch{}});fixture.on('error',reject);fixture.on('exit',code=>reject(Error('Fixture exited '+code)));});
  const base='http://127.0.0.1:'+setup.port;
  const executablePath=process.env.PORTAL_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=await chromium.launch({headless:true,executablePath});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  await page.goto(base+'/gateway/');assert.equal(await page.title(),'浙大上课爽 · 网课不硬扛');
  assert.equal(requests.filter(url=>url.includes('/v1/')).length,0,'public homepage never reads personal APIs');
  await page.getByRole('link',{name:'我的问答',exact:true}).click();await page.waitForURL(/\/gateway\/study$/);
  await page.getByRole('button',{name:'登录查看问答'}).click();await page.locator('#login-name').fill(setup.demo.username);await page.locator('#login-password').fill('incorrect-preview-password');await page.locator('#login-submit').click();await page.getByText('账号或密码不正确，请核对后重试。',{exact:true}).waitFor();
  await page.locator('#login-password').fill(setup.demo.password);await page.locator('#login-submit').click();await page.locator('#study-workspace').waitFor({state:'visible'});await page.locator('.conversation-item').nth(1).waitFor();
  const token=await page.evaluate(()=>sessionStorage.getItem('gateway-web-session'));assert.ok(token);assert.equal(await page.locator('#login-password').inputValue(),'');
  await page.locator('#study-search').fill('动量');assert.equal(await page.locator('.conversation-item').count(),1);await page.locator('.conversation-item button').first().click();await page.locator('#reader-content').waitFor({state:'visible'});assert.match(await page.locator('#reader-messages').innerText(),/动能未必守恒/);
  const me=await context.request.get(base+'/gateway/v1/me',{headers:{Authorization:'Bearer '+token,'X-App-Id':'zhiyun-subtitles'}});assert.equal(me.status(),200);const profile=await me.json();assert.equal(profile.membership.plan,'free');assert.equal(profile.usage.requests,0,'web reading consumes no AI calls');
  await page.locator('#study-search').fill('');await page.screenshot({path:'same-origin-real-backend-desktop-preview.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'same-origin-real-backend-mobile-preview.png',fullPage:true});
  await page.goto(base+'/gateway/account?tab=recharge');await page.locator('#account-member').waitFor({state:'visible'});assert.match(await page.locator('#member-plan').innerText(),/基础免费/);assert.ok(await page.locator('#channel-closed').isVisible());assert.ok(await page.locator('#channel-open').isHidden());
  await page.getByRole('link',{name:'我的问答',exact:true}).click();await page.locator('.conversation-item').nth(1).waitFor();await page.locator('.conversation-item button').first().click();await page.locator('#reader-content').waitFor({state:'visible'});await page.locator('#conversation-delete').click();await page.locator('#delete-confirm').click();await page.getByText('已删除网页保存的问答。',{exact:true}).waitFor();assert.equal(await page.locator('.conversation-item').count(),1);
  await page.locator('[data-logout]').click();await page.locator('#study-guest').waitFor({state:'visible'});await page.waitForFunction(()=>!sessionStorage.getItem('gateway-web-session'));await page.waitForTimeout(150);
  const expired=await context.request.get(base+'/gateway/v1/study/conversations',{headers:{Authorization:'Bearer '+token,'X-App-Id':'zhiyun-subtitles'}});assert.equal(expired.status(),401);
  assert.equal(await page.locator('#reader-messages').innerText(),'');assert.equal(requests.filter(url=>!url.startsWith(base)).length,0,'the whole flow stays on the original-site origin');assert.deepEqual(errors,[]);
  const reduced=await browser.newContext({reducedMotion:'reduce'}),reducedPage=await reduced.newPage();await reducedPage.goto(base+'/gateway/');assert.equal(await reducedPage.locator('html').evaluate(el=>el.classList.contains('motion-ready')),false);await reduced.close();
  const noJS=await browser.newContext({javaScriptEnabled:false}),noJSPage=await noJS.newPage();await noJSPage.goto(base+'/gateway/');assert.ok(await noJSPage.locator('h1').isVisible());assert.ok(await noJSPage.locator('.account-services h2').isVisible());await noJS.close();
  console.log('PASS: actual same-origin Python backend, free account login, zero-model reading/search/course/detail/delete/logout, shared account-page session, QR closed, 390px, reduced motion and no-JS fallback; '+executablePath);
 }finally{await browser?.close();fixture.stdin.end('\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
