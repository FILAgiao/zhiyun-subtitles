const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),origin='https://47.77.182.216.sslip.io';
 try{
  for(const logout of [false,true]){
   const context=await browser.newContext(),errors=[];
   await context.addInitScript({content:`window.chrome={runtime:{sendMessage(message,callback){window.finishBridge=()=>callback({ok:true,token:'automatic-extension-web-session'});}}};\n`+fs.readFileSync('extension/portal-bridge.js','utf8')});
   await context.route(origin+'/gateway/**',async route=>{
    const req=route.request(),u=new URL(req.url()),reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    if(u.pathname.includes('/v1/')){
     if(u.pathname.endsWith('/auth/login'))return reply({token:'manual-user-web-session'});
     if(u.pathname.endsWith('/me')){assert.equal(req.headers().authorization,'Bearer manual-user-web-session');return reply({id:99,username:'手动选择账号',email:'manual@example.test'});}
     if(u.pathname.endsWith('/auth/logout'))return reply({ok:true});
     if(u.pathname.endsWith('/conversations')||u.pathname.endsWith('/clips'))return reply({items:[],next_offset:null});
     return reply({});
    }
    let name=u.pathname.slice('/gateway/'.length);if(name==='study')name+='.html';const file=path.join('backend',name);if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return route.fulfill({status:404,body:''});
    return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/png',body:fs.readFileSync(file)});
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/gateway/study#clips');
   await page.waitForFunction(()=>window.ZYPortal&&window.finishBridge);
   await page.locator('[data-login]').first().click();await page.locator('#login-name').fill('manual@example.test');await page.locator('#login-password').fill('fixture-password');await page.locator('#login-submit').click();await page.waitForFunction(()=>ZYPortal.session().profile?.id===99);
   if(logout){await page.locator('[data-logout]').first().click();await page.waitForFunction(()=>!ZYPortal.session().profile);}
   await page.evaluate(async()=>{finishBridge();await ZYPortal.ready;});
   assert.equal(await page.evaluate(()=>ZYPortal.session().profile?.id||null),logout?null:99,'late automatic handoff must preserve the manual choice');
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('gateway-web-session')),logout?null:'manual-user-web-session');assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: manual login and explicit logout during pending extension handoff survive its late result without account overwrite.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
