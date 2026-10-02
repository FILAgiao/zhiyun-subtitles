const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.route('https://classroom.test/',r=>r.fulfill({contentType:'text/html',body:'<html><title>CPU Architecture</title></html>'}));await page.goto('https://classroom.test/');
  await page.setContent('<title>CPU Architecture</title><style>video{width:900px;height:600px}</style><video></video><div id="pane-voice"></div>');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{
   const phrase='the financial market uses several different trading strategies';
   document.querySelector('#pane-voice').innerHTML=Array.from({length:20},(_,i)=>`<div class="trans-item"><div class="item-title">00:00:${String(i*2).padStart(2,'0')}</div><div class="trans-lan"><div>${i===5?phrase:'We study register example '+i}</div></div></div>`).join('');
   const identity=JSON.stringify([null,null,null]);
   window.saved={'ark-api-key':'fake','speech-credentials':{apiKey:'fake'},['translation-domain:'+identity]:'CPU architecture',['translation-glossary:'+identity]:'register = 寄存器'};
   window.GM_getValue=(k,d)=>saved[k]??d;window.GM_setValue=(k,v)=>saved[k]=v;window.GM_deleteValue=k=>delete saved[k];window.GM_registerMenuCommand=()=>{};
   window.requests=[];
   window.GM_xmlhttpRequest=options=>{
    requests.push({url:options.url,body:JSON.parse(options.data||'{}')});
    if(options.url.includes('responses')) queueMicrotask(()=>options.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'寄存器示例'}]}]})}));
    else if(options.url.endsWith('submit')) queueMicrotask(()=>options.onload({status:200,responseHeaders:'X-Api-Status-Code: 20000000',responseText:'{}'}));
    else if(options.url.endsWith('query')) window.releaseQuery=()=>options.onload({status:200,responseHeaders:'X-Api-Status-Code: 20000000',responseText:JSON.stringify({result:{utterances:[{text:phrase,start_time:0}]}})});
    return {abort(){options.onabort?.();}};
   };
   const video=document.querySelector('video');Object.defineProperties(video,{paused:{get:()=>false},readyState:{get:()=>3},duration:{get:()=>3600},currentTime:{get:()=>12,set(){}},playbackRate:{get:()=>1,set(){}}});
   const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timeout(fn,ms===12000?20:ms===2000?10:ms,...args);
   const track={stop(){}};video.captureStream=()=>({getAudioTracks:()=>[track],getTracks:()=>[track]});
   window.MediaStream=class{};window.MediaRecorder=class{constructor(){this.mimeType='audio/webm';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['audio'])});this.onstop();}};
   window.AudioContext=class{async decodeAudioData(){return {duration:12};}async close(){}};
   window.OfflineAudioContext=class{createBufferSource(){return {connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array([.1,.2,.3])};}};
  });
  await page.addScriptTag({content:fs.readFileSync('zhiyun-subtitles.user.js','utf8')});await page.waitForTimeout(650);
  const ui=page.locator('#zy-subtitle-host');
  assert.equal(await ui.locator('#auto-sync').isChecked(),false);
  await ui.locator('#mode').selectOption('both');await page.waitForTimeout(200);
  const contextual=await page.evaluate(()=>requests.find(r=>r.url.includes('responses'))?.body);
  assert.equal(contextual.model,'doubao-seed-2-1-lite-260915');
  const context=JSON.parse(contextual.input[1].content[0].text).reference;
  assert.equal(context.subject,'CPU architecture');assert.equal(context.terminology,'register = 寄存器');assert.ok(context.preceding.length>=5);
  await ui.locator('#settings-open').click();await ui.locator('#settings-tab-translation').click();await ui.locator('#translation-profile').selectOption('economy');await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>requests.filter(r=>r.url.includes('responses')).at(-1).body.model),'doubao-seed-translation-250915');
  await ui.locator('#settings-tab-sync').click();await ui.locator('#auto-sync').check();assert.equal(await ui.locator('#auto-sync').isChecked(),true);
  await ui.locator('#auto-align').click();await page.waitForFunction(()=>!!window.releaseQuery);
  await ui.locator('#settings-sync details > summary').click();await ui.locator('#offset').fill('5');
  await page.evaluate(()=>releaseQuery());await page.waitForTimeout(100);
  assert.equal(await ui.locator('#offset').inputValue(),'5');assert.equal(await ui.locator('#auto-sync').isChecked(),false);
  assert.match(await ui.locator('#sync-status').textContent(),/手动模式/);
  assert.equal(await page.evaluate(()=>saved['subtitle-sync:'+JSON.stringify([null,null,null])].manual),true);
  await page.waitForTimeout(200);assert.equal(await ui.locator('#offset').inputValue(),'5');
  assert.deepEqual(errors,[]);
  console.log('Translation context, settings changes and manual takeover with a late ASR response passed (mock services only).');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
