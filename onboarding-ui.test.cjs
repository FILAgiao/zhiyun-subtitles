const fs=require('node:fs'),assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://interactivemeta.cmc.zju.edu.cn/**',r=>r.fulfill({contentType:'text/html',body:'<style>#player{width:700px;height:400px}video{width:100%;height:100%}</style><div id="player"><video></video></div><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:10</div><div class="trans-lan"><div>We discuss computer architecture and instruction pipelines.</div></div></div></div>'}));
 await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=gateway&sub_id=1');
 await page.evaluate(()=>{
  window.saved={'gateway-guide-v1':true,'ark-api-key':'old-vendor-secret','speech-credentials':{apiKey:'old-speech-secret'}};window.calls=[];
  window.GM_getValue=(k,d)=>saved[k]??d;window.GM_setValue=(k,v)=>saved[k]=v;window.GM_deleteValue=k=>delete saved[k];window.GM_registerMenuCommand=()=>{};
  window.GM_xmlhttpRequest=o=>{calls.push({url:o.url,headers:o.headers,body:o.data?JSON.parse(o.data):null});const timer=setTimeout(()=>{
   let result={};if(o.url.includes('/speech/'))result={result:{utterances:[{text:'We discuss computer architecture and instruction pipelines.',start_time:0,end_time:1000}]}};else if(o.url.endsWith('/auth/login'))result={token:'user-session'};
   else if(o.url.endsWith('/learning/jobs/create'))result={id:'fake-job'};else if(o.url.endsWith('/learning/jobs/poll'))result={state:'complete',text:'模拟回答',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'模拟回答'}]}],usage:{total_tokens:10}}};else if(o.url.endsWith('/me'))result={email:'a@test',usage:window.mockUsage||{month:'2026-10',requests:2,request_limit:10,total_tokens:30,audio_seconds:0,audio_limit:60,uncertain:0}};
   else result={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'模拟回答'}]}],usage:{total_tokens:10}};
   o.onload({status:200,responseText:JSON.stringify(result),responseHeaders:o.url.includes('/speech/')?'X-Api-Status-Code: 20000000':''});
  },10);return{abort(){clearTimeout(timer);o.onabort?.();}};};
  window.videoTime=12;const v=document.querySelector('video');Object.defineProperties(v,{currentTime:{get:()=>videoTime,set(t){window.videoTime=t;}},duration:{get:()=>3600},paused:{get:()=>!window.playing},readyState:{get:()=>1}});
 });



 await page.setViewportSize({width:1280,height:800});await page.addScriptTag({path:'zhiyun-subtitles.user.js'});
 const ui=page.locator('#zy-subtitle-host'),guide=ui.locator('#gateway-guide'),artwork=require('./load-onboarding-assets.cjs')(),titles=['视频缓存','智能字幕同步','同屏看 PPT','AI 讲解','截图提问','知识卡','老师语音字幕','专业课优化翻译'];
 const initialHeader=await ui.locator('#panel-head').innerHTML();
 async function checkPage(index){
  assert.match(await ui.locator('#guide-step').textContent(),new RegExp((index+1)+' / 2'));
  assert.equal(await ui.locator('.guide-feature-card').count(),4);assert.equal(await ui.locator('#guide-dots button').count(),2);
  assert.equal(await ui.locator('#guide-dots [aria-current=step]').count(),1);assert.equal(await ui.locator('#guide-dots button').nth(index).getAttribute('aria-current'),'step');
  for(let j=0;j<4;j++){const card=ui.locator('.guide-feature-card').nth(j);assert.equal(await card.getAttribute('data-feature-index'),String(index*4+j));assert.equal(await card.locator('.guide-card-title').textContent(),titles[index*4+j]);assert.equal(await card.locator('.guide-frog-art').evaluate(e=>getComputedStyle(e).backgroundImage),'url("'+artwork+'")');}
  assert.equal(await ui.locator('#guide-login').isVisible(),index===1);assert.equal(await ui.locator('#guide-account-note').isVisible(),index===1);
 }
 await guide.waitFor({state:'visible'});await checkPage(0);assert.equal(await ui.locator('#guide-no-remind').isChecked(),false);
 const decoded=await ui.locator('.guide-frog-art').first().evaluate(async e=>{const img=new Image();img.src=getComputedStyle(e).backgroundImage.slice(5,-2);await img.decode();return [img.naturalWidth,img.naturalHeight];});assert.deepEqual(decoded,[1774,887]);
 await guide.screenshot({path:'onboarding-desktop-preview.png'});
 for(let i=0;i<2;i++){await checkPage(i);for(let j=0;j<4;j++){const card=ui.locator('.guide-feature-card').nth(j);await card.click();await ui.locator('#guide-image-viewer').waitFor({state:'visible'});assert.equal(await ui.locator('#guide-viewer-title').textContent(),titles[i*4+j]);assert.ok((await ui.locator('#guide-viewer-copy').textContent()).length>20);await page.keyboard.press('Escape');assert.ok(await ui.locator('#guide-image-viewer').isHidden());assert.ok(await guide.isVisible());assert.equal(await card.evaluate(e=>e.getRootNode().activeElement===e),true);}if(i===0)await ui.locator('#guide-next').click();}
 await guide.screenshot({path:'onboarding-second-page-preview.png'});assert.ok(await ui.locator('#guide-next').isHidden());assert.equal(await ui.locator('#guide-login').textContent(),'登录账号');
 await ui.locator('#guide-back').click();await checkPage(0);const originalTime=await page.evaluate(()=>videoTime);await page.keyboard.press('ArrowLeft');await checkPage(0);await page.keyboard.press('ArrowRight');await checkPage(1);await page.keyboard.press('ArrowRight');await checkPage(1);assert.equal(await page.evaluate(()=>videoTime),originalTime);
 await ui.locator('#guide-dots button').first().click();await checkPage(0);await ui.locator('.guide-feature-card').last().focus();await page.keyboard.press('Enter');await ui.locator('#guide-image-viewer').waitFor({state:'visible'});await ui.locator('#guide-viewer-close').click();assert.equal(await ui.locator('.guide-feature-card').last().evaluate(e=>e.getRootNode().activeElement===e),true);
 await ui.locator('#guide-no-remind').focus();await page.keyboard.press('ArrowRight');await checkPage(0);
 for(const size of [{width:320,height:640},{width:390,height:844},{width:800,height:440},{width:1280,height:500},{width:1920,height:1080}]){
  await page.setViewportSize(size);for(const index of [0,1]){await ui.locator('#guide-dots button').nth(index).click();await checkPage(index);const metrics=await guide.evaluate(e=>{const r=e.getBoundingClientRect(),buttons=[...e.querySelectorAll('.guide-feature-card')].map(n=>n.getBoundingClientRect()),b=e.querySelector('#guide-next[hidden]')?e.querySelector('#guide-login'):e.querySelector('#guide-next');return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,overflow:e.scrollWidth>e.clientWidth,twoColumns:Math.abs(buttons[0].top-buttons[1].top)<2&&buttons[2].top>buttons[0].top,actionBottom:b.getBoundingClientRect().bottom};});assert.ok(metrics.left>=0&&metrics.top>=0&&metrics.right<=size.width+1&&metrics.bottom<=size.height+1,JSON.stringify({size,metrics}));assert.equal(metrics.overflow,false);assert.ok(metrics.width<=680);assert.equal(metrics.twoColumns,size.width>600);assert.ok(metrics.actionBottom<=metrics.bottom);}
  if(size.width===390){await guide.screenshot({path:'onboarding-mobile-preview.png'});await ui.locator('.guide-feature-card').last().click();assert.ok(await ui.locator('#guide-image-viewer').isVisible());assert.equal(await ui.locator('#guide-image-viewer').evaluate(e=>e.scrollWidth>e.clientWidth),false);await page.keyboard.press('Escape');}
 }
 assert.equal(await ui.locator('#panel-head').innerHTML(),initialHeader);assert.equal(await ui.locator('#panel .guide-entry,#panel #gateway-help,#panel button[aria-label="使用指南"]').count(),0);assert.equal((await page.evaluate(()=>calls)).filter(c=>(c.url.includes('/learning/jobs')||c.url.includes('/speech/'))).length,0);
 await page.setViewportSize({width:390,height:844});await ui.locator('#guide-login').click();assert.ok(await guide.isHidden());assert.equal(await page.evaluate(()=>saved['gateway-guide-no-remind-v2']),false);assert.ok(await ui.locator('#gateway-login-form').isVisible());
 await ui.locator('#gateway-help').click();await checkPage(0);await page.keyboard.press('Escape');assert.ok(await guide.isHidden());
 async function reopenCourse(){const values=await page.evaluate(()=>saved);await page.reload();await page.evaluate(values=>{window.saved=values;window.GM_getValue=(k,d)=>saved[k]??d;window.GM_setValue=(k,v)=>saved[k]=v;window.GM_deleteValue=k=>delete saved[k];window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>({abort(){}});},values);await page.addScriptTag({path:'zhiyun-subtitles.user.js'});await ui.locator('#gateway-help').waitFor({state:'attached'});}
 await reopenCourse();await guide.waitFor({state:'visible'});await ui.locator('#guide-no-remind').check();await ui.locator('#guide-skip').click();assert.equal(await page.evaluate(()=>saved['gateway-guide-no-remind-v2']),true);
 await reopenCourse();assert.ok(await guide.isHidden());await ui.locator('#settings-open').evaluate(e=>e.click());await ui.locator('[data-settings=connection]').click();await ui.locator('#gateway-help').click();assert.ok(await ui.locator('#guide-no-remind').isChecked());await ui.locator('#guide-no-remind').uncheck();await page.keyboard.press('Escape');
 await page.evaluate(()=>{saved['gateway-account-v1']={url:'https://47.77.182.216.sslip.io/gateway',token:'fixture-session'};});await reopenCourse();await guide.waitFor({state:'visible'});await ui.locator('#guide-next').click();assert.ok(await ui.locator('#guide-next').isVisible());assert.equal(await ui.locator('#guide-next').textContent(),'开始使用');assert.ok(await ui.locator('#guide-login').isHidden());assert.ok(await ui.locator('#guide-account-note').isHidden());await ui.locator('#guide-next').click();assert.ok(await guide.isHidden());assert.deepEqual(errors,[]);
 console.log('PASS: two pages/four cream frog cards each; exact eight-feature mapping and offline artwork; keyboard/detail/focus; 320/390/800/1280/1920 layouts; login/completion/reminders; unchanged main header and no new panel entry or cloud work.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
