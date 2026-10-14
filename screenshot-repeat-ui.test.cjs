const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<h1>截图恢复测试</h1><canvas id="source" width="1100" height="800"></canvas><div id="host"></div>');
 await page.addScriptTag({content:fs.readFileSync('ai-learning.js','utf8')});
 await page.evaluate(()=>{
  window.saved={};window.calls=[];window.shares=0;window.tracks=[];
  const canvas=document.querySelector('canvas');canvas.getContext('2d').fillRect(0,0,1100,800);window.image=canvas.toDataURL();
  window.ZYNativeCapture={capture:async()=>canvas.toDataURL()};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:async()=>{shares++;throw Error('unexpected sharing');}}});
  document.querySelector('#host').attachShadow({mode:'open'});
  window.mount=()=>window.ai=ZhiyunLearning.mountLearningAssistant({shadow:document.querySelector('#host').shadowRoot,getCourseId:()=> 'test-page',getApiKey:()=> 'test',getValue:(k,d)=>saved[k]??d,setValue:(k,v)=>saved[k]=v,request:o=>{calls.push(JSON.parse(o.data));queueMicrotask(()=>o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'回答'}]}]})}));return{abort(){}};}});mount();
 });
 const host=page.locator('#host'),crop=host.locator('#ai-crop-preview'),choice=host.locator('#ai-crop-conversation');
 await page.evaluate(()=>ai.send('第一次文字问题'));await page.waitForFunction(()=>calls.length===1);
 await page.evaluate(()=>ai.close());
 for(let i=0;i<3;i++){await page.evaluate(()=>ai.startCapture(null,true));await crop.waitFor();const toolbar=await host.locator('.ai-crop-head').boundingBox();assert.ok(toolbar.height<200&&toolbar.y>=0&&toolbar.y+toolbar.height<=800,'annotation toolbar keeps its content height and stays inside viewport without theme overrides');assert.equal(await choice.inputValue(),'new');if(i<2)await host.locator('#ai-crop-cancel').click();}
 await choice.selectOption('current');await host.locator('#ai-crop-send').click();await page.waitForFunction(()=>calls.length===2);assert.match(await page.evaluate(()=>JSON.stringify(calls[1].input)),/第一次文字问题/);
 await page.evaluate(()=>ai.close());await page.evaluate(()=>ai.startCapture(null,true));await crop.waitFor();assert.equal(await choice.inputValue(),'new');await host.locator('#ai-crop-send').click();await page.waitForFunction(()=>calls.length===3);assert.doesNotMatch(await page.evaluate(()=>JSON.stringify(calls[2].input)),/第一次文字问题/);
 await page.evaluate(()=>{ai.close();ai.destroy();mount();});await page.evaluate(()=>ai.startCapture(null,true));await crop.waitFor();await choice.selectOption({index:1});await host.locator('#ai-crop-use').click();assert.equal(await host.locator('#ai-attachment').isVisible(),true);await host.locator('#ai-close').click();
 // A cancelled local renderer cannot re-open an obsolete editor or block a later screenshot.
 await page.evaluate(()=>{ZYNativeCapture.capture=()=>new Promise(r=>window.finishOld=r);window.oldCapture=ai.startCapture(null,true);});await page.waitForFunction(()=>typeof finishOld==='function');await page.keyboard.press('Escape');await page.evaluate(()=>oldCapture);
 await page.evaluate(()=>{ZYNativeCapture.capture=async()=>document.querySelector('canvas').toDataURL();});await page.evaluate(()=>ai.startCapture(null,true));await crop.waitFor();await page.evaluate(()=>finishOld(document.querySelector('canvas').toDataURL()));assert.equal(await host.locator('#ai-crop').count(),1);await host.locator('#ai-crop-cancel').click();
 // Paste still exposes annotation and a conversation destination.
 await page.evaluate(async()=>{const blob=await (await fetch(image)).blob();const transfer=new DataTransfer();transfer.items.add(new File([blob],'capture.png',{type:'image/png'}));document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));});await crop.waitFor();assert.equal(await choice.count(),1);await host.locator('#ai-crop-cancel').click();
 assert.deepEqual(errors,[]);console.log('PASS: repeated screenshot/cancel/reopen; destination choice and reload; local abort and stale result; native capture without sharing; global paste.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
