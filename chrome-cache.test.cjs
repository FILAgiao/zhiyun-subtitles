const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {unsafeLegacyHandles}=require('./cache-storage.js');
assert.equal(unsafeLegacyHandles('Windows Chrome/153.0.0.0 Safari/537.36'),true);
assert.equal(unsafeLegacyHandles('Windows Chrome/153.0.0.0 Edg/153.0.0.0'),false);
assert.equal(unsafeLegacyHandles('Windows Chrome/152.0.0.0'),false);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
 try{
  console.log('Browser:',await browser.version());
  const bytes=fs.readFileSync('.test-media/lecture.mp4'),errors=[],page=await browser.newPage();let ranges=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('crash',()=>errors.push('RENDERER CRASHED'));
  await page.route('https://chrome-cache.test/',r=>r.fulfill({contentType:'text/html',body:'<title>缓存兼容回归</title><video muted controls style="width:700px;height:400px" src="https://vod.cmc.zju.edu.cn/lecture.mp4"></video>'}));
  await page.route('https://vod.cmc.zju.edu.cn/**',r=>r.abort());
  await page.route('https://chrome-cache.test/media',r=>{const range=r.request().headers().range;if(!range)return r.fulfill({contentType:'video/mp4',body:bytes});ranges++;const m=range.match(/bytes=(\d+)-(\d+)/),start=+m[1],end=Math.min(+m[2],bytes.length-1);return r.fulfill({status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`,etag:'"chrome-v1"'},body:bytes.subarray(start,end+1)});});
  await page.goto('https://chrome-cache.test/#/replay?course_id=chrome&sub_id=1');
  const setup=async()=>{
   await page.evaluate(()=>{window.GM_getValue=(k,d)=>k==='cache-auto'?false:d;window.GM_setValue=()=>{};window.GM_deleteValue=()=>{};window.GM_registerMenuCommand=()=>{};
    window.GM_xmlhttpRequest=o=>{const control=new AbortController();fetch('https://chrome-cache.test/media',{headers:o.headers,signal:control.signal}).then(async r=>o.onload({status:r.status,response:await r.blob(),responseHeaders:'Content-Range: '+r.headers.get('content-range')+'\nETag: '+r.headers.get('etag')})).catch(e=>e.name==='AbortError'?o.onabort?.():o.onerror?.());return{abort(){control.abort();}};};});
   await page.addScriptTag({path:'zhiyun-subtitles.user.js'});await page.waitForTimeout(250);
  };
  const click=id=>page.evaluate(id=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById(id).click(),id);
  const waitText=(id,text)=>page.waitForFunction(({id,text})=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById(id).textContent.includes(text),{id,text},{timeout:20000}).catch(async error=>{console.error('UI status:',await page.evaluate(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('cache-status').textContent),'errors:',errors);throw error;});
  const manifest=key=>page.evaluate(key=>ZYCacheStorage.create().get(key),key);
  const key=JSON.stringify(['chrome','1',null]);
  const disk=()=>page.evaluate(async()=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('zhiyun-videos');const out=[];for await(const [name,h]of dir.entries())if(h.kind==='file')out.push(name);return out;});
  const decode=async()=>{await click('cache-play');await page.waitForFunction(()=>document.querySelector('video').src.startsWith('blob:')&&document.querySelector('video').readyState>=2);await page.evaluate(()=>document.querySelector('video').play());await page.waitForFunction(()=>document.querySelector('video').currentTime>.4,{},{timeout:15000});assert.equal(await page.evaluate(()=>document.querySelector('video').videoWidth),320);};
  const clear=async()=>{await click('cache-clear');await waitText('cache-status','已清除');assert.equal(await manifest(key),undefined);assert.equal(await manifest('stream:'+key),undefined);assert.deepEqual(await disk(),[]);};
  await setup();
  // Import a full video via the real userscript input, then discard all JS state.
  await page.locator('#zy-subtitle-host').locator('#cache-file').setInputFiles('.test-media/lecture.mp4');await waitText('cache-status','导入完成');
  let record=await manifest(key);assert.equal(record.directory,undefined);assert.deepEqual(record.location,{kind:'opfs',path:'zhiyun-videos'});
  await page.reload();await setup();await decode();await clear();console.log('Full cache: refreshed, decoded, deleted');
  // Cache and decode the same MP4 through the range/OPFS/MediaSource engine.
  await click('cache-download');await waitText('cache-stage','完整缓存已就绪');record=await manifest('stream:'+key);assert.equal(record.directory,undefined);assert.equal(record.complete,true);assert.deepEqual(record.location,{kind:'opfs',path:'zhiyun-videos'});
  const before=ranges;await page.reload();await setup();await decode();assert.equal(ranges,before,'complete cached stream must decode after refresh without network reads');
  await page.evaluate(()=>document.querySelector('video').currentTime=20);await page.waitForFunction(()=>document.querySelector('video').currentTime>20.4,{},{timeout:15000});await clear();
  // Simulate an external selection using a separate real OPFS directory. The ID
  // file is real; handles are deliberately NOT persisted to IndexedDB.
  await page.evaluate(async()=>{const store=ZYCacheStorage.create(),external=await(await navigator.storage.getDirectory()).getDirectoryHandle('external-fixture',{create:true});await store.selectDirectory(external,'Test disk');const location=await store.location();await store.put({kind:'opfs',name:'test.video',location,size:1},'external-course');});
  await page.reload();await setup();
  const external=await page.evaluate(async()=>{const store=ZYCacheStorage.create(),record=await store.get('external-course');let blocked='';try{await store.directory(record);}catch(e){blocked=e.message;}const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('external-fixture');await store.selectDirectory(dir,'Test disk');return{blocked,same:await(await store.directory(record)).isSameEntry(dir),config:await store.get('cache-folder')};});
  assert.match(external.blocked,/重新选择原文件夹/);assert.equal(external.same,true);assert.equal(external.config.handle,undefined);
  assert.deepEqual(errors,[]);await page.close();
  // An actual old store contains directory handles. Chrome 153 may enumerate
  // its keys but must never deserialize its values. Complete video rescue uses
  // filesystem entries directly and lets the user confirm the course mapping.
  const legacy=await browser.newPage();const legacyErrors=[];legacy.on('pageerror',e=>legacyErrors.push(e.message));legacy.on('crash',()=>legacyErrors.push('RENDERER CRASHED'));
  await legacy.route('https://legacy-cache.test/',r=>r.fulfill({contentType:'text/html',body:'<video muted controls src="https://vod.cmc.zju.edu.cn/lecture.mp4"></video>'}));await legacy.route('https://vod.cmc.zju.edu.cn/**',r=>r.abort());await legacy.route('https://legacy-cache.test/media',r=>r.fulfill({contentType:'video/mp4',body:bytes}));await legacy.goto('https://legacy-cache.test/#/replay?course_id=old&sub_id=1');
  await legacy.evaluate(async()=>{const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('zhiyun-videos',{create:true}),writer=await(await directory.getFileHandle('old.video',{create:true})).createWritable(),blob=await(await fetch('/media')).blob();await writer.write(blob);await writer.close();const partial=await(await directory.getFileHandle('old-stream-0.part',{create:true})).createWritable();await partial.write(new Uint8Array(8));await partial.close();await new Promise((resolve,reject)=>{const request=indexedDB.open('zhiyun-video-cache',1);request.onupgradeneeded=()=>request.result.createObjectStore('videos');request.onsuccess=()=>{const db=request.result,tx=db.transaction('videos','readwrite'),s=tx.objectStore('videos');s.put({kind:'opfs',name:'old.video',size:blob.size,type:'video/mp4',directory},'old-course');s.put({kind:'stream-v1',directory,id:'old-stream',parts:{0:{name:'old-stream-0.part',size:8}}},'stream:old-course');s.put({handle:directory,label:'Old folder'},'cache-folder');s.put({key:'old-course',source:'https://vod.cmc.zju.edu.cn/lecture.mp4',visited:1},'seen:old-course');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});});
  await legacy.addScriptTag({path:'cache-storage.js'});
  const blocked=await legacy.evaluate(async()=>{window.storage=ZYCacheStorage.create({userAgent:'Mozilla/5.0 (Windows NT 10.0) Chrome/153.0.0.0'});await storage.ready();return{info:await storage.info(),old:await storage.get('old-course'),seen:await storage.get('seen:old-course'),files:await storage.recoverableVideos()};});
  assert.equal(blocked.info.blockedLegacy,true);assert.equal(blocked.info.legacyKeys.length,3);assert.equal(blocked.old,undefined);assert.equal(blocked.seen.key,'old-course');assert.equal(blocked.files.videos[0].name,'old.video');assert.equal(blocked.files.parts,1);
  await legacy.evaluate(async()=>{const file=await storage.recoverVideo('old.video','confirmed-course');const v=document.querySelector('video');v.src=URL.createObjectURL(file);await v.play();});await legacy.waitForFunction(()=>document.querySelector('video').currentTime>.4,{},{timeout:15000});
  const remaining=await legacy.evaluate(async()=>{const keys=await new Promise(resolve=>{const r=indexedDB.open('zhiyun-video-cache',2);r.onsuccess=()=>{const db=r.result,tx=db.transaction('videos'),q=tx.objectStore('videos').getAllKeys();q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close();};});const files=[];for await(const [name]of(await storage.defaultDirectory()).entries())files.push(name);return{keys,files,record:await storage.get('confirmed-course')};});
  assert.equal(remaining.keys.length,4,'legacy store must remain intact');assert.ok(remaining.files.includes('old.video'));assert.ok(remaining.files.includes('old-stream-0.part'));assert.equal(remaining.record.directory,undefined);assert.deepEqual(legacyErrors,[]);
  // Deleting a quarantined lesson must not claim success or discard its marker.
  await legacy.evaluate(()=>{location.hash='#/replay?course_id=old-course';window.GM_getValue=(k,d)=>k==='cache-auto'?false:d;window.GM_setValue=()=>{};window.GM_deleteValue=()=>{};window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>({abort(){}});});
  await legacy.addScriptTag({path:'zhiyun-subtitles.user.js'});
  const currentLegacyKey=JSON.stringify(['old-course',null,null]);
  await legacy.evaluate(async key=>{const request=indexedDB.open('zhiyun-video-cache',2);await new Promise((resolve,reject)=>{request.onsuccess=()=>{const db=request.result,tx=db.transaction('videos','readwrite');tx.objectStore('videos').put({kind:'stream-v1',id:'legacy'},'stream:'+key);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});},currentLegacyKey);
  await legacy.reload();await legacy.evaluate(()=>{window.GM_getValue=(k,d)=>k==='cache-auto'?false:d;window.GM_setValue=()=>{};window.GM_deleteValue=()=>{};window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>({abort(){}});});await legacy.addScriptTag({path:'zhiyun-subtitles.user.js'});
  await legacy.locator('#zy-subtitle-host').locator('#cache-clear').evaluate(e=>e.click());
  await legacy.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('cache-status').textContent.includes('旧缓存'));
  assert.match(await legacy.locator('#zy-subtitle-host').locator('#cache-status').textContent(),/尚未删除或释放空间/);assert.deepEqual(legacyErrors,[]);await legacy.close();
  console.log('PASS: real full + progressive caches survive refresh, decode and seek without IDB handles; deletion releases disk; external folder reauthorization; Chrome 153 legacy isolation and complete-video rescue retain old files/store.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
