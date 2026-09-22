const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),bytes=fs.readFileSync('.test-media/long-lecture.mp4');
 let release;const tail=new Promise(r=>release=r);const requests=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://classroom.test/',r=>r.fulfill({contentType:'text/html',body:'<style>video{width:800px;height:450px}</style><video muted src="https://vod.cmc.zju.edu.cn/lecture.mp4"></video>'}));
 await page.route('https://vod.cmc.zju.edu.cn/**',r=>r.abort());
 await page.route('https://classroom.test/part',async r=>{const m=r.request().headers().range.match(/bytes=(\d+)-(\d+)/),start=+m[1],end=Math.min(+m[2],bytes.length-1);requests.push(start);if(start>=12*1024*1024)await tail;await r.fulfill({status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`,etag:'"long-v1"'},body:bytes.subarray(start,end+1)}).catch(()=>{});});
 await page.goto('https://classroom.test/#/replay?course_id=stream&sub_id=1');
 const setup=async()=>{
 await page.evaluate(()=>{
 window.GM_getValue=(k,d)=>d;window.GM_setValue=()=>{};window.GM_deleteValue=()=>{};window.GM_registerMenuCommand=()=>{};
 window.GM_xmlhttpRequest=o=>{const controller=new AbortController();fetch('https://classroom.test/part',{headers:o.headers,signal:controller.signal}).then(async response=>o.onload({status:response.status,response:await response.blob(),responseHeaders:'Content-Range: '+response.headers.get('content-range')+'\nETag: '+response.headers.get('etag')})).catch(e=>e.name==='AbortError'?o.onabort?.():o.onerror?.());return{abort(){controller.abort();}};};
 });
 await page.addScriptTag({path:'progressive-cache.bundle.js'});await page.addScriptTag({path:'zhiyun-subtitles.user.js'});await page.waitForTimeout(200);
 };
 await setup();const ui=page.locator('#zy-subtitle-host');await ui.locator('summary').filter({hasText:'视频缓存'}).click();
 await ui.locator('#cache-download').click();await ui.locator('#stream-play').waitFor({state:'visible',timeout:30000});
 assert.match(await ui.locator('#stream-play').textContent(),/0:00–10:00 已就绪/);
 const manifest=await page.evaluate(()=>new Promise(resolve=>{const open=indexedDB.open('zhiyun-video-cache',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('videos'),r=tx.objectStore('videos').get('stream:'+JSON.stringify(['stream','1',null]));r.onsuccess=()=>resolve({complete:r.result.complete,count:Object.keys(r.result.parts).length,total:r.result.total});tx.oncomplete=()=>db.close();};}));
 assert.equal(manifest.complete,false);assert.ok(manifest.count*2*1024*1024<manifest.total);
 await ui.locator('#stream-minutes').selectOption('1200');assert.ok(await ui.locator('#stream-play').isHidden());await ui.locator('#stream-minutes').selectOption('600');
 await ui.locator('#stream-play').click();await page.waitForFunction(()=>document.querySelector('video').currentTime>1,{},{timeout:20000});
 assert.ok(await page.evaluate(()=>document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames>0));
 await page.screenshot({path:'progressive-preview.png'});
 await ui.locator('#cache-download').click();await page.waitForTimeout(200);assert.match(await ui.locator('#cache-status').textContent(),/停止/);
 // Close/reopen the actual page; IndexedDB + OPFS must survive, not just JS variables.
 await page.reload();release();await setup();await ui.locator('summary').filter({hasText:'视频缓存'}).click();
 const before=requests.length;await ui.locator('#cache-download').click();await ui.locator('#stream-play').waitFor({state:'visible',timeout:20000});
 await page.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('cache-status').textContent.includes('完整缓存已就绪'),{},{timeout:30000});
 const after=requests.slice(before);assert.ok(!after.includes(2*1024*1024),'reloaded downloader must reuse committed prefix blocks');
 await ui.locator('#stream-play').click();await page.waitForFunction(()=>document.querySelector('video').currentTime>1,{},{timeout:20000});
 await page.evaluate(()=>document.querySelector('video').currentTime=1000);await page.waitForFunction(()=>document.querySelector('video').currentTime>1001,{},{timeout:20000});
 await page.evaluate(()=>document.querySelector('video').currentTime=5);await page.waitForFunction(()=>document.querySelector('video').currentTime>6 && document.querySelector('video').currentTime<15,{},{timeout:20000});
 await ui.locator('#cache-details summary').click();await ui.locator('#cache-clear').click();await page.waitForTimeout(250);
 assert.match(await ui.locator('#cache-status').textContent(),/已清除/);
 assert.equal(await page.evaluate(async()=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('zhiyun-videos');let count=0;for await(const file of dir.values())if(file.name.endsWith('.part'))count++;return count;}),0);
 assert.deepEqual(errors,[]);console.log('PASS: userscript 10-minute readiness before full 25-minute download, actual decoded playback, cancellation, page reload resume, forward/back seek.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
