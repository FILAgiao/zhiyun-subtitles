const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<h1>中键先选区，后取图</h1><div id="host"></div>');await page.addScriptTag({content:fs.readFileSync('ai-learning.js','utf8')});
 await page.evaluate(()=>{const shadow=document.querySelector('#host').attachShadow({mode:'open'});window.canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;canvas.getContext('2d').fillRect(0,0,1200,800);window.captureCalls=0;window.ZYNativeCapture={capture:()=>{captureCalls++;return new Promise(r=>window.finishCapture=r);}};window.ai=ZhiyunLearning.mountLearningAssistant({shadow,getValue:(k,d)=>d,getApiKey:()=> 'test',request:()=>({abort(){}})});});
 const host=page.locator('#host'),selection=host.locator('#ai-crop-selection');
 await page.mouse.move(100,120);await page.mouse.down({button:'middle'});await selection.waitFor({state:'visible'});assert.equal(await page.evaluate(()=>captureCalls),0);assert.equal(await host.locator('#ai-crop-tools').count(),0);
 await page.mouse.move(430,360,{steps:12});let rect=await selection.boundingBox();assert.equal(rect.x,100);assert.equal(rect.y,120);assert.equal(rect.width,330);assert.equal(rect.height,240);assert.equal(await page.evaluate(()=>captureCalls),0,'DOM renderer must not run while dragging');
 await page.mouse.up({button:'middle'});await page.waitForFunction(()=>captureCalls===1);assert.equal(await host.locator('#ai-capture-session').evaluate(e=>e.hidden),false);assert.equal(await host.locator('#ai-crop-tools').count(),0,'Annotation controls wait for the screenshot');await page.evaluate(()=>finishCapture(canvas.toDataURL()));await host.locator('#ai-crop-preview').waitFor();assert.equal(await host.locator('#ai-crop-tools').isHidden(),true);rect=await host.locator('#ai-crop-preview').boundingBox();assert.equal(rect.x,100);assert.equal(rect.y,120);assert.equal(rect.width,330);assert.equal(rect.height,240);await host.locator('#ai-crop-cancel').click();
 // Escape and losing focus while holding middle must not begin a hidden capture.
 for(const cancel of ['escape','blur']){await page.mouse.move(100,120);await page.mouse.down({button:'middle'});await page.mouse.move(400,300);if(cancel==='escape')await page.keyboard.press('Escape');else await page.evaluate(()=>dispatchEvent(new Event('blur')));await page.mouse.up({button:'middle'});await page.waitForFunction(()=>!document.querySelector('#host').shadowRoot.querySelector('#ai-crop'));assert.equal(await page.evaluate(()=>captureCalls),1);}
 // Cancel after release ignores late pixels, and the next drag still works.
 await page.mouse.move(100,120);await page.mouse.down({button:'middle'});await page.mouse.move(400,300);await page.mouse.up({button:'middle'});await page.waitForFunction(()=>captureCalls===2);await page.keyboard.press('Escape');await page.evaluate(()=>finishCapture(canvas.toDataURL()));assert.equal(await host.locator('#ai-crop').count(),0);
 await page.evaluate(()=>ZYNativeCapture.capture=async()=>{captureCalls++;return canvas.toDataURL();});await page.mouse.move(100,120);await page.mouse.down({button:'middle'});await page.mouse.move(400,300);await page.mouse.up({button:'middle'});await host.locator('#ai-crop-preview').waitFor();assert.equal(await page.evaluate(()=>captureCalls),3);await host.locator('#ai-crop-cancel').click();
 // Preserve a middle click followed by a left-button selection.
 await page.mouse.click(100,120,{button:'middle'});await host.locator('#ai-crop-stage').waitFor();await page.mouse.move(100,120);await page.mouse.down();await page.mouse.move(400,300);await page.mouse.up();await host.locator('#ai-crop-preview').waitFor();await host.locator('#ai-crop-cancel').click();
 // Narrow horizontal/vertical drags are errors, never clicks or automatic page selections.
 const countBeforeNarrow=await page.evaluate(()=>captureCalls);
 for(const [index,end] of [[0,{x:430,y:123}],[1,{x:103,y:360}]]){
  await page.mouse.move(100,120);await page.mouse.down({button:'middle'});await page.mouse.move(end.x,end.y,{steps:6});await page.mouse.up({button:'middle'});
  await host.locator('#ai-status').filter({hasText:/\u91cd\u65b0\u6846\u9009/}).waitFor();
  assert.equal(await page.evaluate(()=>captureCalls),countBeforeNarrow,'invalid narrow selection does not read a native frame');
  assert.equal(await host.locator('#ai-crop').count(),0);assert.equal(await host.locator('#ai-crop-preview').count(),0);
  if(index===0)await host.locator('#ai-close').click();
 }
 await host.getByRole('button',{name:/\u91cd\u65b0\u6846\u9009/}).click();await host.locator('#ai-crop-image').waitFor();
 assert.equal(await host.locator('#ai-crop-preview').count(),0,'reselect opens a normal manual selection');
 assert.equal(await page.evaluate(()=>captureCalls),countBeforeNarrow+1);
 await page.mouse.move(100,120);await page.mouse.down();await page.mouse.move(430,360);await page.mouse.up();await host.locator('#ai-crop-preview').waitFor();
 assert.deepEqual(await host.locator('#ai-crop-preview').boundingBox(),{x:100,y:120,width:330,height:240});await host.locator('#ai-crop-cancel').click();
assert.deepEqual(errors,[]);
 console.log('PASS: immediate lightweight region selection; no DOM capture or annotation controls while dragging; release starts capture; original rectangle retained; Escape/blur/cancel/late result/retry; middle click compatibility; narrow drags never capture and reselect works.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
