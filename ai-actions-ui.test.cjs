const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div id="pane-voice"><span id="text">selected lesson text</span></div><div id="pane-ppt"><canvas id="picture" width="2000" height="1000" style="width:400px;height:200px"></canvas><a href="#"><canvas id="link-image" width="30" height="30"></canvas></a></div><div id="host"></div>');
  await page.addScriptTag({content:fs.readFileSync('ai-learning.js','utf8')});
  await page.evaluate(()=>{
   const shadow=document.querySelector('#host').attachShadow({mode:'open'});window.calls=[];window.captureCalls=0;window.track=null;
   Object.defineProperty(navigator,'mediaDevices',{value:{getDisplayMedia:async()=>{
    captureCalls++;const canvas=document.querySelector('#picture'),stream=canvas.captureStream(10);window.track=stream.getVideoTracks()[0];
    const timer=setInterval(()=>canvas.getContext('2d').fillRect(0,0,1,1),50);track.addEventListener('ended',()=>clearInterval(timer));return stream;
   }},configurable:true});
   window.ai=ZhiyunLearning.mountLearningAssistant({shadow,getApiKey:()=> 'opaque-session',request:o=>{
    calls.push(JSON.parse(o.data));queueMicrotask(()=>o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'done'}]}]})}));return{abort(){}};
   }});
   const canvas=document.querySelector('#picture'),ctx=canvas.getContext('2d');ctx.fillStyle='orange';ctx.fillRect(0,0,2000,1000);
  });
  const host=page.locator('#host');
  await page.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#text'));getSelection().removeAllRanges();getSelection().addRange(range);});
  await page.locator('#text').click({button:'right'});assert.equal(await host.locator('#ai-selection-menu').isVisible(),true);assert.equal(await page.evaluate(()=>calls.length),0);
  await host.getByRole('menuitem',{name:'问插件'}).click();await page.waitForFunction(()=>calls.length===1);assert.match(await page.evaluate(()=>calls[0].input.at(-1).content[0].text),/selected lesson text/);
  await host.locator('#ai-close').click();const before=await page.locator('#picture').boundingBox();
  // Holding middle-button starts the rectangle at that very point, without a second click.
  await page.mouse.move(120,100);await page.mouse.down({button:'middle'});await host.locator('#ai-crop').waitFor({state:'visible'});
  await page.mouse.move(420,300);await page.mouse.up({button:'middle'});assert.equal(await host.locator('#ai-crop-send').isEnabled(),true);
  assert.deepEqual(await page.locator('#picture').boundingBox(),before);assert.equal(await page.evaluate(()=>calls.length),1);
  assert.equal(await host.locator('#ai-crop-whole').count(),0);await host.locator('#ai-crop-question').fill('解释选区');await host.locator('#ai-crop-send').click();
  await page.waitForFunction(()=>calls.length===2);assert.match(await page.evaluate(()=>calls[1].input.at(-1).content[0].text),/解释选区/);
  const image=await page.evaluate(()=>calls[1].input.at(-1).content.find(x=>x.type==='input_image').image_url);
  const size=await page.evaluate(src=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve([i.width,i.height]);i.src=src;}),image);
  assert.ok(size[0]<1600&&size[1]<800);assert.equal(await page.evaluate(()=>track.readyState),'ended');assert.equal(await page.evaluate(()=>captureCalls),1);
  // Explicit continuous capture asks once, keeps a visible stop control, and reuses the stream.
  await host.locator('#ai-quick-capture').click();await host.locator('#ai-capture-session').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>captureCalls),2);
  await host.locator('#ai-close').click();
  for(let i=0;i<2;i++){
   await page.mouse.move(650,350);await page.mouse.down({button:'middle'});await host.locator('#ai-crop').waitFor({state:'visible'});await page.mouse.move(900,550);await page.mouse.up({button:'middle'});
   assert.equal(await host.locator('#ai-crop-send').isEnabled(),true);assert.equal(await page.evaluate(()=>captureCalls),2);await host.locator('#ai-crop-cancel').click();
  }
  assert.equal(await page.evaluate(()=>calls.length),2);await host.locator('#ai-capture-session-stop').click();assert.equal(await page.evaluate(()=>track.readyState),'ended');assert.equal(await host.locator('#ai-capture-session').isVisible(),false);
  const result=await page.evaluate(()=>{const target=document.querySelector('#link-image'),ev=new MouseEvent('mousedown',{button:1,bubbles:true,cancelable:true,composed:true});target.dispatchEvent(ev);const shift=new MouseEvent('mousedown',{button:1,shiftKey:true,bubbles:true,cancelable:true,composed:true});document.querySelector('#picture').dispatchEvent(shift);return [ev.defaultPrevented,shift.defaultPrevented];});assert.deepEqual(result,[false,false]);
  assert.deepEqual(errors,[]);console.log('PASS: middle-drag at original coordinates, cropped-only one-click send, unchanged layout, continuous capture asks once, explicit stop and native link/Shift behavior.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
