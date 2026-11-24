const assert=require('node:assert/strict'),cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events'),{createInterface}=require('node:readline'),{chromium}=require('playwright');
(async()=>{
 const fixture=cp.spawn('python',['-u','-c',`import json,tempfile,threading,sys
from backend.public_preview import make_preview_server,seed_preview,PreviewGateway
with tempfile.TemporaryDirectory() as folder:
 def blocked(*args,**kwargs):raise AssertionError('No external service allowed in website verification')
 gateway=PreviewGateway(folder+'/test.sqlite3',upstream=blocked,upstream_stream=blocked)
 gateway.study_mailer=lambda email,code: print(json.dumps({'email':email,'code':code}),flush=True)
 demo=seed_preview(gateway)
 server=make_preview_server(gateway);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 print(json.dumps({'port':server.server_port,'demo':demo}),flush=True)
 sys.stdin.readline();server.shutdown();server.server_close();thread.join()
`],{stdio:['pipe','pipe','inherit']});let browser;
 try{
  const inbox=createInterface({input:fixture.stdout});
  const [setupLine]=await Promise.race([
   once(inbox,'line'),
   once(fixture,'exit').then(([code])=>{throw Error('Fixture exited '+code);}),
  ]);
  const setup=JSON.parse(setupLine);
  const previews=path.resolve(process.env.ZY_STUDY_PREVIEW_DIR||'dist/web-registration-'+require('./backend/public-page.json').pageVersion);
  fs.mkdirSync(previews,{recursive:true});
  const base='http://127.0.0.1:'+setup.port;
  const executablePath=process.env.PORTAL_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=await chromium.launch({headless:true,executablePath});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  await page.goto(base+'/gateway/');assert.equal(await page.title(),'浙大上课爽 · 网课不硬扛');
  assert.equal(requests.filter(url=>url.includes('/v1/')).length,0,'public homepage never reads personal APIs');
  const navigation=page.getByRole('navigation',{name:'主导航'});
  const navLabels=()=>navigation.getByRole('link').allTextContents();
  const siteLinks=await navLabels();
  assert.ok(siteLinks.some(label=>label.trim()==='随意摘'));
  for(const [route,current] of [['/account?tab=register','account'],['/study','study'],['/study#clips','clips'],['/privacy','privacy']]){
   await page.goto(base+'/gateway'+route);
   const active=page.locator('[data-nav="'+current+'"][aria-current="page"]:visible');
   await active.waitFor();
   assert.deepEqual(await navLabels(),siteLinks,'same guest navigation on '+route);
   if(current==='account'){
    const colors=await active.evaluate(link=>{const style=getComputedStyle(link);return [style.color,style.backgroundColor];});
    assert.deepEqual(colors,['rgb(255, 255, 255)','rgb(166, 71, 32)'],'active signup keeps white text on its filled background');
   }
   assert.ok(await page.getByRole('navigation',{name:'页脚导航'}).getByRole('link',{name:'隐私与数据说明'}).isVisible());
   if(current==='clips'){
    await page.getByRole('button',{name:'登录查看收藏'}).waitFor();
    assert.match(await page.title(),/^随意摘/);
    await page.locator('#study-text-tab').click();
    await page.locator('[data-nav="study"][aria-current="page"]').waitFor();
   }
   if(current==='account'||current==='study'){
    await navigation.getByRole('link',{name:'登录账号'}).click();
    await page.getByRole('dialog',{name:'登录账号'}).waitFor();
    assert.ok(await page.locator('#login-dialog').getByRole('link',{name:'免费注册'}).isVisible());
    if(current==='account')await page.screenshot({path:path.join(previews,'login.png'),animations:'disabled'});
    await page.locator('[data-close-login]').click();
   }
   for(const width of [320,390,768,1024,1440]){
    await page.setViewportSize({width,height:880});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'site fits '+route+' at '+width);
   }
  }
  await page.goto(base+'/gateway/');
  await page.getByRole('link',{name:'我的问答',exact:true}).click();await page.waitForURL(/\/gateway\/study$/);
  await page.getByRole('button',{name:'登录查看问答'}).click();await page.locator('#login-name').fill(setup.demo.username);await page.locator('#login-password').fill('incorrect-preview-password');await page.locator('#login-submit').click();await page.getByText('账号或密码不正确，请核对后重试。',{exact:true}).waitFor();
  await page.locator('#login-password').fill(setup.demo.password);await page.locator('#login-submit').click();await page.locator('#study-workspace').waitFor({state:'visible'});await page.locator('.conversation-item').nth(1).waitFor();
  const token=await page.evaluate(()=>sessionStorage.getItem('gateway-web-session'));assert.ok(token);assert.equal(await page.locator('#login-password').inputValue(),'');
  await page.locator('#study-search').fill('动量');assert.equal(await page.locator('.conversation-item').count(),1);await page.locator('.conversation-item button').first().click();await page.locator('#reader-content').waitFor({state:'visible'});assert.match(await page.locator('#reader-messages').innerText(),/动能未必守恒/);
  const me=await context.request.get(base+'/gateway/v1/me',{headers:{Authorization:'Bearer '+token,'X-App-Id':'zhiyun-subtitles'}});assert.equal(me.status(),200);const profile=await me.json();assert.equal(profile.membership.plan,'free');assert.equal(profile.usage.requests,0,'web reading consumes no AI calls');
  await page.locator('#study-search').fill('');await page.screenshot({path:path.join(previews,'same-origin-real-backend-desktop-preview.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(previews,'same-origin-real-backend-mobile-preview.png'),fullPage:true});
  await page.goto(base+'/gateway/account?tab=recharge');await page.locator('#account-member').waitFor({state:'visible'});assert.match(await page.locator('#member-plan').innerText(),/基础免费/);await page.locator('#channel-closed').waitFor();assert.ok(await page.locator('#channel-open').isHidden());
  await page.getByRole('link',{name:'我的问答',exact:true}).click();await page.locator('.conversation-item').nth(1).waitFor();await page.locator('.conversation-item button').first().click();await page.locator('#reader-content').waitFor({state:'visible'});await page.locator('#conversation-delete').click();await page.locator('#delete-confirm').click();await page.getByText('已删除网页保存的问答。',{exact:true}).waitFor();assert.equal(await page.locator('.conversation-item').count(),1);
  await page.locator('[data-logout]').click();await page.locator('#study-guest').waitFor({state:'visible'});await page.waitForFunction(()=>!sessionStorage.getItem('gateway-web-session'));await page.waitForTimeout(150);
  const expired=await context.request.get(base+'/gateway/v1/study/conversations',{headers:{Authorization:'Bearer '+token,'X-App-Id':'zhiyun-subtitles'}});assert.equal(expired.status(),401);
  assert.equal(await page.locator('#reader-messages').innerText(),'');assert.equal(requests.filter(url=>!url.startsWith(base)).length,0,'the whole flow stays on the original-site origin');assert.deepEqual(errors,[]);
  // The production signup UI, same-origin routes and validators use only a test inbox.
  await page.setViewportSize({width:1440,height:860});
  await page.goto(base+'/gateway/');
  const signup=page.getByRole('link',{name:'免费注册',exact:true});
  await signup.waitFor();
  assert.equal(await page.locator('.account-services a[href$="tab=recharge"]').isVisible(),false);
  await page.screenshot({path:path.join(previews,'homepage.png')});
  await signup.click();
  await page.waitForURL(base+'/gateway/account?tab=register');
  await page.locator('#email-registration').waitFor();
  assert.equal(await page.locator('#register-verify-step').isVisible(),false);
  assert.equal(await page.getByRole('link',{name:/充值/}).count(),0);
  await page.screenshot({path:path.join(previews,'registration.png'),fullPage:true});
  for(const width of [320,390,768,960]){
   await page.setViewportSize({width,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'registration fits '+width);
   if(width===390)await page.screenshot({path:path.join(previews,'registration-mobile.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:860});
  const email='learner@example.test',password='LocalExample2026';
  await page.locator('#register-email').fill(email);
  const mail=once(inbox,'line');
  await page.locator('#register-email').press('Enter');
  await page.locator('#register-verify-step').waitFor();
  const sent=JSON.parse((await mail)[0]);
  assert.equal(sent.email,email);
  assert.match(sent.code,/^\d{6}$/);
  assert.match(await page.locator('#register-resend').innerText(),/秒后可重发/);
  assert.equal(await page.locator('#register-resend').isDisabled(),true);
  assert.equal(await page.locator('#register-code').evaluate(node=>node===document.activeElement),true);
  await page.screenshot({path:path.join(previews,'verification.png'),fullPage:true});
  await page.locator('#register-edit').click();
  assert.equal(await page.locator('#register-email-step').isVisible(),true);
  assert.equal(await page.locator('#register-email').inputValue(),email);
  await page.locator('#register-send').click();
  await page.locator('#register-verify-step').waitFor();
  assert.equal(requests.filter(url=>url.endsWith('/v1/auth/register-code')).length,1,'editing the same email can resume without a duplicate code');
  await page.locator('#register-code').fill(String((Number(sent.code)+1)%1000000).padStart(6,'0'));
  await page.locator('#register-password').fill(password);
  await page.locator('#register-submit').click();
  await page.locator('#register-status.error').waitFor();
  assert.equal(await page.locator('#register-verify-step').isVisible(),true);
  await page.locator('#register-code').fill(sent.code);
  await page.locator('#register-submit').click();
  await page.locator('#login-dialog').waitFor();
  assert.equal(await page.locator('#login-name').inputValue(),email);
  assert.equal(await page.locator('#login-password').inputValue(),'');
  await page.locator('[data-close-login]').click();
  await page.getByRole('heading',{name:'账号创建成功'}).waitFor();
  await page.locator('#register-success').click();
  await page.locator('#login-dialog').waitFor();
  assert.equal(await page.locator('#login-name').inputValue(),email);
  await page.locator('#login-password').fill(password);
  await page.locator('#login-submit').click();
  await page.locator('#account-member').waitFor({timeout:10000}).catch(async error=>{
   const login=await page.evaluate(()=>({
    open:document.getElementById('login-dialog').open,
    status:document.getElementById('login-status').textContent,
    hasPassword:!!document.getElementById('login-password').value,
    requiredFields:[...document.querySelectorAll('#portal-login-form input:invalid')].map(input=>input.id),
   }));
   throw Error(error.message+'\n'+JSON.stringify({login,errors,lastRequests:requests.slice(-5)}));
  });
  assert.equal(await page.locator('#email-registration').isVisible(),false);
  assert.match(await page.locator('#member-plan').innerText(),/基础免费/);
  assert.match(await page.locator('#member-quota').innerText(),/0 次/);
  assert.equal(await page.getByText('本月未分配额度',{exact:true}).count(),3);
  assert.equal(await page.locator('#member-quota progress').count(),0);
  const sampleUsage={month:'2026-11',request_limit:100,requests:22,audio_limit:3600,audio_seconds:1084,translation_limit:10000,translation_chars:1800};
  let example=sampleUsage;
  let expiredExample=false;
  const quotaFixture=async route=>{
   const response=await route.fetch();
   const original=await response.json();
   await route.fulfill({response,json:{...original,username:'示例同学',membership:expiredExample?{plan:'trial',state:'expired',expires:Date.UTC(2026,10,1)/1000}:{plan:'trial',state:'trial',expires:Date.UTC(2026,11,23)/1000},usage:example}});
  };
  await page.route('**/gateway/v1/me',quotaFixture);
  await page.reload();
  await page.locator('#member-name').filter({hasText:'示例同学'}).waitFor();
  assert.match(await page.locator('#member-plan').innerText(),/免费体验/);
  assert.match(await page.locator('#member-period').innerText(),/2026 年 11 月/);
  assert.deepEqual(await page.locator('#member-quota progress').evaluateAll(bars=>bars.map(bar=>[bar.value,bar.max])),[[78,100],[2516,3600],[8200,10000]]);
  assert.match(await page.locator('#member-quota').innerText(),/41 分钟 56 秒/);
  await page.screenshot({path:path.join(previews,'quota.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(previews,'quota-mobile.png'),fullPage:true});
  example={...sampleUsage,requests:139,translation_limit:null};
  expiredExample=true;
  await page.reload();
  await page.locator('#member-plan').filter({hasText:'已到期'}).waitFor();
  assert.equal(await page.getByText('本月额度已用完',{exact:true}).count(),1);
  assert.equal(await page.getByText('暂无法核对',{exact:true}).count(),1);
  await page.unroute('**/gateway/v1/me',quotaFixture);
  await page.locator('#member-recharge').click();
  await page.waitForURL(base+'/gateway/account?tab=recharge');
  await page.locator('#channel-closed').waitFor();
  await page.goto(base+'/gateway/');
  await page.getByRole('link',{name:'我的账号与额度'}).waitFor();
  assert.equal(await signup.isVisible(),false);
  assert.equal(await page.locator('.account-services a[href$="tab=recharge"]').isVisible(),true);
  assert.deepEqual(errors,[]);

  const reduced=await browser.newContext({reducedMotion:'reduce'}),reducedPage=await reduced.newPage();await reducedPage.goto(base+'/gateway/');assert.equal(await reducedPage.locator('html').evaluate(el=>el.classList.contains('motion-ready')),false);await reduced.close();
  const noJS=await browser.newContext({javaScriptEnabled:false}),noJSPage=await noJS.newPage();await noJSPage.goto(base+'/gateway/');assert.ok(await noJSPage.locator('h1').isVisible());assert.ok(await noJSPage.locator('.account-services h2').isVisible());await noJS.close();
  console.log('PASS: actual same-origin Python backend, shared navigation and login, two-step registration, real and sample quota states, zero-model reading/search/course/detail/delete/logout, shared account-page session, QR closed, 390px, reduced motion and no-JS fallback; '+executablePath);
 }finally{await browser?.close();fixture.stdin.end('\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
