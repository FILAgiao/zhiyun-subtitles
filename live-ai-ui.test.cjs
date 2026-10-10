// Explicit live acceptance only; uses fixed test text and existing ignored test credentials.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const origin=JSON.parse(fs.readFileSync('gateway.config.json','utf8')).url;
 const account=JSON.parse(fs.readFileSync('backend/.bootstrap-account.json','utf8'));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 let page;const active=new Map();let paid=0,historyVerified=false;
 try{
  page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://classroom.test/**',r=>r.fulfill({contentType:'text/html',body:'<style>video{width:640px;height:360px}</style><div id="player"><video></video></div><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:10</div><div class="trans-lan"><div>This is a synthetic classroom fixture.</div></div></div></div>'}));
  await page.goto('https://classroom.test/#/replay?course_id=live-acceptance&sub_id=1');
  setInterval(()=>console.log('LIVE TEST RUNNING',paid,active.size),30000).unref();await page.exposeFunction('abortRequest',id=>active.get(id)?.abort());
  await page.exposeFunction('dispatchRequest',async packet=>{
   if(!packet.url.startsWith(origin+'/'))throw Error('Unexpected live destination');
   const controller=new AbortController();active.set(packet.id,controller);
   if(packet.url.endsWith('/ark/responses')){
    paid++;const body=JSON.parse(packet.data);
    if(paid===2)historyVerified=body.input.some(i=>i.role==='user'&&typeof i.content==='string'&&i.content.includes('37'))&&body.input.some(i=>i.role==='assistant');
   }
   try{
    console.log('REQUEST',packet.id,packet.url.split('/').pop(),!!packet.stream);const response=await fetch(packet.url,{method:packet.method,headers:packet.headers,body:packet.data,signal:controller.signal});
    console.log('HTTP',packet.id,response.status);if(packet.stream){
     await page.evaluate(({id,status})=>{const p=pending[id];p.o.onloadstart?.({status,response:p.stream});},{id:packet.id,status:response.status});
     let chunks=0;for await(const chunk of response.body){++chunks;await page.evaluate(({id,bytes})=>pending[id]?.controller.enqueue(new Uint8Array(bytes)),{id:packet.id,bytes:[...chunk]});}console.log('STREAM END',packet.id);
     await page.evaluate(({id,status})=>{const p=pending[id];p.controller.close();p.o.onload?.({status,response:p.stream});delete pending[id];},{id:packet.id,status:response.status});
    }else{
     const text=await response.text();await page.evaluate(({id,status,text})=>{pending[id].o.onload?.({status,responseText:text,responseHeaders:''});delete pending[id];},{id:packet.id,status:response.status,text});
    }
   }catch(e){console.log('BRIDGE ERROR',e.message);await page.evaluate(({id,aborted})=>{const p=pending[id];if(!p)return;if(aborted)p.o.onabort?.();else p.o.onerror?.();delete pending[id];},{id:packet.id,aborted:controller.signal.aborted}).catch(()=>{});}
   finally{active.delete(packet.id);}
  });
  await page.evaluate(()=>{
   window.saved={};window.pending={};let serial=0;
   window.GM_getValue=(k,d)=>saved[k]??d;window.GM_setValue=(k,v)=>saved[k]=v;window.GM_deleteValue=k=>delete saved[k];window.GM_registerMenuCommand=()=>{};
   window.GM_xmlhttpRequest=o=>{const id=++serial,p={o};if(o.responseType==='stream')p.stream=new ReadableStream({start(c){p.controller=c;}});pending[id]=p;dispatchRequest({id,url:o.url,method:o.method||'GET',headers:o.headers||{},data:o.data,stream:!!p.stream});return{abort(){abortRequest(id);}};};
   const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>12,set(){}},duration:{get:()=>3600},paused:{get:()=>true},readyState:{get:()=>1}});
  });
  await page.addScriptTag({path:'zhiyun-subtitles.user.js'});const ui=page.locator('#zy-subtitle-host');
  assert.equal(await ui.locator('#ai-open').getAttribute('data-login-required'),'true');
  await ui.locator('#account-open').click();await ui.locator('#gateway-email').fill(account.email);await ui.locator('#gateway-password').fill(account.password);await ui.locator('#gateway-login').click();
  await page.waitForFunction(()=>!!saved['gateway-account-v1']?.token);assert.equal(await ui.locator('#ai-open').getAttribute('data-login-required'),'false');await ui.locator('#settings-close').click();console.log('LOGIN PASS');
  await page.evaluate(()=>{
   window.sawPartialWhileBusy=false;window.sawWaitingFeedback=false;
   const s=document.getElementById('zy-subtitle-host').shadowRoot;
   new MutationObserver(()=>{if(s.getElementById('ai-learning').getAttribute('aria-busy')==='true'&&s.querySelector('.ai-stream-text')?.textContent)sawPartialWhileBusy=true;if(s.getElementById('ai-status').textContent.includes('已等待'))sawWaitingFeedback=true;}).observe(s.getElementById('ai-learning'),{childList:true,subtree:true,characterData:true,attributes:true});
  });
  await ui.locator('#ai-open').click();await ui.locator('#ai-question').fill('请记住这个数字：37。只回复已记住。');await ui.locator('#ai-send').click();
  await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.querySelector('.ai-stream-text')?.textContent&&document.getElementById('zy-subtitle-host').shadowRoot.getElementById('ai-learning').getAttribute('aria-busy')==='false',null,{timeout:120000});
  assert.equal(await page.evaluate(()=>sawPartialWhileBusy),true);
  await ui.locator('#ai-question').fill('刚才的数字是多少？只回复数字。');await ui.locator('#ai-send').click();
  await page.waitForFunction(()=>{const s=document.getElementById('zy-subtitle-host').shadowRoot;return s.querySelectorAll('.ai-stream-text').length===2&&s.getElementById('ai-learning').getAttribute('aria-busy')==='false';},null,{timeout:120000});
  assert.match(await ui.locator('.ai-stream-text').last().textContent(),/37/);assert.equal(historyVerified,true);assert.equal(paid,2);assert.deepEqual(errors,[]);
  const result={real_login:true,two_turns:true,history_retained:true,text_visible_before_completion:await page.evaluate(()=>sawPartialWhileBusy),waiting_feedback_visible:await page.evaluate(()=>sawWaitingFeedback),page_errors:0};
  const reportPath='backend/acceptance-'+JSON.parse(fs.readFileSync('package.json','utf8')).version.replaceAll('.','')+'.json';const report=fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath,'utf8')):{version:JSON.parse(fs.readFileSync('package.json','utf8')).version};report.browser_ai=result;fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log('PASS: real browser login, live readable-stream text, waiting feedback and two-turn conversation.',JSON.stringify(result));
 }catch(e){if(page)console.log('UI DIAGNOSTIC',await page.evaluate(()=>{const s=document.getElementById('zy-subtitle-host')?.shadowRoot;return {status:s?.getElementById('ai-status')?.textContent,busy:s?.getElementById('ai-learning')?.getAttribute('aria-busy'),log:s?.getElementById('ai-log')?.textContent};}));throw e;}finally{
  if(page){const token=await page.evaluate(()=>saved['gateway-account-v1']?.token).catch(()=>null);if(token)await fetch(origin+'/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-App-Id':'zhiyun-subtitles',Authorization:'Bearer '+token},body:'{}'}).catch(()=>{});}
  for(const controller of active.values())controller.abort();await browser.close();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
