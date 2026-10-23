const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const native=process.argv.includes('--extension'),source=process.env.PLAYER_LOADING_SOURCE||'zhiyun-subtitles.user.js';
const fixture=`<style>body{margin:0;background:#fff}.cmc-main{position:relative;width:960px;height:650px;background:#000}.cmc-main:fullscreen{width:100vw!important;height:100vh!important}.cmc-base{position:absolute;inset:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center}.cmc-player{display:block}.player-content{position:relative;width:100%;height:100%}.cmc-video{background:#000}.spoken-language-body,.note-scroll_body{display:none}</style><div class="cmc-main" id="player"><div class="cmc-base cmc-player"><div class="player-content"><div class="cmc-base cmc-video"><video id="cmc_player_video" width="100%" height="100%" controls muted preload="auto" src="https://media.test/loading.mp4" style="padding-bottom:7px!important;object-fit:contain;box-sizing:border-box"></video></div></div></div></div><div class="spoken-language-body"><div class="voice-body_wrap"><div class="trans-list_wrap"><p class="item-time">00:00:00</p><div class="trans-item"><div class="item-origin">A real delayed media source keeps its timeline at the bottom.</div></div></div></div></div><div class="note-scroll_body"><div class="note-ppt_item"><div class="ppt_wrap"><div class="ppt_order">1</div><div class="ppt_time">00:00:00</div><img src="https://media.test/slide.svg"></div></div></div>`;
(async()=>{
 const dir=path.resolve(process.env.PLAYER_LOADING_EXTENSION||'dist/extension');
 const browser=native?null:await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=native?await chromium.launchPersistentContext(path.resolve('.test-media/player-loading-edge-'+Date.now()),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1440,height:900},args:['--disable-extensions-except='+dir,'--load-extension='+dir]}):await browser.newContext({viewport:{width:1440,height:900}});
 let release;const gate=new Promise(r=>release=r),evidence=[];
 try{
  if(native){const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(async()=>{await chrome.storage.local.set({'cache-auto':false,'gateway-guide-no-remind-v2':true});});}
  await context.route('**/*',async r=>{
   if(r.request().isNavigationRequest())return r.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
   if(r.request().url().endsWith('loading.mp4')){await gate;const body=fs.readFileSync('.test-media/lecture.mp4'),range=r.request().headers().range?.match(/bytes=(\d+)-(\d*)/),start=Number(range?.[1]||0),end=range?.[2]?Math.min(Number(range[2]),body.length-1):body.length-1;return r.fulfill({status:range?206:200,headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})},contentType:'video/mp4',body:body.subarray(start,end+1)});}
   if(r.request().url().endsWith('slide.svg'))return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#eed0a0"/></svg>'});
   return r.abort();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  const session=await context.newCDPSession(page);await session.send('DOM.enable');
  await page.goto('https://classroom.zju.edu.cn/livingroom?course_id=player-loading&sub_id=1&tenant_code=112',{waitUntil:'domcontentloaded'});
  if(!native){await page.evaluate(()=>{const values={'cache-auto':false,'gateway-guide-no-remind-v2':true};window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;window.GM_deleteValue=k=>delete values[k];window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>({abort(){}});});await page.addScriptTag({content:fs.readFileSync(source,'utf8').replace(/const DEFAULT_ORIGIN=[^;]+;/,'const DEFAULT_ORIGIN="";')});}
  const ui=page.locator('#zy-subtitle-host'),video=page.locator('#cmc_player_video');await ui.locator('#show-slides').waitFor();
  await page.waitForFunction(()=>document.querySelector('video').hasAttribute('data-zy-enhanced'));
  async function nativeBox(pseudo){
   const {root}=await session.send('DOM.getDocument',{depth:-1,pierce:true});const matches=[];let target;
   function select(n){const a=n.attributes||[];if(a.some((v,i)=>i%2===0&&v==='id'&&a[i+1]==='cmc_player_video'))target=n;for(const c of n.children||[])select(c);}select(root);assert.ok(target);
   function walk(n){const a=n.attributes||[];if(a.some((v,i)=>i%2===0&&v==='pseudo'&&a[i+1]===pseudo))matches.push(n);for(const c of [...(n.children||[]),...(n.shadowRoots||[])])walk(c);}walk(target);
   for(const n of matches){try{const {model}=await session.send('DOM.getBoxModel',{nodeId:n.nodeId});return {x:model.border[0],y:model.border[1],width:model.border[2]-model.border[0],height:model.border[5]-model.border[1],bottom:model.border[5]};}catch{}}throw Error('No visible native control: '+pseudo);
  }
  async function check(label){
   await video.hover({force:true});const v=await video.boundingBox(),p=await nativeBox('-webkit-media-controls-timeline');
   evidence.push({label,ready:await video.evaluate(v=>v.readyState),bottom:v.y+v.height,timelineBottom:p.bottom,padding:await video.evaluate(v=>getComputedStyle(v).paddingBottom)});
   assert.ok(Math.abs(v.y+v.height-p.bottom-7)<2,label+': native timeline stays at video bottom; gap='+(v.y+v.height-p.bottom));return p;
  }
  assert.equal(await video.evaluate(v=>v.readyState),0);assert.equal(await video.evaluate(v=>v.videoHeight),0);await check('before metadata');
  await page.screenshot({path:'.test-media/player-loading-'+(native?'edge':'chrome')+'-before.png'});
  release();await page.waitForFunction(()=>document.querySelector('video').readyState>=2);await check('first decoded frame');
  const play=await nativeBox('-webkit-media-controls-play-button');await page.mouse.click(play.x+play.width/2,play.y+play.height/2);await page.waitForFunction(()=>!document.querySelector('video').paused);await page.mouse.click(play.x+play.width/2,play.y+play.height/2);await page.waitForFunction(()=>document.querySelector('video').paused);
  await page.waitForFunction(()=>{const v=document.querySelector('video');return v.seekable.length&&v.seekable.end(v.seekable.length-1)>30;});const timeline=await check('native seek');await page.mouse.move(timeline.x+timeline.width*.25,timeline.y+timeline.height/2);await page.mouse.down();await page.mouse.move(timeline.x+timeline.width*.75,timeline.y+timeline.height/2,{steps:8});await page.mouse.up();await page.waitForFunction(()=>document.querySelector('video').currentTime>25);
  await page.evaluate(()=>{const p=document.getElementById('player');p.style.width='740px';p.style.height='360px';});await page.waitForFunction(()=>document.querySelector('video').getBoundingClientRect().height===360);await check('resized');
  await ui.locator('#focus-fullscreen').click();await page.waitForFunction(()=>!!document.fullscreenElement&&document.querySelector('video').getBoundingClientRect().height===900);await check('fullscreen');await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>!document.fullscreenElement&&document.querySelector('video').getBoundingClientRect().height===360);await check('exit fullscreen');
  await ui.locator('#show-slides').click();await page.waitForFunction(()=>document.querySelector('video').style.width==='50%');await check('PPT split');
  // Native controls retain the site's box; website controls still get the reserved subtitle band.
  await ui.locator('#placement').evaluate(e=>{e.value='overlay';e.dispatchEvent(new Event('change'));});await page.waitForFunction(()=>document.querySelector('video').style.paddingBottom==='7px');
  assert.equal(await video.evaluate(v=>v.style.getPropertyValue('padding-bottom')),'7px');assert.equal(await video.evaluate(v=>v.style.getPropertyPriority('padding-bottom')),'important');
  await ui.locator('#placement').evaluate(e=>{e.value='below';e.dispatchEvent(new Event('change'));});await page.waitForTimeout(150);await check('restored below');
  await video.evaluate(v=>v.controls=false);await page.waitForFunction(()=>document.querySelector('video').style.paddingBottom==='144px');
  await video.evaluate(v=>v.controls=true);await page.waitForFunction(()=>document.querySelector('video').style.paddingBottom==='7px');await check('website to native controls');
  await video.evaluate(v=>v.controls=false);await page.waitForFunction(()=>document.querySelector('video').style.paddingBottom==='144px');
  await ui.locator('#enabled').evaluate(e=>{e.checked=false;e.dispatchEvent(new Event('change'));});await page.waitForFunction(()=>document.querySelector('video').style.paddingBottom==='7px');assert.equal(await video.evaluate(v=>v.style.getPropertyPriority('padding-bottom')),'important');
  assert.deepEqual(errors,[]);fs.writeFileSync('.test-media/player-loading-'+(native?'edge':'chrome')+'-verification.json',JSON.stringify({mode:native?'real Edge MV3':'Chrome userscript',evidence,native_pause_resume:true,native_seek:true,style_restoration:true},null,2)+'\n');
  console.log('PASS: '+(native?'real Edge MV3':'Chrome userscript')+' delayed real media, native timeline before metadata/after frame/resize/fullscreen/PPT, actual pause/resume/drag seek and style restoration.');
 }finally{release();await context.close();await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
