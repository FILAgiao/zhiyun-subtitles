const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const extension=path.resolve('dist/extension'),manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));assert.ok(manifest.host_permissions.includes('<all_urls>'),'The packaged extension must grant persistent native screenshot access');
 const context=await chromium.launchPersistentContext(path.resolve('.test-media/native-extension-'+Date.now()),{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1200,height:800},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:20000});
  await worker.evaluate(async()=>{await chrome.storage.local.set({'gateway-guide-no-remind-v2':true,'gateway-account-v1':{url:'https://47.77.182.216.sslip.io/gateway',token:'fixture-native'}});globalThis.nativeRequests=0;chrome.runtime.onMessage.addListener(message=>{if(message?.type==='zy-capture-visible')nativeRequests++;});globalThis.fetch=async url=>new Response(JSON.stringify({username:'原生截图测试',permissions:{learning:true,translation:true,speech:true},capabilities:{web_search:false},usage:{month:'2026-10',requests:0,request_limit:20,total_tokens:0,audio_seconds:0,audio_limit:60}}),{headers:{'Content-Type':'application/json'}});});
  await context.route('https://fixture-native.example/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:white}h1{font:28px sans-serif}img{position:absolute;left:100px;top:100px;width:200px;height:120px}</style><h1>页面首次中键原生截图</h1><img src="https://cdn-native.example/image.svg"><iframe src="https://frame-native.example/" style="position:absolute;left:400px;top:100px;width:200px;height:120px;border:0"></iframe>'}));
  await context.route('https://cdn-native.example/image.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#ff0000"/></svg>'}));
  await context.route('https://frame-native.example/**',route=>route.fulfill({contentType:'text/html',body:'<style>html,body{margin:0;width:100%;height:100%;background:#00ff00}</style>'}));
  async function preparePage(url){const page=await context.newPage(),errors=[],session=await context.newCDPSession(page),contexts=new Map();page.on('pageerror',e=>errors.push(e.message));session.on('Runtime.executionContextCreated',e=>contexts.set(e.context.id,e.context));session.on('Runtime.executionContextDestroyed',e=>contexts.delete(e.executionContextId));await session.send('Runtime.enable');await page.goto(url);const host=page.locator('#zy-subtitle-host');await host.waitFor();let contextId;for(let attempt=0;attempt<40&&!contextId;attempt++){for(const [id,info] of contexts){if(info.auxData?.isDefault)continue;try{const result=await session.send('Runtime.evaluate',{contextId:id,expression:'typeof globalThis.ZYNativeCapture?.capture',returnByValue:true});if(result.result.value==='function'){contextId=id;break;}}catch{}}if(!contextId)await page.waitForTimeout(25);}assert.ok(contextId,'Actual extension content script isolated context is available');await session.send('Runtime.evaluate',{contextId,expression:"globalThis.__shareCalls=0;Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{globalThis.__shareCalls++;throw Error('Native capture must never request sharing');}});",returnByValue:true});return{page,host,errors,session,contextId,shareCalls:async()=>{const r=await session.send('Runtime.evaluate',{contextId,expression:'globalThis.__shareCalls',returnByValue:true});return r.result.value;}};}
  const generic=await preparePage('https://fixture-native.example/'),{page,host}=generic;await page.bringToFront();await page.locator('img[src="https://cdn-native.example/image.svg"]').evaluate(e=>e.decode());await page.frameLocator('iframe').locator('body').waitFor();
  async function drag(target,x1,y1,x2,y2){await target.mouse.move(x1,y1);await target.mouse.down({button:'middle'});await target.mouse.move(x2,y2,{steps:8});await target.mouse.up({button:'middle'});}
  // Focusing a child frame emits window.blur while the tab is still active.
  // Delay the real native queue so this happens between request and response.
  const nativeCount=()=>worker.evaluate(()=>nativeRequests),focusCount=await nativeCount();
  await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});captureTimes.set(tab.windowId,Date.now()+500);});
  await drag(page,80,80,650,260);
  await worker.evaluate(count=>new Promise(resolve=>{const timer=setInterval(()=>{if(nativeRequests>=count){clearInterval(timer);resolve();}},10);}),focusCount+1);
  await page.evaluate(()=>{window.__captureBlurEvents=0;window.addEventListener('blur',()=>window.__captureBlurEvents++);document.querySelector('iframe').focus();});
  assert.ok(await page.evaluate(()=>window.__captureBlurEvents)>0,'Frame focus triggers a real top-window blur');
  assert.equal(await page.evaluate(()=>document.hasFocus()),true,'Focus remains within this document tree');
  await page.waitForFunction(()=>{const s=document.getElementById('zy-subtitle-host').shadowRoot;return s.querySelector('#ai-crop-preview')||s.querySelector('#ai-status').textContent.includes('失去焦点');});
  assert.doesNotMatch(await host.locator('#ai-status').textContent(),/失去焦点/,'A real iframe blur must not reject successfully captured pixels');
  await host.locator('#ai-crop-preview').waitFor({timeout:12000});
  assert.deepEqual(await host.locator('#ai-crop-preview').boundingBox(),{x:80,y:80,width:570,height:180},'Frame focus retains the middle-button region');
  const focusPixel=await host.locator('#ai-crop-preview').evaluate(c=>[...c.getContext('2d').getImageData(70,70,1,1).data]);
  assert.ok(focusPixel[0]>220&&focusPixel[1]<30,'Successful native pixels survive internal focus changes');
  assert.equal(await nativeCount(),focusCount+1);assert.equal(await generic.shareCalls(),0);
  await host.locator('#ai-crop-cancel').click();
  async function queuedDrag(){
   const count=await nativeCount();
   await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});captureTimes.set(tab.windowId,Date.now()+500);});
   await drag(page,80,80,650,260);
   await worker.evaluate(count=>new Promise(resolve=>{const timer=setInterval(()=>{if(nativeRequests>=count){clearInterval(timer);resolve();}},10);}),count+1);
   return count+1;
  }
  // Simulate a transient renderer hasFocus=false while the browser window stays
  // focused. This override is test-only; the actual native capture is unchanged.
  await queuedDrag();
  await generic.session.send('Runtime.evaluate',{contextId:generic.contextId,expression:"Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('blur'));",returnByValue:true});
  assert.equal(await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return (await chrome.windows.get(tab.windowId)).focused;}),true);
  await host.locator('#ai-crop-preview').waitFor({timeout:12000});
  await generic.session.send('Runtime.evaluate',{contextId:generic.contextId,expression:"delete document.hasFocus;",returnByValue:true});
  assert.deepEqual(await host.locator('#ai-crop-preview').boundingBox(),{x:80,y:80,width:570,height:180});
  await host.locator('#ai-crop-cancel').click();
  // A real tab switch still fails; a fresh trusted retry keeps the drawn region.
  await queuedDrag();const other=await context.newPage();await other.goto('https://frame-native.example/');await other.bringToFront();
  await host.locator('#ai-capture-retry').waitFor({timeout:12000});assert.equal(await host.locator('#ai-crop-preview').count(),0);
  await other.close();await page.bringToFront();await host.locator('#ai-capture-retry').click();
  await host.locator('#ai-crop-preview').waitFor({timeout:12000});
  assert.deepEqual(await host.locator('#ai-crop-preview').boundingBox(),{x:80,y:80,width:570,height:180});await host.locator('#ai-crop-cancel').click();await host.locator('#ai-close').click();
  assert.equal(await generic.shareCalls(),0);assert.deepEqual(generic.errors,[]);
  console.log('PASS: real MV3 native pixels survive child-frame blur and simulated transient renderer focus; real tab switching fails, retry preserves the middle rectangle, no sharing.');
 }finally{await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
