const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  for(const childSource of [false,true]){
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const source='https://interactivemeta.cmc.zju.edu.cn/media.mp4';
   await page.route('https://interactivemeta.cmc.zju.edu.cn/**',route=>{
    if(route.request().url().includes('.mp4')){const bytes=fs.readFileSync('.test-media/lecture.mp4'),range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;return route.fulfill({status:206,contentType:'video/mp4',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)});}return route.fulfill({contentType:'video/mp4',headers:{'accept-ranges':'bytes'},body:bytes});}
    return route.fulfill({contentType:'text/html',body:`<div class="video-player"><video muted style="width:800px;height:450px" ${childSource?'':`src="${source}"`}>${childSource?`<source src="${source}" type="video/mp4">`:''}</video><div class="vjs-control-bar">网站进度条</div></div>`});
   });
   await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=real-switch&sub_id='+Number(childSource));
   await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
   await page.evaluate(async()=>{
    window.GM_getValue=(key,fallback)=>key==='gateway-guide-no-remind-v2'?true:key==='cache-auto'?false:fallback;window.GM_setValue=()=>{};window.GM_deleteValue=()=>{};window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>({abort(){}});
    const blob=await(await fetch('/media.mp4')).blob(),key=JSON.stringify(['real-switch',String(Number(!document.querySelector('video').hasAttribute('src'))),null]);
    await new Promise((resolve,reject)=>{const request=indexedDB.open('zhiyun-video-cache',2);request.onupgradeneeded=()=>{for(const name of ['videos','videos-v2','cache-meta'])request.result.createObjectStore(name);};request.onsuccess=()=>{const db=request.result,tx=db.transaction('videos-v2','readwrite');tx.objectStore('videos-v2').put(blob,key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});
   });
   await page.addScriptTag({path:'zhiyun-subtitles.user.js'});const ui=page.locator('#zy-subtitle-host');await page.waitForTimeout(250);if(await ui.locator('#guide-skip').isVisible())await ui.locator('#guide-skip').click();
   await ui.locator('#cache-details-toggle').click();
   assert.equal(await ui.locator('#cache-progress-area').isVisible(),false);
   assert.equal(await ui.locator('#batch-add').count(),0);
   assert.equal(await ui.locator('#cache-play').isVisible(),true);assert.equal(await ui.locator('#cache-online').isVisible(),false);
   for(let i=0;i<3;i++){
    await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=Math.min(1,v.duration/3);v.playbackRate=1.5;});
    await page.waitForFunction(()=>document.querySelector('video').currentTime>.1);
    if(i===1)await page.locator('.video-player video').evaluate(v=>v.play());
    await ui.locator('#cache-play').click();await page.waitForFunction(()=>{const v=document.querySelector('video');return v.currentSrc.startsWith('blob:')&&v.readyState>=2&&v.currentTime>.1;},{},{timeout:7000}).catch(async e=>{console.error(await page.evaluate(()=>{const v=document.querySelector('video'),s=document.querySelector('#zy-subtitle-host').shadowRoot;return{src:v.src,current:v.currentSrc,time:v.currentTime,ready:v.readyState,error:v.error?.code,status:s.getElementById('cache-status').textContent};}));throw e;});
    assert.equal(await ui.locator('#cache-details-toggle').textContent(),'🟢 使用缓存中');
    assert.equal(await ui.locator('#cache-play').isVisible(),false);assert.equal(await ui.locator('#cache-online').isVisible(),true);assert.equal(await ui.locator('#stream-play').isVisible(),false);
    await ui.locator('#cache-details-toggle').click();assert.equal(await ui.locator('#cache-details-toggle').textContent(),'🟢 使用缓存中');await ui.locator('#cache-details-toggle').click();
    assert.equal(await page.locator('.video-player video').evaluate(v=>v.controls),true);assert.equal(await page.locator('.vjs-control-bar').evaluate(e=>getComputedStyle(e).display),'none');
    await ui.locator('#cache-online').click();await page.waitForFunction(()=>{const v=document.querySelector('video');return v.currentSrc.startsWith('https:')&&v.readyState>=2&&v.currentTime>.1;},{},{timeout:7000}).catch(async e=>{console.error(await page.evaluate(()=>{const v=document.querySelector('video'),s=document.querySelector('#zy-subtitle-host').shadowRoot;return{src:v.src,current:v.currentSrc,time:v.currentTime,ready:v.readyState,error:v.error?.code,status:s.getElementById('cache-status').textContent};}));throw e;});
    const state=await page.locator('.video-player video').evaluate(v=>({time:v.currentTime,rate:v.playbackRate,paused:v.paused,width:v.videoWidth,controls:v.controls,error:v.error?.code}));
    assert.ok(state.time>.1);assert.equal(await ui.locator('#cache-play').isVisible(),true);assert.equal(await ui.locator('#cache-online').isVisible(),false);assert.equal(state.rate,1.5);assert.equal(state.paused,i!==1);if(i!==1)assert.ok(Math.abs(state.time-1)<.2);assert.ok(state.width>0);assert.equal(state.error,undefined);assert.equal(state.controls,false);
    assert.notEqual(await page.locator('.vjs-control-bar').evaluate(e=>getComputedStyle(e).display),'none');assert.equal(await ui.locator('#cache-details-toggle').textContent(),'收起详情');
   }
   // currentSrc can still name the previous resource immediately after src changes.
   if(!childSource){
    await page.evaluate(()=>{const v=document.querySelector('video');v.src='/replacement.mp4';Object.defineProperty(v,'currentSrc',{configurable:true,get:()=> 'https://interactivemeta.cmc.zju.edu.cn/stale.mp4'});});
    await ui.locator('#cache-play').click();await page.waitForFunction(()=>document.querySelector('video').src.startsWith('blob:'));await ui.locator('#cache-online').click();assert.ok(await page.locator('.video-player video').evaluate(v=>v.src.endsWith('/replacement.mp4')));
   }
   await ui.locator('#cache-details > summary').click();await ui.locator('#cache-clear').click();await page.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('cache-status').textContent.includes('已清除'));
   assert.equal(await ui.locator('#cache-progress-area').isVisible(),false);assert.equal(await ui.locator('#cache-stage').textContent(),'');assert.equal(await ui.locator('#cache-online').isVisible(),false);
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS: real video switches repeatedly with src and source children; picture, clock, rate, pause, badge and single control bar recover; latest online URL survives.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
