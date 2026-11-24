const assert=require('node:assert/strict'),path=require('node:path'),cp=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const gateway='https://47.77.182.216.sslip.io/gateway';
 const fixture=cp.spawn('python',['-u','-c',`import json,tempfile,threading,sys,os
from backend.public_preview import PreviewGateway,seed_preview,make_preview_server
from backend.server import Gateway
from backend.test_clips import image
os.environ['ALLOW_EXTENSION_ORIGINS']='1'
class SessionPreview(PreviewGateway):
 def handle(self,method,path,headers,body,ip,stream_sink=None):
  if path.split('?',1)[0] in ('/v1/admin/login','/v1/admin/overview','/v1/admin/analytics','/v1/admin/logout'):
   return Gateway.handle(self,method,path,headers,body,ip,stream_sink)
  return super().handle(method,path,headers,body,ip,stream_sink)
with tempfile.TemporaryDirectory() as folder:
 g=SessionPreview(folder+'/auth.sqlite');g.study_mailer=lambda *_:None;demo=seed_preview(g);g.add_user('fixture-admin@example.test','fixture-only-admin-password','zhiyun-subtitles',username='后台测试管理员',admin=True);server=make_preview_server(g);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 headers={'X-App-Id':'zhiyun-subtitles'}
 token=g.handle('POST','/v1/auth/login',headers,{'email':demo['username'],'password':demo['password']},'fixture')[2]['token'];headers['Authorization']='Bearer '+token
 g.handle('POST','/v1/study/clips',headers,{'id':'native-handoff-one','title':'原生扩展收藏直达','course':'测试课程','image':image(1000,620),'thumbnail':image(280,174)},'fixture')
 print(json.dumps({'port':server.server_port,'demo':demo,'token':token}),flush=True)
 sys.stdin.readline();server.shutdown();server.server_close();thread.join()
`],{stdio:['pipe','pipe','inherit']});let context;
 try{
  const setup=await new Promise((resolve,reject)=>{let out='';fixture.stdout.on('data',d=>{out+=d;try{resolve(JSON.parse(out.trim()));}catch{}});fixture.on('error',reject);fixture.on('exit',code=>reject(Error('Fixture exited '+code)));}),base='http://127.0.0.1:'+setup.port;
  const dir=path.resolve(process.env.ZY_TEST_EXTENSION_DIR||'dist/extension');
  context=await chromium.launchPersistentContext(path.resolve('.test-media/portal-python-edge-'+Date.now()),{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1440,height:1000},args:['--disable-extensions-except='+dir,'--load-extension='+dir]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async({base,gateway,token})=>{const original=fetch;globalThis.bridgeCalls=[];globalThis.fetch=async(url,options)=>{if(!String(url).startsWith(gateway+'/v1/'))throw Error('Unexpected request');bridgeCalls.push(String(url));return original(base+'/gateway'+String(url).slice(gateway.length),options);};await chrome.storage.local.set({'gateway-account-v1':{url:gateway,token},'gateway-guide-no-remind-v2':true});},{base,gateway,token:setup.token});
  const routeErrors=[];let closing=false;await context.route(gateway+'/**',async route=>{try{const request=route.request(),u=new URL(request.url()),headers={...request.headers(),origin:base};delete headers.host;const response=await route.fetch({url:base+u.pathname+u.search,headers});await route.fulfill({response});}catch(error){if(!closing)routeErrors.push(error.message);await route.abort().catch(()=>{});}});
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  const count=path=>requests.filter(url=>url==='/gateway'+path).length;
  await page.goto(gateway+'/');
  await page.getByRole('link',{name:'我的账号与额度'}).filter({hasText:'本地示例同学'}).waitFor();
  const originalChild=await page.evaluate(()=>localStorage.getItem('gateway-web-session'));
  assert.ok(originalChild&&originalChild!==setup.token);
  await page.reload();
  await page.getByRole('link',{name:'我的账号与额度'}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('gateway-web-session')),originalChild);
  const revoked=await fetch(base+'/gateway/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-App-Id':'zhiyun-subtitles',Authorization:'Bearer '+originalChild},body:'{}'});
  assert.equal(revoked.status,200);
  await page.evaluate(()=>{const key='gateway-web-verified-profile',profile=JSON.parse(sessionStorage.getItem(key));sessionStorage.setItem(key,JSON.stringify({...profile,time:Date.now()-61000}));});
  await page.reload();
  await page.getByRole('link',{name:'我的账号与额度'}).waitFor();
  assert.notEqual(await page.evaluate(()=>localStorage.getItem('gateway-web-session')),originalChild);
  await page.goto(gateway+'/study?clip=native-handoff-one&login=1#clips');
  try{await page.waitForFunction(()=>window.ZYPortal?.session().profile?.username==='本地示例同学');}catch(error){console.log('Auth diagnostics',await page.evaluate(()=>({marker:sessionStorage.getItem('gateway-extension-auth'),hasToken:!!sessionStorage.getItem('gateway-web-session'),notice:ZYPortal.session().notice})),await worker.evaluate(()=>bridgeCalls));throw error;}
  assert.equal(await page.locator('#login-dialog').evaluate(d=>d.open),false);
  await page.waitForFunction(()=>document.querySelector('#clip-reader').open&&document.querySelector('#clip-full-image').naturalWidth===1000);
  const child=await page.evaluate(()=>sessionStorage.getItem('gateway-web-session'));assert.ok(child&&child!==setup.token,'website receives independent scoped token');
  assert.equal(await page.locator('#clip-reader-title').textContent(),'原生扩展收藏直达');
  await page.locator('#clip-close').click();await page.locator('[data-logout]').first().click();await page.waitForFunction(()=>!window.ZYPortal.session().profile);
  const me=await fetch(base+'/gateway/v1/me',{headers:{'X-App-Id':'zhiyun-subtitles',Authorization:'Bearer '+setup.token}});assert.equal(me.status,200,'website logout retains extension session');
  await page.goto(gateway+'/account?tab=recharge&login=1');await page.waitForFunction(()=>window.ZYPortal);await page.evaluate(()=>ZYPortal.ready);assert.equal(await page.evaluate(()=>!!ZYPortal.session().profile),false,'explicit website logout must survive navigation');assert.equal(await page.locator('#login-dialog').evaluate(d=>d.open),true);
  assert.equal((await worker.evaluate(()=>bridgeCalls.filter(url=>url.endsWith('/v1/auth/web-session')).length)),2);
  const out=await fetch(base+'/gateway/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-App-Id':'zhiyun-subtitles',Authorization:'Bearer '+setup.token},body:'{}'});assert.equal(out.status,200);
  await page.goto(gateway+'/study#clips');await page.waitForFunction(()=>window.ZYPortal);await page.evaluate(()=>ZYPortal.ready);assert.equal(await page.evaluate(()=>!!ZYPortal.session().profile),false,'revoked parent cannot silently log in');
  const accountKey='gateway-account-v1';
  await worker.evaluate(key=>chrome.storage.local.remove(key),accountKey);
  await page.goto(gateway+'/');
  const registrationChecks=count('/v1/study/capabilities');
  const started=Date.now();
  await page.getByRole('link',{name:'免费注册',exact:true}).first().click();
  await page.locator('#register-email').waitFor({state:'visible'});
  const registrationMs=Date.now()-started;
  assert.equal(count('/v1/study/capabilities'),registrationChecks,'registration consumes the document readiness marker');
  await page.locator('[data-login]').first().click();
  await page.locator('#login-name').fill(setup.demo.username);
  await page.locator('#login-password').fill(setup.demo.password);
  await page.locator('#login-submit').click();
  await page.getByRole('link',{name:'我的账号与额度'}).filter({hasText:'本地示例同学'}).waitFor();
  const websiteToken=await page.evaluate(()=>localStorage.getItem('gateway-web-session'));
  const waitForAddon=tokenPresent=>worker.evaluate(async({key,tokenPresent})=>{
   const deadline=Date.now()+5000;
   do{
    const account=(await chrome.storage.local.get(key))[key];
    if(Boolean(account?.token)===tokenPresent)return account;
    await new Promise(resolve=>setTimeout(resolve,50));
   }while(Date.now()<deadline);
   throw Error('Extension account storage did not update');
  },{key:accountKey,tokenPresent});
  const addon=await waitForAddon(true);
  assert.ok(addon.websiteLink&&addon.token!==websiteToken,'official site authorizes an independent extension credential');
  const addonRequest=credential=>fetch(base+'/gateway/v1/me',{headers:{'X-App-Id':'zhiyun-subtitles',Authorization:'Bearer '+credential}});
  assert.equal((await addonRequest(addon.token)).status,200);
  const meBefore=count('/v1/me');
  const extensionMeCount=()=>worker.evaluate(()=>bridgeCalls.filter(url=>url.endsWith('/v1/me')).length);
  const extensionMeBefore=await extensionMeCount();
  for(const location of ['/','/study','/account?tab=recharge','/download']){
   await page.goto(gateway+location);
   await page.getByRole('link',{name:'我的账号与额度'}).filter({hasText:'本地示例同学'}).waitFor();
  }
  assert.equal(count('/v1/me'),meBefore,'four new page loads reuse the fresh same-tab profile');
  assert.equal(await extensionMeCount(),extensionMeBefore,'extension does not run duplicate profile checks on official pages before use');
  assert.equal(await worker.evaluate(()=>bridgeCalls.filter(url=>url.endsWith('/v1/auth/extension-session')).length),1);
  await context.route('https://interactivemeta.cmc.zju.edu.cn/**',route=>route.fulfill({contentType:'text/html',body:'<div id="player"><video></video></div><div id="pane-voice"></div>'}));
  const course=await context.newPage();
  await course.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=fixture&sub_id=1');
  const accountPanel=course.locator('#zy-subtitle-host');
  await accountPanel.locator('#account-open').evaluate(button=>button.click());
  await accountPanel.locator('#gateway-member').waitFor({state:'visible'});
  const pluginLogout=await extensionMeCount();
  assert.ok(pluginLogout>extensionMeBefore,'extension still verifies the account on the classroom page');
  await accountPanel.locator('#gateway-logout').click();
  await waitForAddon(false);
  await page.reload();
  await page.getByRole('link',{name:'我的账号与额度'}).filter({hasText:'本地示例同学'}).waitFor();
  assert.equal((await waitForAddon(false)).websiteSyncDisabled,true,'explicit extension logout stops automatic adoption');
  const websitePageEvent=context.waitForEvent('page');
  await accountPanel.locator('#gateway-website-login').click();
  const websitePage=await websitePageEvent;
  await websitePage.waitForURL(gateway+'/account?tab=register&login=1');
  const restored=await waitForAddon(true);
  assert.notEqual(restored.token,addon.token);
  assert.equal((await addonRequest(restored.token)).status,200);
  await accountPanel.locator('#gateway-member').waitFor({state:'visible'});
  assert.equal(await websitePage.locator('#login-dialog').evaluate(dialog=>dialog.open),false,'website reuses the existing sign-in');
  const adminPage=await context.newPage(),adminPaths=[];
  adminPage.on('pageerror',error=>errors.push(error.message));
  adminPage.on('request',request=>adminPaths.push(new URL(request.url()).pathname));
  await adminPage.goto(gateway+'/admin');
  await adminPage.locator('#login-panel').waitFor({state:'visible'});
  assert.equal(adminPaths.some(p=>p.includes('/v1/')),false,'the regular website session never starts an admin session');
  const signInAdmin=async()=>{
   await adminPage.locator('#login-name').fill('fixture-admin@example.test');
   await adminPage.locator('#login-password').fill('fixture-only-admin-password');
   await adminPage.locator('#login-button').click();
   await adminPage.locator('#who').filter({hasText:'后台测试管理员'}).waitFor({state:'visible'});
  };
  await signInAdmin();
  const firstAdmin=await adminPage.evaluate(()=>sessionStorage.getItem('gateway-admin-session'));
  assert.ok(firstAdmin&&firstAdmin!==websiteToken&&firstAdmin!==restored.token);
  assert.equal(await adminPage.evaluate(()=>localStorage.getItem('gateway-web-session')),websiteToken);
  assert.equal(adminPaths.filter(p=>p.endsWith('/v1/admin/overview')).length,1);
  assert.equal(adminPaths.filter(p=>p.endsWith('/v1/me')).length,0);
  await adminPage.reload();
  await adminPage.locator('#who').filter({hasText:'后台测试管理员'}).waitFor({state:'visible'});
  assert.equal(await adminPage.evaluate(()=>sessionStorage.getItem('gateway-admin-session')),firstAdmin);
  const adminLogout=adminPage.waitForResponse(response=>response.url()===gateway+'/v1/admin/logout');
  await adminPage.locator('#logout').click();
  assert.equal((await adminLogout).status(),200);
  assert.equal(await page.evaluate(()=>localStorage.getItem('gateway-web-session')),websiteToken);
  assert.equal((await waitForAddon(true)).token,restored.token);
  await signInAdmin();
  const done=page.waitForResponse(response=>response.url()===gateway+'/v1/auth/logout');
  await page.locator('[data-logout]').first().click();
  assert.equal((await done).status(),200);
  await waitForAddon(false);
  assert.equal((await addonRequest(restored.token)).status,401);
  await accountPanel.locator('#gateway-login-form').waitFor({state:'visible'});
  const adminRefresh=adminPage.waitForResponse(response=>response.url()===gateway+'/v1/admin/overview');
  await adminPage.locator('#refresh').click();
  assert.equal((await adminRefresh).status(),200,'website logout does not revoke the admin session');
  await adminPage.locator('#who').filter({hasText:'后台测试管理员'}).waitFor({state:'visible'});
  assert.deepEqual(routeErrors,[]);assert.deepEqual(errors,[]);closing=true;
  console.log(`PASS: real MV3 and Python gateway; registration input in ${registrationMs} ms locally with zero capability requests; four navigations with zero additional /v1/me requests; bidirectional scoped login and logout; separate administrator identity and logout in both directions.`);
 }finally{await context?.close();fixture.stdin.end('\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
