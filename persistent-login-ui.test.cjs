'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const ORIGIN='https://47.77.182.216.sslip.io',TOKEN='persistent-fixture-session',KEY='gateway-web-session';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ZY_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});let context;
 const errors=[],calls=[];let offline=false;
 async function setup(storageState){
  const c=await browser.newContext({storageState});
  c.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  await c.addInitScript({content:`window.bridgeCalls=0;window.chrome={runtime:{sendMessage(message,callback){window.bridgeCalls++;callback({ok:true,token:''});}}};\n`+fs.readFileSync('extension/portal-bridge.js','utf8')});
  await c.route(ORIGIN+'/gateway/**',async route=>{
   const request=route.request(),u=new URL(request.url()),reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(u.pathname.includes('/v1/')){
    calls.push(u.pathname);
    if(u.pathname.endsWith('/account/access'))return reply({registration:{enabled:false},recharge:{enabled:false}});
    if(u.pathname.endsWith('/auth/login'))return reply({token:TOKEN,expires_in:null,persistent:true});
    assert.equal(request.headers().authorization,'Bearer '+TOKEN);
    if(u.pathname.endsWith('/me'))return offline?reply({error:'暂时不可用'},503):reply({id:42,username:'持久登录同学',email:'persistent@example.test',is_admin:false,usage:{month:'2026-11',requests:0,request_limit:100,audio_seconds:0,audio_limit:100},membership:{plan:'free'}});
    if(u.pathname.endsWith('/conversations')||u.pathname.endsWith('/clips'))return reply({items:[],next_offset:null});
    if(u.pathname.endsWith('/history'))return reply({calls:[],sessions:[{username:'持久登录同学',app:'zhiyun-subtitles',client:'study-web',started:Date.now()/1000,last_seen:Date.now()/1000,ended:null,expires:null}]});
    if(u.pathname.endsWith('/auth/logout'))return reply({ok:true});
    return reply({});
   }
   let name=u.pathname.slice('/gateway/'.length);if(['study','account','admin'].includes(name))name+='.html';const file=path.join(__dirname,'backend',name);
   if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/png',body:fs.readFileSync(file)});
  });return c;
 }
 try{
  context=await setup();let page=await context.newPage();await page.goto(ORIGIN+'/gateway/study?login=1');
  await page.locator('#login-name').fill('persistent@example.test');await page.locator('#login-password').fill('fixture-password');await page.locator('#login-submit').click();await page.waitForFunction(()=>ZYPortal.session().profile?.id===42);
  assert.equal(await page.evaluate(()=>localStorage.getItem('gateway-web-session')),TOKEN);
  const saved=await context.storageState();await context.close();context=await setup(saved);
  page=await context.newPage();await page.goto(ORIGIN+'/gateway/study');await page.waitForFunction(()=>ZYPortal.session().profile?.id===42);assert.equal(await page.evaluate(()=>bridgeCalls),0,'persistent website login needs no fresh extension handoff');
  const second=await context.newPage();await second.goto(ORIGIN+'/gateway/account');await second.waitForFunction(()=>ZYPortal.session().profile?.id===42);
  const admin=await context.newPage();await admin.goto(ORIGIN+'/gateway/admin');await admin.locator('#dashboard').waitFor({state:'visible'});assert.match(await admin.locator('#sessions-body').textContent(),/最近 90 秒活跃/);assert.doesNotMatch(await admin.locator('#sessions-body').textContent(),/已过期/);
  offline=true;await page.reload();await page.evaluate(()=>ZYPortal.ready);assert.equal(await page.evaluate(()=>localStorage.getItem('gateway-web-session')),TOKEN,'network failure must not discard persistent credential');offline=false;
  await page.reload();await page.waitForFunction(()=>ZYPortal.session().profile?.id===42);
  await page.locator('[data-logout]').first().click();await page.waitForFunction(()=>!ZYPortal.session().profile);await second.waitForFunction(()=>!ZYPortal.session().profile);await admin.locator('#login-panel').waitFor({state:'visible'});
  await page.reload();await page.evaluate(()=>ZYPortal.ready);assert.equal(await page.evaluate(()=>!!ZYPortal.session().profile),false);assert.equal(await page.evaluate(()=>bridgeCalls),0,'explicit logout must not be undone by extension');assert.equal(await page.evaluate(()=>localStorage.getItem('gateway-web-session')),null);
  const loggedOut=await context.storageState();await context.close();context=await setup(loggedOut);page=await context.newPage();await page.goto(ORIGIN+'/gateway/account?login=1');await page.evaluate(()=>ZYPortal.ready);assert.equal(await page.evaluate(()=>!!ZYPortal.session().profile),false);assert.equal(await page.locator('#login-dialog').evaluate(d=>d.open),true);
  await page.locator('#login-name').fill('persistent@example.test');await page.locator('#login-password').fill('fixture-password');await page.locator('#login-submit').click();await page.waitForFunction(()=>ZYPortal.session().profile?.id===42);assert.equal(await page.evaluate(()=>localStorage.getItem('gateway-web-logged-out')),null);
  assert.equal(calls.filter(p=>p.endsWith('/auth/login')).length,2);assert.deepEqual(errors,[]);
  console.log('PASS: portal/admin login survives browser restart, no redundant handoff, transient failures preserve credential, logout syncs all tabs and remains logged out after restart, manual login restores persistence.');
 }finally{await context?.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
