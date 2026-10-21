const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const extensionMode=process.env.ZY_PASTE_EXTENSION==='1'||process.argv.includes('--extension');
 const extension=path.resolve(process.env.ZY_TEST_EXTENSION_DIR||'dist/extension');
 const browser=extensionMode?null:await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=extensionMode?await chromium.launchPersistentContext(path.resolve('.test-media/paste-scope-'+Date.now()),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1200,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]}):await browser.newContext({viewport:{width:1200,height:900}});
 try{
  let worker;
  if(extensionMode){worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:20000});await worker.evaluate(async()=>{await chrome.storage.local.set({'gateway-guide-no-remind-v2':true,'gateway-account-v1':{url:'https://47.77.182.216.sslip.io/gateway',token:'fixture-paste'}});globalThis.networkCalls=[];globalThis.fetch=async url=>{networkCalls.push(url);return new Response(JSON.stringify({username:'paste fixture',permissions:{learning:true,learning_records:true},usage:{month:'2026-10',requests:0,request_limit:20},prompts:[]}),{headers:{'Content-Type':'application/json'}});};});}
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
  const html='<h1 id="blank" tabindex="0">Ordinary page paste target</h1><input id="input"><textarea id="textarea"></textarea><div id="editable" contenteditable="true"><span>Rich editor</span></div><div id="custom" role="textbox" tabindex="0">Custom editor</div><div id="site-shadow"></div><div id="zy-subtitle-host"></div>';
  if(extensionMode){await context.route('https://fixture-paste.example/**',route=>route.fulfill({contentType:'text/html',body:html.replace('<div id="zy-subtitle-host"></div>','')}));await page.goto('https://fixture-paste.example/');}
  else{await page.setContent(html);await page.addScriptTag({content:fs.readFileSync('ai-learning.js','utf8')});await page.evaluate(()=>{window.requests=0;window.loginPrompts=0;window.allowed=true;window.ai=ZhiyunLearning.mountLearningAssistant({shadow:document.getElementById('zy-subtitle-host').attachShadow({mode:'open'}),canUse:()=>allowed,getApiKey:()=> 'fixture',onRequireLogin:()=>loginPrompts++,request:()=>{requests++;throw Error('Paste must not send an AI request');}});});}
  const host=page.locator('#zy-subtitle-host');await host.locator('#ai-question').waitFor({state:'attached'});
  await page.evaluate(()=>{document.getElementById('site-shadow').attachShadow({mode:'open'}).innerHTML='<div id="shadow-editable" contenteditable="true">Shadow editor</div>';const c=document.createElement('canvas');c.width=320;c.height=180;c.getContext('2d').fillRect(0,0,320,180);window.pasteImage=c.toDataURL();window.dispatchPaste=({owner='page',selector='#blank',text=false,prevented=false})=>{const root=owner==='assistant'?document.getElementById('zy-subtitle-host').shadowRoot:owner==='site-shadow'?document.getElementById('site-shadow').shadowRoot:document;const target=root.querySelector(selector),clipboardData=new DataTransfer();if(text)clipboardData.setData('text/plain','ordinary text');else clipboardData.items.add(new File([Uint8Array.from(atob(pasteImage.split(',')[1]),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'}));const event=new ClipboardEvent('paste',{clipboardData,bubbles:true,composed:true,cancelable:true});if(prevented)event.preventDefault();target.dispatchEvent(event);return event.defaultPrevented;};});
  const open=async()=>extensionMode?host.locator('#web-ask').click():page.evaluate(()=>ai.open());
  const ignoredTargets=[{selector:'#blank'},{selector:'body'},{selector:'#input'},{selector:'#textarea'},{selector:'#editable span'},{selector:'#custom'},{owner:'site-shadow',selector:'#shadow-editable'}];
  for(const state of ['closed','open']){
   if(state==='open')await open();
   for(const target of ignoredTargets){assert.equal(await page.evaluate(arg=>dispatchPaste(arg),target),false,`${state} assistant must not prevent page paste: ${target.selector}`);}
   await page.waitForTimeout(100);assert.equal(await host.locator('#ai-crop').count(),0);assert.equal(await host.locator('#ai-learning').isVisible(),state==='open');
  }
  // Text still follows the input's normal browser paste path.
  assert.equal(await page.evaluate(()=>dispatchPaste({owner:'assistant',selector:'#ai-question',text:true})),false);
  assert.equal(await page.evaluate(()=>dispatchPaste({owner:'assistant',selector:'#ai-question',prevented:true})),true);
  await page.waitForTimeout(50);assert.equal(await host.locator('#ai-crop').count(),0,'Already-handled events must not open the image editor');
  await host.locator('#ai-close').click();
  assert.equal(await page.evaluate(()=>dispatchPaste({owner:'assistant',selector:'#ai-question'})),false,'Hidden assistant must not consume an image');
  if(!extensionMode){await page.evaluate(()=>allowed=false);for(const target of ignoredTargets)assert.equal(await page.evaluate(arg=>dispatchPaste(arg),target),false);assert.equal(await page.evaluate(()=>loginPrompts),0,'Unrelated image paste must not open account/login UI');await page.evaluate(()=>allowed=true);}
  await open();await host.locator('#ai-question').focus();
  assert.equal(await page.evaluate(()=>dispatchPaste({owner:'assistant',selector:'#ai-question'})),true,'Explicit composer image paste remains supported');
  await host.locator('#ai-crop-preview').waitFor();assert.equal(await host.locator('#ai-crop-conversation').count(),1);assert.equal(await host.locator('#ai-crop-use').isEnabled(),true);
  const before=await host.locator('#ai-crop-preview').evaluate(c=>c.toDataURL());
  assert.equal(await page.evaluate(()=>dispatchPaste({selector:'#blank'})),false);await page.waitForTimeout(100);assert.equal(await host.locator('#ai-crop-preview').evaluate(c=>c.toDataURL()),before,'Unrelated paste must not replace an existing annotation');
  await host.locator('#ai-crop-use').click();await host.locator('#ai-attachment').waitFor({state:'visible'});
  if(extensionMode)assert.equal(await worker.evaluate(()=>networkCalls.filter(url=>/learning\/jobs|ark\/responses/.test(url)).length),0,'No AI request is sent by paste or attachment');
  else assert.equal(await page.evaluate(()=>requests),0);
  assert.deepEqual(errors,[]);console.log('PASS: '+(extensionMode?'actual Edge MV3':'Chrome module')+'; page blank/input/rich/custom/shadow editor paste untouched, hidden/logged-out assistant stays quiet, explicit AI composer images annotate and attach without sending.');
 }finally{await context.close();await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
