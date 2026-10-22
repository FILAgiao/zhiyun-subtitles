'use strict';
// Every service request and audio frame is synthetic. No real audio is uploaded.
const path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const phrase='the financial market uses several different trading strategies for managing risk and measuring expected returns';
const conflict='the biology department studies cellular structures and examines how living organisms adapt to changing environmental conditions';
const unrelated='this unrelated statement contains several distinct words about a completely different subject entirely';
const screenshotRecognition='光信号变成了一些电荷信号。那电荷信号再根据后面的这个 A D 物理信号，就是因为它';
const screenshotCaption='那电荷信号再根据后面的这个ADC也就是模拟信号，就是为他的电气化。';
const homophoneCaption='模数转换后的采样电压，会被处理器写入存储器，再按照数字信号的顺序完成编码。';
const homophoneRecognition='魔数转焕后的采样电压，会被处理气写入存储器，再按照数字信号的顺序完成编码。';
// Deterministic synthetic character timings, not actual ASR output or a real recording.
// The second clause starts at 3000 ms; a substring match must use its own word time.
const screenshotWords=Array.from(screenshotRecognition).map((text,index)=>({text,start_time:index<screenshotRecognition.indexOf('那')?Math.round(index*3000/screenshotRecognition.indexOf('那')):3000+(index-screenshotRecognition.indexOf('那'))*150}));
const caption=phrase+' while the professor continues discussing many other unrelated details about investment institutions and their organizational structure in another market';
const fixture='<style>body{margin:0;background:#eee4d9}.cmc-main{width:850px;height:480px;background:#263d4c}video{width:100%;height:100%}.spoken-language-body{display:none}</style><div class="cmc-main"><video></video></div><div class="spoken-language-body"><div class="voice-body_wrap"><div class="trans-item"><p class="item-time">00:00:20</p><div class="item-origin">'+caption+'</div></div><div class="trans-item"><p class="item-time">00:00:50</p><div class="item-origin">'+conflict+'</div></div><div class="trans-item"><p class="item-time">01:02:24</p><div class="item-origin">'+screenshotCaption+'</div></div><div class="trans-item"><p class="item-time">00:01:40</p><div class="item-origin">'+homophoneCaption+'</div></div></div></div>';
function installFixture({plans,phrase,native,streaming=false}){
 globalThis.speechFixture={plans,phrase,calls:[],jobs:{},pending:{},round:0,streaming};
 globalThis.fixtureRequest=async(url,options={})=>{
  const state=speechFixture,pathname=new URL(url).pathname;
  if(pathname.endsWith('/me'))return{status:200,headers:{'Content-Type':'application/json'},body:{username:'fixture',usage:{requests:0,request_limit:100,audio_seconds:0,audio_limit:100},permissions:{learning:true,translation:true,speech:true},membership:{active:true,plan:'pro'},capabilities:{speech_stream:state.streaming,speech_stream_pcm:true}}};
  if(pathname.endsWith('/prompts'))return{status:404,headers:{'Content-Type':'application/json'},body:{error:'接口不存在'}};
  if(pathname.endsWith('/activity')||pathname.endsWith('/auth/logout'))return{status:200,headers:{'Content-Type':'application/json'},body:{}};
  const streamAction=pathname.match(/\/speech\/stream\/(create|push|poll|finish|cancel)$/)?.[1];
  if(streamAction){
   const body=JSON.parse(options.data||options.body||'{}'),id=body.request_id||body.id;
   let job=state.jobs[id];
   if(streamAction==='create'){
    if(job)throw Error('Duplicate stream create');
    job=state.jobs[id]={id,round:++state.round,state:'listening',revision:0,result:{text:'',utterances:[]},next:0};
   }
   if(!job)throw Error('Unknown stream session');
   const plan=state.plans[job.round-1]||{};
   state.calls.push({action:streamAction,requestId:id,round:job.round,sequence:body.sequence});
   const snapshot=()=>({id,state:job.state,revision:job.revision,result:job.result,audio_seconds:job.next*.2,max_seconds:30,chunk_ms:200});
   const reply=()=>({status:200,headers:{'Content-Type':'application/json'},body:snapshot()});
   if(streamAction==='cancel'){job.state='cancelled';return reply();}
   if(streamAction==='finish'){job.state='complete';job.revision++;return reply();}
   if(streamAction==='push'){
    if(body.sequence!==job.next)throw Error('Stream sequence is not continuous');
    if(!body.audio||body.audio.length>42668)throw Error('Invalid synthetic PCM chunk');
    job.next++;job.revision++;
    const event=(plan.streamEvents||[])[job.next-1]||{text:plan.text??state.phrase,definite:!plan.neverStable&&job.next>=2};
    job.result={text:event.text,utterances:[{text:event.text,definite:event.definite===true,start_time:0,end_time:2000,...(event.words?{words:event.words}:{})}]};
    if(plan.holdPush===job.next){const key=job.round+':push:'+body.sequence;return await new Promise(resolve=>state.pending[key]=()=>{delete state.pending[key];resolve(reply());});}
   }
   return reply();
  }
  const action=pathname.match(/\/speech\/(submit|query)$/)?.[1];if(!action)throw Error('Unexpected fixture request: '+pathname);
  const requestId=Object.entries(options.headers||{}).find(([key])=>key.toLowerCase()==='x-api-request-id')?.[1];if(!requestId)throw Error('Speech fixture needs a request UUID');
  let job=state.jobs[requestId];
  if(action==='submit'){
   if(job)throw Error('Duplicate paid submission for '+requestId);
   const body=JSON.parse(options.data||options.body||'{}');if(!body.audio?.data||body.audio.data.length>256)throw Error('Only tiny synthetic audio is permitted');
   job=state.jobs[requestId]={round:++state.round,queries:0};
  }
  if(!job)throw Error('Query without original UUID');
  const plan=state.plans[job.round-1]||{},query=action==='query'?++job.queries:0;state.calls.push({action,requestId,round:job.round,query});
  const reply=()=>{
   if(action==='submit'&&plan.submitTimeout||action==='query'&&(plan.queryTimeouts||0)>=query)return{timeout:true};
   if(action==='submit'&&!plan.submitTranscript)return{status:200,headers:{'Content-Type':'application/json','X-Api-Status-Code':'20000001'},body:{}};
   return{status:200,headers:{'Content-Type':'application/json','X-Api-Status-Code':'20000000'},body:{result:{utterances:[{text:plan.text??state.phrase,start_time:plan.startTime??0,...(plan.words?{words:plan.words}:{})}]}}};
  };
  if(action==='submit'&&plan.holdSubmit||action==='query'&&plan.holdQuery&&query===1){const key=job.round+':'+action;return await new Promise(resolve=>state.pending[key]=()=>{delete state.pending[key];resolve(reply());});}
  return reply();
 };
 if(native){
  if(!globalThis.fixtureOriginalSetTimeout){const original=globalThis.setTimeout;globalThis.fixtureOriginalSetTimeout=original;globalThis.setTimeout=(fn,ms,...args)=>original(fn,ms>=15000&&ms<=45000&&!speechFixture.streaming?1000:ms,...args);}
  globalThis.fetch=async(url,options={})=>{const r=await fixtureRequest(url,options);if(r.timeout)return await new Promise((resolve,reject)=>{if(options.signal?.aborted)reject(Error('fixture timeout'));else options.signal?.addEventListener('abort',()=>reject(Error('fixture timeout')),{once:true});});return new Response(JSON.stringify(r.body),{status:r.status,headers:r.headers});};
 }else{
  window.values={'cache-auto':false,'gateway-guide-no-remind-v2':true,'gateway-account-v1':{url:'https://47.77.182.216.sslip.io/gateway',token:'fixture-token'}};
  window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;window.GM_deleteValue=k=>delete values[k];window.GM_registerMenuCommand=()=>{};
  window.GM_xmlhttpRequest=o=>{fixtureRequest(o.url,o).then(r=>r.timeout?o.ontimeout?.():o.onload?.({status:r.status,responseText:JSON.stringify(r.body),responseHeaders:Object.entries(r.headers).map(([k,v])=>k+': '+v).join('\r\n')}));return{abort(){o.onabort?.();}};};
 }
}
function mockAudio({currentTime=22,streaming=false}={}){
 const v=document.querySelector('video');let generated=0;
 Object.defineProperties(v,{duration:{get:()=>7200},currentTime:{get:()=>currentTime+(streaming?generated/16000:0),set(){}},paused:{get:()=>false},readyState:{get:()=>3},playbackRate:{get:()=>1,set(){}}});v.play=async()=>{};
 const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timeout(fn,(ms===12000||ms===20000)&&!streaming?20:ms===2000?10:ms,...args);
 window.audioCounters={recordings:0,stopped:0,callbacks:0};
 const track={stop(){audioCounters.stopped++;},clone(){return{stop(){audioCounters.stopped++;}};}};
 v.captureStream=()=>({getAudioTracks:()=>[track],getTracks:()=>[track]});window.MediaStream=class{constructor(tracks=[]){this.tracks=tracks;}getTracks(){return this.tracks;}};
 window.MediaRecorder=class{constructor(){this.mimeType='audio/webm';this.state='inactive';}start(){this.state='recording';audioCounters.recordings++;}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['fixture'])});this.onstop();}};
 window.AudioContext=class{
  constructor(){this.sampleRate=16000;this.destination={};this.state='running';}
  async resume(){}async decodeAudioData(){return{duration:20};}async close(){}
  createMediaStreamSource(){return{channelCount:1,connect(){},disconnect(){}};}
  createGain(){return{gain:{value:0},connect(){},disconnect(){}};}
  createScriptProcessor(){let timer;const processor={onaudioprocess:null,connect(){timer=setInterval(()=>{if(!processor.onaudioprocess)return;generated+=3200;audioCounters.callbacks++;processor.onaudioprocess({inputBuffer:{length:3200,numberOfChannels:1,getChannelData:()=>new Float32Array(3200).fill(.1)}});},40);},disconnect(){clearInterval(timer);}};return processor;}
 };
 window.OfflineAudioContext=class{createBufferSource(){return{connect(){},start(){}};}async startRendering(){return{getChannelData:()=>new Float32Array([.1,.2,.3])};}};
}
(async()=>{
 const native=process.argv.includes('--extension'),dir=path.resolve('dist/extension');let browser,worker,scenario=0;
 const context=native?await chromium.launchPersistentContext(path.resolve('.test-media/speech-sync-'+Date.now()),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1440,height:1000},args:['--disable-extensions-except='+dir,'--load-extension='+dir]}):await(browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})).newContext({viewport:{width:1440,height:1000}});
 try{
  if(native){worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.local.set({'cache-auto':false,'gateway-guide-no-remind-v2':true,'gateway-account-v1':{url:'https://47.77.182.216.sslip.io/gateway',token:'fixture-token'}}));}
  await context.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html; charset=utf-8',body:fixture}):r.abort());
  async function open(plans,{currentTime=22,streaming=false}={}){
   const page=await context.newPage(),errors=[],worlds=new Map();page.on('pageerror',e=>errors.push(e.message));let session;const setup={plans,phrase,native,streaming};
   if(native){await worker.evaluate(({code,setup})=>(0,eval)('('+code+')')(setup),{code:installFixture.toString(),setup});session=await context.newCDPSession(page);session.on('Runtime.executionContextCreated',e=>worlds.set(e.context.id,e.context));session.on('Runtime.executionContextDestroyed',e=>worlds.delete(e.executionContextId));session.on('Runtime.executionContextsCleared',()=>worlds.clear());await session.send('Runtime.enable');}
   await page.goto('https://classroom.zju.edu.cn/livingpage?tenant_code=112&course_id=speech-'+(++scenario)+'&sub_id=1');
   if(!native){await page.evaluate(installFixture,setup);await page.evaluate(mockAudio,{currentTime,streaming});await page.addScriptTag({path:'zhiyun-subtitles.user.js'});}
   const ui=page.locator('#zy-subtitle-host');await ui.locator('#sync-toggle').waitFor();
   if(native){let world;for(const[id,info]of worlds){if(info.auxData?.isDefault)continue;try{const r=await session.send('Runtime.evaluate',{contextId:id,expression:'typeof ZYClassroomMedia',returnByValue:true});if(r.result.value==='object'){world=id;break;}}catch{}}assert.ok(world);await session.send('Runtime.evaluate',{contextId:world,expression:'('+mockAudio.toString()+')('+JSON.stringify({currentTime,streaming})+')',returnByValue:true});}
   await page.waitForTimeout(650);
   const evaluate=fn=>native?worker.evaluate(fn):page.evaluate(fn),calls=()=>evaluate(()=>speechFixture.calls);
   const pending=async key=>{const start=Date.now();while(Date.now()-start<8000){if((await evaluate(()=>Object.keys(speechFixture.pending))).includes(key))return;await page.waitForTimeout(20);}throw Error('Missing held '+key+'; calls='+JSON.stringify(await calls())+'; status='+await ui.locator('#align-status').textContent());};
   const release=key=>native?worker.evaluate(key=>{const release=speechFixture.pending[key];if(!release)throw Error('No pending '+key);release();},key):page.evaluate(key=>{const release=speechFixture.pending[key];if(!release)throw Error('No pending '+key);release();},key);
   const syncKey='subtitle-sync:'+JSON.stringify(['speech-'+scenario,'1','112']);
   const saved=()=>native?worker.evaluate(key=>chrome.storage.local.get(key).then(values=>values[key]),syncKey):page.evaluate(key=>values[key],syncKey);
   const done=()=>page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('auto-align').textContent==='开始匹配');
   return{page,ui,calls,pending,release,done,saved,start:()=>ui.locator('#sync-toggle').click(),offset:()=>ui.locator('#offset').inputValue(),status:()=>ui.locator('#align-status').textContent(),attempts:()=>ui.locator('#align-attempts li').allTextContents(),live:()=>ui.locator('#sync-live-status').textContent(),close:async()=>{assert.deepEqual(errors,[]);await page.close();}};
  }
  async function oneSubmission(s){const calls=await s.calls();assert.equal(calls.filter(x=>x.action==='submit').length,1);assert.equal(new Set(calls.filter(x=>['submit','query'].includes(x.action)).map(x=>x.requestId)).size,1);}
  {
   const s=await open([{}]);await s.start();await s.done();assert.equal(await s.offset(),'2');assert.match(await s.status(),/匹配成功.*时间差 \+2 秒/);await oneSubmission(s);assert.equal((await s.attempts()).length,1);await s.close();
  }
  {
   const s=await open([{text:unrelated}]);await s.ui.locator('#offset').evaluate(e=>{e.value='7';e.dispatchEvent(new Event('input',{bubbles:true}));});await s.start();await s.done();assert.equal(await s.offset(),'7');await oneSubmission(s);assert.match(await s.status(),/未.*可靠匹配|未找到可靠时间差/);assert.equal(await s.ui.locator('#sync-complete').isHidden(),true);await s.close();
  }
  {
   const s=await open([{submitTranscript:true}]);await s.start();await s.done();assert.equal(await s.offset(),'2');await oneSubmission(s);assert.equal((await s.calls()).filter(x=>x.action==='query').length,0);await s.close();
  }
  {
   const s=await open([{queryTimeouts:1}]);await s.start();await s.done();await oneSubmission(s);assert.equal((await s.calls()).filter(x=>x.action==='query').length,2);assert.equal(await s.offset(),'2');await s.close();
  }
  {
   const s=await open([{holdQuery:true}]);await s.start();await s.pending('1:query');await s.ui.locator('#sync-toggle').click();await s.done();const cancelled=await s.status();await s.release('1:query');await s.page.waitForTimeout(100);assert.equal(await s.offset(),'0');assert.equal(await s.status(),cancelled);await oneSubmission(s);await s.close();
  }
  {
   const s=await open([{holdQuery:true}]);await s.start();await s.pending('1:query');await s.page.evaluate(()=>location.hash='#/replay?course_id=speech-late-other-course');await s.page.waitForTimeout(650);await s.release('1:query');await s.page.waitForTimeout(150);assert.equal(await s.offset(),'0');assert.equal(await s.ui.locator('#sync-complete').isHidden(),true);assert.doesNotMatch(await s.status(),/匹配成功/);assert.deepEqual(await s.attempts(),[]);assert.equal(await s.live(),'');await s.close();
  }
  {
   const s=await open([{holdQuery:true}]);await s.start();await s.pending('1:query');await s.ui.locator('#offset').evaluate(e=>{e.value='7';e.dispatchEvent(new Event('input',{bubbles:true}));});await s.done();await s.release('1:query');await s.page.waitForTimeout(100);assert.equal(await s.offset(),'7');assert.match(await s.status(),/手动微调.*时间差 \+7 秒/);assert.equal((await s.saved()).manual,true);await oneSubmission(s);await s.close();
  }
  {
   const s=await open([{text:screenshotRecognition,words:screenshotWords}],{currentTime:3743});await s.start();await s.done();assert.equal(await s.offset(),'2');await oneSubmission(s);assert.match(await s.status(),/匹配成功.*时间差 \+2 秒/);await s.page.screenshot({path:'.test-media/speech-sync-partial-clause-'+(native?'extension':'chrome')+'.png'});await s.close();
  }
  {
   const s=await open([{text:homophoneRecognition}],{currentTime:102});await s.start();await s.done();assert.equal(await s.offset(),'2');await oneSubmission(s);await s.close();
  }
  {
   const s=await open([{holdQuery:true},{holdQuery:true}]);await s.start();await s.pending('1:query');assert.ok(await s.ui.locator('#sync-result').isVisible());await s.ui.locator('#sync-manual-toggle').click();assert.ok(await s.ui.locator('#sync-result').isHidden());await s.release('1:query');await s.done();assert.equal(await s.offset(),'2');assert.ok(await s.ui.locator('#sync-result').isHidden());assert.equal((await s.attempts()).length,1);await s.ui.locator('#sync-manual-toggle').click();assert.ok(await s.ui.locator('#sync-result').isVisible());assert.match(await s.live(),/匹配成功/);await s.ui.locator('#sync-manual-toggle').click();await s.start();await s.pending('2:query');assert.ok(await s.ui.locator('#sync-result').isVisible());assert.doesNotMatch(await s.live(),/第 [23] 次/);await s.ui.locator('#sync-toggle').click();await s.done();await s.release('2:query');await s.page.waitForTimeout(80);assert.equal(await s.offset(),'2');await s.close();
  }
  {
   const s=await open([{holdPush:2}],{streaming:true});await s.start();await s.pending('1:push:1');assert.equal(await s.offset(),'0','partial ASR must not move subtitles');assert.match(await s.live(),/识别|匹配/);assert.equal((await s.attempts()).length,1);await s.release('1:push:1');await s.done();assert.equal(await s.offset(),'2','first definite result applies without another recording');const calls=await s.calls();assert.equal(calls.filter(x=>x.action==='create').length,1);assert.equal(calls.filter(x=>x.action==='submit').length,0);assert.equal(calls.filter(x=>x.action==='cancel').length,1);assert.ok(calls.filter(x=>x.action==='push').length<=2);assert.match(await s.status(),/匹配成功.*时间差 \+2 秒/);await s.page.screenshot({path:'.test-media/speech-stream-first-definite-'+(native?'extension':'chrome')+'.png'});await s.close();
  }
  {
   const s=await open([{holdPush:2}],{streaming:true});await s.start();await s.pending('1:push:1');await s.ui.locator('#sync-manual-toggle').click();assert.ok(await s.ui.locator('#sync-result').isHidden());await s.release('1:push:1');await s.done();assert.equal(await s.offset(),'2');assert.ok(await s.ui.locator('#sync-result').isHidden());assert.equal((await s.attempts()).length,1);await s.close();
  }
  {
   const s=await open([{holdPush:2}],{streaming:true});await s.start();await s.pending('1:push:1');await s.ui.locator('#sync-toggle').click();await s.done();const cancelled=await s.status();await s.release('1:push:1');await s.page.waitForTimeout(100);assert.equal(await s.offset(),'0');assert.equal(await s.status(),cancelled);assert.equal((await s.calls()).filter(x=>x.action==='create').length,1);assert.equal((await s.calls()).filter(x=>x.action==='cancel').length,1);await s.close();
  }
  {
   const s=await open([{holdPush:2}],{streaming:true});await s.start();await s.pending('1:push:1');await s.ui.locator('#offset').evaluate(e=>{e.value='7';e.dispatchEvent(new Event('input',{bubbles:true}));});await s.done();await s.release('1:push:1');await s.page.waitForTimeout(100);assert.equal(await s.offset(),'7');assert.equal((await s.saved()).manual,true);assert.equal((await s.calls()).filter(x=>x.action==='create').length,1);await s.close();
  }
  {
   const s=await open([{text:unrelated,neverStable:true}],{streaming:true});await s.start();await s.done();assert.equal(await s.offset(),'0');const calls=await s.calls();assert.equal(calls.filter(x=>x.action==='create').length,1);assert.equal(calls.filter(x=>x.action==='submit').length,0);assert.equal(calls.filter(x=>x.action==='finish').length,1);assert.equal(calls.filter(x=>x.action==='cancel').length,1);assert.match(await s.status(),/未找到可靠时间差/);await s.close();
  }
  console.log('PASS '+(native?'real Edge MV3':'Chrome userscript')+': 15 scenarios; one file job or one continuous stream per click; first definite result immediately applies; partial results never move offsets; no automatic second/third recordings; same UUID query retries; cancel/course change/manual edit isolate late callbacks; screenshot fragment and homophones; one live log line; +/- collapse survives partial and final results; stream success stops audio and closes session.');
 }finally{await context.close();await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
