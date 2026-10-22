const fs=require('node:fs'),assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://interactivemeta.cmc.zju.edu.cn/**',r=>r.fulfill({contentType:'text/html',body:'<style>#player{width:700px;height:400px}video{width:100%;height:100%}</style><div id="player"><video></video></div><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:10</div><div class="trans-lan"><div>We discuss computer architecture and instruction pipelines.</div></div></div></div>'}));
 await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=gateway&sub_id=1');
 await page.evaluate(()=>{
  window.saved={'ark-api-key':'old-vendor-secret','speech-credentials':{apiKey:'old-speech-secret'}};window.calls=[];
  window.GM_getValue=(k,d)=>saved[k]??d;window.GM_setValue=(k,v)=>saved[k]=v;window.GM_deleteValue=k=>delete saved[k];window.GM_registerMenuCommand=()=>{};
  window.GM_xmlhttpRequest=o=>{calls.push({url:o.url,headers:o.headers,body:o.data?JSON.parse(o.data):null});const timer=setTimeout(()=>{
   let result={};if(o.url.includes('/speech/'))result={result:{utterances:[{text:'We discuss computer architecture and instruction pipelines.',start_time:0,end_time:1000}]}};else if(o.url.endsWith('/auth/login'))result={token:'user-session'};
   else if(o.url.endsWith('/prompts'))result={prompts:[{id:'feynman',label:'费曼 · 大白话',prompt:'用大白话解释',scope:'official',revision:1}]};else if(o.url.endsWith('/learning/jobs/create'))result={id:'fake-job'};else if(o.url.endsWith('/learning/jobs/poll'))result={state:'complete',text:'模拟回答',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'模拟回答'}]}],usage:{total_tokens:10}}};else if(o.url.endsWith('/me'))result={email:'a@test',usage:window.mockUsage||{month:'2026-10',requests:2,request_limit:10,total_tokens:30,audio_seconds:0,audio_limit:60,uncertain:0}};
   else result={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'模拟回答'}]}],usage:{total_tokens:10}};
   o.onload({status:200,responseText:JSON.stringify(result),responseHeaders:o.url.includes('/speech/')?'X-Api-Status-Code: 20000000':''});
  },10);return{abort(){clearTimeout(timer);o.onabort?.();}};};
  window.videoTime=12;const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>videoTime,set(t){window.videoTime=t;}},duration:{get:()=>3600},paused:{get:()=>!window.playing},readyState:{get:()=>1}});
 });
 await page.evaluate(()=>GM_setValue('gateway-guide-no-remind-v2',true));
 await page.addScriptTag({path:'zhiyun-subtitles.user.js'});const ui=page.locator('#zy-subtitle-host');
 await ui.locator('#transcript-open').waitFor();assert.equal(await ui.locator('#transcript-open').getAttribute('data-login-required'),'true');assert.equal(await ui.locator('#ai-open').getAttribute('aria-disabled'),'true');await ui.locator('#transcript-open').evaluate(n=>n.click());assert.equal(await ui.locator('#settings-dialog').isVisible(),true);assert.equal(await ui.locator('#ai-questions').isVisible(),false);await ui.locator('#settings-close').click();

 await page.evaluate(()=>{
  window.playing=true;const originalTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,(ms===12000||ms===20000)?200:ms===2000?10:ms,...args);
  const track={stop(){}};document.querySelector('video').captureStream=()=>({getAudioTracks:()=>[track],getTracks:()=>[track]});window.MediaStream=class{};
  window.MediaRecorder=class{constructor(){this.mimeType='audio/webm';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['audio'])});this.onstop();}};
  window.AudioContext=class{async decodeAudioData(){return{duration:12};}async close(){}};window.OfflineAudioContext=class{createBufferSource(){return{connect(){},start(){}};}async startRendering(){return{getChannelData:()=>new Float32Array([.1,.2,.3])};}};
 });
 await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('status').textContent.includes('已读取 1 条'));await ui.locator('#sync-toggle').evaluate(node=>node.click());assert.equal(await ui.locator('#gateway-login-form').isVisible(),true);assert.equal(await page.evaluate(()=>calls.filter(call=>call.url.includes('/speech/')).length),0);await ui.locator('#settings-close').click();await ui.locator('#settings-open').click();
 await page.evaluate(async()=>{const store=ZYCacheStorage.create();await store.put({key:'layout-fixture',source:'https://vod.cmc.zju.edu.cn/fixture.mp4',visited:Date.now(),title:'计算机体系结构 · 第十二讲 / '+ '很长的文件名_without_spaces_'.repeat(10)+'.mp4',state:'已缓存'},'seen:layout-fixture');});
 await ui.locator('[data-settings=storage]').click();await ui.locator('#batch-refresh').click();const cacheRow=ui.locator('.cache-course').filter({hasText:'计算机体系结构'});await cacheRow.waitFor();
 for(const width of [1280,360]){
  await page.setViewportSize({width,height:760});
  assert.equal(await ui.locator('#settings-content').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  const titleBox=await cacheRow.locator('.cache-course-title').boundingBox(),actionsBox=await cacheRow.locator('.actions').boundingBox();assert.ok(actionsBox.y>=titleBox.y+titleBox.height,'cache actions stay below the filename');
  await cacheRow.scrollIntoViewIfNeeded();await ui.locator('#settings-card').screenshot({path:width===360?'cache-list-mobile-preview.png':'cache-list-preview.png'});
 }
 await cacheRow.locator('input').check();assert.equal(await cacheRow.locator('input').isChecked(),true);await cacheRow.getByRole('button',{name:'移出清单',exact:true}).click();await cacheRow.waitFor({state:'detached'});
 await page.setViewportSize({width:1280,height:720});await ui.locator('[data-settings=connection]').click();
 assert.equal(await ui.locator('#gateway-quota .quota-ring').count(),3);
 assert.equal(await ui.locator('.quota-row[data-locked=true]').count(),2);
 assert.match(await ui.locator('#gateway-quota').textContent(),/无限量/);
 assert.equal(await ui.locator('#gateway-quota-section').isVisible(),false);assert.equal(await ui.locator('#gateway-apply').getAttribute('href'),'https://47.77.182.216.sslip.io/gateway/account?tab=register');assert.equal(await ui.locator('#gateway-recharge').getAttribute('href'),'https://47.77.182.216.sslip.io/gateway/account?tab=recharge');await page.context().route('https://47.77.182.216.sslip.io/gateway/**',r=>r.fulfill({contentType:'text/html',body:'<h1>账号申请与充值</h1><p>暂未开放</p>'}));const pop=page.waitForEvent('popup');await ui.locator('#gateway-apply').click();const application=await pop;await application.waitForLoadState('domcontentloaded');assert.equal(application.url(),'https://47.77.182.216.sslip.io/gateway/account?tab=register');await application.close();assert.ok(await ui.locator('#gateway-recharge-note').isHidden());
 assert.equal(await ui.locator('#gateway-url').count(),0);assert.match(await ui.locator('#account-guide').textContent(),/游客/);assert.equal(await ui.locator('#ai-open').getAttribute('data-login-required'),'true');await ui.locator('#gateway-email').fill('a@test');await ui.locator('#gateway-password').fill('long-password');
 await ui.locator('#gateway-login').click();await page.waitForFunction(()=>saved['gateway-account-v1']?.token==='user-session');assert.equal(await ui.locator('#gateway-password').inputValue(),'');assert.equal(await ui.locator('#ai-open').getAttribute('data-login-required'),'false');assert.equal(await ui.locator('#gateway-login-form').isVisible(),false);
 await ui.getByRole('button',{name:'查看额度',exact:true}).click();await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-status').textContent.includes('额度已更新'));
 assert.equal(await ui.locator('.quota-row[data-locked=true]').count(),0);
 assert.equal(await ui.locator('.quota-ring[aria-label="AI 问答与翻译：剩余 8 次"]').count(),1);
 await ui.locator('#settings-card').screenshot({path:'quota-preview.png'});
 await page.setViewportSize({width:360,height:760});
 assert.equal(await ui.locator('#settings-content').evaluate(e=>e.scrollWidth>e.clientWidth),false);
 await ui.locator('#settings-card').screenshot({path:'quota-mobile-preview.png'});
 await page.setViewportSize({width:1280,height:720});
 await page.evaluate(()=>window.mockUsage={month:'2026-10',requests:15,request_limit:10,total_tokens:30,audio_seconds:null,audio_limit:null});await ui.locator('#gateway-usage').click();
 await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.querySelector('.quota-ring[aria-label="AI 问答与翻译：剩余 0 次"]'));
 assert.equal(await ui.locator('.quota-ring[aria-label="语音识别：额度暂不可用"]').count(),1);
 await page.evaluate(()=>window.mockUsage=null);await ui.locator('#gateway-usage').click();
 await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.querySelector('.quota-ring[aria-label="AI 问答与翻译：剩余 8 次"]'));
 await ui.locator('#settings-close').click();await ui.locator('#sync-manual-toggle').click();await ui.locator('#later').click();await ui.locator('#transcript-open').click();assert.ok(await ui.locator('#ai-questions').isVisible());await ui.locator('#ai-questions-close').click();await ui.locator('#mode').selectOption('both');await page.waitForFunction(()=>calls.some(c=>c.url.endsWith('/ark/responses')));
 await ui.locator('#ai-open').click();await ui.locator('#ai-question').fill('解释流水线');await ui.locator('#ai-send').click();await page.waitForFunction(()=>calls.filter(c=>c.url.endsWith('/ark/responses')||c.url.endsWith('/learning/jobs/create')).length>=2);
 const service=await page.evaluate(()=>saved['gateway-account-v1'].url);const calls=await page.evaluate(()=>window.calls);const paid=calls.filter(c=>c.url.endsWith('/ark/responses')||c.url.endsWith('/learning/jobs/create'));assert.ok(paid.length>=2);for(const c of paid){assert.ok(c.url===service+'/v1/ark/responses'||c.url===service+'/v1/learning/jobs/create');assert.equal(c.headers.Authorization,'Bearer user-session');assert.ok(!JSON.stringify(c).includes('old-vendor-secret'));}
 await ui.locator('#ai-close').click();await ui.locator('#settings-open').click();await ui.locator('[data-settings=connection]').click();await ui.getByRole('button',{name:'退出登录',exact:true}).click();await page.waitForFunction(()=>saved['gateway-account-v1']?.token==='');
 assert.equal(await ui.locator('.quota-row[data-locked=true]').count(),2);assert.equal(await ui.locator('.quota-ring[aria-label="AI 问答与翻译：剩余 8 次"]').count(),0);
 const before=await page.evaluate(()=>calls.length);await ui.locator('#settings-close').click();await ui.locator('#mode').selectOption('both');await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>calls.length),before);
 await ui.locator('[data-settings=connection]').click();await page.screenshot({path:'account-login-preview.png'});assert.deepEqual(errors,[]);console.log('PASS: real userscript login, usage UI, translation + AI proxy, vendor key isolation and logout blocks paid calls.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
