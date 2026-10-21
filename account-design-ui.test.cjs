const assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://public.example/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#eeebe6;font:20px sans-serif;padding:50px}</style><h1>学习资料</h1><p>每一次理解，都从一个问题开始。</p>'}));
  await page.goto('https://public.example/study');
  await page.evaluate(()=>{
   window.saved={'gateway-guide-no-remind-v2':true};window.calls=[];window.failLogin=true;
   window.fixtureProfile={username:'体验同学',membership:{plan:'trial',active:true,state:'trial',expires:Math.floor(Date.now()/1000)+6*86400+12*3600},permissions:{learning:true,translation:true,speech:true,learning_records:true,card_export:true},usage:{month:'2026-10',requests:16,request_limit:100,total_tokens:30,audio_seconds:120,audio_limit:600}};
   window.GM_getValue=(k,d)=>saved[k]??d;window.GM_setValue=(k,v)=>saved[k]=v;window.GM_deleteValue=k=>delete saved[k];window.GM_registerMenuCommand=()=>{};
   window.GM_xmlhttpRequest=o=>{calls.push({url:o.url});const timer=setTimeout(()=>{
    let result={},status=200;
    if(o.url.endsWith('/auth/login')){if(failLogin){result={error:'账号或密码不正确，请检查后重试'};status=401;}else result={...fixtureProfile,server_time:Math.floor(Date.now()/1000),token:'trial-session'};}
    else if(o.url.endsWith('/prompts'))result={prompts:[{id:'feynman',label:'费曼 · 大白话',prompt:'用大白话解释',scope:'official',revision:1}]};
    else if(o.url.endsWith('/me'))result={...fixtureProfile,server_time:Math.floor(Date.now()/1000)};
    else if(o.url.endsWith('/learning/jobs/create')){fixtureProfile.usage.requests++;result={id:'trial-job'};}
    else if(o.url.endsWith('/learning/jobs/poll'))result={state:'complete',text:'先把问题拆成几个小步骤，再逐步理解。',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'先把问题拆成几个小步骤，再逐步理解。'}]}]}};
    o.onload({status,responseText:JSON.stringify(result)});
   },8);return{abort(){clearTimeout(timer);o.onabort?.();}};};
  });
  await page.addScriptTag({path:'zhiyun-subtitles.user.js'});const ui=page.locator('#zy-subtitle-host');await ui.locator('#account-open').evaluate(n=>n.click());await ui.locator('#gateway-login-form').waitFor({state:'visible'});
  assert.equal(await ui.locator('#gateway-quota-section').isVisible(),false,'quota should not compete with guest login');
  assert.equal(await ui.locator('#gateway-membership').isVisible(),false);
  await ui.locator('#gateway-email').fill('trial@example.test');await ui.locator('#gateway-password').fill('fixture-password');await ui.locator('#gateway-password-toggle').click();assert.equal(await ui.locator('#gateway-password').getAttribute('type'),'text');await ui.locator('#gateway-password-toggle').click();assert.equal(await ui.locator('#gateway-password').getAttribute('type'),'password');
  await ui.locator('#gateway-login').click();await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-status').dataset.error==='true');assert.equal(await ui.locator('#gateway-login-form').isVisible(),true);
  await ui.locator('#gateway-password').fill('');await ui.locator('#gateway-email').fill('');
  for(const theme of ['warm','blue','glass']){
   await page.evaluate(theme=>ZYAppearance.select(theme),theme);
   const actual=await ui.locator('#gateway-login').evaluate(node=>({color:getComputedStyle(node).backgroundColor,image:getComputedStyle(node).backgroundImage,accent:getComputedStyle(node).getPropertyValue('--zy-accent').trim()}));assert.ok(actual.color!=='rgba(0, 0, 0, 0)'||actual.image!=='none',JSON.stringify({theme,...actual}));
   for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:900});
    assert.equal(await ui.locator('#settings-content').evaluate(n=>n.scrollWidth>n.clientWidth),false,theme+' '+width);
    const input=await ui.locator('#gateway-email').boundingBox(),password=await ui.locator('#gateway-password').boundingBox(),button=await ui.locator('#gateway-login').boundingBox();assert.ok(Math.abs(input.width-password.width)<1&&Math.abs(input.width-button.width)<1);
    if(theme==='warm'){await ui.locator('#gateway-status').evaluate(n=>{n.textContent='';n.dataset.error='false';});await ui.locator('#settings-card').screenshot({path:width===1280?'account-login-modern-preview.png':width===390?'account-login-narrow-preview.png':'.test-media/account-login-320.png'});}
   }
  }
  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>ZYAppearance.select('warm'));await ui.locator('#gateway-email').fill('trial@example.test');await ui.locator('#gateway-password').fill('fixture-password');await page.evaluate(()=>failLogin=false);await ui.locator('#gateway-login').click();
  await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-membership-value').textContent.includes('免费体验'));
  assert.equal(await ui.locator('#gateway-login-form').isVisible(),false);assert.equal(await ui.locator('#gateway-quota-section').isVisible(),true);
  assert.match(await ui.locator('#gateway-membership-value').textContent(),/剩 6 天/);assert.match(await ui.locator('#gateway-membership-deadline').textContent(),/北京时间/);assert.equal(await ui.locator('.quota-ring[aria-label="AI 问答与翻译：剩余 84 次"]').count(),1);
  await ui.locator('#settings-card').screenshot({path:'account-trial-modern-preview.png'});await ui.locator('#settings-close').click();await ui.locator('#web-ask').click();
  assert.match(await ui.locator('#ai-account-status').textContent(),/免费体验.*剩 6 天.*84 次/);
  await ui.locator('#ai-question').fill('这段课程内容应该怎样理解？');await ui.locator('#ai-send').click();
  await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('ai-account-status').textContent.includes('83 次'));
  await ui.locator('#ai-learning').screenshot({path:'account-trial-ai-preview.png'});
  await ui.locator('#ai-account-status').click();await ui.locator('#settings-dialog').waitFor({state:'visible'});
  // An unlimited-duration grant must never get a fabricated countdown.
  await page.evaluate(()=>fixtureProfile.membership.expires=null);await ui.locator('#gateway-usage').click();await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-membership-deadline').textContent==='未设置到期时间');assert.equal(await ui.locator('#gateway-membership-value').textContent(),'免费体验');
  await page.evaluate(()=>fixtureProfile.usage.requests=100);await ui.locator('#gateway-usage').click();await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-membership-value').textContent==='体验额度已用完');
  await page.evaluate(()=>{fixtureProfile.membership.state='trial';fixtureProfile.membership.active=true;fixtureProfile.membership.expires=Math.floor(Date.now()/1000)-1;for(const key of Object.keys(fixtureProfile.permissions))fixtureProfile.permissions[key]=false;});await ui.locator('#gateway-usage').click();
  await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('gateway-membership-value').textContent==='体验已结束');assert.equal(await ui.locator('#ai-learning').isVisible(),false);assert.match(await ui.locator('#gateway-state').textContent(),/免费体验已结束/);
  await ui.locator('#gateway-logout').click();await ui.locator('#gateway-login-form').waitFor({state:'visible'});assert.equal(await ui.locator('#gateway-membership').isVisible(),false);assert.equal(await ui.locator('#gateway-password').inputValue(),'');
  assert.deepEqual(errors,[]);console.log('PASS: themed responsive login, password toggle/error retry, independent trial display, expiry versus usage, live post-answer quota update, no-deadline grant, exhausted/expired/logout states.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
