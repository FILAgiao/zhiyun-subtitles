const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<style>body{margin:0;background:#ebe6de;font-family:Arial,sans-serif}#host{position:fixed;inset:0;pointer-events:none}</style><div id="host"></div>');
  for(const file of ['warm-theme.js','appearance-theme.js','ai-learning.js'])await page.addScriptTag({path:file});
  await page.evaluate(()=>{
   const shadow=document.querySelector('#host').attachShadow({mode:'open'});shadow.innerHTML='<style>[hidden]{display:none!important}</style>';window.saved={};
   window.ai=ZhiyunLearning.mountLearningAssistant({shadow,getApiKey:()=> 'mock-session',getValue:(k,d)=>saved[k]??d,setValue:(k,v)=>saved[k]=v,request:o=>{window.pending=o;return{abort:()=>o.onabort?.()};}});ai.open();
   window.finish=text=>pending.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text}]}]})});
  });
  const ui=page.locator('#host'),panel=ui.locator('#ai-learning'),log=ui.locator('#ai-log'),input=ui.locator('#ai-question');
  assert.equal(await ui.locator('.ai-message').count(),0);
  const initial=(await input.boundingBox()).height;await input.fill(('输入一段较长的问题，需要保留换行。\n').repeat(12));const grown=(await input.boundingBox()).height;assert.ok(grown>initial&&grown<=121);await input.fill('短问题');assert.ok((await input.boundingBox()).height<=initial+1);
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(await page.evaluate(()=>!!window.pending),false,'IME confirmation must not submit');
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',shiftKey:true});assert.equal(await page.evaluate(()=>!!window.pending),false,'Shift+Enter keeps editing');
  await input.fill('什么是后门准则？');await input.press('Enter');await page.evaluate(()=>finish('## 先看直觉\n\n后门准则帮助我们判断：**控制哪些变量，才能公平比较因果效应。**\n\n- 阻断混杂带来的后门路径\n- 不控制处理变量的后代\n\n可以把它理解为：先消除共同原因带来的干扰，再比较结果。'));
  await ui.locator('#ai-save-card').waitFor({state:'visible'});assert.equal(await ui.locator('#ai-save-card').isEnabled(),true);
  await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=720;const x=c.getContext('2d');x.fillStyle='#f6f3e8';x.fillRect(0,0,c.width,c.height);x.fillStyle='#33443d';x.font='bold 48px sans-serif';x.fillText('The Backdoor Criterion',70,130);x.font='30px sans-serif';x.fillText('Find the variables that block confounding paths.',70,205);x.strokeStyle='#bd663b';x.lineWidth=5;for(const [a,b] of [[300,210],[210,450],[300,450]]){x.beginPath();x.moveTo(a,380);x.lineTo(b,540);x.stroke();}ai.send('请解释截图里的因果关系。',{image:c.toDataURL(),fresh:true});});
  await page.evaluate(()=>finish(('共同原因 Z 同时影响 X 和 Y。控制 Z，可以阻断 X ← Z → Y 这条后门路径。\n\n').repeat(30)));
  const thumb=ui.locator('.ai-message[data-role=user] img').last();assert.ok((await thumb.boundingBox()).height<=181);await thumb.press('Enter');await ui.locator('#ai-image-viewer').waitFor();await page.keyboard.press('Escape');assert.equal(await thumb.evaluate(e=>e.getRootNode().activeElement===e),true);
  const h=await log.evaluate(e=>e.clientHeight);await page.evaluate(()=>{const l=document.querySelector('#host').shadowRoot.querySelector('#ai-log');l.scrollTop=0;l.dispatchEvent(new Event('scroll'));});assert.ok(await ui.locator('#ai-jump-latest').isVisible());assert.equal(await log.evaluate(e=>e.clientHeight),h,'floating return button must not reduce reading area');await ui.locator('#ai-jump-latest').click();
  await panel.screenshot({path:'ai-conversation-modern-preview.png'});
  for(const size of [{width:320,height:640},{width:390,height:844},{width:900,height:500}]){
   await page.setViewportSize(size);await page.evaluate(()=>ai.open());await page.waitForTimeout(80);
   const box=await panel.boundingBox(),send=await ui.locator('#ai-send').boundingBox(),read=await log.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=size.width+1);assert.ok(send.y+send.height<=size.height&&send.x+send.width<=size.width);assert.ok(read.height>=64);assert.ok(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'panel must not overflow horizontally');
   await input.fill(('长问题\n').repeat(20));assert.ok((await ui.locator('#ai-send').boundingBox()).y+32<=size.height);await input.fill('');
   if(size.width===320)await panel.screenshot({path:'ai-conversation-narrow-preview.png'});
  }
  await page.setViewportSize({width:1200,height:900});
  for(const theme of ['blue','glass','warm']){await page.evaluate(t=>document.querySelector('#host').shadowRoot.host.setAttribute('data-zy-theme',t),theme);assert.ok(await ui.locator('#ai-send').isVisible());const accent=await panel.evaluate(e=>getComputedStyle(e).getPropertyValue('--zy-accent').trim());assert.equal(accent,theme==='blue'?'#235FA2':theme==='glass'?'#B94420':'#C45221');}
  await ui.locator('#ai-clear').click();assert.equal(await ui.locator('.ai-message').count(),0);assert.ok((await input.boundingBox()).height<=initial+1);
  await page.evaluate(()=>ai.destroy());assert.equal(await panel.count(),0);assert.deepEqual(errors,[]);
  console.log('PASS: growing/shrinking input, IME/Shift+Enter, compact image and keyboard preview, overlay geometry, 320px/mobile/short viewport, themes, clear and destroy.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
