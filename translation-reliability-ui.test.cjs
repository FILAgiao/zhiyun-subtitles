const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const context=await chromium.launchPersistentContext(path.resolve('.test-media/translation-reliability-'+Date.now()),{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--disable-extensions-except='+path.resolve('dist/extension'),'--load-extension='+path.resolve('dist/extension')]});
 try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:20000});
  await worker.evaluate(async()=>{
   await chrome.storage.local.set({'gateway-account-v1':{url:'https://47.77.182.216.sslip.io/gateway',token:'fixture-session'},'gateway-guide-no-remind-v2':true});
   globalThis.translationCalls=[];globalThis.behavior='busy-once';
   globalThis.fetch=async(url,options)=>{
    let body={};let status=200;
    if(url.endsWith('/me'))body={username:'fixture',usage:{month:'2026-10',requests:531,request_limit:10000,audio_seconds:240,audio_limit:360000},permissions:{learning:true,translation:true,speech:true}};
    if(url.endsWith('/ark/responses')){
     const requestBody=JSON.parse(options.body);
     let payload={};try{payload=JSON.parse(requestBody.input.find(row=>row.role==='user')?.content?.find(row=>row.type==='input_text')?.text||'{}');}catch(_){}
     translationCalls.push({url,body:requestBody,targets:payload.target_subtitles,client:options.headers['X-Client-Type']});
     if(behavior==='slow'){globalThis.behavior='ok';await new Promise(resolve=>{globalThis.releaseTranslation=resolve;});}
     else if(behavior==='busy-once'){globalThis.behavior='ok';status=429;body={error:'请等待当前请求完成'};}
     else if(behavior==='updating-once'){globalThis.behavior='ok';status=503;body={error:'服务正在更新',error_code:'server_updating'};}
     else if(behavior==='quota'){status=429;body={error:'本月额度已用完'};}
     else if(behavior==='unknown'){status=429;body={error:'unrecognized provider limit'};}
     else if(behavior==='failed'){status=502;body={error:'官方接口请求未完成，请检查用量后重试'};}
     if(status===200){
      const text=Array.isArray(payload.target_subtitles)?JSON.stringify({translations:payload.target_subtitles.map(row=>({id:row.id,text:'这是译文 '+row.id}))}):'这是译文';
      body={status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{total_tokens:10}};
     }
    }
    return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
   };
  });
  await context.route('https://interactivemeta.cmc.zju.edu.cn/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<style>video{width:720px;height:405px;background:#153545}</style><video></video><div id="pane-voice">'+[0,20,40,60].map((n,i)=>'<div class="trans-item"><div class="item-title">00:0'+Math.floor(n/60)+':'+String(n%60).padStart(2,'0')+'</div><div class="trans-lan"><div>English lecture sentence '+i+'</div></div></div>').join('')+'</div>'}));
  const page=await context.newPage();await page.setViewportSize({width:1280,height:800});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=fixture&sub_id=1');
  const ui=page.locator('#zy-subtitle-host');await ui.waitFor();await page.waitForTimeout(400);await ui.locator('#mode').selectOption('both');
  await ui.locator('#translation-status').filter({hasText:'空闲名额'}).waitFor();assert.equal(await ui.locator('#mode').inputValue(),'both');assert.equal(await ui.locator('#translation-retry').isVisible(),false);
  await ui.locator('#translation-status').filter({hasText:'翻译已恢复'}).waitFor({timeout:10000});await ui.locator('#translation').filter({hasText:'这是译文'}).waitFor();
  assert.equal(await worker.evaluate(()=>translationCalls.length),2,'one rejected request followed by one paid batch');
  assert.deepEqual(await worker.evaluate(()=>translationCalls.map(call=>call.targets.length)),[4,4],'the next 60 seconds are prefetched in one batch');
  assert.equal(await ui.locator('#mode').inputValue(),'both');
  await worker.evaluate(()=>{globalThis.behavior='updating-once';translationCalls.length=0;});await page.reload();await ui.waitFor();await page.waitForTimeout(350);await ui.locator('#mode').selectOption('both');
  await ui.locator('#translation-status').filter({hasText:'服务正在更新'}).waitFor();assert.equal(await ui.locator('#translation-retry').isVisible(),false);assert.equal(await ui.locator('#mode').inputValue(),'both');
  await ui.locator('#translation-status').filter({hasText:'翻译已恢复'}).waitFor({timeout:10000});await ui.locator('#translation').filter({hasText:'这是译文'}).waitFor();
  assert.equal(await worker.evaluate(()=>translationCalls.length),2,'maintenance rejection automatically resumes with one paid batch');
  for(const [behavior,pattern] of [['quota',/本月调用额度已用完/],['unknown',/暂时限制请求/],['failed',/HTTP 502/]]){
   await worker.evaluate(value=>{globalThis.behavior=value;translationCalls.length=0;},behavior);await page.reload();await ui.waitFor();await page.waitForTimeout(350);await ui.locator('#mode').selectOption('both');
   await ui.locator('#translation-retry').waitFor({state:'visible'});assert.match(await ui.locator('#translation-status').textContent(),pattern);assert.equal(await ui.locator('#mode').inputValue(),'both');await page.waitForTimeout(250);assert.equal(await worker.evaluate(()=>translationCalls.length),1,'no auto retry of quota or unconfirmed/provider error');
   if(behavior==='unknown')assert.doesNotMatch(await ui.locator('#translation-status').textContent(),/额度/);
   await worker.evaluate(()=>{globalThis.behavior='ok';});await ui.locator('#translation-retry').click();await ui.locator('#translation').filter({hasText:'这是译文'}).waitFor();assert.equal(await ui.locator('#translation-retry').isVisible(),false);
  }
  await worker.evaluate(()=>{globalThis.behavior='slow';translationCalls.length=0;});await page.reload();await ui.waitFor();await page.waitForTimeout(350);await ui.locator('#mode').selectOption('both');
  for(let n=0;n<30;n++){if(await worker.evaluate(()=>typeof releaseTranslation==='function'))break;await page.waitForTimeout(50);}
  assert.equal(await worker.evaluate(()=>typeof releaseTranslation),'function');await ui.locator('#mode').selectOption('original');await ui.locator('#mode').selectOption('both');await page.waitForTimeout(300);assert.equal(await worker.evaluate(()=>translationCalls.length),1,'stop/reopen does not overlap old server work');
  await worker.evaluate(()=>{releaseTranslation();});await ui.locator('#translation').filter({hasText:'这是译文'}).waitFor();assert.equal(await worker.evaluate(()=>translationCalls.length),1,'stop/reopen reuses all four results from the original paid batch');assert.equal(await ui.locator('#translation-retry').isVisible(),false);assert.equal(await ui.locator('#mode').inputValue(),'both');
  const requests=await worker.evaluate(()=>translationCalls);assert.ok(requests.every(r=>r.client==='chrome-extension'));assert.deepEqual(errors,[]);
  await page.screenshot({path:'dist/translation-reliability-0.20.50.png'});
  console.log('PASS: real Edge MV3 batch pretranslation, busy/maintenance recovery, quota/provider failure retains bilingual mode, manual retry and stop/reopen paid-batch reuse; mocked service only.');
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
