const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://clip-ownership.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="host"></div>'}));await page.goto('https://clip-ownership.test/');await page.addScriptTag({path:'ai-learning.js'});
  await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=900;canvas.getContext('2d').fillRect(0,0,1280,900);
   window.ZYNativeCapture={capture:async()=>canvas.toDataURL()};window.account='account-a';window.attempts=[];window.mode='fail';window.modelCalls=0;
   const shadow=document.querySelector('#host').attachShadow({mode:'open'});shadow.innerHTML='<style>[hidden]{display:none!important}</style>';
   window.ai=ZhiyunLearning.mountLearningAssistant({shadow,getApiKey:()=> 'fixture',getCourseId:()=>location.href,getCourseTitle:()=> '收藏归属测试',request:()=>{modelCalls++;throw Error('No model calls');},studyStore:{account:()=>account,identity:()=>account,saveClip:async(clip,options)=>{attempts.push({clip:structuredClone(clip),options});if(mode==='fail')throw Error('测试网络中断');if(mode==='delay')await new Promise(resolve=>window.finishSave=resolve);return {ok:true,id:clip.id};}}});
  });
  const ui=page.locator('#host');
  async function crop(){await page.evaluate(()=>{void ai.startCapture();});await ui.locator('#ai-crop-image').waitFor();await page.mouse.move(20,20);await page.mouse.down();await page.mouse.move(900,500,{steps:4});await page.mouse.up();await ui.locator('#ai-crop-preview').waitFor();}
  await crop();await ui.locator('#ai-crop-save').click();await ui.getByText('重试收藏',{exact:true}).waitFor();
  await page.evaluate(()=>mode='ok');await ui.locator('#ai-crop-save').click();await ui.getByText('已收藏',{exact:true}).waitFor();
  const first=await page.evaluate(()=>attempts);assert.equal(first.length,2);assert.deepEqual(first[0],first[1],'same-account retry reuses image and ID');assert.deepEqual(first[1].options,{account:'account-a'});
  const href=await ui.getByText('查看这张收藏 ↗',{exact:true}).getAttribute('href'),link=new URL(href);assert.equal(link.searchParams.get('clip'),first[1].clip.id);assert.equal(link.hash,'#clips');assert.equal(link.searchParams.has('token'),false);
  await ui.locator('#ai-crop-cancel').click();await page.evaluate(()=>mode='delay');await crop();await ui.locator('#ai-crop-save').click();await page.waitForFunction(()=>typeof finishSave==='function');
  await page.evaluate(()=>{account='account-b';finishSave();});await ui.getByText('账号已切换，请确认当前账号后重新收藏。',{exact:true}).waitFor();assert.equal(await ui.locator('#ai-crop-save').isEnabled(),true,'account change must not strand the save button');assert.equal(await ui.getByText('已收藏',{exact:true}).count(),0,'old account acknowledgement must not appear as current success');
  await page.evaluate(()=>mode='ok');await ui.locator('#ai-crop-save').click();await ui.getByText('已收藏',{exact:true}).waitFor();
  const last=await page.evaluate(()=>attempts.slice(-2));assert.equal(last[0].options.account,'account-a');assert.equal(last[1].options.account,'account-b');assert.notEqual(last[0].clip.id,last[1].clip.id,'new account gets a new explicit save ID');
  assert.equal(await page.evaluate(()=>modelCalls),0);assert.deepEqual(errors,[]);console.log('PASS: frozen retry, exact-image link, account-bound upload, ignored stale success and usable retry after account switch; no AI calls.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
