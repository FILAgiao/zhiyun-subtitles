const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.route('https://interactivemeta.cmc.zju.edu.cn/',r=>r.fulfill({contentType:'text/html',body:'<html><title>CPU Architecture</title></html>'}));await page.goto('https://interactivemeta.cmc.zju.edu.cn/');
  await page.setContent('<title>CPU Architecture</title><style>video{width:900px;height:600px}</style><video></video><div id="pane-voice"></div>');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>{
   const phrase='the financial market uses several different trading strategies';
   document.querySelector('#pane-voice').innerHTML=Array.from({length:20},(_,i)=>`<div class="trans-item"><div class="item-title">00:00:${String(i*2).padStart(2,'0')}</div><div class="trans-lan"><div>${i===4?'现在我们继续讲下一页':i===5?phrase:i===6?'我们使用 Transformer attention mechanism 来处理输入序列并输出结果':'We study register example '+i}</div></div></div>`).join('');
   const identity=JSON.stringify([null,null,null]);
   window.saved={'gateway-guide-no-remind-v2':true,'translation-profile':'context','ark-api-key':'fake','display-preferences':{direction:'zh-en'},'speech-credentials':{apiKey:'fake'},['translation-domain:'+identity]:'CPU architecture',['translation-glossary:'+identity]:'register = 寄存器'};
   window.GM_getValue=(k,d)=>saved[k]??d;window.GM_setValue=(k,v)=>saved[k]=v;window.GM_deleteValue=k=>delete saved[k];window.GM_registerMenuCommand=()=>{};
   window.requests=[];window.intervalCallbacks=[];const originalInterval=window.setInterval;window.setInterval=(fn,ms,...args)=>{if(ms===100)intervalCallbacks.push(fn);return originalInterval(fn,ms,...args);};
   window.GM_xmlhttpRequest=options=>{
    requests.push({url:options.url,body:JSON.parse(options.data||'{}')});
    if(options.url.includes('responses')) {const request=JSON.parse(options.data);const input=request.input[0].content[0].text;const text=/^\[01\] /.test(input)?input.split('\n').map(line=>line.slice(0,5)+'寄存器示例').join('\n'):'寄存器示例';window.setTimeout(()=>options.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text}]}]})}),100);}
    else if(options.url.endsWith('submit')) queueMicrotask(()=>options.onload({status:200,responseHeaders:'X-Api-Status-Code: 20000000',responseText:'{}'}));
    else if(options.url.endsWith('query')) window.releaseQuery=()=>options.onload({status:200,responseHeaders:'X-Api-Status-Code: 20000000',responseText:JSON.stringify({result:{utterances:[{text:phrase,start_time:0}]}})});
    return {abort(){options.onabort?.();}};
   };
   window.playing=false;window.playCalls=0;window.rejectPlay=true;const video=document.querySelector('video');video.play=async()=>{playCalls++;if(rejectPlay)throw Error('blocked');playing=true;video.dispatchEvent(new Event('playing'));};Object.defineProperties(video,{paused:{get:()=>!playing},readyState:{get:()=>3},duration:{get:()=>3600},currentTime:{get:()=>window.videoTime??12,set(){ }},playbackRate:{get:()=>1,set(){}}});
   const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timeout(fn,(ms===12000||ms===20000)?20:ms===2000?10:ms,...args);
   const track={stop(){}};video.captureStream=()=>({getAudioTracks:()=>[track],getTracks:()=>[track]});
   window.MediaStream=class{};window.MediaRecorder=class{constructor(){this.mimeType='audio/webm';this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['audio'])});this.onstop();}};
   window.AudioContext=class{async decodeAudioData(){return {duration:12};}async close(){}};
   window.OfflineAudioContext=class{createBufferSource(){return {connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array([.1,.2,.3])};}};
  });
  await page.addScriptTag({content:fs.readFileSync('zhiyun-subtitles.user.js','utf8').replace(/const DEFAULT_ORIGIN=[^;]+;/,'const DEFAULT_ORIGIN="";')});await page.waitForTimeout(650);
  const ui=page.locator('#zy-subtitle-host');
  assert.equal(await ui.locator('#sync-auto-indicator').isHidden(),false);assert.equal(await ui.locator('#auto-sync').isChecked(),true);assert.equal(await ui.locator('#direction').inputValue(),'auto-zh');
  await ui.locator('#mode').selectOption('both');
  assert.equal(await ui.locator('#translation-status').textContent(),'翻译已开启');
  await page.waitForTimeout(200);
  assert.equal(await ui.locator('#translation-status').textContent(),'翻译已开启');
  const requestsForTranslation=await page.evaluate(()=>requests.filter(r=>r.url.includes('responses')).map(r=>r.body));
  assert.ok(requestsForTranslation.length>0 && requestsForTranslation.every(body=>body.model==='doubao-seed-translation-250915' && body.input.length===1));
  assert.deepEqual(requestsForTranslation[0].input[0].content[0].translation_options,{target_language:'zh'});
  await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('translation').textContent==='寄存器示例');
  assert.match(await ui.locator('#original').textContent(),/我们使用 Transformer/);
  assert.ok(requestsForTranslation.some(body=>body.input[0].content[0].text.includes('我们使用')));
  await page.evaluate(()=>{videoTime=8;const lines=document.querySelectorAll('.trans-lan')[4];const old=document.createElement('div');old.textContent='An unwanted English translation';lines.append(old);});
  await page.waitForTimeout(350);
  assert.equal(await ui.locator('#original').textContent(),'现在我们继续讲下一页');
  assert.equal(await ui.locator('#translation').textContent(),'');
  assert.equal(await page.evaluate(()=>requests.some(r=>r.url.includes('responses')&&r.body.input[0].content[0].text.includes('现在我们继续讲下一页'))),false);
  await page.evaluate(()=>videoTime=12);
  await ui.locator('#settings-open').click();await ui.locator('#settings-tab-translation').click();
  assert.equal(await ui.locator('#translation-profile').count(),0);
  assert.ok(await ui.locator('#translation-batch-size').isVisible());
  await ui.locator('#settings-tab-sync').click();await ui.locator('#auto-sync').check();assert.equal(await ui.locator('#auto-sync').isChecked(),true);
  await page.evaluate(()=>playing=true);
  await page.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('sync-auto-indicator').title.includes('20 分钟'));
  await page.evaluate(()=>playing=false);
  assert.match(await ui.locator('#auto-sync').evaluate(e=>e.closest('label').textContent),/20 分钟/);
  await ui.locator('#auto-sync').uncheck();assert.equal(await ui.locator('#sync-auto-indicator').isHidden(),true);await ui.locator('#auto-sync').check();

  await ui.locator('#settings-close').click();assert.equal(await ui.locator('#sync-auto-indicator').isVisible(),true);await ui.locator('#panel').screenshot({path:'.test-media/sync-timer-preview.png'});await ui.locator('#sync-toggle').click();await page.waitForTimeout(100);assert.match(await ui.locator('#align-status').textContent(),/无法自动播放/);assert.equal(await page.evaluate(()=>requests.filter(r=>r.url.endsWith('submit')).length),0);await page.evaluate(()=>rejectPlay=false);await ui.locator('#sync-toggle').click();await page.waitForFunction(()=>!!window.releaseQuery);assert.equal(await page.evaluate(()=>playing),true);assert.equal(await page.evaluate(()=>playCalls),2);
  if(await ui.locator('#offset').isHidden()){if(await ui.locator('#sync-manual-toggle').getAttribute('aria-expanded')==='true')await ui.locator('#sync-manual-toggle').click();await ui.locator('#sync-manual-toggle').click();}
  await ui.locator('#offset').fill('5');
  await page.evaluate(()=>releaseQuery());await page.waitForTimeout(100);
  assert.equal(await ui.locator('#offset').inputValue(),'5');assert.equal(await ui.locator('#auto-sync').isChecked(),false);assert.equal(await ui.locator('#sync-auto-indicator').isHidden(),true);
  assert.match(await ui.locator('#sync-status').textContent(),/手动模式/);
  assert.equal(await page.evaluate(()=>saved['subtitle-sync:'+JSON.stringify([null,null,null])].manual),true);
  await page.waitForTimeout(200);assert.equal(await ui.locator('#offset').inputValue(),'5');
  // Drive the existing playback tick to the exact 20-minute boundary.
  await ui.locator('#mode').selectOption('original');await ui.locator('#settings-open').click();await ui.locator('#settings-tab-sync').click();await ui.locator('#auto-sync').check();await ui.locator('#settings-close').click();
  await page.evaluate(()=>{
    playing=true;window.captureAttempts=0;
    document.querySelector('video').captureStream=()=>{captureAttempts++;throw Error('mock periodic audio failure');};
    const tick=intervalCallbacks.find(fn=>String(fn).includes('tick();updateEditHandles'));
    if(!tick)throw Error('Missing existing playback timer');
    for(let elapsed=0;elapsed<1200;elapsed++){videoTime=12+elapsed;tick();}
  });
  assert.equal(await page.evaluate(()=>captureAttempts),0,'no calibration before 20 minutes');
  await page.evaluate(()=>videoTime=1212);
  await page.waitForFunction(()=>document.querySelector('#zy-subtitle-host').shadowRoot.getElementById('sync-status').textContent.includes('遇到错误'));
  assert.equal(await page.evaluate(()=>captureAttempts),1);
  assert.equal(await ui.locator('#auto-sync').isChecked(),true);
  await ui.locator('#sync-auto-indicator[data-state="paused"]').waitFor({state:'visible'});
  await page.evaluate(()=>location.hash='#/replay?course_id=next');
  await ui.locator('#sync-auto-indicator[data-state="waiting"]').waitFor({state:'visible'});
  assert.equal(await ui.locator('#auto-sync').isChecked(),true);
  assert.deepEqual(errors,[]);
  console.log('Seed Translation, timer visibility/interval/off/manual/error/course reset and late ASR takeover passed (mock services only).');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
