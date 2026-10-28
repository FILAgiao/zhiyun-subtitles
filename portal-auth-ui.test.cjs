'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const BASE='https://47.77.182.216.sslip.io',WEB='fixture-scoped-website-session';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ZY_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const scenario of [{target:'study?login=1#clips'},{target:'account?tab=recharge&login=1'},{target:'study?login=1',failed:true},{target:'study?login=1',runtimeError:true},{target:'study?login=1',throws:true},{target:'study?login=1',empty:true},{target:'account?login=1',manual:true}]){
   const {target,manual}=scenario,failed=!!(scenario.failed||scenario.runtimeError||scenario.throws||scenario.empty);
   const context=await browser.newContext();const errors=[],calls=[];
   const result=scenario.failed?{ok:false,error:'handoff failed'}:{ok:true,token:manual?'':WEB};
   const init=`${failed||manual?`sessionStorage.setItem('gateway-web-session',${JSON.stringify(manual?WEB:'previous-owner-token')});`:''}window.chrome={runtime:{sendMessage(message,callback){if(message.type!=='zy-portal-session')throw Error('unexpected bridge message');${scenario.throws?`throw Error('extension unavailable');`:''}${scenario.runtimeError?`window.chrome.runtime.lastError={message:'extension unavailable'};`:''}setTimeout(()=>callback(${scenario.runtimeError||scenario.empty?'undefined':JSON.stringify(result)}),180);}}};`;
   await context.addInitScript({content:init+'\n'+fs.readFileSync('extension/portal-bridge.js','utf8')});
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.origin!==BASE)return route.abort();
    if(url.pathname.startsWith('/gateway/v1/')){
     calls.push({url:url.pathname,auth:request.headers().authorization});
     const reply=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
     if(url.pathname.endsWith('/account/access'))return reply({registration:{enabled:false},recharge:{enabled:false}});
     assert.equal(request.headers().authorization,'Bearer '+WEB,'personal reads must wait for the bridge');
     if(url.pathname.endsWith('/me'))return reply({id:42,username:'插件登录的同学',email:'handoff@example.test',membership:{plan:'free'},usage:{requests:0,request_limit:0}});
     if(url.pathname.endsWith('/conversations')||url.pathname.endsWith('/clips'))return reply({items:[],next_offset:null});
     if(url.pathname.endsWith('/auth/logout'))return reply({ok:true});
     return route.fulfill({status:404,contentType:'application/json',body:'{}'});
    }
    let name=url.pathname.slice('/gateway/'.length);if(name==='study'||name==='account')name+='.html';
    const file=path.join(__dirname,'backend',name);if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return route.fulfill({status:404,body:''});
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/png';
    return route.fulfill({status:200,contentType:type,body:fs.readFileSync(file)});
   });
   const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(BASE+'/gateway/'+target);
   if(failed){await page.waitForFunction(()=>window.ZYPortal?.session().notice);assert.equal(await page.evaluate(()=>sessionStorage.getItem('gateway-web-session')),null);assert.equal(calls.filter(call=>call.url.endsWith('/me')).length,0,'a failed account change must not read the prior owner');assert.match(await page.locator('#study-notice').textContent(),/插件登录衔接暂不可用/);assert.deepEqual(errors,[]);await context.close();continue;}
   await page.waitForFunction(()=>window.ZYPortal?.session().profile?.id===42);
   assert.equal(await page.locator('#login-dialog').evaluate(dialog=>dialog.open),false,'login=1 must not open a second login after extension handoff');
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('gateway-web-session')),WEB);
   assert.equal(await page.locator('[data-user-name]').first().textContent(),'插件登录的同学');
   assert.equal(calls.filter(call=>call.url.endsWith('/auth/login')).length,0);assert.deepEqual(errors,[]);
   await page.locator('[data-logout]').first().click();await page.waitForFunction(()=>!window.ZYPortal.session().profile);
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('gateway-web-session')),null);
   await context.close();
  }
  console.log('Portal auth UI passed: delayed bridge, personal reads, no secondary login, account page, failure isolation, manual fallback and logout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
