const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
  await page.route('https://interactivemeta.cmc.zju.edu.cn/**',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/live?course_id=causal&sub_id=20261020');
  await page.route('https://ppt.cmc.zju.edu.cn/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#fffbe9"/><path d="M140 100V550H1050" fill="none" stroke="#333" stroke-width="3"/><text x="220" y="80" font-size="34">LIVE PPT '+r.request().url().split('/').pop()+'</text></svg>'}));
  // Classes and the transformed .ratio container match the supplied live app bundles.
  await page.setContent(fs.readFileSync('fixtures/live-classroom.html','utf8'));
  await page.evaluate(()=>{
   window.values={'cache-auto':false,'gateway-guide-no-remind-v2':true};window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;window.GM_deleteValue=k=>delete values[k];window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>({abort(){}});
   window.t=35;window.paused=false;window.seeks=[];window.ranges=[];const video=document.querySelector('video');
   Object.defineProperties(video,{duration:{configurable:true,get:()=>Infinity},currentTime:{configurable:true,get:()=>t,set:v=>{seeks.push(v);t=v;}},paused:{get:()=>paused},readyState:{get:()=>3},seekable:{get:()=>({length:ranges.length,start:i=>ranges[i][0],end:i=>ranges[i][1]})}});
   video.play=async()=>{paused=false;};video.pause=()=>{paused=true;};
  });
  await page.addScriptTag({content:fs.readFileSync(process.env.LIVE_SCRIPT||'zhiyun-subtitles.user.js','utf8').replace(/const DEFAULT_ORIGIN=[^;]+;/,'const DEFAULT_ORIGIN="";')});
  const ui=page.locator('#zy-subtitle-host'),video=page.locator('#live-video');await ui.locator('#video-edit-box span').waitFor();await page.waitForTimeout(300);
  const geometry=()=>video.boundingBox(),close=(actual,expected,label)=>{for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<1,label+' '+key+': '+actual[key]+' expected '+expected[key]);};
  const before=await geometry(),original=await video.getAttribute('style'),stream=await video.evaluate(v=>v.parentElement.className);
  const handle=await ui.locator('#video-edit-box span').boundingBox();const x=handle.x+40,y=handle.y+10;
  await page.mouse.move(x,y);await page.mouse.down();close(await geometry(),before,'pointer down keeps geometry');await page.mouse.move(x+1,y+1);close(await geometry(),before,'one pixel jitter keeps geometry');
  await page.mouse.move(x+30,y+20,{steps:4});await page.mouse.up();await page.waitForTimeout(160);close(await geometry(),{...before,x:before.x+30,y:before.y+20},'first drag follows pointer in transformed live container');assert.equal(await video.evaluate(v=>v.parentElement.className),stream);
  const again=await ui.locator('#video-edit-box span').boundingBox();await page.mouse.move(again.x+40,again.y+10);await page.mouse.down();await page.mouse.move(again.x+20,again.y+25,{steps:4});await page.mouse.up();close(await geometry(),{...before,x:before.x+10,y:before.y+35},'second drag has no cumulative offset');
  // First click opens centered live PPT, uses the full-size current image and follows the teacher, not a join-relative media clock.
  await ui.locator('#show-slides').click();await ui.locator('#slide-image').evaluate(e=>e.decode());assert.ok(await ui.locator('#slides').isVisible());assert.equal(await ui.locator('#show-slides').textContent(),'收起 PPT');assert.equal(await ui.locator('#slide-page').textContent(),'2 / 2');assert.equal(await ui.locator('#slide-image').getAttribute('src'),'https://ppt.cmc.zju.edu.cn/200.jpg');assert.doesNotMatch(await ui.locator('#slides-status').textContent(),/先打开/);
  await ui.locator('#slides').hover();await ui.locator('#slide-prev').click();assert.equal(await ui.locator('#slide-page').textContent(),'1 / 2');assert.deepEqual(await page.evaluate(()=>seeks),[]);
  // Dynamic arrival must retain manual choice and extend the existing drawer.
  await page.evaluate(()=>{document.querySelector('.note-scroll_body').insertAdjacentHTML('beforeend','<div class="note-ppt_item"><div class="ppt_order">01:35:00</div><img src="https://ppt.cmc.zju.edu.cn/s_300.jpg"><div class="ppt_mask" style="display:none"></div></div>');document.querySelector('.ppt-section-wrapper img').src='https://ppt.cmc.zju.edu.cn/300.jpg';});
  await page.waitForTimeout(700);assert.equal(await ui.locator('#slide-page').textContent(),'1 / 3');await ui.locator('#slides').hover();await ui.locator('#slide-follow').click();assert.equal(await ui.locator('#slide-page').textContent(),'3 / 3');assert.match(await ui.locator('#slide-image').getAttribute('src'),/300.jpg$/);
  // A new teacher page can arrive while following, before the 500ms list sampler.
  await page.evaluate(()=>{document.querySelector('.note-scroll_body').insertAdjacentHTML('beforeend','<div class="note-ppt_item"><div class="ppt_order">01:36:00</div><img src="https://ppt.cmc.zju.edu.cn/s_350.jpg"><div class="ppt_mask" style="display:none"></div></div>');document.querySelector('.ppt-section-wrapper img').src='https://ppt.cmc.zju.edu.cn/350.jpg';});
  await page.waitForTimeout(700);assert.equal(await ui.locator('#slide-page').textContent(),'4 / 4');assert.match(await ui.locator('#slide-image').getAttribute('src'),/350.jpg$/);
  // Native browser controls own live playback. No-DVR keyboard seeks still
  // respect the source, and a finite live duration must not invent replay.
  assert.equal(await video.evaluate(v=>v.controls),true);assert.ok(await ui.locator('#zy-playback').isHidden());await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>paused),true);await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>paused),false);await page.keyboard.press('ArrowLeft');assert.deepEqual(await page.evaluate(()=>seeks),[]);
  await video.evaluate(v=>Object.defineProperty(v,'duration',{configurable:true,get:()=>3600}));await page.waitForTimeout(160);assert.equal(await video.evaluate(v=>v.controls),true);assert.deepEqual(await page.evaluate(()=>ZYClassroomMedia.timeline(document.querySelector('video')).ranges),[]);
  // Preserve disjoint/moving DVR range clamping for keyboard, subtitle and PPT seeks.
  await page.evaluate(()=>{ranges=[[120,150],[160,240]];t=200;});await page.waitForTimeout(160);assert.deepEqual(await page.evaluate(()=>{const {start,end,ranges}=ZYClassroomMedia.timeline(document.querySelector('video'));return {start,end,ranges};}),{start:120,end:240,ranges:[[120,150],[160,240]]});
  await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>t),190);assert.equal(await page.evaluate(()=>ZYClassroomMedia.seekTime(document.querySelector('video'),155)),160);assert.ok(Math.abs(await page.evaluate(()=>ZYClassroomMedia.seekTime(document.querySelector('video'),240))-239.95)<.01);
  await page.evaluate(()=>{ranges=[[180,270]];});await page.waitForTimeout(160);assert.deepEqual(await page.evaluate(()=>{const {start,end}=ZYClassroomMedia.timeline(document.querySelector('video'));return {start,end};}),{start:180,end:270});assert.ok(await ui.locator('#zy-playback').isHidden());
  await page.screenshot({path:'.test-media/live-classroom-fixed.png'});
  // Closing restores all video inline properties, without reparenting or replacing the live element.
  await ui.locator('#show-slides').click();await page.waitForTimeout(180);close(await geometry(),before,'closing PPT restores initial live layout');assert.equal(await video.evaluate(v=>v.parentElement.className),stream);
  const restored=await video.getAttribute('style');assert.equal((restored||'').replace(/\s/g,''),(original||'').replace(/\s/g,''));
  // Scaling ancestors and resizing still use screen-space deltas.
  await page.evaluate(()=>document.querySelector('.ratio').style.transform='translate(-50%,-50%) scale(.8)');await page.waitForTimeout(150);
  const scaled=await geometry(),sh=await ui.locator('#video-edit-box span').boundingBox();await page.mouse.move(sh.x+40,sh.y+10);await page.mouse.down();await page.mouse.move(sh.x+60,sh.y+20,{steps:4});await page.mouse.up();close(await geometry(),{...scaled,x:scaled.x+20,y:scaled.y+10},'scaled ancestor drag');
  const resize=await ui.locator('#video-edit-box button').boundingBox(),moved=await geometry();await page.mouse.move(resize.x+10,resize.y+10);await page.mouse.down();await page.mouse.move(resize.x+50,resize.y+30,{steps:5});await page.mouse.up();close(await geometry(),{...moved,width:moved.width+40,height:moved.height+20},'scaled ancestor resize');
  await page.setViewportSize({width:320,height:844});await page.waitForTimeout(180);assert.ok(await ui.locator('#zy-playback').isHidden(),'live DVR keeps native controls at 320px');await page.evaluate(()=>ranges=[]);await page.waitForTimeout(180);assert.ok(await ui.locator('#zy-playback').isHidden(),'no-DVR keeps native controls at 320px');await page.setViewportSize({width:1920,height:1080});await page.waitForTimeout(180);
  // Existing course isolation applies to live slides as well.
  await page.evaluate(()=>location.hash='#/live?course_id=next&sub_id=next');await page.waitForTimeout(250);if(await ui.locator('#panel').isHidden())await ui.locator('#compact').click();await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slides').isHidden(),true);assert.match(await ui.locator('#slides-status').textContent(),/等待新课程 PPT/);
  await page.evaluate(()=>{document.querySelector('.note-scroll_body').innerHTML='<div class="note-ppt_item"><div class="ppt_order">00:00:00</div><img src="https://ppt.cmc.zju.edu.cn/s_400.jpg"></div>';document.querySelector('.ppt-section-wrapper img').src='https://ppt.cmc.zju.edu.cn/400.jpg';});await page.waitForTimeout(600);await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slide-page').textContent(),'1 / 1');assert.match(await ui.locator('#slide-image').getAttribute('src'),/400.jpg$/);
  assert.deepEqual(errors,[]);console.log('PASS: live DOM PPT/current full image/arrival/manual/follow/course isolation; transformed parent drag/jitter/repeat/restore; native live controls/no-DVR pause; actual disjoint/moving DVR range clamping.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
