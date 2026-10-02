const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});
 try {
  const page=await browser.newPage(),bytes=fs.readFileSync('.test-media/long-lecture.mp4'),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let releasePrefix,holdPrefix=true;const prefixGate=()=>new Promise(resolve=>{releasePrefix=resolve;});let prefix=prefixGate();
  let releaseTail;const tail=new Promise(resolve=>{releaseTail=resolve;});
  await page.route('https://cache.test/',route=>route.fulfill({contentType:'text/html',body:'<title>缓存回归课堂</title><video muted controls src="https://vod.cmc.zju.edu.cn/lecture.mp4"></video>'}));
  await page.route('https://vod.cmc.zju.edu.cn/**',route=>route.abort());
  await page.route('https://cache.test/part',async route=>{
   const m=route.request().headers().range.match(/bytes=(\d+)-(\d+)/),start=+m[1],end=Math.min(+m[2],bytes.length-1);
   if(start>=12*1024*1024)await tail;else if(start>=2*1024*1024&&holdPrefix)await prefix;
   await route.fulfill({status:206,headers:{'content-range':'bytes '+start+'-'+end+'/'+bytes.length,etag:'"course-v1"'},body:bytes.subarray(start,end+1)}).catch(()=>{});
  });
  await page.goto('https://cache.test/#/replay?course_id=deletion&sub_id=1');
  await page.evaluate(()=>{
   const values={};window.GM_getValue=(key,fallback)=>values[key]??fallback;window.GM_setValue=(key,value)=>{values[key]=value;};window.GM_deleteValue=key=>{delete values[key];};window.GM_registerMenuCommand=()=>{};
   window.GM_xmlhttpRequest=options=>{const controller=new AbortController();fetch('https://cache.test/part',{headers:options.headers,signal:controller.signal}).then(async response=>options.onload({status:response.status,response:await response.blob(),responseHeaders:'Content-Range: '+response.headers.get('content-range')+'\nETag: '+response.headers.get('etag')})).catch(error=>error.name==='AbortError'?options.onabort?.():options.onerror?.());return{abort(){controller.abort();}};};
  });
  await page.addScriptTag({path:'progressive-cache.bundle.js'});await page.addScriptTag({path:'zhiyun-subtitles.user.js'});
  const ui=page.locator('#zy-subtitle-host');
  const click=async id=>{
   if(id==='cache-auto'){await ui.locator('#settings-open').click();await ui.locator('#settings-tab-storage').click();await ui.locator('#'+id).click();await ui.locator('#settings-close').click();return;}
   if(!await ui.locator('#study-cache').evaluate(e=>e.open))await ui.locator('#study-cache > summary').click();
   const group=id.startsWith('batch-')?'cache-batch':['cache-play','cache-online','cache-clear'].includes(id)?'cache-details':null;
   if(group&&!await ui.locator('#'+group).evaluate(e=>e.open))await ui.locator('#'+group+' > summary').click();
   await ui.locator('#'+id).click();
  };
  const text=id=>page.evaluate(id=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById(id).textContent,id);
  const ready=()=>page.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('cache-stage').textContent.includes('3 / 3'),{},{timeout:20000});
  const clear=async()=>{await click('cache-clear');await page.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('cache-status').textContent.includes('已清除'),{},{timeout:15000});await emptyDisk();};
  const emptyDisk=async()=>{
   const state=await page.evaluate(async()=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('zhiyun-videos');let files=0;for await(const f of dir.values())if(f.name.endsWith('.part')||f.name.endsWith('.video'))files++;const record=await new Promise(resolve=>{const request=indexedDB.open('zhiyun-video-cache',2);request.onsuccess=()=>{const db=request.result,tx=db.transaction('videos-v2'),read=tx.objectStore('videos-v2').get('stream:'+JSON.stringify(['deletion','1',null]));read.onsuccess=()=>resolve(read.result);tx.oncomplete=()=>db.close();};});return{files,exists:!!record,locks:(await navigator.locks.query()).held.map(lock=>lock.name)};});
   assert.equal(state.files,0,'delete must reclaim real OPFS blocks');assert.equal(state.exists,false,'delete removes manifest');assert.ok(!state.locks.some(name=>name.startsWith('zhiyun-cache:')),'delete must release its own stream lock');
  };
  await page.waitForTimeout(250);await click('cache-download');
  await page.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('cache-stage').textContent.includes('2 / 3'),{},{timeout:20000});
  assert.match(await text('cache-stage'),/10 分钟/);
  const progress=await page.evaluate(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('cache-progress').value);assert.ok(progress>=0&&progress<100,'prepare shows actual incomplete target progress');
  holdPrefix=false;releasePrefix();await ready();
  assert.ok(await page.evaluate(()=>document.querySelector('video').src.startsWith('blob:')),'ready prefix automatically becomes the playback source');
  assert.equal(await page.evaluate(()=>document.querySelector('video').paused),true,'automatic switch preserves paused state');
  await clear();await new Promise(resolve=>setTimeout(resolve,100));await emptyDisk();
  // Auto disabled remains online. The list action can delete while a background task still owns the cache.
  await click('cache-auto');await click('cache-download');await ready();
  assert.ok(await page.evaluate(()=>document.querySelector('video').src.startsWith('https:')),'disabled auto setting is respected');
  await click('batch-add');await page.waitForFunction(()=>[...document.querySelector('#zy-subtitle-host').shadowRoot.querySelectorAll('#batch-list button')].some(button=>button.textContent==='删除缓存'));await ui.locator('#batch-list').getByRole('button',{name:'删除缓存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('batch-status').textContent.includes('磁盘空间已释放'),{},{timeout:15000});await emptyDisk();
  // An explicit online choice during preparation wins over automatic source switching.
  await click('cache-auto');holdPrefix=true;prefix=prefixGate();await click('cache-download');
  await page.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('cache-stage').textContent.includes('2 / 3'),{},{timeout:20000});await click('cache-online');holdPrefix=false;releasePrefix();await ready();
  assert.ok(await page.evaluate(()=>document.querySelector('video').src.startsWith('https:')),'explicit online selection is respected');await clear();
  // Full-file caches and abandoned pending imports use the same one-click cleanup path.
  await page.evaluate(async()=>{
   const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('zhiyun-videos'),key=JSON.stringify(['deletion','1',null]);
   for(const [suffix,name] of [['','complete.video'],[':pending','abandoned.video']]){
    const writer=await(await directory.getFileHandle(name,{create:true})).createWritable();await writer.write(new Uint8Array(32));await writer.close();
    await new Promise((resolve,reject)=>{const request=indexedDB.open('zhiyun-video-cache',2);request.onsuccess=()=>{const db=request.result,tx=db.transaction('videos-v2','readwrite');tx.objectStore('videos-v2').put({kind:'opfs',name,size:32,type:'video/mp4',location:{kind:'opfs',path:'zhiyun-videos'}},key+suffix);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});
   }
  });await clear();
  releaseTail();assert.deepEqual(errors,[]);
  console.log('PASS: true preparation progress, automatic ready switch, pause preservation, single-click active deletion, catalog deletion, released disk and locks, disabled auto and explicit online preference.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
