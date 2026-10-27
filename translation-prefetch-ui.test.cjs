'use strict';
// Real browser/UI regression, synthetic classroom and model responses only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const native=process.argv.includes('--extension');
const executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH||(native?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'C:/Program Files/Google/Chrome/Application/chrome.exe');
const stamp=t=>[Math.floor(t/3600),Math.floor(t/60)%60,t%60].map(n=>String(n).padStart(2,'0')).join(':');
const escape=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const markup=rows=>rows.map(row=>'<div class="trans-item"><div class="item-title">'+stamp(row.start)+'</div><div class="trans-lan"><div>'+escape(row.text)+'</div>'+(row.school?'<div>'+escape(row.school)+'</div>':'')+'</div></div>').join('');
const translatedText=(text,prefix='中文译文：')=>prefix+'第'+(text.match(/\d+/)?.[0]||'混合')+'条课堂译文';
const rows=(count=24,step=5)=>Array.from({length:count},(_,i)=>({start:i*step,text:'The processor stores classroom example number '+i+' in memory.'}));
function installTransport({native,plans}){
 globalThis.translationFixture={calls:[],pending:{},plans};
 globalThis.fixtureRequest=async(url,options={})=>{
  const pathname=new URL(url).pathname,state=translationFixture;
  if(pathname.endsWith('/me'))return{status:200,body:{username:'fixture',usage:{requests:0,request_limit:10000,audio_seconds:0,audio_limit:10000},permissions:{learning:true,translation:true,speech:true},membership:{active:true,plan:'pro'}}};
  if(pathname.endsWith('/prompts'))return{status:404,body:{error:'接口不存在'}};
  if(pathname.endsWith('/activity'))return{status:200,body:{}};
  if(!pathname.endsWith('/responses'))throw Error('Unexpected local fixture request: '+pathname);
  const body=JSON.parse(options.body||options.data||'{}'),payload=JSON.parse(body.input[1].content[0].text),targets=payload.target_subtitles||[{id:'0',text:payload.target_subtitle}],ordinal=state.calls.length,plan=state.plans[ordinal]||{};
  const call={ordinal,targets,payload,client:options.headers?.['X-Client-Type'],started:Date.now(),completed:null};state.calls.push(call);
  if(plan.hold)await new Promise(resolve=>state.pending[ordinal]=()=>{delete state.pending[ordinal];resolve();});
  const results=targets.map((target,i)=>({id:target.id,text:plan.invalid==='empty'||plan.invalid==='mixed'&&i===1?'':plan.invalid==='echo'||plan.invalid==='mixed'&&i===0?target.text:(plan.prefix||'中文译文：')+'第'+(target.text.match(/\d+/)?.[0]||'混合')+'条课堂译文'}));
  const text=payload.target_subtitles?JSON.stringify({translations:results}):results[0].text;
  call.completed=Date.now();
  return{status:plan.status||200,body:plan.status?{error:plan.error||'unrecognized provider limit'}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}};
 };
 if(native)globalThis.fetch=async(url,options)=>{const r=await fixtureRequest(url,options);return new Response(JSON.stringify(r.body),{status:r.status,headers:{'Content-Type':'application/json'}});};
 else{
  globalThis.fixtureValues={'cache-auto':false,'gateway-guide-no-remind-v2':true,'gateway-account-v1':{url:'https://47.77.182.216.sslip.io/gateway',token:'fixture-translation-token'}};
  globalThis.GM_getValue=(key,fallback)=>fixtureValues[key]??fallback;globalThis.GM_setValue=(key,value)=>fixtureValues[key]=value;globalThis.GM_deleteValue=key=>delete fixtureValues[key];globalThis.GM_registerMenuCommand=()=>{};
  globalThis.GM_xmlhttpRequest=options=>{fixtureRequest(options.url,options).then(r=>options.onload?.({status:r.status,responseText:JSON.stringify(r.body),responseHeaders:'Content-Type: application/json'}));return{abort(){options.onabort?.();}};};
 }
}
function installClock(){
 const video=document.querySelector('video');globalThis.translationClock={time:0,rate:1};
 Object.defineProperties(video,{duration:{get:()=>3600},currentTime:{get:()=>translationClock.time,set:value=>translationClock.time=value},playbackRate:{get:()=>translationClock.rate,set:value=>translationClock.rate=value},paused:{get:()=>true},readyState:{get:()=>3}});
 video.play=async()=>{};video.pause=()=>{};
}
(async()=>{
 fs.mkdirSync('.test-media',{recursive:true});let browser,worker,scenario=0;const evidence=[];
 const extension=path.resolve(process.env.ZY_TEST_EXTENSION_DIR||'dist/extension');
 const context=native?await chromium.launchPersistentContext(path.resolve('.test-media/translation-prefetch-'+Date.now()),{headless:true,executablePath,viewport:{width:1440,height:900},args:['--disable-extensions-except='+extension,'--load-extension='+extension]}):await(browser=await chromium.launch({headless:true,executablePath})).newContext({viewport:{width:1440,height:900}});
 try{
  if(native){worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.local.set({'cache-auto':false,'gateway-guide-no-remind-v2':true,'display-preferences':{mode:'original'},'gateway-account-v1':{url:'https://47.77.182.216.sslip.io/gateway',token:'fixture-translation-token'}}));}
  async function open(cues,plans=[]){
   const page=await context.newPage(),errors=[],worlds=new Map();let session,world;
   page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html; charset=utf-8',body:'<title>Translation Fixture</title><style>body{margin:0;background:#eee4d9}video{width:850px;height:480px;background:#263d4c}#pane-voice{display:none}</style><video></video><div id="pane-voice">'+markup(cues)+'</div>'}):route.abort());
   if(native){await worker.evaluate(({code,setup})=>(0,eval)('('+code+')')(setup),{code:installTransport.toString(),setup:{native,plans}});session=await context.newCDPSession(page);session.on('Runtime.executionContextCreated',e=>worlds.set(e.context.id,e.context));session.on('Runtime.executionContextDestroyed',e=>worlds.delete(e.executionContextId));session.on('Runtime.executionContextsCleared',()=>worlds.clear());await session.send('Runtime.enable');}
   await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=translation-fixture-'+(++scenario)+'&sub_id=1');
   if(!native){await page.evaluate(installTransport,{native,plans});await page.evaluate(installClock);await page.addScriptTag({path:process.env.ZY_TEST_USERSCRIPT_PATH||'zhiyun-subtitles.user.js'});}
   const ui=page.locator('#zy-subtitle-host');await ui.locator('#mode').waitFor();
   if(native){for(const[id,info]of worlds){if(info.auxData?.isDefault)continue;const r=await session.send('Runtime.evaluate',{contextId:id,expression:'typeof ZYClassroomMedia',returnByValue:true});if(r.result.value==='object'){world=id;break;}}assert.ok(world,'extension isolated world exists');await session.send('Runtime.evaluate',{contextId:world,expression:'('+installClock.toString()+')()',returnByValue:true});}
   const evaluate=(fn,arg)=>native?worker.evaluate(fn,arg):page.evaluate(fn,arg);
   const clock=async(time,rate=1)=>{const fn=({time,rate})=>{translationClock.time=time;translationClock.rate=rate;document.querySelector('video').dispatchEvent(new Event('seeking'));document.querySelector('video').dispatchEvent(new Event('seeked'));};if(native)await session.send('Runtime.evaluate',{contextId:world,expression:'('+fn.toString()+')('+JSON.stringify({time,rate})+')',returnByValue:true});else await page.evaluate(fn,{time,rate});};
   const calls=()=>evaluate(()=>translationFixture.calls);
   const until=async(predicate,message)=>{const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await page.waitForTimeout(30);}throw Error(message+'; requests='+JSON.stringify(await calls())+'; UI='+await ui.locator('#translation-status').textContent());};
   const done=async count=>until(async()=>{const c=await calls();return c.length>=count&&c.every(x=>x.completed);},'Missing completed translation requests');
   const translated=async text=>{await ui.locator('#translation').filter({hasText:text}).waitFor();};
   const release=ordinal=>evaluate(n=>{const fn=translationFixture.pending[n];if(!fn)throw Error('Missing held request '+n);fn();},ordinal);
   await page.waitForTimeout(650);await ui.locator('#mode').selectOption('original');
   return{page,ui,calls,clock,done,translated,release,until,evaluate,start:()=>ui.locator('#mode').selectOption('both'),close:async()=>{assert.deepEqual(errors,[]);await page.close();}};
  }
  {
   const cues=rows();cues[2]={start:10,text:'这里令 x 等于 y',school:'Here we set x equal to y'};cues[3]={start:15,text:'我们调用 foo bar 处理输入',school:'We call foo bar to process the input'};cues[4]={start:20,text:'接下来解释 how the processor handles memory requests and schedules instructions'};
   const s=await open(cues);await s.start();await s.done(2);
   const initial=await s.calls(),targets=initial.flatMap(c=>c.targets.map(t=>t.text));
   assert.equal(initial.length,2,'ten applicable cues prefetch in two batches');assert.ok(initial.every(c=>c.targets.length<=6));assert.ok(targets.includes(cues[11].text),'a later cue is already translated while playback stays at zero');assert.ok(!targets.includes(cues[12].text),'initial prefetch has a twelve-cue cap');assert.ok(!targets.includes(cues[2].text)&&!targets.includes(cues[3].text));assert.ok(targets.includes(cues[4].text),'substantial English in a mixed sentence remains translatable');
   const completedBeforeSeek=Math.max(...initial.map(c=>c.completed));await s.clock(5);await s.translated(translatedText(cues[1].text));assert.ok(completedBeforeSeek<=Date.now());
   for(const index of [2,3]){await s.clock(cues[index].start);await s.until(async()=>await s.ui.locator('#original').textContent()===cues[index].text,'mixed Chinese original not shown');assert.equal(await s.ui.locator('#translation').textContent(),'','short terms do not show school English as duplicate translation');}
   await s.clock(20);await s.translated(translatedText(cues[4].text));assert.equal((await s.calls()).flatMap(c=>c.targets).filter(t=>t.text===cues[1].text).length,1,'prefetched translation is reused when reached');
   await s.page.screenshot({path:'.test-media/translation-prefetch-'+(native?'edge-extension':'chrome-userscript')+'.png'});evidence.push({case:'prefetch and mixed variables',initialBatches:initial.map(c=>c.targets.length),completedBeforePlayback:true});await s.close();
  }
  {
   const cues=rows(12,15),s=await open(cues);await s.start();await s.done(1);let targets=(await s.calls()).flatMap(c=>c.targets.map(t=>t.text));assert.ok(targets.includes(cues[4].text));assert.ok(!targets.includes(cues[5].text),'1x prefetch stops at sixty seconds');
   await s.clock(0,2);await s.done(2);targets=(await s.calls()).flatMap(c=>c.targets.map(t=>t.text));assert.ok(targets.includes(cues[8].text),'2x reaches 120 video seconds');assert.ok(!targets.includes(cues[9].text));await s.clock(0,4);await s.page.waitForTimeout(300);assert.equal((await s.calls()).length,2,'high speeds retain the 120-second ceiling');evidence.push({case:'speed window',normalSeconds:60,doubleSeconds:120,maximumSeconds:120});await s.close();
  }
  {
   const cues=rows(80),s=await open(cues,[{hold:true}]);await s.start();await s.until(async()=>(await s.calls()).length===1,'initial request never starts');await s.clock(200);await s.page.waitForTimeout(220);assert.equal((await s.calls()).length,1,'seeking does not overlap paid work');await s.release(0);await s.done(3);
   const calls=await s.calls();assert.equal(calls[1].targets[0].text,cues[40].text,'the next request prioritizes the new playback position');assert.ok(!calls.slice(1).flatMap(c=>c.targets).some(t=>t.text===cues[6].text),'stale queued subtitles are discarded');await s.translated(translatedText(cues[40].text));evidence.push({case:'seek priority',nextTarget:calls[1].targets[0].text});await s.close();
  }
  {
   const cues=rows(12),s=await open(cues,[{hold:true,prefix:'旧课译文：'},{prefix:'新课译文：'}]);await s.start();await s.until(async()=>(await s.calls()).length===1,'old course request never starts');await s.page.evaluate(()=>location.hash='#/replay?course_id=next-translation-fixture&sub_id=2');await s.until(async()=>await s.ui.locator('#mode').inputValue()==='original','course switch did not reset translation mode');assert.equal(await s.ui.locator('#translation').textContent(),'');
   await s.page.evaluate(html=>document.querySelector('#pane-voice').innerHTML=html,markup(cues));await s.page.waitForTimeout(700);await s.start();await s.page.waitForTimeout(250);assert.equal((await s.calls()).length,1,'new course waits for the submitted old request');await s.release(0);await s.done(3);await s.translated(translatedText(cues[0].text,'新课译文：'));assert.doesNotMatch(await s.ui.locator('#translation').textContent(),/旧课/);evidence.push({case:'late course reply',newCourseTranslation:true});await s.close();
  }
  {
   const cues=rows(12),s=await open(cues,[{invalid:'mixed'}]);await s.start();await s.done(2);await s.ui.locator('#translation-retry').waitFor({state:'visible'});assert.equal(await s.ui.locator('#mode').inputValue(),'both');await s.page.waitForTimeout(300);assert.equal((await s.calls()).length,2,'invalid entries do not retry on every playback tick');
   await s.clock(30);await s.translated(translatedText(cues[6].text));assert.equal(await s.ui.locator('#translation-retry').isVisible(),true,'later valid subtitles continue while invalid output remains retryable');await s.clock(0);await s.page.waitForTimeout(150);await s.ui.locator('#translation-retry').click();await s.done(3);await s.translated(translatedText(cues[0].text));const last=(await s.calls()).at(-1);assert.deepEqual(last.targets.map(t=>t.text),[cues[0].text,cues[1].text],'manual retry preserves successful translations');assert.equal(await s.ui.locator('#translation-retry').isVisible(),false);evidence.push({case:'invalid output recovery',retryOnlyFailed:2,laterCuesContinue:true});await s.close();
  }
  {
   const s=await open(rows(12),[{status:429,error:'unrecognized provider limit'}]);await s.start();await s.ui.locator('#translation-retry').waitFor({state:'visible'});assert.match(await s.ui.locator('#translation-status').textContent(),/暂时限制请求/);await s.page.waitForTimeout(300);assert.equal((await s.calls()).length,1,'unknown failures need explicit retry');assert.equal(await s.ui.locator('#mode').inputValue(),'both');await s.ui.locator('#translation-retry').click();await s.done(3);await s.translated('中文译文：');evidence.push({case:'unknown provider failure',automaticRetries:0,manualRecovery:true});await s.close();
  }
  fs.writeFileSync('.test-media/translation-prefetch-'+(native?'edge-extension':'chrome-userscript')+'-verification.json',JSON.stringify({mode:native?'real Edge MV3':'real Chrome userscript',mockServicesOnly:true,evidence},null,2)+'\n');
  console.log('PASS: '+(native?'real Edge MV3':'real Chrome userscript')+' batch prefetch before playback, short mixed variables, rate-adjusted window, seek priority, course isolation, partial invalid-output retry and provider failure recovery; mocked services only.');
 }finally{await context.close();await browser?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});


