const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent(`<style>body{margin:0;background:#19251f;font:16px sans-serif}#player{position:relative;width:1000px;height:700px;background:#253b30}video{width:100%;height:100%}#pane-voice{position:absolute;left:1010px;top:0;color:white}#player:fullscreen{width:100vw;height:100vh}</style><div id="player"><video></video></div><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:10</div><div class="trans-lan"><div>the financial market uses several different trading strategies</div></div></div></div><div id="pane-ppt"><div class="tab-ppt"><img src="https://example.test/1.svg"><span class="time">00:00:00</span></div><div class="tab-ppt"><img src="https://example.test/2.svg"><span class="time">00:00:20</span></div></div>`);
 await page.route('https://example.test/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="100%" height="100%" fill="#fff9e9"/><text x="100" y="140" font-size="60">Lecture / 01</text></svg>'}));
 await page.evaluate(()=>{
  crypto.randomUUID=()=>String(Math.random());
  window.saved={'ark-api-key':'fake','speech-credentials':{apiKey:'fake'}};
  window.GM_getValue=(k,d)=>saved[k]??d; window.GM_setValue=(k,v)=>saved[k]=v;window.GM_deleteValue=k=>delete saved[k];window.GM_registerMenuCommand=()=>{};
  window.requests=[];window.jobs=0;
  window.GM_xmlhttpRequest=o=>{requests.push(o.url);let aborted=false;setTimeout(()=>{if(aborted)return; if(o.url.includes('responses'))o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'金融市场使用多种不同的交易策略'}]}]})});else {if(o.url.endsWith('submit'))jobs++;o.onload({status:200,responseHeaders:'X-Api-Status-Code: 20000000',responseText:JSON.stringify({result:{utterances:[{text:jobs<3?'this text has no match at all here':'the financial market uses several different trading strategies',start_time:0}]}})});}},10);return{abort(){aborted=true;o.onabort?.();}};};
  const video=document.querySelector('video');Object.defineProperties(video,{paused:{get:()=>false},currentTime:{get:()=>window.videoTime??12},playbackRate:{get:()=>1}});
  video.captureStream=()=>({getAudioTracks:()=>[],getTracks:()=>[]});
 });
 await page.addScriptTag({content:fs.readFileSync('zhiyun-subtitles.user.js','utf8')});
 const ui=page.locator('#zy-subtitle-host');
 await page.waitForTimeout(650);
 assert.equal(await ui.locator('#speech-badge').textContent(),'✓ 已配置');
 await ui.locator('#mode').selectOption('both');await page.waitForTimeout(200);
 await ui.locator('summary').filter({hasText:'偏好与连接'}).click();
 await ui.locator('#placement').selectOption('overlay');await ui.locator('#direction').selectOption('zh-en');
 assert.equal(await ui.locator('#mode').inputValue(),'both');
 await page.evaluate(()=>location.hash='#/replay?layout=ppt');await page.waitForTimeout(200);
 assert.equal(await ui.locator('#mode').inputValue(),'both');
 const scroll=await ui.locator('#panel-body').evaluate(e=>{e.scrollTop=9999;return e.scrollTop;});assert.ok(scroll>0);
 await ui.locator('summary').filter({hasText:'偏好与连接'}).click();
 await ui.locator('#show-slides').click();await page.waitForTimeout(200);
 await ui.locator('#slide-viewport').hover();await ui.locator('#slide-next').click();assert.equal(await ui.locator('#slide-page').textContent(),'2 / 2');
 // Start split equally, then freely move/resize across the divider; restore video on close.
 const before=await ui.locator('#slides').boundingBox();
 const videoBefore=await page.locator('video').boundingBox();
 assert.equal(before.width,videoBefore.width);assert.ok(before.x+before.width<=videoBefore.x+1);
 const initialGrip=await ui.locator('#slide-resize').boundingBox();
 await page.mouse.move(initialGrip.x+12,initialGrip.y+12);await page.mouse.down();await page.mouse.move(initialGrip.x+132,initialGrip.y+12,{steps:5});await page.mouse.up();
 assert.ok((await ui.locator('#slides').boundingBox()).width>videoBefore.width+100);
 await page.mouse.move(initialGrip.x+132,initialGrip.y+12);await page.mouse.down();await page.mouse.move(initialGrip.x+12,initialGrip.y+12,{steps:5});await page.mouse.up();
 const grip=await ui.locator('#slide-resize').boundingBox();
 await page.mouse.move(grip.x+12,grip.y+12);await page.mouse.down();await page.mouse.move(grip.x-88,grip.y-48,{steps:5});await page.mouse.up();
 const resized=await ui.locator('#slides').boundingBox();assert.ok(resized.width<before.width-80);
 await page.mouse.move(resized.x+100,resized.y+50);await page.mouse.down();await page.mouse.move(resized.x+650,resized.y+90,{steps:5});await page.mouse.up();
 const moved=await ui.locator('#slides').boundingBox();assert.ok(moved.x>resized.x+60);assert.ok(moved.x>videoBefore.x);
 await ui.locator('#slide-viewport').hover();await ui.locator('#slide-close').click();
 assert.equal((await page.locator('video').boundingBox()).width,videoBefore.width*2);
 await ui.locator('#show-slides').click();await page.waitForTimeout(150);
 const restored=await ui.locator('#slides').boundingBox();assert.equal(restored.width,moved.width);assert.equal(restored.x,moved.x);
 assert.equal(await ui.locator('#slide-viewport').evaluate(e=>getComputedStyle(e).overflow),'hidden');
 await ui.locator('#focus-fullscreen').click();await page.waitForTimeout(300);
 assert.ok(await page.evaluate(()=>!!document.fullscreenElement));
 const fsVideo=await page.locator('video').boundingBox(),fsSlides=await ui.locator('#slides').boundingBox();assert.equal(fsVideo.width,720);assert.ok(fsSlides.x+fsSlides.width>fsVideo.x);assert.ok(fsSlides.x+fsSlides.width<=1440);
 assert.ok(await ui.locator('#slide-prev').isVisible());await ui.locator('#slide-viewport').hover();await ui.locator('#slide-prev').click();assert.equal(await ui.locator('#slide-page').textContent(),'1 / 2');
 assert.equal(await ui.locator('#mode').inputValue(),'both');
 await page.screenshot({path:'ui-preview.png'});
 await ui.locator('#focus-fullscreen').click();await page.waitForTimeout(200);
 // Manual browsing survives close/reopen; automatic pages use the same subtitle offset.
 await ui.locator('#slide-viewport').hover();await ui.locator('#slide-next').click();
 await ui.locator('#slide-viewport').hover();await ui.locator('#slide-close').click();await ui.locator('#show-slides').click();
 assert.equal(await ui.locator('#slide-page').textContent(),'2 / 2');
 await ui.locator('#slide-viewport').hover();await ui.locator('#slide-follow').click();await page.waitForTimeout(150);
 assert.equal(await ui.locator('#slide-page').textContent(),'1 / 2');
 await page.evaluate(()=>window.videoTime=25);await page.waitForTimeout(150);
 assert.equal(await ui.locator('#slide-page').textContent(),'2 / 2');
 await ui.locator('summary').filter({hasText:'手动微调'}).click();
 await ui.locator('#offset').fill('10');await ui.locator('#offset').dispatchEvent('input');await page.waitForTimeout(150);
 assert.equal(await ui.locator('#slide-page').textContent(),'1 / 2');
 await ui.locator('#offset').fill('0');await ui.locator('#offset').dispatchEvent('input');
 await page.evaluate(()=>window.videoTime=12);await page.waitForTimeout(150);
 // Put a fake speed control behind visible caption text; the real click must reach it.
 const box=await ui.locator('#caption').boundingBox();assert.ok(box);
 await page.evaluate(({x,y})=>{const b=document.createElement('button');b.id='speed-test';b.textContent='2×';b.style.cssText=`position:fixed;left:${x}px;top:${y}px;width:40px;height:25px`;b.onclick=()=>window.speedClicked=true;document.body.append(b);},{x:box.x+10,y:box.y+5});
 await page.mouse.click(box.x+20,box.y+15);assert.ok(await page.evaluate(()=>window.speedClicked));
 assert.equal(await ui.locator('#caption').evaluate(e=>getComputedStyle(e).overflowY),'hidden');
 // Mock captured audio and speed up only recording/poll delays. Never contact cloud services.
 await page.evaluate(()=>{
  const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===12000?120:ms===2000?10:ms,...args);
  const track={stop(){}};document.querySelector('video').captureStream=()=>({getAudioTracks:()=>[track],getTracks:()=>[track]});
  window.MediaStream=class{};
  window.MediaRecorder=class{constructor(){this.mimeType='audio/webm';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['audio'])});this.onstop();}};
  window.AudioContext=class{async decodeAudioData(){return{duration:12};}async close(){}};
  window.OfflineAudioContext=class{createBufferSource(){return{connect(){},start(){}};}async startRendering(){return{getChannelData:()=>new Float32Array([.1,.2,.3])};}};
 });
 await ui.locator('#auto-align').click();await page.waitForTimeout(60);assert.ok(await ui.locator('#align-progress').isVisible());
 await page.waitForTimeout(1000);
 assert.equal(await page.evaluate(()=>jobs),3);assert.match(await ui.locator('#align-label').textContent(),/匹配成功/);
 assert.equal(await ui.locator('#offset').inputValue(),'2');
 // A reliable first match must stop immediately; explicit cancellation must not submit.
 await page.evaluate(()=>jobs=2);
 await ui.locator('#auto-align').click(); await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>jobs),3);
 await ui.locator('#auto-align').click(); await ui.locator('#auto-align').click();
 await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>jobs),3);
 assert.match(await ui.locator('#align-label').textContent(),/取消/);
 // Single translation control starts/stops cloud requests and handles missing credentials clearly.
 assert.equal(await ui.locator('#translate').count(),0);
 await ui.locator('#mode').selectOption('original');
 const count=await page.evaluate(()=>requests.filter(u=>u.includes('responses')).length);
 await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>requests.filter(u=>u.includes('responses')).length),count);
 // A Chinese-only current cue must neither call translation nor render a duplicate line.
 await page.evaluate(()=>{document.querySelector('.trans-lan').innerHTML='<div>我们现在继续讲下一页的内容</div>';location.hash='#/replay?course_id=language-test';});
 await page.waitForTimeout(750);
 await ui.locator('summary').filter({hasText:'偏好与连接'}).click();
 await ui.locator('#direction').selectOption('en-zh');
 const beforeChinese=await page.evaluate(()=>requests.filter(u=>u.includes('responses')).length);
 await ui.locator('#mode').selectOption('both');await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>requests.filter(u=>u.includes('responses')).length),beforeChinese);
 assert.equal(await ui.locator('#translation').textContent(),'');
 assert.equal(await ui.locator('#original').textContent(),'我们现在继续讲下一页的内容');
 assert.deepEqual(errors,[]);
 console.log('PASS: badges, presentation state, direction state, scroll, PPT pages, fullscreen, progress, three attempts, offset.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});


