const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<h1>截图恢复测试</h1><canvas id="source" width="1100" height="800"></canvas><div id="host"></div>');
 await page.addScriptTag({content:fs.readFileSync('ai-learning.js','utf8')});
 await page.evaluate(()=>{
  window.saved={};window.calls=[];window.shares=0;window.tracks=[];
  const canvas=document.querySelector('canvas');canvas.getContext('2d').fillRect(0,0,1100,800);window.image=canvas.toDataURL();
  window.ZYCardRender={captureViewport:async()=>canvas};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:async()=>{shares++;throw Error('unexpected sharing');}}});
  document.querySelector('#host').attachShadow({mode:'open'});
  window.mount=()=>window.ai=ZhiyunLearning.mountLearningAssistant({shadow:document.querySelector('#host').shadowRoot,getCourseId:()=> 'test-page',getApiKey:()=> 'test',getValue:(k,d)=>saved[k]??d,setValue:(k,v)=>saved[k]=v,request:o=>{calls.push(JSON.parse(o.data));queueMicrotask(()=>o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'回答'}]}]})}));return{abort(){}};}});mount();
 });
 const host=page.locator('#host'),crop=host.locator('#ai-crop-preview'),choice=host.locator('#ai-crop-conversation');
 await page.evaluate(()=>ai.send('第一次文字问题'));await page.waitForFunction(()=>calls.length===1);
 await page.evaluate(()=>ai.close());
 for(let i=0;i<3;i++){await page.evaluate(()=>ai.capturePage());await crop.waitFor();assert.equal(await choice.inputValue(),'new');if(i<2)await host.locator('#ai-crop-cancel').click();}
 await choice.selectOption('current');await host.locator('#ai-crop-send').click();await page.waitForFunction(()=>calls.length===2);assert.match(await page.evaluate(()=>JSON.stringify(calls[1].input)),/第一次文字问题/);
 await page.evaluate(()=>ai.close());await page.evaluate(()=>ai.capturePage());await crop.waitFor();assert.equal(await choice.inputValue(),'new');await host.locator('#ai-crop-send').click();await page.waitForFunction(()=>calls.length===3);assert.doesNotMatch(await page.evaluate(()=>JSON.stringify(calls[2].input)),/第一次文字问题/);
 await page.evaluate(()=>{ai.close();ai.destroy();mount();});await page.evaluate(()=>ai.capturePage());await crop.waitFor();await choice.selectOption({index:1});await host.locator('#ai-crop-use').click();assert.equal(await host.locator('#ai-attachment').isVisible(),true);await host.locator('#ai-close').click();
 // A cancelled local renderer cannot re-open an obsolete editor or block a later screenshot.
 await page.evaluate(()=>{ZYCardRender.captureViewport=()=>new Promise(r=>window.finishOld=r);window.oldCapture=ai.capturePage();});await page.keyboard.press('Escape');await page.evaluate(()=>oldCapture);
 await page.evaluate(()=>{ZYCardRender.captureViewport=async()=>document.querySelector('canvas');});await page.evaluate(()=>ai.capturePage());await crop.waitFor();await page.evaluate(()=>finishOld(document.querySelector('canvas')));assert.equal(await host.locator('#ai-crop').count(),1);await host.locator('#ai-crop-cancel').click();
 // Restricted pages do not invoke display sharing unless explicitly enabled.
 await page.evaluate(()=>{const f=document.createElement('iframe');f.id='restricted';f.style.cssText='position:fixed;top:0;left:0;width:100px;height:100px';document.body.append(f);});await page.evaluate(()=>ai.capturePage());assert.equal(await page.evaluate(()=>shares),0);assert.match(await host.locator('#ai-status').textContent(),/系统截图/);
 // Paste outside the assistant opens the same editor with a destination choice.
 await page.evaluate(async()=>{const blob=await (await fetch(image)).blob();const transfer=new DataTransfer();transfer.items.add(new File([blob],'capture.png',{type:'image/png'}));document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));});await crop.waitFor();assert.equal(await choice.count(),1);await host.locator('#ai-crop-cancel').click();
 // A late browser permission result after cancellation is stopped without affecting a retry.
 await page.evaluate(()=>{ai.destroy();saved['ai-learning-settings-v1']={browserCapture:true};mount();navigator.mediaDevices.getDisplayMedia=()=>new Promise(r=>window.finishPermission=r);window.oldCapture=ai.capturePage();});await page.keyboard.press('Escape');await page.evaluate(()=>oldCapture);
 await page.evaluate(()=>{document.getElementById('restricted').remove();window.oldStream=document.querySelector('canvas').captureStream(5);finishPermission(oldStream);});await page.waitForFunction(()=>oldStream.getVideoTracks()[0].readyState==='ended');
 await page.evaluate(()=>ai.capturePage());await crop.waitFor();await host.locator('#ai-crop-cancel').click();assert.equal(await host.locator('#ai-learning').getAttribute('aria-busy'),'false');
 // Bound both a stalled DOM renderer and video playback startup, then prove a retry works.
 await page.evaluate(()=>{window.nativeTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>nativeTimeout(fn,[10000,12000,30000].includes(ms)?80:ms,...args);ZYCardRender.captureViewport=()=>new Promise(()=>{});});
 await page.evaluate(()=>ai.capturePage());assert.match(await host.locator('#ai-status').textContent(),/截图超时/);assert.equal(await host.locator('#ai-learning').getAttribute('aria-busy'),'false');
 await page.evaluate(()=>{const f=document.createElement('iframe');f.id='restricted';f.style.cssText='position:fixed;top:0;width:100px;height:100px';document.body.append(f);navigator.mediaDevices.getDisplayMedia=async()=>new MediaStream();window.nativePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=()=>new Promise(()=>{});});
 await page.evaluate(()=>ai.capturePage());assert.match(await host.locator('#ai-status').textContent(),/画面未就绪|截图超时/);assert.equal(await host.locator('#ai-learning').getAttribute('aria-busy'),'false');
 await page.evaluate(()=>{setTimeout=nativeTimeout;HTMLMediaElement.prototype.play=nativePlay;document.querySelector('#restricted').remove();ZYCardRender.captureViewport=async()=>document.querySelector('canvas');});await page.evaluate(()=>ai.capturePage());await crop.waitFor();await host.locator('#ai-crop-cancel').click();
 assert.deepEqual(errors,[]);console.log('PASS: repeated screenshot/cancel/reopen; destination choice and reload; local abort and stale result; default no sharing; global paste; late permission stream released.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
