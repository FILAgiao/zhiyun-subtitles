const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
 try{
 const page=await browser.newPage();const bytes=fs.readFileSync(process.argv[2]||'.test-media/lecture.mp4');
 const requests=[];let version='test-v1';
 await page.route('https://stream.test/',r=>r.fulfill({contentType:'text/html',body:'<video controls muted></video>'}));
 await page.route('https://stream.test/media',async r=>{const range=r.request().headers().range.match(/bytes=(\d+)-(\d+)/);const start=+range[1],end=Math.min(+range[2],bytes.length-1);requests.push(start);await r.fulfill({status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`,'etag':'"'+version+'"'},body:bytes.subarray(start,end+1)});});
 await page.goto('https://stream.test/');await page.addScriptTag({path:'progressive-cache.bundle.js'});
 await page.evaluate(async()=>{
  window.errors=[];window.states=[];const root=await navigator.storage.getDirectory();
  window.options={source:'https://stream.test/media',blockSize:65536,directory:async()=>root,
   load:async()=>window.manifest?structuredClone(window.manifest):null,save:async r=>{window.manifest=structuredClone(r);},onChange:s=>states.push(s),
   request:async(url,o)=>{const response=await fetch(url,{signal:o.signal,headers:{Range:`bytes=${o.range.start}-${o.range.end}`}});const m=response.headers.get('content-range').match(/bytes (\d+)-(\d+)\/(\d+)/);return{blob:await response.blob(),end:+m[2],total:+m[3],validator:response.headers.get('etag')};}};
  window.cache=await ZYProgressive.openCache(options);await cache.prepare(0,10);
 });
 const status=await page.evaluate(()=>states.at(-1));assert.ok(status.ranges[0][1]>=10);assert.equal(status.complete,false);assert.ok(status.bytes<bytes.length);
 await page.evaluate(async()=>{window.player=await cache.play(document.querySelector('video'),{paused:false,onError:e=>errors.push(e.message)});});
 await page.waitForFunction(()=>document.querySelector('video').currentTime>1,{},{timeout:15000});
 assert.equal(await page.evaluate(()=>document.querySelector('video').videoWidth),320);
 assert.equal(await page.evaluate(()=>cache.complete()),false);
 await page.evaluate(()=>document.querySelector('video').currentTime=35);
 await page.waitForFunction(()=>document.querySelector('video').currentTime>36,{},{timeout:15000});
 await page.evaluate(()=>document.querySelector('video').currentTime=2);
 await page.waitForFunction(()=>document.querySelector('video').currentTime>3 && document.querySelector('video').currentTime<10,{},{timeout:15000});
 await page.evaluate(()=>document.querySelector('video').currentTime=44);
 await page.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:15000});
 await page.evaluate(()=>{document.querySelector('video').currentTime=2;document.querySelector('video').play();});
 await page.waitForFunction(()=>document.querySelector('video').currentTime>3 && document.querySelector('video').currentTime<10,{},{timeout:15000});
 assert.deepEqual(await page.evaluate(()=>errors),[]);
 await page.evaluate(()=>{cache.close();});
 const before=requests.length;
 await page.evaluate(async()=>{window.cache=await ZYProgressive.openCache(options);await cache.prepare(0,10);});
 assert.equal(requests.length,before,'cached prefix plays without downloading again');
 await page.evaluate(async()=>{const last=Math.max(...Object.keys(cache.record.parts).map(Number));delete cache.record.parts[last];await options.save(cache.record);cache.close();window.cache=await ZYProgressive.openCache(options);});
 version='changed-version';
 const mismatch=await page.evaluate(async()=>{try{await cache.download();return '';}catch(e){return e.message;}});
 assert.match(mismatch,/源文件无法核验或已改变/);
 version='test-v1';await page.evaluate(async()=>{cache.close();window.cache=await ZYProgressive.openCache(options);await cache.download();});
 assert.equal(await page.evaluate(()=>cache.complete()),true);
 await page.evaluate(()=>cache.close());
 console.log('PASS: real MP4 audio/video decode before full download, seeking forward/back, disk prefix reuse, complete download.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
