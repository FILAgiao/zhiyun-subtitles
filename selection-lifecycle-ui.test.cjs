const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<p id="text">Select this text to ask a question</p><div id="host"></div>');
 await page.addScriptTag({content:fs.readFileSync('ai-learning.js','utf8')});
 await page.evaluate(()=>{
  const shadow=document.querySelector('#host').attachShadow({mode:'open'});shadow.innerHTML='<button id="transcript-open">History</button><div id="settings-ai" hidden></div>';
  window.mount=()=>window.ai=ZhiyunLearning.mountLearningAssistant({shadow,getApiKey:()=> 'test',request:()=>({abort(){}})});mount();
  window.selectText=()=>{const text=document.querySelector('#text'),range=document.createRange();range.selectNodeContents(text);getSelection().removeAllRanges();getSelection().addRange(range);text.dispatchEvent(new PointerEvent('pointerup',{button:0,bubbles:true,clientX:100,clientY:60}));};
  window.setVisibility=value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'));};
 });
 const menu=page.locator('#host').locator('#ai-selection-menu'),dialog=page.locator('#host').locator('#ai-learning');
 await page.evaluate(()=>{setVisibility('visible');selectText();ai.open();});assert.equal(await menu.count(),1);
 await page.evaluate(()=>setVisibility('visible'));assert.equal(await menu.count(),1,'Visible event must preserve current selection menu');
 await page.evaluate(()=>setVisibility('hidden'));assert.equal(await menu.count(),0,'Leaving tab closes the menu');assert.equal(await dialog.isVisible(),true,'Existing AI conversation remains open');
 await page.evaluate(()=>selectText());assert.equal(await menu.count(),0,'Hidden pointerup cannot recreate menu');
 await page.evaluate(()=>setVisibility('visible'));assert.equal(await menu.count(),0,'Returning does not restore the old menu');
 await page.evaluate(()=>selectText());assert.equal(await menu.count(),1,'A fresh selection still works');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));assert.equal(await menu.count(),0,'Leaving page closes menu, including bfcache');
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));assert.equal(await menu.count(),0);
 await page.evaluate(()=>{selectText();ai.destroy();});assert.equal(await menu.count(),0);
 await page.evaluate(()=>{mount();selectText();setVisibility('hidden');});assert.equal(await menu.count(),0,'Remounted assistant retains hide handling');
 await page.evaluate(()=>{setVisibility('visible');selectText();});assert.equal(await menu.count(),1);
 await menu.getByRole('button',{name:'关闭划词提问'}).click();assert.equal(await menu.count(),0,'Close button still works');
 assert.deepEqual(errors,[]);console.log('PASS: visibility hidden/return, hidden pointerup, pagehide/bfcache, existing AI dialog, destroy/remount, fresh selection and close button (lifecycle events simulated in Chrome).');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
