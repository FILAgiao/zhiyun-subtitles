const assert=require('node:assert/strict'),path=require('node:path'),cp=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const gateway='https://47.77.182.216.sslip.io/gateway';
 const fixture=cp.spawn('python',['-u','-c',`import json,tempfile,threading,sys,os
from backend.public_preview import PreviewGateway,seed_preview,make_preview_server
from backend.test_clips import image
os.environ['ALLOW_EXTENSION_ORIGINS']='1'
with tempfile.TemporaryDirectory() as folder:
 g=PreviewGateway(folder+'/auth.sqlite');demo=seed_preview(g);server=make_preview_server(g);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 headers={'X-App-Id':'zhiyun-subtitles'}
 token=g.handle('POST','/v1/auth/login',headers,{'email':demo['username'],'password':demo['password']},'fixture')[2]['token'];headers['Authorization']='Bearer '+token
 g.handle('POST','/v1/study/clips',headers,{'id':'native-handoff-one','title':'原生扩展收藏直达','course':'测试课程','image':image(1000,620),'thumbnail':image(280,174)},'fixture')
 print(json.dumps({'port':server.server_port,'demo':demo,'token':token}),flush=True)
 sys.stdin.readline();server.shutdown();server.server_close();thread.join()
`],{stdio:['pipe','pipe','inherit']});let context;
 try{
  const setup=await new Promise((resolve,reject)=>{let out='';fixture.stdout.on('data',d=>{out+=d;try{resolve(JSON.parse(out.trim()));}catch{}});fixture.on('error',reject);fixture.on('exit',code=>reject(Error('Fixture exited '+code)));}),base='http://127.0.0.1:'+setup.port;
  const dir=path.resolve(process.env.ZY_TEST_EXTENSION_DIR||'dist/extension');
  context=await chromium.launchPersistentContext(path.resolve('.test-media/portal-python-edge-'+Date.now()),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1440,height:1000},args:['--disable-extensions-except='+dir,'--load-extension='+dir]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async({base,gateway,token})=>{const original=fetch;globalThis.bridgeCalls=[];globalThis.fetch=async(url,options)=>{if(!String(url).startsWith(gateway+'/v1/'))throw Error('Unexpected request');bridgeCalls.push(String(url));return original(base+'/gateway'+String(url).slice(gateway.length),options);};await chrome.storage.local.set({'gateway-account-v1':{url:gateway,token},'gateway-guide-no-remind-v2':true});},{base,gateway,token:setup.token});
  const routeErrors=[];let closing=false;await context.route(gateway+'/**',async route=>{try{const request=route.request(),u=new URL(request.url()),headers={...request.headers(),origin:base};delete headers.host;const response=await route.fetch({url:base+u.pathname+u.search,headers});await route.fulfill({response});}catch(error){if(!closing)routeErrors.push(error.message);await route.abort().catch(()=>{});}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(gateway+'/study?clip=native-handoff-one&login=1#clips');
  try{await page.waitForFunction(()=>window.ZYPortal?.session().profile?.username==='本地示例同学');}catch(error){console.log('Auth diagnostics',await page.evaluate(()=>({marker:sessionStorage.getItem('gateway-extension-auth'),hasToken:!!sessionStorage.getItem('gateway-web-session'),notice:ZYPortal.session().notice})),await worker.evaluate(()=>bridgeCalls));throw error;}
  assert.equal(await page.locator('#login-dialog').evaluate(d=>d.open),false);
  await page.waitForFunction(()=>document.querySelector('#clip-reader').open&&document.querySelector('#clip-full-image').naturalWidth===1000);
  const child=await page.evaluate(()=>sessionStorage.getItem('gateway-web-session'));assert.ok(child&&child!==setup.token,'website receives independent scoped token');
  assert.equal(await page.locator('#clip-reader-title').textContent(),'原生扩展收藏直达');
  await page.locator('#clip-close').click();await page.locator('[data-logout]').first().click();await page.waitForFunction(()=>!window.ZYPortal.session().profile);
  const me=await fetch(base+'/gateway/v1/me',{headers:{'X-App-Id':'zhiyun-subtitles',Authorization:'Bearer '+setup.token}});assert.equal(me.status,200,'website logout retains extension session');
  await page.goto(gateway+'/account?tab=recharge&login=1');await page.waitForFunction(()=>window.ZYPortal?.session().profile);assert.equal(await page.locator('#login-dialog').evaluate(d=>d.open),false);
  assert.equal((await worker.evaluate(()=>bridgeCalls.filter(url=>url.endsWith('/v1/auth/web-session')).length)),2);
  const out=await fetch(base+'/gateway/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-App-Id':'zhiyun-subtitles',Authorization:'Bearer '+setup.token},body:'{}'});assert.equal(out.status,200);
  await page.goto(gateway+'/study#clips');await page.waitForFunction(()=>window.ZYPortal);await page.evaluate(()=>ZYPortal.ready);assert.equal(await page.evaluate(()=>!!ZYPortal.session().profile),false,'revoked parent cannot silently log in');
  assert.deepEqual(routeErrors,[]);assert.deepEqual(errors,[]);closing=true;console.log('PASS: real Edge MV3 + actual Python scoped sessions + query/hash saved-image deep link; automatic login, account page, independent logout and expired-parent fallback. No production account/model calls.');
 }finally{await context?.close();fixture.stdin.end('\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
