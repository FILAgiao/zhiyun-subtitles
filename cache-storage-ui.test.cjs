const assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.STORAGE_MIGRATION_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage();await page.route('https://migration.test/',r=>r.fulfill({body:'<title>Cache migration</title>',contentType:'text/html'}));await page.goto('https://migration.test/');
  await page.evaluate(async()=>{const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('zhiyun-videos',{create:true});await new Promise((resolve,reject)=>{const r=indexedDB.open('zhiyun-video-cache',1);r.onupgradeneeded=()=>r.result.createObjectStore('videos');r.onsuccess=()=>{const db=r.result,tx=db.transaction('videos','readwrite'),s=tx.objectStore('videos');s.put({kind:'opfs',name:'full.video',directory},'course');s.put({kind:'stream-v1',id:'part',directory,parts:{0:{name:'part-0.part',size:8}}},'stream:course');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});});
  await page.addScriptTag({path:'cache-storage.js'});
  const migrated=await page.evaluate(async()=>{window.store=ZYCacheStorage.create({userAgent:'Windows Edg/153.0.0.0'});return {full:await store.get('course'),part:await store.get('stream:course'),info:await store.info()};});
  assert.equal(migrated.full.directory,undefined);assert.equal(migrated.part.directory,undefined);assert.equal(migrated.full.location.kind,'opfs');assert.deepEqual(migrated.info.legacyKeys,[]);
  // A synchronous failure of the second write must abort the first one too.
  const atomic=await page.evaluate(async()=>{await store.put({name:'before'},'atomic');const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='cache-meta'&&key==='atomic')throw new DOMException('Injected','QuotaExceededError');return original.call(this,value,key);};let failed=false;try{await store.put({name:'after'},'atomic');}catch{failed=true;}finally{IDBObjectStore.prototype.put=original;}return{failed,record:await store.get('atomic')};});
  assert.equal(atomic.failed,true);assert.equal(atomic.record.name,'before','index and migration marker roll back together');
  await page.evaluate(async()=>{await store.delete('course');await store.delete('stream:course');});await page.reload();await page.addScriptTag({path:'cache-storage.js'});
  const after=await page.evaluate(async()=>{const store=ZYCacheStorage.create({userAgent:'Windows Edg/153.0.0.0'});return{full:await store.get('course'),part:await store.get('stream:course'),info:await store.info()};});
  assert.equal(after.full,undefined);assert.equal(after.part,undefined);assert.deepEqual(after.info.legacyKeys,[]);
  console.log('PASS: compatible-browser legacy handles migrate to locators; failed metadata writes roll back atomically; deleted cache indexes never migrate back.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
