const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://interactivemeta.cmc.zju.edu.cn/**',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));
  await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/studentsrs?course_id=89414&sub_id=2023951&tenant_code=112');
  await page.setContent('<style>body{margin:0;background:#263d4c}.cmc-main{width:960px;height:540px;position:relative}.cmc-main:fullscreen{width:100vw;height:100vh}video{width:100%;height:100%}.control-content{height:40px;background:#eee}#host{position:fixed;inset:0;pointer-events:none;z-index:999}#host button{pointer-events:auto}</style><div class="cmc-main" id="first-player"><div class="cmc-player"><video id="first"></video><div class="control-content">School controls</div></div></div><div class="cmc-main" id="second-player" hidden><div class="cmc-player"><video id="second" controls></video><div class="control-content">School controls</div></div></div><div class="cmc-main" id="replay-player" hidden><div class="cmc-player"><video id="replay" controls></video><div class="control-content">School controls</div></div></div><div id="host"></div>');
  await page.addScriptTag({path:'classroom-media.js'});await page.addScriptTag({path:'player-interactions.js'});
  await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');ctx.fillStyle='#264862';ctx.fillRect(0,0,960,540);ctx.fillStyle='white';ctx.font='40px sans-serif';ctx.fillText('Studentsrs live native controls',40,100);
   window.stream=canvas.captureStream(10);window.video=document.getElementById('first');window.local=null;
   for(const id of ['first','second']){const v=document.getElementById(id);v.srcObject=stream;v.muted=true;await v.play();}
   Object.defineProperty(document.getElementById('replay'),'duration',{get:()=>90});
   const host=document.getElementById('host'),shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>button{pointer-events:auto;position:fixed;top:8px;right:8px}</style><button id="focus-fullscreen">Classroom fullscreen</button><button id="fullscreen-recover" hidden></button><div id="fullscreen-notice" hidden></div><p id="slides-status"></p><div id="settings-dialog" hidden></div><div id="transcript" hidden></div><button id="transcript-close" hidden></button><button id="transcript-follow" hidden></button><div id="transcript-list"></div><div id="cache-transport"></div><div id="cache-status"></div>';
   window.controls=ZYPlayerInteractions.mount({shadow,host,getVideo:()=>video,getLocal:()=>local,getCues:()=>[],getCourse:()=>'',getClock:t=>t,getSeekTime:t=>t,translate:()=>'',seek:t=>{const target=ZYClassroomMedia.seekTime(video,t);if(target!==null)video.currentTime=target;},onCollapse:()=>{}});controls.update();
  });
  const ui=page.locator('#host'),first=page.locator('#first');
  assert.equal(await first.evaluate(v=>v.controls),true);assert.equal(await first.evaluate(v=>v.srcObject===stream),true);assert.ok(await ui.locator('#zy-playback').isHidden());assert.equal(await page.locator('#first-player .control-content').evaluate(e=>getComputedStyle(e).display),'none');
  // The browser's own pause button is visible and receives actual pointer input.
  await first.hover();const box=await first.boundingBox();await page.mouse.click(box.x+32,box.y+box.height-27);await page.waitForFunction(()=>document.getElementById('first').paused);await page.mouse.click(box.x+32,box.y+box.height-27);await page.waitForFunction(()=>!document.getElementById('first').paused);assert.equal(await first.evaluate(v=>v.srcObject===stream),true);
  await page.screenshot({path:'.test-media/live-native-controls.png'});
  await ui.locator('#focus-fullscreen').click();await page.waitForFunction(()=>document.fullscreenElement?.id==='first-player');assert.equal(await first.evaluate(v=>v.controls),true);assert.ok(await ui.locator('#zy-playback').isHidden());await page.evaluate(()=>document.exitFullscreen());
  // Repeated ticks repair a site reset without replacing the stream or toolbar.
  await page.evaluate(()=>{video.controls=false;controls.update();});assert.equal(await first.evaluate(v=>v.controls),true);
  await page.evaluate(()=>{document.getElementById('first-player').hidden=true;document.getElementById('second-player').hidden=false;video=document.getElementById('second');controls.update();});assert.equal(await first.evaluate(v=>v.controls),false,'the old live video regains its original controls flag');assert.equal(await page.locator('#second').evaluate(v=>v.controls),true);
  await page.evaluate(()=>{local={video,controls:true};controls.update();});assert.equal(await page.locator('#second').evaluate(v=>v.controls),false);assert.ok(await ui.locator('#zy-playback').isVisible(),'cached transport keeps its existing controls');
  await page.evaluate(()=>{local=null;controls.update();});assert.equal(await page.locator('#second').evaluate(v=>v.controls),true);assert.ok(await ui.locator('#zy-playback').isHidden());
  await page.evaluate(()=>{location.hash='#/student?course_id=replay';document.getElementById('second-player').hidden=true;document.getElementById('replay-player').hidden=false;video=document.getElementById('replay');controls.update();});assert.equal(await page.locator('#second').evaluate(v=>v.controls),true,'an originally enabled live control stays enabled on switch');assert.equal(await page.locator('#replay').evaluate(v=>v.controls),true);assert.notEqual(await page.locator('#replay-player .control-content').evaluate(e=>getComputedStyle(e).display),'none');assert.ok(await ui.locator('#zy-playback').isHidden());
  await page.evaluate(()=>{location.hash='#/studentsrs?course_id=89414';document.getElementById('replay-player').hidden=true;document.getElementById('first-player').hidden=false;video=document.getElementById('first');controls.update();controls.destroy();});assert.equal(await first.evaluate(v=>v.controls),false);assert.notEqual(await page.locator('#first-player .control-content').evaluate(e=>getComputedStyle(e).display),'none');assert.ok(await ui.locator('#zy-playback').isHidden());
  // The studentsrs route also serves ended lessons: only its visible live
  // stream wrapper should promote a finite source without srcObject to live.
  await page.evaluate(()=>{
   const wrapper=document.createElement('div');wrapper.id='stream-list-wrapper';wrapper.innerHTML='<video id="finite-live"></video>';document.body.append(wrapper);const v=wrapper.firstElementChild;Object.defineProperty(v,'duration',{get:()=>3600});window.finiteLive=v;
  });
  assert.equal(await page.evaluate(()=>finiteLive.srcObject),null);assert.equal(await page.evaluate(()=>ZYClassroomMedia.isLive(finiteLive)),true);assert.deepEqual(await page.evaluate(()=>ZYClassroomMedia.timeline(finiteLive).ranges),[],'a finite live duration does not invent DVR');
  await page.evaluate(()=>document.getElementById('stream-list-wrapper').style.display='none');assert.equal(await page.evaluate(()=>ZYClassroomMedia.isLive(finiteLive)),false,'hidden live wrapper does not promote the ended lesson');
  await page.evaluate(()=>{document.getElementById('stream-list-wrapper').style.display='block';location.hash='#/replay?course_id=ended';});assert.equal(await page.evaluate(()=>ZYClassroomMedia.isLive(finiteLive)),false,'wrapper alone does not promote an ordinary replay');
  await page.evaluate(()=>Object.defineProperty(document.getElementById('first'),'duration',{get:()=>3600}));assert.equal(await first.evaluate(v=>ZYClassroomMedia.isLive(v)),true,'an attached MediaStream remains live with finite reported duration');
  await page.evaluate(()=>stream.getTracks().forEach(t=>t.stop()));assert.deepEqual(errors,[]);console.log('PASS: studentsrs real MediaStream uses native pause/resume and fullscreen controls; no fixed live toolbar; video/cache/replay switches restore original controls; finite studentsrs live wrapper and MediaStream detection.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
