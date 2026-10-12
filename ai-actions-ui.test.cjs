const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="pane-voice"><span id="text">selected lesson text</span></div><div id="pane-ppt"><canvas id="picture" width="2000" height="1000" style="width:400px;height:200px"></canvas><a href="#"><canvas id="link-image" width="30" height="30"></canvas></a></div><div id="host"></div>');
  await page.addScriptTag({content:(fs.readFileSync('warm-theme.js','utf8')+'\n'+fs.readFileSync('ai-learning.js','utf8'))});
  await page.evaluate(()=>{
   const shadow=document.querySelector('#host').attachShadow({mode:'open'});window.calls=[];window.captureCalls=0;window.track=null;
   Object.defineProperty(navigator,'mediaDevices',{value:{getDisplayMedia:async()=>{
    captureCalls++;const canvas=document.querySelector('#picture'),stream=canvas.captureStream(10);window.track=stream.getVideoTracks()[0];
    const timer=setInterval(()=>canvas.getContext('2d').fillRect(0,0,1,1),50);track.addEventListener('ended',()=>clearInterval(timer));return stream;
   }},configurable:true});
   window.ai=ZhiyunLearning.mountLearningAssistant({shadow,getValue:(k,d)=>k==='ai-learning-settings-v1'?{browserCapture:true}:d,getApiKey:()=> 'opaque-session',request:o=>{
    calls.push(JSON.parse(o.data));queueMicrotask(()=>o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'done'}]}]})}));return{abort(){}};
   }});
   const canvas=document.querySelector('#picture'),ctx=canvas.getContext('2d');ctx.fillStyle='orange';ctx.fillRect(0,0,2000,1000);
  });
  const host=page.locator('#host');
  await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#text'));getSelection().removeAllRanges();getSelection().addRange(range);});
  await page.locator('#text').dispatchEvent('pointerup',{button:0,clientX:40,clientY:20});assert.equal(await host.locator('#ai-selection-menu').isVisible(),true);const menu=await host.locator('#ai-selection-menu').boundingBox();assert.ok(menu.x>=40&&menu.x<=60);assert.ok(menu.y>=20&&menu.y<=40);assert.equal(await page.evaluate(()=>calls.length),0);
  await host.getByRole('button',{name:'爽问一下'}).click();await page.waitForFunction(()=>calls.length===1);assert.match(await page.evaluate(()=>calls[0].input.at(-1).content[0].text),/selected lesson text/);
  await host.locator('#ai-close').click();const before=await page.locator('#picture').boundingBox();
  // Holding middle-button starts the rectangle at that very point, without a second click.
  await page.mouse.move(120,100);await page.mouse.down({button:'middle'});await host.locator('#ai-crop').waitFor({state:'visible'});
  await page.mouse.move(420,300);await page.mouse.up({button:'middle'});await host.locator('#ai-crop-preview').waitFor();assert.equal(await host.locator('#ai-crop-send').isEnabled(),true);
  assert.deepEqual(await page.locator('#picture').boundingBox(),before);assert.equal(await page.evaluate(()=>calls.length),1);
  assert.equal(await host.locator('#ai-crop-question').count(),0);assert.equal(await host.locator('#ai-crop').evaluate(e=>e.classList.contains('ai-crop-preview')),true);const preview=await host.locator('#ai-crop-preview').boundingBox();assert.ok(Math.abs(preview.x-120)<2&&Math.abs(preview.y-100)<2);assert.ok(Math.abs(preview.width-300)<2&&Math.abs(preview.height-200)<2);const original=await host.locator('#ai-crop-preview').evaluate(c=>c.toDataURL());await page.mouse.move(preview.x+20,preview.y+20);await page.mouse.down();await page.mouse.move(preview.x+60,preview.y+50);await page.mouse.up();assert.notEqual(await host.locator('#ai-crop-preview').evaluate(c=>c.toDataURL()),original);await host.locator('#ai-crop-undo').click();assert.equal(await host.locator('#ai-crop-preview').evaluate(c=>c.toDataURL()),original);await host.locator('#ai-crop-circle').click();await page.mouse.move(preview.x+25,preview.y+25);await page.mouse.down();await page.mouse.move(preview.x+110,preview.y+80);await page.mouse.up();assert.notEqual(await host.locator('#ai-crop-preview').evaluate(c=>c.toDataURL()),original);await page.mouse.click(40,20);assert.equal(await host.locator('#ai-crop').isVisible(),true);await page.screenshot({path:'screenshot-annotation-preview.png'});await host.locator('#ai-crop-conversation').selectOption('current');await host.locator('#ai-crop-send').click();
  await page.waitForFunction(()=>calls.length===2);assert.match(await page.evaluate(()=>calls[1].input.at(-1).content[0].text),/请解释截图中的内容/);
  const image=await page.evaluate(()=>calls[1].input.at(-1).content.find(x=>x.type==='input_image').image_url);
  const size=await page.evaluate(src=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve([i.width,i.height]);i.src=src;}),image);
  assert.ok(size[0]<1600&&size[1]<800);assert.match(await page.evaluate(()=>JSON.stringify(calls[1].input)),/selected lesson text/,'screenshot continues the existing conversation');assert.equal(await page.evaluate(()=>track.readyState),'live');assert.equal(await page.evaluate(()=>captureCalls),1);
  // The authorized stream is reused for subsequent screenshots.
  assert.equal(await host.locator('#ai-capture-session').isVisible(),true);assert.equal(await page.evaluate(()=>captureCalls),1);
  await host.locator('#ai-close').click();
  for(let i=0;i<2;i++){
   await page.mouse.move(650,350);await page.mouse.down({button:'middle'});await host.locator('#ai-crop').waitFor({state:'visible'});await page.mouse.move(900,550);await page.mouse.up({button:'middle'});
   await host.locator('#ai-crop-preview').waitFor();assert.equal(await host.locator('#ai-crop-send').isEnabled(),true);assert.equal(await page.evaluate(()=>captureCalls),1);assert.equal(await page.evaluate(()=>track.readyState),'live');if(i===0){await host.locator('#ai-crop-conversation').selectOption('current');await host.locator('#ai-crop-use').click();assert.equal(await host.locator('#ai-attachment').isVisible(),true);assert.match(await host.locator('#ai-log').textContent(),/selected lesson text/);assert.equal(await page.evaluate(()=>calls.length),2);await host.locator('#ai-close').click();}else await host.locator('#ai-crop-cancel').click();assert.equal(await host.locator('#ai-learning').isVisible(),false,'cancelling a crop keeps the conversation closed');
  }
  assert.equal(await page.evaluate(()=>calls.length),2);await page.evaluate(()=>ai.destroy());assert.equal(await page.evaluate(()=>track.readyState),'ended');assert.equal(await host.locator('#ai-capture-session').isVisible(),false);
  await page.evaluate(()=>navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException('Cancelled','NotAllowedError');});await page.mouse.click(650,350,{button:'middle'});await page.waitForTimeout(100);assert.equal(await host.locator('#ai-learning').isVisible(),false,'cancelling browser screenshot permission keeps the conversation closed');
  const result=await page.evaluate(()=>{const target=document.querySelector('#link-image'),ev=new MouseEvent('mousedown',{button:1,bubbles:true,cancelable:true,composed:true});target.dispatchEvent(ev);const shift=new MouseEvent('mousedown',{button:1,shiftKey:true,bubbles:true,cancelable:true,composed:true});document.querySelector('#picture').dispatchEvent(shift);return [ev.defaultPrevented,shift.defaultPrevented];});assert.deepEqual(result,[false,false]);
  assert.deepEqual(errors,[]);console.log('PASS: middle-drag at original coordinates, cropped-only one-click send, unchanged layout, authorized session reused across repeated captures and native link/Shift behavior.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
