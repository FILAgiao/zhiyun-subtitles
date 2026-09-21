const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.route('https://classroom.test/',r=>r.fulfill({body:'<html></html>',contentType:'text/html'}));await page.goto('https://classroom.test/');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://example.test/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1400"><rect width="100%" height="100%" fill="#fff9e9"/><text x="100" y="140" font-size="60">Lecture / 01</text></svg>'}));
 await page.setContent(`<style>body{margin:0;background:#19251f;font:16px sans-serif}#player{position:relative;width:1000px;height:700px;background:#253b30}video{width:100%;height:100%}#pane-voice{position:absolute;left:1010px;top:0;color:white}#player:fullscreen{width:100vw;height:100vh}</style><div id="player"><video></video></div><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:10</div><div class="trans-lan"><div>the financial market uses several different trading strategies</div></div></div></div><div id="pane-ppt"><div class="tab-ppt"><img src="https://example.test/1.svg"><span class="time">00:00:00</span></div><div class="tab-ppt"><img src="https://example.test/2.svg"><span class="time">00:00:20</span></div></div>`);
 await page.evaluate(()=>{
  crypto.randomUUID=()=>String(Math.random());
  window.saved={'ark-api-key':'fake','speech-credentials':{apiKey:'fake'}};
  window.GM_getValue=(k,d)=>saved[k]??d; window.GM_setValue=(k,v)=>saved[k]=v;window.GM_deleteValue=k=>delete saved[k];window.GM_registerMenuCommand=()=>{};
  window.requests=[];window.jobs=0;
  window.GM_xmlhttpRequest=o=>{if(o.method==='GET'){window.videoRequests=(window.videoRequests||0)+1;setTimeout(()=>o.onload({status:206,responseHeaders:'Content-Range: bytes 0-15/16',response:new Blob([new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0])],{type:'video/mp4'})}),10);return{abort(){o.onabort?.();}};}requests.push(o.url);let aborted=false;setTimeout(()=>{if(aborted)return; if(o.url.includes('responses'))o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'金融市场使用多种不同的交易策略'}]}]})});else {if(o.url.endsWith('submit'))jobs++;o.onload({status:200,responseHeaders:'X-Api-Status-Code: 20000000',responseText:JSON.stringify({result:{utterances:[{text:jobs<3?'this text has no match at all here':'the financial market uses several different trading strategies',start_time:0}]}})});}},10);return{abort(){aborted=true;o.onabort?.();}};};
  const video=document.querySelector('video');Object.defineProperties(video,{paused:{get:()=>window.testPaused??false},duration:{get:()=>3600},currentTime:{get:()=>window.videoTime??12,set:v=>{window.videoTime=v;}},playbackRate:{get:()=>window.testRate??1,set:v=>{window.testRate=v;setTimeout(()=>video.dispatchEvent(new Event('ratechange')),0);}}});
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
 // Drag beyond the left screen boundary and recover with the settings-panel reset.
 await ui.locator('#reset-ppt').click();await page.waitForTimeout(150);
 let frame=await ui.locator('#slides').boundingBox();
 await page.mouse.move(frame.x+200,frame.y+80);await page.mouse.down();await page.mouse.move(20,frame.y+80,{steps:5});await page.mouse.up();
 assert.ok((await ui.locator('#slides').boundingBox()).x< -100);
 await page.waitForTimeout(150);assert.ok((await ui.locator('#slides').boundingBox()).x< -100);
 await ui.locator('#reset-ppt').click();await page.waitForTimeout(150);
 frame=await ui.locator('#slides').boundingBox();assert.ok(frame.x>=0);
 const imageBefore=await ui.locator('#slide-image').boundingBox();
 let edge=await ui.locator('[data-edge="right"]').boundingBox();
 await page.mouse.move(edge.x+4,edge.y+30);await page.mouse.down();await page.mouse.move(edge.x-76,edge.y+30,{steps:5});await page.mouse.up();
 assert.ok((await ui.locator('#slides').boundingBox()).width<frame.width-60);
 assert.ok(Math.abs((await ui.locator('#slide-image').boundingBox()).width-imageBefore.width)<1);
 edge=await ui.locator('[data-edge="bottom"]').boundingBox();
 await page.mouse.move(edge.x+30,edge.y+4);await page.mouse.down();await page.mouse.move(edge.x+30,edge.y+64,{steps:5});await page.mouse.up();
 const enlarged=await ui.locator('#slide-image').boundingBox();assert.ok(enlarged.height>imageBefore.height+40);
 assert.ok(Math.abs(enlarged.width/enlarged.height-imageBefore.width/imageBefore.height)<.01);
 await ui.locator('#reset-ppt').click();
 // Layout cycle: split -> PPT focus -> original, without losing the native video.
 await ui.locator('#show-slides').click();await page.waitForTimeout(150);
 assert.equal(await ui.locator('#show-slides').textContent(),'③ 恢复课堂');
 await ui.locator('#focus-fullscreen').click();await page.waitForTimeout(250);
 let focused=await page.locator('video').boundingBox();
 assert.ok(Math.abs(focused.x+focused.width-1424)<2);assert.ok(Math.abs(focused.y+focused.height-836)<2);
 await ui.locator('#focus-fullscreen').click();await page.waitForTimeout(150);
 await page.setViewportSize({width:1600,height:1000});await ui.locator('#focus-fullscreen').click();await page.waitForTimeout(250);
 focused=await page.locator('video').boundingBox();assert.ok(Math.abs(focused.x+focused.width-1584)<2);assert.ok(Math.abs(focused.y+focused.height-936)<2);
 await ui.locator('#focus-fullscreen').click();await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(200);

 assert.ok((await page.locator('video').boundingBox()).width<400);
 const focusPpt=await ui.locator('#slides').boundingBox(),focusCaption=await ui.locator('#caption').boundingBox();assert.ok(focusCaption.y>=focusPpt.y+focusPpt.height);
 await ui.locator('#show-slides').click();assert.ok(await ui.locator('#slides').isHidden());assert.equal((await page.locator('video').boundingBox()).width,1000);
 // Recording from 2x normalizes speed, buffering discards only the partial clip and resumes automatically.
 await page.evaluate(()=>{jobs=2;window.testRate=2;});
 await ui.locator('#auto-align').click();await page.waitForTimeout(30);
 assert.equal(await page.evaluate(()=>window.testRate),1);
 await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('waiting')));
 await page.waitForTimeout(160);assert.equal(await page.evaluate(()=>jobs),2);
 await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('playing')));
 await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>jobs),3);assert.equal(await page.evaluate(()=>window.testRate),2);
 // Cancelling while waiting prevents the next playing event from restarting recognition.
 await page.evaluate(()=>jobs=2);await ui.locator('#auto-align').click();await page.waitForTimeout(30);
 await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('waiting')));await page.waitForTimeout(30);
 await ui.locator('#auto-align').click();await page.waitForTimeout(50);
 await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('playing')));await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>jobs),2);assert.equal(await page.evaluate(()=>window.testRate),2);
 // Cache only synthetic media bytes: verify storage and source switching, not codec decoding.
 await ui.locator('summary').filter({hasText:'偏好与连接'}).click();
 // Edit overlays allow direct movement, and disappear so normal playback stays clickable.
 assert.ok(await ui.locator('#caption-edit-box').isHidden());
 const originalVideo=await page.locator('video').boundingBox();
 const videoHandle=await ui.locator('#video-edit-box span').boundingBox();
 await page.mouse.move(videoHandle.x+30,videoHandle.y+10);await page.mouse.down();await page.mouse.move(videoHandle.x+90,videoHandle.y+40,{steps:5});await page.mouse.up();
 const draggedVideo=await page.locator('video').boundingBox();assert.ok(draggedVideo.x>originalVideo.x+40);
 await ui.locator('#edit-layout').click();await page.waitForTimeout(150);
 const captionHandle=await ui.locator('#caption-edit-box').boundingBox();assert.ok(captionHandle);
 await page.mouse.move(captionHandle.x+60,captionHandle.y+10);await page.mouse.down();await page.mouse.move(captionHandle.x+100,captionHandle.y-30,{steps:5});await page.mouse.up();
 assert.ok(await ui.locator('#caption-custom').isChecked());
 assert.ok((await ui.locator('#caption').boundingBox()).x>captionHandle.x+25);
 const corner=await ui.locator('#video-edit-box button').boundingBox();
 await page.mouse.move(corner.x+10,corner.y+10);await page.mouse.down();await page.mouse.move(corner.x+60,corner.y+40,{steps:5});await page.mouse.up();
 assert.ok((await page.locator('video').boundingBox()).width>draggedVideo.width+30);
 await ui.locator('#edit-layout').click();assert.ok(await ui.locator('#video-edit-box').isVisible());assert.equal(await ui.locator('#video-edit-box').evaluate(e=>getComputedStyle(e).pointerEvents),'none');assert.ok(await ui.locator('#caption-edit-box').isHidden());
 assert.equal(await ui.locator('#caption').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
 await ui.locator('summary').filter({hasText:'偏好与连接'}).click();
 await ui.locator('summary').filter({hasText:'视频缓存'}).click();await ui.locator('#cache-details summary').click();
 await ui.locator('#cache-download').click();assert.match(await ui.locator('#cache-status').textContent(),/不是可直接缓存/);
 await page.evaluate(()=>{const v=document.querySelector('video');v.load=()=>{};v.pause=()=>{window.testPaused=true;};v.play=()=>{window.playCalls=(window.playCalls||0)+1;window.testPaused=false;return Promise.resolve();};v.addEventListener('error',e=>e.stopImmediatePropagation(),true);v.setAttribute('src','https://vod.cmc.zju.edu.cn/test.mp4');window.fetch=async()=>{throw new Error('CORS blocked');};});
 await ui.locator('#cache-download').click();await page.waitForTimeout(150);assert.match(await ui.locator('#cache-status').textContent(),/缓存完成/);assert.equal(await page.evaluate(()=>window.videoRequests),1);assert.ok(await page.evaluate(async()=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('zhiyun-videos');for await(const file of dir.values()){if((await file.getFile()).size===16)return true;}return false;}));
 // No manual play-cache click: completion should automatically select the disk file.
 await page.waitForTimeout(150);assert.match(await page.locator('video').getAttribute('src'),/^blob:/);
 await page.evaluate(()=>{window.videoTime=0;document.querySelector('video').dispatchEvent(new Event('loadedmetadata'));});
 assert.equal(await page.evaluate(()=>window.videoTime),12);assert.equal(await page.evaluate(()=>window.testRate),2);assert.equal(await page.evaluate(()=>window.playCalls),1);
 await page.evaluate(()=>window.testPaused=true);
 await ui.locator('#cache-online').click();assert.equal(await page.locator('video').getAttribute('src'),'https://vod.cmc.zju.edu.cn/test.mp4');
 await page.evaluate(()=>{window.videoTime=0;document.querySelector('video').dispatchEvent(new Event('loadedmetadata'));});assert.equal(await page.evaluate(()=>window.videoTime),12);assert.equal(await page.evaluate(()=>window.playCalls),1);assert.equal(await page.evaluate(()=>window.testPaused),true);
 await ui.locator('#cache-clear').click();await page.waitForTimeout(100);await ui.locator('#cache-play').click();await page.waitForTimeout(100);assert.match(await ui.locator('#cache-status').textContent(),/没有缓存/);
 // Use a real serializable directory handle with a simulated OS folder picker.
 await page.evaluate(()=>{window.showDirectoryPicker=async()=> (await navigator.storage.getDirectory()).getDirectoryHandle('chosen-disk',{create:true});});
 await ui.locator('#cache-folder').click();await page.waitForTimeout(100);
 assert.match(await ui.locator('#cache-location').textContent(),/chosen-disk/);
 await ui.locator('#cache-download').click();await page.waitForTimeout(250);
 assert.ok(await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();const dir=await(await root.getDirectoryHandle('chosen-disk')).getDirectoryHandle('伴读字幕缓存');for await(const file of dir.values())if((await file.getFile()).size===16)return true;return false;}));
 await ui.locator('#cache-default-folder').click();await page.waitForTimeout(100);
 await ui.locator('#cache-play').click();await page.waitForTimeout(150);
 assert.match(await page.locator('video').getAttribute('src'),/^blob:/);
 await ui.locator('#cache-clear').click();await page.waitForTimeout(100);
 // Batch queue persists lesson sources and continues after navigating away.
 await ui.locator('#cache-auto').uncheck();
 await ui.locator('#cache-batch summary').click();
 await page.evaluate(()=>{Object.defineProperty(document.querySelector('video'),'currentSrc',{configurable:true,get(){return this.getAttribute('src')||'';}});location.hash='#/replay?course_id=batch&sub_id=1';document.title='Batch lesson';document.querySelector('video').src='https://vod.cmc.zju.edu.cn/one.mp4';});
 await page.waitForTimeout(200);await ui.locator('#batch-add').click();await page.waitForTimeout(100);
 await page.evaluate(()=>{location.hash='#/replay?course_id=batch&sub_id=2';document.querySelector('video').src='https://vod.cmc.zju.edu.cn/two.mp4';});
 await page.waitForTimeout(200);await ui.locator('#batch-add').click();await page.waitForTimeout(100);
 assert.equal(await ui.locator('#batch-list input:checked').count(),2);
 await page.evaluate(()=>{window.batchCalls=[];window.batchActive=0;window.batchMax=0;window.failSecond=true;const original=GM_xmlhttpRequest;window.GM_xmlhttpRequest=o=>{if(o.method!=='GET')return original(o);batchCalls.push(o.url);batchActive++;batchMax=Math.max(batchMax,batchActive);let done=false;const timer=setTimeout(()=>{if(done)return;done=true;batchActive--;if(failSecond&&o.url.includes('two.mp4')){failSecond=false;o.onload({status:403});}else o.onload({status:206,responseHeaders:'Content-Range: bytes 0-15/16',response:new Blob([new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0])],{type:'video/mp4'})});},350);return{abort(){if(done)return;done=true;clearTimeout(timer);batchActive--;o.onabort?.();}};};});
 await ui.locator('#batch-start').click();await page.waitForTimeout(100);
 await page.evaluate(()=>{location.hash='#/replay?course_id=batch&sub_id=3';document.querySelector('video').src='https://vod.cmc.zju.edu.cn/three.mp4';});
 await page.waitForTimeout(1000);
 assert.match(await ui.locator('#batch-status').textContent(),/失败 1 节/);assert.equal(await page.evaluate(()=>batchMax),1);
 assert.equal(await ui.locator('#batch-list input:checked').count(),1);
 await ui.locator('#batch-start').click();await page.waitForTimeout(650);assert.match(await ui.locator('#batch-status').textContent(),/失败 0 节/);
 const callsBeforeSkip=await page.evaluate(()=>batchCalls.length);
 await ui.locator('#batch-list input').first().check();await ui.locator('#batch-start').click();await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>batchCalls.length),callsBeforeSkip);
 await ui.locator('#batch-add').click();await page.waitForTimeout(100);await ui.locator('#batch-start').click();await page.waitForTimeout(100);await ui.locator('#batch-stop').click();await page.waitForTimeout(250);
 assert.match(await ui.locator('#batch-status').textContent(),/队列已停止/);
 assert.equal(await page.evaluate(()=>batchActive),0);
 await ui.locator('#batch-start').click();await page.waitForTimeout(650);assert.match(await ui.locator('#batch-status').textContent(),/失败 0 节/);
 await ui.locator('summary').filter({hasText:'视频缓存'}).click();
 // Automatic discovery must not associate an old player's URL with a new lesson.
 await page.evaluate(()=>{Object.defineProperty(document.querySelector('video'),'readyState',{configurable:true,get:()=>1});location.hash='#/replay?course_id=batch&sub_id=4';});
 await page.waitForTimeout(1500);
 const readSeen=()=>new Promise((resolve,reject)=>{const open=indexedDB.open('zhiyun-video-cache',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('videos');const req=tx.objectStore('videos').getAll();req.onsuccess=()=>resolve(req.result.filter(e=>e?.visited));tx.oncomplete=()=>db.close();};open.onerror=reject;});
 let seen=await page.evaluate(readSeen);assert.ok(!seen.some(e=>JSON.parse(e.key)[1]==='4'));
 await page.evaluate(()=>document.querySelector('video').src='https://vod.cmc.zju.edu.cn/four.mp4');await page.waitForTimeout(1500);
 seen=await page.evaluate(readSeen);assert.ok(seen.some(e=>JSON.parse(e.key)[1]==='4'&&e.source.endsWith('/four.mp4')));
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


