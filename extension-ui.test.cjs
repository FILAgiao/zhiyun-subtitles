const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{
const profile=path.resolve('.test-media/extension-profile-'+Date.now());const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--disable-extensions-except='+path.resolve(process.env.ZY_TEST_EXTENSION_DIR||'dist/extension'),'--load-extension='+path.resolve(process.env.ZY_TEST_EXTENSION_DIR||'dist/extension')]});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:20000});console.log('Extension loaded in Edge');
 await worker.evaluate(()=>{
  globalThis.requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,headers:options.headers});let body={};
   if(url.endsWith('/auth/login'))body={token:'fixture-extension-session'};
   else if(url.endsWith('/me'))body={username:'学习测试账号',email:'fixture@example.test',membership:{plan:'trial',active:true,state:'trial',expires:Math.floor(Date.now()/1000)+86400},server_time:Math.floor(Date.now()/1000),usage:{month:'2026-10',requests:2,request_limit:20,total_tokens:300,audio_seconds:0,audio_limit:60},permissions:{learning:true,translation:true,speech:true},capabilities:{web_search:false}};
   else if(url.endsWith('/learning/jobs/create'))body={id:'fixture-job'};
   else if(url.endsWith('/learning/jobs/poll'))body={state:'complete',text:'虚函数使同一个接口表现出不同实现。',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'虚函数使同一个接口表现出不同实现。'}]}],usage:{total_tokens:30}}};
   else if(url.endsWith('/ark/responses'))body={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'指令流水线通过重叠执行提高吞吐量。'}]}],usage:{total_tokens:20}};
   if(url.includes('/fixture.jpg'))return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAWQAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
   return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  };
 });
 const poster=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405"><rect width="720" height="405" fill="#173654"/><text x="40" y="64" fill="#fff" font-family="sans-serif" font-size="30">程序设计 · 多态与虚函数</text><text x="40" y="104" fill="#a8cde4" font-family="sans-serif" font-size="18">演示课程 · 同一个接口，不同的实现</text><rect x="250" y="145" width="200" height="64" rx="12" fill="#e9f2f6"/><text x="350" y="185" text-anchor="middle" fill="#173654" font-family="sans-serif" font-size="22">Animal.speak()</text><path d="M350 209V244M180 244H520M180 244V270M520 244V270" stroke="#b6dce7" stroke-width="3" fill="none"/><rect x="90" y="270" width="180" height="65" rx="12" fill="#fff3d5"/><rect x="430" y="270" width="180" height="65" rx="12" fill="#fff3d5"/><text x="180" y="310" text-anchor="middle" fill="#784529" font-family="sans-serif" font-size="22">Dog: woof</text><text x="520" y="310" text-anchor="middle" fill="#784529" font-family="sans-serif" font-size="22">Cat: meow</text></svg>').toString('base64');
 await context.route('https://interactivemeta.cmc.zju.edu.cn/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<style>body{background:#e7eff4;font:18px sans-serif;margin:28px}video{width:720px;height:405px;background:#173654}#pane-voice{background:white;padding:24px;width:660px;margin-top:20px;border-radius:20px}</style><h1>程序设计 · 多态与虚函数</h1><div id="player"><video poster="data:image/svg+xml;base64,'+poster+'"></video></div><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:10</div><div class="trans-lan"><div>Virtual methods enable polymorphism through a common interface.</div></div></div></div>'}));
 const page=await context.newPage(),errors=[];await page.setViewportSize({width:1280,height:800});page.on('pageerror',e=>errors.push(e.message));await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=fixture&sub_id=1');
 const ui=page.locator('#zy-subtitle-host');await ui.waitFor();
 const guide=ui.locator('#gateway-guide');await guide.waitFor({state:'visible'});

 const artwork=require('./load-onboarding-assets.cjs')();
 for(let i=0;i<2;i++){await ui.locator('#guide-dots button').nth(i).click();assert.equal(await ui.locator('.guide-feature-card').count(),4);assert.deepEqual(await ui.locator('.guide-feature-card').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.featureIndex))),[i*4,i*4+1,i*4+2,i*4+3]);await ui.locator('.guide-frog-art').first().evaluate(async e=>{const img=new Image();img.src=getComputedStyle(e).backgroundImage.slice(5,-2);await img.decode();if(img.naturalWidth!==1774)throw Error('Missing native extension frog artwork');});assert.equal(await ui.locator('.guide-frog-art').first().evaluate(e=>getComputedStyle(e).backgroundImage),'url("'+artwork+'")');}
 await ui.locator('#guide-dots button').first().click();await guide.screenshot({path:'dist/onboarding-extension-preview.png'});await ui.locator('.guide-feature-card').first().click();await ui.locator('#guide-image-viewer').waitFor({state:'visible'});await ui.locator('#guide-viewer-close').click();assert.equal(await ui.locator('#panel .guide-entry,#panel #gateway-help').count(),0);
 await ui.locator('#guide-skip').click();await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await chrome.tabs.sendMessage(tab.id,{type:'zy-ask',text:'guest selection'});});await ui.locator('#settings-dialog').waitFor({state:'visible'});assert.equal(await ui.locator('#ai-learning').isVisible(),false);assert.equal(await worker.evaluate(()=>requests.filter(r=>r.url.endsWith('/learning/jobs/create')).length),0);await ui.locator('#account-open').evaluate(node=>node.click());await ui.locator('#gateway-email').fill('fixture@example.test');await ui.locator('#gateway-password').fill('fixture-test-password');await ui.locator('#gateway-login').click();await page.waitForTimeout(500);
 const persisted=await worker.evaluate(()=>chrome.storage.local.get('gateway-account-v1'));assert.equal(persisted['gateway-account-v1'].token,'fixture-extension-session');
 await ui.locator('#gateway-usage').click();await page.waitForTimeout(300);await ui.locator('#settings-close').click();
 await page.screenshot({path:'dist/store-screenshot-classroom.png'});
 await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await chrome.tabs.sendMessage(tab.id,{type:'zy-ask',text:'polymorphism'});});
 await page.waitForTimeout(1600);assert.match(await ui.locator('#ai-log').textContent(),/虚函数/);assert.match(await ui.locator('#ai-account-status').textContent(),/免费体验/);
 const requests=await worker.evaluate(()=>globalThis.requests);assert.ok(requests.some(r=>r.url.endsWith('/learning/jobs/create')));assert.ok(requests.every(r=>r.headers['X-Client-Type']==='chrome-extension'));
 await page.screenshot({path:'dist/store-screenshot-assistant.png'});
 await ui.locator('#ai-save-card').click();await ui.locator('#ai-card-sentences').click();await ui.locator('.ai-sentence-choice').first().click();
 await page.screenshot({path:'knowledge-card-mv3-dialog-preview.png'});
 const callsBeforeExport=await worker.evaluate(()=>globalThis.requests.length),downloadEvent=page.waitForEvent('download');await ui.locator('#ai-card-confirm').click();
 const card=await downloadEvent;await card.saveAs('.testdeps/extension-knowledge-card.png');
 const png=fs.readFileSync('.testdeps/extension-knowledge-card.png');assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1080);assert.ok(png.readUInt32BE(20)<1200);
 assert.equal(await worker.evaluate(()=>globalThis.requests.length),callsBeforeExport,'knowledge cards make no backend/model requests');
 assert.match(await ui.locator('#ai-status').textContent(),/已保存所选回答及对应问题/);

 await page.reload();await ui.waitFor();await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});await chrome.tabs.sendMessage(tab.id,{type:'zy-open'});});assert.match(await ui.locator('#gateway-state').textContent(),/已登录/);assert.equal(await ui.locator('#gateway-status').textContent(),'额度已更新');
 const web=await context.newPage();await context.route('https://example.test/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>学习笔记</h1><p>选中文字后右键问上课爽，或中键截图提问。</p>'}));await web.goto('https://example.test/');await web.locator('#zy-subtitle-host').waitFor();assert.deepEqual(errors,[]);console.log('PASS: native MV3 service worker, isolated content UI, login/storage, AI poll proxy, paired sentence PNG export without network calls, selection and reload, ordinary webpage.');
}finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
