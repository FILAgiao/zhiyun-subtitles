const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:'<!doctype html><title>Private page title must not be collected</title><style>body{margin:0}#host{position:fixed;inset:0;pointer-events:none}</style><div id="host"></div>'}):route.abort());
  await page.goto('https://analytics-fixture.test/private?token=never-collect');
  await page.addScriptTag({content:['usage-analytics.js','warm-theme.js','ai-learning.js'].map(p=>fs.readFileSync(p,'utf8')).join('\n')});
  await page.evaluate(()=>{
   window.sent=[];window.failAI=false;window.failCapture=false;window.owner='one';window.heldReply=null;
   window.collector=ZYUsageAnalytics.create({context:()=>({enabled:true,owner}),storage:sessionStorage,send:async body=>{sent.push(body);return{ok:true};}});
   const shadow=document.querySelector('#host').attachShadow({mode:'open'});shadow.innerHTML='<style>[hidden]{display:none!important}</style>';
   const frame=document.createElement('canvas');frame.width=1200;frame.height=900;frame.getContext('2d').fillRect(0,0,1200,900);
   window.ZYNativeCapture={capture:async()=>{if(failCapture)throw Object.assign(Error('fixture failure'),{code:'NATIVE_CAPTURE_FAILED'});return frame.toDataURL();}};
   window.ai=ZhiyunLearning.mountLearningAssistant({shadow,analytics:collector,getApiKey:()=> 'fixture-token',getCourseId:()=>location.href,getCourseTitle:()=>document.title,request:o=>{const respond=()=>o.onload({status:failAI?500:200,responseText:JSON.stringify(failAI?{error:'fixture failure'}:{output:[{type:'message',content:[{type:'output_text',text:'Success answer'}]}]})});if(window.hold)heldReply=respond;else queueMicrotask(respond);return{abort(){}};}});
  });
  const host=page.locator('#host');
  await page.evaluate(()=>ai.send('hello'));await page.evaluate(()=>{failAI=true;return ai.send('failure');});
  await page.evaluate(()=>ai.startCapture());await host.locator('#ai-crop').waitFor();await host.locator('#ai-crop-cancel').click();
  assert.equal(await page.evaluate(()=>collector.inspect().queued),1,'opening and cancelling a selection is not a screenshot');
  await page.evaluate(()=>ai.startCapture());await host.locator('#ai-crop').waitFor();await page.mouse.move(100,100);await page.mouse.down();await page.mouse.move(450,350);await page.mouse.up();await host.locator('#ai-crop-preview').waitFor();
  assert.equal(await page.evaluate(()=>collector.inspect().queued),2,'one actual crop preview records one screenshot');await host.locator('#ai-crop-cancel').click();
  await page.evaluate(()=>{failCapture=true;return ai.capturePage();});assert.equal(await page.evaluate(()=>collector.inspect().queued),2);
  await page.evaluate(()=>collector.flush());const events=await page.evaluate(()=>sent.flatMap(b=>b.events));assert.deepEqual(events.map(e=>e.feature),['ai','screenshot']);assert.ok(events.every(e=>!e.course_id&&!e.course_title));assert.ok(!JSON.stringify(events).includes('never-collect'));assert.ok(!JSON.stringify(events).includes('Success answer'));
  await page.evaluate(()=>{failAI=false;hold=true;void ai.send('delayed');});await page.waitForFunction(()=>!!heldReply);await page.evaluate(()=>{owner='two';heldReply();});await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.querySelector('#ai-learning').getAttribute('aria-busy')==='false');assert.equal(await page.evaluate(()=>collector.inspect().queued),0,'late previous-account completion is ignored');
  await page.evaluate(()=>{ai.destroy();collector.destroy();});assert.deepEqual(errors,[]);await page.close();

  // Exercise the full classroom render hook with current source modules, without
  // mutating the release bundle or contacting a real classroom/model service.
  const classroom=await browser.newPage({viewport:{width:1440,height:900}});classroom.on('pageerror',e=>errors.push(e.message));
  await classroom.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:'<!doctype html><title>测试课堂</title><style>body{margin:0}video{width:850px;height:480px;background:#263d4c}#pane-voice{display:none}</style><video></video><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:00</div><div class="trans-lan"><div>The classroom lecture explains a scientific concept.</div><div>这堂课讲解一个科学概念。</div></div></div><div class="trans-item"><div class="item-title">00:10:00</div><div class="trans-lan"><div>Next topic</div></div></div></div>'}):route.abort());
  await classroom.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=analytics-test&sub_id=1&tenant_code=112');
  await classroom.evaluate(()=>{
   window.values={'cache-auto':false,'gateway-guide-no-remind-v2':true,'gateway-account-v1':{url:'https://47.77.182.216.sslip.io/gateway',token:'fixture-token'}};
   window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;window.GM_deleteValue=k=>delete values[k];window.GM_registerMenuCommand=()=>{};window.sent=[];
   window.GM_xmlhttpRequest=o=>{let body={};const p=new URL(o.url).pathname;if(p.endsWith('/me'))body={id:1,email:'fixture@example.test',username:'fixture',server_time:Date.now()/1000,capabilities:{analytics:true},usage:{requests:0,request_limit:10000,audio_seconds:0,audio_limit:1000},permissions:{learning:true,translation:true,speech:true},membership:{active:true,plan:'pro'}};else if(p.endsWith('/analytics/events')){sent.push(JSON.parse(o.data));body={ok:true};}else if(p.endsWith('/prompts'))body={prompts:[]};queueMicrotask(()=>o.onload?.({status:200,responseText:JSON.stringify(body)}));return{abort(){}};};
   const video=document.querySelector('video');window.clock={time:0,playing:false};Object.defineProperties(video,{duration:{get:()=>3600},currentTime:{get:()=>clock.time},paused:{get:()=>!clock.playing},readyState:{get:()=>3}});video.play=async()=>{};video.pause=()=>{};
  });
  const script=fs.readFileSync('zhiyun-subtitles.user.js','utf8');
  await classroom.addScriptTag({content:script});const ui=classroom.locator('#zy-subtitle-host');await ui.locator('#mode').waitFor();
  await ui.locator('#mode').selectOption('both');await classroom.waitForTimeout(1500);
  await classroom.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  assert.equal(await classroom.evaluate(()=>sent.flatMap(b=>b.events).filter(e=>e.kind==='feature').length),0,'paused subtitle and prefetched translation do not count');
  assert.equal(await classroom.evaluate(()=>sessionStorage.getItem('zy-usage-pending-v1')),null,'website storage contains no telemetry');
  await classroom.evaluate(()=>{clock.playing=true;window.playTimer=setInterval(()=>clock.time+=.1,100);});await classroom.waitForTimeout(3500);
  await classroom.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));});await classroom.waitForFunction(()=>sent.length>0);
  const displayed=await classroom.evaluate(()=>sent.flatMap(b=>b.events));assert.equal(displayed.filter(e=>e.feature==='subtitle').length,1);assert.equal(displayed.filter(e=>e.feature==='translation').length,1);assert.ok(displayed.every(e=>!e.course_id||/^[a-f0-9]{32}$/.test(e.course_id)));
  assert.deepEqual(errors,[]);console.log('PASS analytics UI: real AI/crop success hooks, cancellation/failure exclusion, account race, no ordinary-page content, full classroom display-only feature sampling.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
