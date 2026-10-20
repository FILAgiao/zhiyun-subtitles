const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
  await page.setContent('<h1>原生静态截图</h1><div id="host"></div>');await page.addScriptTag({content:fs.readFileSync('warm-theme.js','utf8')+'\n'+fs.readFileSync('ai-learning.js','utf8')});
  await page.evaluate(()=>{
   const shadow=document.querySelector('#host').attachShadow({mode:'open'});window.shares=0;window.nativeCalls=0;window.nativeSignals=[];window.canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='orange';ctx.fillRect(0,0,1200,800);
   window.ZYCardRender={captureViewport:()=>{throw Error('Static screenshot must not use DOM renderer');}};
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:async()=>{shares++;throw Error('Static screenshot must never request display sharing');}}});
   window.staticProvider={capture:async signal=>{nativeCalls++;nativeSignals.push(signal);return canvas.toDataURL();}};window.ZYNativeCapture=staticProvider;
   window.deferNative=()=>{delete window.finishNative;ZYNativeCapture={capture:signal=>{nativeCalls++;nativeSignals.push(signal);return new Promise(resolve=>window.finishNative=resolve);}};window.pending=ai.capturePage();};
   window.testKey='fixture';window.loginCalls=0;window.mount=()=>window.ai=ZhiyunLearning.mountLearningAssistant({shadow,getValue:(k,d)=>d,getApiKey:()=>testKey,onRequireLogin:()=>loginCalls++,request:()=>{throw Error('Screenshot must not send to AI before user chooses');}});mount();
  });
  const host=page.locator('#host'),noSharing=async()=>{assert.equal(await page.evaluate(()=>shares),0,'native captures never invoke getDisplayMedia');assert.equal(await host.locator('#ai-capture-session').isVisible(),false);assert.equal(await host.locator('[data-zy-capture-hidden]').count(),0,'assistant controls are restored after every capture');};
  // Logged-out captures only request login, without opening chat or taking pixels.
  await page.evaluate(()=>testKey='');await page.mouse.move(200,100);await page.mouse.down({button:'middle'});await page.mouse.up({button:'middle'});
  await page.evaluate(()=>ai.capturePage());assert.equal(await page.evaluate(()=>loginCalls),2);assert.equal(await page.evaluate(()=>nativeCalls),0);assert.ok(await host.locator('#ai-panel').isHidden());assert.equal(await host.locator('#ai-crop').count(),0);
  await page.evaluate(()=>testKey='fixture');
  // Successful repeated actions read fresh static pixels, without retaining a stream.
  for(let i=0;i<3;i++){await page.evaluate(()=>ai.capturePage());await host.locator('#ai-attachment').waitFor({state:'visible'});assert.equal(await host.locator('#ai-crop').count(),0);assert.equal(await page.evaluate(()=>nativeCalls),i+1);await noSharing();await host.locator('#ai-close').click();}
  await page.evaluate(()=>ai.startCapture(null,true));await host.locator('#ai-crop-preview').waitFor();assert.equal(await page.evaluate(()=>nativeCalls),4);await noSharing();await host.locator('#ai-crop-cancel').click();
  // Cancellation restores controls immediately; late pixels cannot replace an attachment.
  const before=await host.locator('#ai-attachment img').getAttribute('src');await page.evaluate(()=>deferNative());await page.waitForFunction(()=>typeof finishNative==='function');await page.keyboard.press('Escape');await page.evaluate(()=>pending);assert.equal(await page.evaluate(()=>nativeSignals.at(-1).aborted),true);await noSharing();
  await page.evaluate(()=>{const late=document.createElement('canvas');late.width=1200;late.height=800;late.getContext('2d').fillStyle='green';late.getContext('2d').fillRect(0,0,1200,800);finishNative(late.toDataURL());});await page.waitForTimeout(50);assert.equal(await host.locator('#ai-attachment img').getAttribute('src'),before);assert.equal(await host.locator('#ai-crop').count(),0);
  await page.evaluate(()=>{ZYNativeCapture=staticProvider;});await page.evaluate(()=>ai.capturePage());await host.locator('#ai-attachment').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>nativeCalls),6);await noSharing();await host.locator('#ai-close').click();
  // API/permission failure stays a visible native error, without a browser-share fallback.
  await page.evaluate(()=>{ZYNativeCapture={capture:async()=>{nativeCalls++;throw Error('fixture native screenshot denied');}};});await page.evaluate(()=>ai.capturePage());assert.match(await host.locator('#ai-status').textContent(),/原生截图失败/);assert.equal(await page.evaluate(()=>nativeCalls),7);await noSharing();
  // A userscript with no native provider and no readable classroom media offers guidance.
  await page.evaluate(()=>delete window.ZYNativeCapture);await page.evaluate(()=>ai.capturePage());assert.match(await host.locator('#ai-status').textContent(),/截图|粘贴/);assert.equal(await page.evaluate(()=>nativeCalls),7);await noSharing();
  // Navigation and destruction abort in-flight reads and ignore their late replies.
  for(const kind of ['pagehide','destroy']){
   await page.evaluate(()=>deferNative());await page.waitForFunction(()=>typeof finishNative==='function');await page.evaluate(kind=>kind==='pagehide'?dispatchEvent(new Event('pagehide')):ai.destroy(),kind);await page.evaluate(()=>pending);assert.equal(await page.evaluate(()=>nativeSignals.at(-1).aborted),true);await page.evaluate(()=>finishNative(canvas.toDataURL()));await page.waitForTimeout(50);assert.equal(await host.locator('#ai-crop').count(),0);await noSharing();
  }
  assert.equal(await host.locator('#ai-learning').count(),0);assert.deepEqual(errors,[]);console.log('PASS: static native screenshots read fresh pixels without sharing; cancel/late replies/retry/native failure/no provider/pagehide/destroy restore controls and never send images automatically.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});