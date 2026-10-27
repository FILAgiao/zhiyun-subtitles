const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.route('https://interactivemeta.cmc.zju.edu.cn/**',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/studentsrs?course_id=resource-retry&sub_id=1');
  let imageAvailable=false,requests=0;await page.route('https://images.test/current.svg',r=>{requests++;return r.fulfill(imageAvailable?{status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#fff8e1"/><text x="60" y="100" font-size="40">Recovered lesson slide</text></svg>'}:{status:404,body:'missing'});});
  await page.setContent('<style>body{margin:0;background:#263d4c}#player{width:960px;height:540px;position:relative}video{width:960px;height:540px}.control-content{height:40px}</style><div id="stream-list-wrapper"><div id="player"><video></video><div class="control-content">School controls</div></div></div><div class="trans-contain"><div class="trans-item active"><div class="item-origin">First live sentence.</div></div><div class="trans-item"><div class="item-origin">Second live sentence.</div></div></div><div class="note-scroll_body"><div class="note-ppt_item"><div class="ppt_order">1</div><img src="https://images.test/current.svg"></div></div>');
  await page.evaluate(()=>{
   window.values={'cache-auto':false,'gateway-guide-no-remind-v2':true};window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;window.GM_deleteValue=k=>delete values[k];window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>({abort(){}});
   window.paused=false;const v=document.querySelector('video');Object.defineProperties(v,{duration:{get:()=>3600},currentTime:{get:()=>30},paused:{get:()=>paused},readyState:{get:()=>3}});
  });
  await page.addScriptTag({content:fs.readFileSync(process.env.LIVE_SCRIPT||'zhiyun-subtitles.user.js','utf8').replace(/const DEFAULT_ORIGIN=[^;]+;/,'const DEFAULT_ORIGIN="";')});
  const ui=page.locator('#zy-subtitle-host');await ui.locator('#classroom-caption-source').waitFor();
  await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('original').textContent==='First live sentence.');assert.equal(await page.locator('#player > video').evaluate(v=>v.controls),true);assert.ok(await ui.locator('#zy-playback').isHidden());assert.match(await ui.locator('#classroom-caption-source').textContent(),/字幕 2/);
  await page.evaluate(()=>{document.querySelector('.trans-item.active').classList.remove('active');document.querySelectorAll('.trans-item')[1].classList.add('active');});
  await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('original').textContent==='Second live sentence.');
  // A class-only update must still freeze while paused, then follow on resume.
  await page.evaluate(()=>{paused=true;document.querySelector('.trans-item.active').classList.remove('active');document.querySelectorAll('.trans-item')[0].classList.add('active');});await page.waitForTimeout(700);assert.equal(await ui.locator('#original').textContent(),'Second live sentence.');await page.evaluate(()=>paused=false);await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('original').textContent==='First live sentence.');
  await ui.locator('#show-slides').click();await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('classroom-ppt-source').dataset.warning==='true');
  assert.equal(await ui.locator('#slide-image').evaluate(i=>i.complete&&i.naturalWidth===0),true);assert.match(await ui.locator('#slides-status').textContent(),/加载失败.*重试/);const failedRequests=requests;
  imageAvailable=true;assert.equal(await ui.locator('#classroom-source-retry').count(),0);await ui.locator('#show-slides').click();await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('slide-image').naturalWidth===960);
  assert.ok(requests>failedRequests,'retry reissues the failed image request');assert.doesNotMatch(await ui.locator('#classroom-ppt-source').textContent(),/失败/);assert.match(await ui.locator('#classroom-ppt-source').textContent(),/PPT 1/);assert.doesNotMatch(await ui.locator('#slides-status').textContent(),/加载失败/,'successful retry clears the old loading failure');
  assert.deepEqual(errors,[]);console.log('PASS: finite studentsrs live source with no srcObject; class-only subtitle changes/pause/resume; PPT404 failure and successful retry clear all stale error states.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
