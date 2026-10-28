'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const BASE='https://47.77.182.216.sslip.io',WEB='isolated-website-session',EXT='extension-private-fixture-token';
(async()=>{
 const root=path.resolve('.test-media/portal-auth-'+Date.now()),extension=path.join(root,'extension');fs.mkdirSync(extension,{recursive:true});
 for(const file of ['background.js','portal-bridge.js'])fs.copyFileSync(path.join('extension',file),path.join(extension,file));
 fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Portal auth regression',version:'1.0.0',permissions:['storage','contextMenus'],host_permissions:[BASE+'/*'],background:{service_worker:'background.js'},action:{},commands:{'zy-capture-page':{description:'截图回归'}},content_scripts:[{matches:[BASE+'/gateway/*'],js:['portal-bridge.js'],run_at:'document_start'}]}));
 const context=await chromium.launchPersistentContext(path.join(root,'profile'),{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:20000});
  await worker.evaluate(async({BASE,WEB,EXT})=>{
   await chrome.storage.local.set({'gateway-account-v1':{url:BASE+'/gateway',token:EXT}});globalThis.handoffs=[];
   globalThis.fetch=async(url,options)=>{handoffs.push({url,authorization:options.headers.Authorization});if(url!==BASE+'/gateway/v1/auth/web-session'||options.headers.Authorization!=='Bearer '+EXT)throw Error('Unpinned handoff');await new Promise(resolve=>setTimeout(resolve,220));return new Response(JSON.stringify({token:WEB}),{headers:{'Content-Type':'application/json'}});};
  },{BASE,WEB,EXT});
  const calls=[],errors=[];
  await context.route(BASE+'/gateway/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname.startsWith('/gateway/v1/')){
    calls.push({url:url.pathname,auth:request.headers().authorization});const reply=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname.endsWith('/account/access'))return reply({registration:{enabled:false},recharge:{enabled:false}});
    assert.equal(request.headers().authorization,'Bearer '+WEB);
    if(url.pathname.endsWith('/me'))return reply({id:42,username:'已登录插件账号',email:'isolated@example.test',membership:{plan:'free'},usage:{requests:0,request_limit:0}});
    if(url.pathname.endsWith('/clips')||url.pathname.endsWith('/conversations'))return reply({items:[],next_offset:null});
    if(url.pathname.endsWith('/auth/logout'))return reply({ok:true});return route.fulfill({status:404,body:'{}'});
   }
   let name=url.pathname.slice('/gateway/'.length);if(name==='study'||name==='account')name+='.html';const file=path.join(__dirname,'backend',name);
   if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return route.fulfill({status:404,body:''});
   return route.fulfill({status:200,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/png',body:fs.readFileSync(file)});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const target of ['study?login=1#clips','account?login=1']){
   await page.goto(BASE+'/gateway/'+target);try{await page.waitForFunction(()=>window.ZYPortal?.session().profile?.id===42,{},{timeout:15000});}catch(error){console.error('Native handoff diagnostic',JSON.stringify({target,state:await page.evaluate(()=>({storage:Object.entries(sessionStorage),portal:!!window.ZYPortal,notice:window.ZYPortal?.session().notice,href:location.href})),worker:await worker.evaluate(async()=>({handoffs:globalThis.handoffs,listening:chrome.runtime.onMessage.hasListeners(),session:!!(await chrome.storage.local.get('gateway-account-v1'))['gateway-account-v1'],tabs:await chrome.tabs.query({})})),calls,errors}));throw error;}
   assert.equal(await page.locator('#login-dialog').evaluate(dialog=>dialog.open),false);
   const entries=await page.evaluate(()=>Object.entries(sessionStorage));assert.ok(!JSON.stringify(entries).includes(EXT),'extension credential must remain outside the page world');assert.equal(await page.evaluate(()=>sessionStorage.getItem('gateway-web-session')),WEB);
  }
  assert.equal(await worker.evaluate(()=>handoffs.length),2);assert.equal(calls.filter(call=>call.url.endsWith('/auth/login')).length,0);assert.deepEqual(errors,[]);
  await page.locator('[data-logout]').first().click();await page.waitForFunction(()=>!window.ZYPortal.session().profile);
  assert.equal(await worker.evaluate(()=>chrome.storage.local.get('gateway-account-v1').then(saved=>saved['gateway-account-v1'].token)),EXT);
  console.log('Native MV3 portal handoff passed: isolated document_start bridge, delayed background request, both official pages, scoped page session and independent logout.');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
