const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const dir=path.resolve(process.env.ZY_TEST_EXTENSION_DIR||'dist/extension'),context=await chromium.launchPersistentContext(path.resolve('.test-media/account-transport-'+Date.now()),{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--disable-extensions-except='+dir,'--load-extension='+dir]});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{
   globalThis.fixtureMode='offline';globalThis.loginPosts=0;
   globalThis.fetch=async url=>{
    const profile={username:'慢连接测试',membership:{plan:'pro',active:true},permissions:{learning:true,translation:true,speech:true},usage:{requests:0,request_limit:20,audio_seconds:0,audio_limit:60}};
    if(url.endsWith('/auth/login')){loginPosts++;if(fixtureMode==='offline')throw Error('fixture offline');await new Promise(r=>setTimeout(r,16500));return new Response(JSON.stringify({...profile,token:'fixture-session'}));}
    if(url.endsWith('/me'))return new Response(JSON.stringify(profile));
    if(url.endsWith('/activity')||url.endsWith('/auth/logout'))return new Response('{}');
    throw Error('Fixture blocks all other network requests');
   };
   await chrome.storage.local.set({'gateway-account-v1':{url:'https://47.77.182.216.sslip.io/gateway',token:''},'gateway-guide-no-remind-v2':true,'cache-auto':false});
  });
  await context.route('https://public.example/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Slow account connection fixture</h1>'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://public.example/');const ui=page.locator('#zy-subtitle-host');await ui.locator('#account-open').evaluate(n=>n.click());
  await ui.locator('#gateway-email').fill('fixture-account');await ui.locator('#gateway-password').fill('fixture-password');await ui.locator('#gateway-login').click();await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-status').dataset.error==='true');
  assert.match(await ui.locator('#gateway-status').textContent(),/无法连接服务/);assert.equal(await ui.locator('#gateway-login').isEnabled(),true);
  await worker.evaluate(()=>globalThis.fixtureMode='slow');const start=Date.now();await ui.locator('#gateway-login').click();await page.waitForTimeout(15500);
  assert.equal(await ui.locator('#gateway-login-form').isVisible(),true);assert.equal(await ui.locator('#gateway-login').isDisabled(),true);assert.match(await ui.locator('#gateway-status').textContent(),/正在登录/);
  await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-login-form').hidden,{},{timeout:10000});
  await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-status').textContent==='额度已更新');assert.equal(await ui.locator('#gateway-password').inputValue(),'');assert.equal(await worker.evaluate(()=>loginPosts),2);
  console.log('Slow login completed in '+(Date.now()-start)+' ms; one POST per manual attempt.');await ui.locator('#settings-card').screenshot({path:'.test-media/account-transport-slow-success.png'});
  await ui.locator('#gateway-logout').click();await page.waitForFunction(()=>!document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-login-form').hidden);assert.deepEqual(errors,[]);
  console.log('PASS: real MV3 network failure retry, 16.5 second login survives the old deadline, usage, password clearing and logout; cloud APIs simulated.');
 }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
