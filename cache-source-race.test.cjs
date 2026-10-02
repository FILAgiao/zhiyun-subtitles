const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cache-race.test/**',route=>route.fulfill({contentType:'text/html',body:'<video style="width:800px;height:450px" src="https://vod.cmc.zju.edu.cn/first.mp4"></video>'}));
  await page.route('https://vod.cmc.zju.edu.cn/**',route=>route.abort());
  await page.goto('https://cache-race.test/#/replay?course_id=race&sub_id=1');
  await page.evaluate(async()=>{
   window.GM_getValue=(key,fallback)=>key==='cache-auto'?false:fallback;window.GM_setValue=()=>{};window.GM_deleteValue=()=>{};window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>({abort(){}});
   const video=document.querySelector('video');Object.defineProperty(video,'readyState',{get:()=>1});video.load=()=>{};
   await new Promise((resolve,reject)=>{const request=indexedDB.open('zhiyun-video-cache',2);request.onupgradeneeded=()=>{for(const name of ['videos','videos-v2','cache-meta'])request.result.createObjectStore(name);};request.onsuccess=()=>{const db=request.result,tx=db.transaction('videos-v2','readwrite');tx.objectStore('videos-v2').put({kind:'stream-v1',complete:true,parts:{}},'stream:'+JSON.stringify(['race','1',null]));tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});
  });
  await page.addScriptTag({path:'zhiyun-subtitles.user.js'});
  await page.evaluate(()=>{
   window.plays=0;window.opens=0;window.closes=0;window.openGates=[];
   window.ZYProgressive={openCache:async()=>{window.opens++;await new Promise(resolve=>openGates.push(resolve));return {
    async play(video,{onAttach}){window.plays++;const playback={url:'blob:https://cache-race.test/cached-'+plays,dispose(){}};onAttach(playback);video.setAttribute('src',playback.url);return playback;},close(){window.closes++;},pause(){}
   };}};
  });
  const ui=page.locator('#zy-subtitle-host');
  const click=async id=>{if(!await ui.locator('#study-cache').evaluate(e=>e.open))await ui.locator('#study-cache > summary').click();if(!await ui.locator('#cache-details').evaluate(e=>e.open))await ui.locator('#cache-details > summary').click();await ui.locator('#'+id).click();};
  const release=()=>page.evaluate(()=>openGates.shift()());
  await page.waitForTimeout(200);await click('cache-play');await page.waitForFunction(()=>opens===1);
  await click('cache-online');await release();await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>plays),0,'a later online choice cancels the pending cache source switch');
  assert.ok(await page.evaluate(()=>document.querySelector('video').src.startsWith('https:')));
  // The opened session can still be used by a new explicit cache-play action.
  await click('cache-play');await page.waitForFunction(()=>plays===1);await click('cache-online');
  // A new signed/source URL legitimately closes the previous session. That internal
  // restore increments the epoch but must not be mistaken for user cancellation.
  await page.evaluate(()=>document.querySelector('video').src='https://vod.cmc.zju.edu.cn/second.mp4');await click('cache-play');await page.waitForFunction(()=>opens===2);await release();await page.waitForFunction(()=>plays===2);
  assert.equal(await page.evaluate(()=>closes),1);assert.ok(await page.evaluate(()=>document.querySelector('video').src.startsWith('blob:')));
  await click('cache-online');await page.evaluate(()=>document.querySelector('video').src='https://vod.cmc.zju.edu.cn/third.mp4');await click('cache-play');await page.waitForFunction(()=>opens===3);
  await click('cache-online');await release();await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>plays),2,'cancellation also wins during replacement of an older session');
  assert.deepEqual(errors,[]);console.log('PASS: delayed cache opening respects a later online choice; explicit retry and source replacement remain playable.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
