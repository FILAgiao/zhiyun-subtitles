const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const shells=new Map();
 try{
  for(const surface of ['course','web'])for(const plan of ['guest','free','expired','trial','pro','ultra']){
   const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route('https://**/*',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#f6f4ef}#player{width:700px;height:400px;background:#567}video{width:100%;height:100%}</style><div id="player"><video></video></div><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:10</div><div class="trans-lan"><div>We discuss computer architecture.</div></div></div></div>'}));
   await page.goto(surface==='course'?'https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=accounts&sub_id=1':'https://public.example/study');
   await page.exposeFunction('captureFixture',async()=> 'data:image/png;base64,'+(await page.screenshot()).toString('base64'));
   await page.evaluate(plan=>{
    window.accountPlan=plan;window.calls=[];window.nativeCalls=0;
    const active=['trial','pro','ultra'].includes(plan),permissions=Object.fromEntries(['learning','translation','speech','learning_records','card_export'].map(key=>[key,active]));
    window.fixtureProfile={username:'student',email:'student@example.test',membership:{plan:plan==='expired'?'pro':plan,state:plan==='expired'?'expired':active?'paid':'free',active},permissions,usage:{month:'2026-10',requests:0,request_limit:active?(plan==='pro'?10:30):0,total_tokens:0,audio_seconds:0,audio_limit:active?120:0}};
    window.saved={'gateway-guide-no-remind-v2':true,'ai-question-index-v1':[{id:'previous-record',title:'之前保存的学习记录'}]};
    if(plan!=='guest')saved['gateway-account-v1']={url:'https://47.77.182.216.sslip.io/gateway',token:'session-'+plan};
    window.GM_getValue=(key,fallback)=>saved[key]??fallback;window.GM_setValue=(key,value)=>saved[key]=value;window.GM_deleteValue=key=>delete saved[key];window.GM_registerMenuCommand=()=>{};
    window.GM_xmlhttpRequest=options=>{calls.push({url:options.url,data:options.data});const timer=setTimeout(()=>{
     const path=new URL(options.url).pathname;let result={};
     if(path.endsWith('/me'))result=fixtureProfile;
     else if(path.endsWith('/auth/login'))result={...fixtureProfile,token:'session-'+accountPlan};
     else if(path.endsWith('/learning/jobs/create'))result={id:'mock-job'};
     else if(path.endsWith('/learning/jobs/poll'))result={state:'complete',text:'理解流水线的关键是分阶段执行。',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'理解流水线的关键是分阶段执行。'}]}]}};
     options.onload({status:200,responseText:JSON.stringify(result)});
    },5);return{abort(){clearTimeout(timer);options.onabort?.();}};};
    const video=document.querySelector('video');Object.defineProperties(video,{currentTime:{get:()=>12,set(){}},duration:{get:()=>3600},paused:{get:()=>true},readyState:{get:()=>1}});
   },plan);
   await page.addScriptTag({path:'zhiyun-subtitles.user.js'});
   const ui=page.locator('#zy-subtitle-host');await ui.locator('#gateway-account').waitFor({state:'attached'});
   if(plan!=='guest')await page.waitForFunction(()=>!document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-state').textContent.includes('正在读取'));
   await page.evaluate(()=>window.ZYNativeCapture={capture:()=>{nativeCalls++;return captureFixture();}});
   if(!['trial','pro','ultra'].includes(plan)){
    await page.evaluate(()=>{const clipboard=new DataTransfer();clipboard.setData('text/plain','ordinary pasted text');document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true}));});
    assert.equal(await ui.locator('#settings-dialog').isVisible(),false,'ordinary text paste must not open login');
    // A real middle click must open the same account shell as the settings entry, before capture.
    await page.mouse.click(120,100,{button:'middle'});
    await ui.locator('#settings-dialog').waitFor({state:'visible'});
    assert.equal(await ui.locator('#settings-title').textContent(),'我的学习账号');
    assert.equal(await ui.locator('#settings-tab-connection').getAttribute('aria-selected'),'true');
    assert.equal(await ui.locator('#ai-learning').isVisible(),false);
    assert.equal(await ui.locator('#ai-crop').count(),0);
    assert.equal(await page.evaluate(()=>nativeCalls),0);
    assert.equal(await ui.locator('#gateway-login-form').isVisible(),plan==='guest');
    const viaCapture=await ui.locator('#settings-card').boundingBox();
    await ui.locator('#settings-close').click();
    await ui.locator(surface==='course'?'#settings-open':'#web-settings-open').evaluate(node=>node.click());
    await ui.locator('#settings-tab-connection').click();
    const viaSettings=await ui.locator('#settings-card').boundingBox();assert.deepEqual(viaCapture,viaSettings);
    if(surface==='web')assert.equal(await ui.locator('#panel').isVisible(),false);
    if(!shells.has(plan))shells.set(plan,viaSettings);else assert.deepEqual(viaSettings,shells.get(plan),'web and course share the same account window geometry');
    for(const width of [1280,360]){
     await page.setViewportSize({width,height:800});
     const geometry=await ui.locator('#settings-card').boundingBox();assert.ok(geometry.x>=0&&geometry.x+geometry.width<=width+.1);
     assert.equal(await ui.locator('#settings-content').evaluate(node=>node.scrollWidth>node.clientWidth),false);
    }
    await page.setViewportSize({width:1280,height:800});await ui.locator('#settings-close').click();
    for(const id of [surface==='course'?'ai-open':'web-ask','transcript-open',...(surface==='course'?['sync-toggle']:[])]){
     await ui.locator('#'+id).evaluate(node=>node.click());await ui.locator('#settings-dialog').waitFor({state:'visible'});await ui.locator('#settings-close').click();
    }
    if(surface==='course'){
     await ui.locator('#study-sync > summary').click();const offset=Number(await ui.locator('#offset').inputValue());await ui.locator('#later').click();assert.equal(Number(await ui.locator('#offset').inputValue()),offset+.5);assert.equal(await ui.locator('#settings-dialog').isVisible(),false);
     for(const id of ['show-slides','focus-fullscreen','cache-download','offset'])assert.notEqual(await ui.locator('#'+id).getAttribute('data-feature-blocked'),'true');
     await ui.locator('#mode').selectOption('both');await ui.locator('#settings-dialog').waitFor({state:'visible'});assert.equal(await ui.locator('#mode').inputValue(),'original');
     await ui.locator('#settings-close').click();
    }
    assert.equal(await page.evaluate(()=>calls.filter(call=>/\/(ark\/responses|learning\/jobs\/create|speech\/(submit|query))$/.test(call.url)).length),0);
    assert.equal(await page.evaluate(()=>nativeCalls),0);
    assert.equal(await page.evaluate(()=>saved['ai-question-index-v1'].length),1,'denied access does not delete existing learning records');
    assert.equal(await ui.locator('#ai-questions').isVisible(),false);
    if(plan==='guest'&&surface==='web'){await ui.locator('#account-open').evaluate(node=>node.click());await ui.locator('#settings-card').screenshot({path:'.test-media/account-login-unified.png'});}
   }else{
    for(const id of [surface==='course'?'ai-open':'web-ask','transcript-open',...(surface==='course'?['sync-toggle']:[])])assert.equal(await ui.locator('#'+id).getAttribute('data-feature-blocked'),'false');
    await page.mouse.click(120,100,{button:'middle'});await ui.locator('#ai-crop').waitFor();assert.equal(await page.evaluate(()=>nativeCalls),1);
    if(surface==='course'&&plan==='pro'){await page.mouse.move(140,120);await page.mouse.down();await page.mouse.move(350,260,{steps:6});await page.mouse.up();await ui.locator('#ai-crop-tools').waitFor({state:'visible'});await ui.locator('#ai-crop-circle').click();await page.mouse.move(170,150);await page.mouse.down();await page.mouse.move(290,215,{steps:6});await page.mouse.up();await page.screenshot({path:'.test-media/screenshot-annotation-existing.png'});}
    await ui.locator('#ai-crop-cancel').click();
    await ui.locator(surface==='course'?'#ai-open':'#web-ask').click();
    await ui.locator('#ai-question').fill('解释流水线');await ui.locator('#ai-send').click();
    await page.waitForFunction(()=>!document.getElementById('zy-subtitle-host').shadowRoot.getElementById('ai-save-card').disabled);
    assert.equal(await page.evaluate(()=>calls.filter(call=>call.url.endsWith('/learning/jobs/create')).length),1);
    await ui.locator('#ai-save-card').click();await ui.locator('#ai-card-dialog').waitFor();await ui.locator('#ai-card-cancel').click();
    await ui.locator('#ai-questions-back').click();await ui.locator('#ai-questions').waitFor();
    assert.ok(await page.evaluate(()=>saved['ai-question-index-v1'].length)>=2);
    // Changing a paid account to free closes paid workspaces and preserves saved records.
    await ui.locator('#account-open').evaluate(node=>node.click());
    await page.evaluate(()=>{fixtureProfile.membership={plan:'free',state:'free',active:false};for(const key of Object.keys(fixtureProfile.permissions))fixtureProfile.permissions[key]=false;});
    await ui.locator('#gateway-usage').click();await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-state').textContent.includes('未充值'));
    assert.equal(await ui.locator('#ai-learning').isVisible(),false);assert.equal(await ui.locator('#ai-questions').isVisible(),false);
   }
   assert.deepEqual(errors,[],surface+' '+plan);console.log('PASS: '+surface+' '+plan);await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
