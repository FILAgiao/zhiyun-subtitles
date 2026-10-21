const assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<style>body{margin:0;font:20px sans-serif}#text{margin:20px;width:440px}#blank{position:absolute;top:140px;width:450px;height:180px;user-select:none}</style><p id="text">Select these words to explain their meaning</p><div id="blank"></div><input id="edit"><div id="host"></div>');
 await page.addScriptTag({path:'ai-learning.js'});
 await page.evaluate(()=>{
  window.saved={};window.calls=0;const shadow=document.querySelector('#host').attachShadow({mode:'open'});shadow.innerHTML='<div id="settings-ai" style="position:absolute;top:340px"></div><div id="panel" style="position:absolute;left:480px;top:50px">Sidebar drag header</div>';
  window.mount=()=>window.ai=ZhiyunLearning.mountLearningAssistant({shadow,getValue:(k,d)=>saved[k]??d,setValue:(k,v)=>saved[k]=v,getApiKey:()=> 'test',request:o=>{calls++;queueMicrotask(()=>o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'answer'}]}]})}));return {abort(){}};}});mount();
  window.selectFresh=()=>{const p=document.querySelector('#text');getSelection().removeAllRanges();p.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,pointerId:7}));const r=document.createRange();r.selectNodeContents(p);getSelection().addRange(r);p.dispatchEvent(new PointerEvent('pointerup',{button:0,bubbles:true,pointerId:7,clientX:100,clientY:50}));};
 });
 const host=page.locator('#host'),menu=host.locator('#ai-selection-menu'),selectionSwitch=host.getByLabel('选中文字后显示“爽问一下”',{exact:true}),middleSwitch=host.getByLabel('按住鼠标中键拖动截图',{exact:true});
 assert.equal(await selectionSwitch.isChecked(),true);assert.equal(await middleSwitch.isChecked(),true);
 // Real Chrome double click and drag selection both work.
 await page.locator('#text').dblclick({position:{x:25,y:10}});assert.equal(await menu.count(),1);await page.mouse.click(10,200);assert.equal(await menu.count(),0);
 await page.evaluate(()=>getSelection().removeAllRanges());await page.mouse.move(24,30);await page.mouse.down();await page.mouse.move(260,30,{steps:12});await page.mouse.up();assert.equal(await menu.count(),1);
 // A retained selection must not reopen on blank drags, controls or an orphan release.
 await page.evaluate(()=>{document.querySelector('#blank').dispatchEvent(new PointerEvent('pointerup',{button:0,bubbles:true}));});assert.equal(await menu.count(),0);
 for(const target of ['blank','edit','panel']){
  await page.evaluate(target=>{selectFresh();const el=document.getElementById(target)||document.querySelector('#host').shadowRoot.getElementById(target);el.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,composed:true,pointerId:9}));document.querySelector('#blank').dispatchEvent(new PointerEvent('pointerup',{button:0,bubbles:true,pointerId:9}));},target);assert.equal(await menu.count(),0,target+' drag with old selection');
 }
 for(const event of ['pointercancel','blur']){await page.evaluate(event=>{getSelection().removeAllRanges();const p=document.querySelector('#text');p.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,pointerId:3}));const r=document.createRange();r.selectNodeContents(p);getSelection().addRange(r);(event==='blur'?window:document).dispatchEvent(new Event(event));p.dispatchEvent(new PointerEvent('pointerup',{button:0,bubbles:true,pointerId:3}));},event);assert.equal(await menu.count(),0);}
 await page.evaluate(()=>selectFresh());assert.equal(await menu.count(),1);await page.evaluate(()=>getSelection().removeAllRanges());await page.waitForFunction(()=>!document.querySelector('#host').shadowRoot.querySelector('#ai-selection-menu'));
 await selectionSwitch.uncheck();await page.evaluate(()=>selectFresh());assert.equal(await menu.count(),0);assert.equal(await page.evaluate(()=>calls),0);
 await middleSwitch.uncheck();await page.mouse.click(250,200,{button:'middle'});assert.equal(await host.locator('#ai-crop').count(),0);assert.equal(await page.evaluate(()=>{const e=new MouseEvent('mousedown',{button:1,bubbles:true,cancelable:true});document.querySelector('#blank').dispatchEvent(e);return e.defaultPrevented;}),false);
 await page.evaluate(()=>{ai.destroy();mount();});assert.equal(await selectionSwitch.isChecked(),false);assert.equal(await middleSwitch.isChecked(),false);
 await selectionSwitch.check();await page.evaluate(()=>selectFresh());await menu.getByRole('button',{name:'爽问一下',exact:true}).click();await page.waitForFunction(()=>calls===1);assert.equal(await host.locator('#ai-learning').isVisible(),true);
 await page.evaluate(()=>ai.close());await middleSwitch.check();await page.mouse.move(100,180);await page.mouse.down({button:'middle'});assert.equal(await host.locator('#ai-crop').count(),1);await page.keyboard.press('Escape');await page.mouse.up({button:'middle'});
 await page.setViewportSize({width:320,height:760});assert.equal(await selectionSwitch.isVisible(),true);assert.equal(await middleSwitch.isVisible(),true);
 assert.deepEqual(errors,[]);console.log('PASS: real double click/drag, stale selection/sidebar/input/blank drag, cancellation, cleared selection, independent switches, persistence/remount, explicit ask, middle re-enable, narrow settings; zero accidental AI calls.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
