const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // CMC puts the video in .cmc-video and the controls in a sibling of .player-content.
  await page.setContent('<style>body{margin:0;background:#202b38}.cmc-main{position:relative;width:960px;height:580px;margin:30px}.cmc-main:fullscreen{width:100vw;height:100vh;margin:0;background:#111}.cmc-base{position:absolute;inset:0}.player-content{position:relative;height:calc(100% - 40px)}video{width:100%;height:100%}.control-content{height:40px;width:100%;background:#ddd}.control-float{position:absolute;bottom:-100px}.cmc-control{height:100%;display:flex;align-items:center}input{width:85%;margin:auto}#host{position:fixed;inset:0;pointer-events:none;z-index:999}</style><div id="cmc_video" class="cmc-main"><div class="cmc-base cmc-player"><div class="player-content"><div class="cmc-base cmc-video"><video></video></div></div><div class="control-content"><div class="cmc-control"><input id="progress" type="range" min="0" max="100" value="10" aria-label="Playback position"><button title="全屏">Full screen</button></div></div></div></div><div id="host"></div>');
  await page.addScriptTag({path:'player-interactions.js'});
  await page.evaluate(()=>{
   const host=document.getElementById('host'),shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>button{pointer-events:auto;position:fixed;top:8px;right:8px}</style><button id="focus-fullscreen">课堂全屏</button><button id="fullscreen-recover" hidden></button><div id="fullscreen-notice" hidden></div><p id="slides-status"></p><div id="settings-dialog" hidden></div><div id="transcript" hidden></div><button id="transcript-close" hidden></button><button id="transcript-follow" hidden></button><div id="transcript-list"></div><div id="cache-transport"></div><div id="cache-status"></div>';
   window.video=document.querySelector('video');window.local=null;window.seekEvents=0;document.getElementById('progress').oninput=e=>{video.currentTime=Number(e.target.value);seekEvents++;};
   window.controls=ZYPlayerInteractions.mount({shadow,host,getVideo:()=>video,getLocal:()=>local,getCues:()=>[],getCourse:()=>'',getClock:t=>t,getSeekTime:t=>t,translate:()=>'',seek:t=>video.currentTime=t,onCollapse:()=>{}});controls.update();
  });
  async function checkProgress(){
   const p=await page.locator('#progress').boundingBox();assert.ok(p&&p.y>=0&&p.y+p.height<=800,'progress stays inside fullscreen viewport');
   const before=await page.evaluate(()=>seekEvents);await page.mouse.move(p.x+p.width*.2,p.y+p.height/2);await page.mouse.down();await page.mouse.move(p.x+p.width*.8,p.y+p.height/2,{steps:8});await page.mouse.up();assert.ok(Number(await page.locator('#progress').inputValue())>65);assert.ok(await page.evaluate(()=>seekEvents)>before,'real pointer drag reaches seek handler');
  }
  await checkProgress();await page.locator('#host').locator('#focus-fullscreen').click();
  await page.waitForFunction(()=>document.fullscreenElement?.id==='cmc_video'&&document.fullscreenElement.contains(document.getElementById('host')));assert.equal(await page.evaluate(()=>document.fullscreenElement.contains(document.querySelector('.control-content'))),true);assert.equal(await page.evaluate(()=>document.fullscreenElement.contains(document.getElementById('host'))),true);await checkProgress();
  // Fullscreen PPT moves the video independently; the website controls must remain above it.
  await page.evaluate(()=>{video.style.cssText='position:fixed;left:50%;top:0;width:50%;height:100%;z-index:20';document.querySelector('.control-content').classList.add('control-float');document.querySelector('.control-content').style.top='800px';});await checkProgress();
  await page.screenshot({path:'.test-media/classroom-fullscreen-controls.png'});
  await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.querySelector('[data-zy-classroom-fullscreen]'));assert.equal(await page.locator('.control-content').evaluate(e=>getComputedStyle(e).position),'absolute');
  await page.evaluate(()=>{video.style.cssText='';document.querySelector('.control-content').classList.remove('control-float');});
  // A website fullscreen click and redirected video API use the same complete root.
  await page.locator('.control-content button').click();await page.waitForFunction(()=>document.fullscreenElement?.id==='cmc_video');await checkProgress();await page.evaluate(()=>document.exitFullscreen());await page.evaluate(()=>video.requestFullscreen());await page.waitForFunction(()=>document.fullscreenElement?.id==='cmc_video');await checkProgress();await page.evaluate(()=>document.exitFullscreen());
  await page.evaluate(()=>{local={video,controls:false};controls.update();});assert.equal(await page.locator('video').evaluate(v=>v.controls),true);assert.equal(await page.locator('.control-content').evaluate(e=>getComputedStyle(e).display),'none');
  await page.evaluate(()=>{local=null;controls.update();});assert.equal(await page.locator('video').evaluate(v=>v.controls),false);assert.notEqual(await page.locator('.control-content').evaluate(e=>getComputedStyle(e).display),'none');
  await page.evaluate(async()=>{const root=document.querySelector('.cmc-main');root.requestFullscreen=async()=>{throw Error('denied');};try{await controls.enterFullscreen();}catch{};});assert.equal(await page.locator('.cmc-main').getAttribute('data-zy-classroom-fullscreen'),null);
  assert.deepEqual(errors,[]);console.log('PASS: CMC classroom/website/video fullscreen includes draggable progress; PPT stacking, cache controls, exit and failure restore.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
