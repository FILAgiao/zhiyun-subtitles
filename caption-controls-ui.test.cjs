const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(`<style>body{margin:0;background:#202b38}#player{position:relative;margin:30px 40px;width:1000px;height:650px;background:#111}video{width:100%;height:100%}#player:fullscreen{margin:0;width:100vw;height:100vh}.vjs-control-bar{position:absolute;left:0;right:0;bottom:30px;height:85px;background:#ddd;display:flex;align-items:center;z-index:1}.vjs-control-bar input{width:95%;margin:auto}</style><div id="player"><video></video><div class="vjs-control-bar"><input id="progress" type="range" min="0" max="100" value="10" aria-label="Playback position"></div></div><div id="host"></div>`);
  await page.addScriptTag({path:'player-interactions.js'});
  await page.evaluate(()=>{
   const host=document.getElementById('host');host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:999';const shadow=host.attachShadow({mode:'open'});
   shadow.innerHTML=`<style>#caption{position:fixed;left:40px;top:665px;width:1000px;height:80px;transform:translateY(-100%);background:#14241ee8;color:white;text-align:center;font:26px sans-serif;padding:12px;box-sizing:border-box;pointer-events:none}#caption span{pointer-events:none}button{pointer-events:auto;position:fixed;top:8px;right:8px}</style><div id="caption"><span>Subtitles must leave playback controls clear.</span></div><button id="focus-fullscreen">Fullscreen</button><button id="fullscreen-recover" hidden></button><p id="slides-status"></p><div id="fullscreen-notice" hidden></div><div id="settings-dialog" hidden></div><div id="transcript" hidden></div><button id="transcript-close" hidden></button><button id="transcript-follow" hidden></button><div id="transcript-list"></div><div id="cache-transport"></div><div id="cache-status"></div>`;
   window.video=document.querySelector('video');window.videoTime=10;Object.defineProperties(video,{duration:{get:()=>100},currentTime:{get:()=>videoTime,set:t=>videoTime=t}});window.progressEvents=0;document.getElementById('progress').addEventListener('input',()=>progressEvents++);
   window.controls=ZYPlayerInteractions.mount({shadow,host,getVideo:()=>video,getLocal:()=>null,getCues:()=>[],getCourse:()=>'',getClock:t=>t,getSeekTime:t=>t,translate:()=>'',seek:t=>{videoTime=t;progressEvents++;},onCollapse:()=>{}});controls.update();
   window.placeCaption=()=>{const b=video.getBoundingClientRect(),caption=shadow.getElementById('caption');Object.assign(caption.style,{left:b.left+'px',top:(b.bottom-10)+'px',width:b.width+'px'});};
  });
  const host=page.locator('#host'),caption=host.locator('#caption');
  async function checkWebsiteControls(){
   await page.evaluate(()=>{placeCaption();controls.update();});
   const c=await caption.boundingBox();assert.equal(c.y+c.height,(await page.locator('video').boundingBox()).y+(await page.locator('video').boundingBox()).height-10,'rollback retains the original caption position');
   await page.evaluate(()=>{videoTime=10;controls.update();});const p=await host.locator('#zy-play-seek').boundingBox();await page.mouse.move(p.x+p.width*.2,p.y+p.height/2);await page.waitForTimeout(160);
   assert.equal(await caption.evaluate(e=>getComputedStyle(e).opacity),'1');assert.equal(await caption.locator('span').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
   await page.mouse.down();await page.mouse.move(p.x+p.width*.75,p.y+p.height/2,{steps:8});await page.mouse.up();assert.ok(Number(await host.locator('#zy-play-seek').inputValue())>60);assert.ok(await page.evaluate(()=>progressEvents)>0);
   await page.mouse.move(100,100);await page.waitForTimeout(160);assert.equal(await caption.evaluate(e=>getComputedStyle(e).opacity),'1');
  }
  await checkWebsiteControls();
  await host.locator('#focus-fullscreen').click();await checkWebsiteControls();await page.screenshot({path:'.test-media/caption-controls-preview.png'});await page.evaluate(()=>document.exitFullscreen());
  // The single external bar stays usable even when the video is padded for below-video captions.
  await page.evaluate(()=>{document.querySelector('.vjs-control-bar').style.display='none';video.controls=true;video.style.cssText='box-sizing:border-box;padding-bottom:160px';placeCaption();controls.update();});
  let v=await page.locator('video').boundingBox(),c=await caption.boundingBox();assert.equal(c.y+c.height,v.y+v.height-10);
  await page.mouse.move(v.x+v.width/2,v.y+v.height-180);await page.waitForTimeout(160);assert.equal(await caption.evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.mouse.move(v.x+50,v.y+50);await page.waitForTimeout(160);assert.equal(await caption.evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.mouse.move(v.x+50,v.y+v.height-20);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForTimeout(160);assert.equal(await caption.evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.evaluate(()=>{const r=video.getBoundingClientRect();document.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+50,clientY:r.bottom-20,pointerType:'touch',bubbles:true}));});await page.waitForTimeout(160);assert.equal(await caption.evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.evaluate(()=>document.dispatchEvent(new PointerEvent('pointerup',{pointerType:'touch',bubbles:true})));await page.waitForTimeout(160);assert.equal(await caption.evaluate(e=>getComputedStyle(e).opacity),'1');
  assert.deepEqual(errors,[]);console.log('PASS: rolled-back subtitles stay visible while hovering/seeking in normal/fullscreen/native players; original geometry and click-through preserved.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
