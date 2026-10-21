const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=__dirname,base=path.join(root,'backend');
const serve=http.createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  const name=route==='/gateway/study'?'study.html':route==='/gateway/account'?'account.html':route.replace(/^\/gateway\//,'');
  if(!/^(?:study\.(?:html|js|css)|account\.(?:html|js|css)|portal\.(?:js|css)|landing\/brand-logo\.png)$/.test(name)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':'text/html;charset=utf-8'});res.end(fs.readFileSync(path.join(base,name)));
});
const hostile='<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const now=Date.UTC(2026,9,21,8),record=(id,title,course,text)=>({id,title,course,updated:now,created:now,questionCount:1,history:[{role:'user',text},{role:'assistant',text:text===hostile?'一段回答\n'+hostile:'学习率控制每次更新参数的步长。可以从一个较小的值开始，观察损失是否平稳下降，再按验证结果调整。'}]});
const owners={a:[record('a1','自己的问题 A','程序设计',hostile),record('a2','梯度复习','机器学习','学习率怎样设置？')],b:[record('b1','自己的问题 B','数学','如何理解导数？')]};
(async()=>{
  let browser;await new Promise(resolve=>serve.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+serve.address().port;
  let onTimeoutRouteStart=null;
  let apiCalls=[],loginMode='ok',meMode='ok',slowDetail=false,privateExpired=false,access={registration:{enabled:false},recharge:{enabled:false}};
  const errors=[];
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.ZY_TEST_CHROME||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    const ctx=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});
    await ctx.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin){if(url.hostname==='qr.example.org')return url.pathname==='/good.png'?route.fulfill({status:200,contentType:'image/png',body:fs.readFileSync(path.join(base,'landing/brand-logo.png'))}):route.fulfill({status:404,body:'bad image'});throw Error('Unexpected external request '+url.origin);}
      if(!url.pathname.startsWith('/gateway/v1/'))return route.continue();
      const endpoint=url.pathname.slice('/gateway/v1/'.length),auth=req.headers().authorization||'',owner=auth==='Bearer fixture-a'?'a':auth==='Bearer fixture-b'?'b':null;
      const body=req.postData()?req.postDataJSON():null;apiCalls.push({endpoint,auth,method:req.method(),body,url:url.search});
      const reply=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(endpoint==='account/access')return reply(200,access);
      if(endpoint==='auth/login'){
        if(loginMode==='timeout'){onTimeoutRouteStart?.();return new Promise(()=>{});}
        if(loginMode==='wrong')return reply(401,{error:'邮箱或密码错误'});
        return reply(200,{token:body.email==='user-b'?'fixture-b':'fixture-a'});
      }
      if(!owner||privateExpired)return reply(401,{error:'登录失效'});
      if(endpoint==='me'&&meMode==='html401')return route.fulfill({status:401,contentType:'text/html',body:'<h1>Unauthorized</h1>'});
      if(endpoint==='me'&&meMode==='network')return route.abort('failed');
      if(endpoint==='me')return reply(200,{username:'个人账号 '+owner,membership:{plan:'trial',expires:Math.floor(now/1000)+86400*7},usage:{requests:4,request_limit:100,audio_seconds:20,audio_limit:600}});
      if(endpoint==='auth/logout')return reply(200,{ok:true});
      if(endpoint==='study/conversations'){
        assert.equal(url.searchParams.has('user_id'),false);assert.equal(url.searchParams.has('user'),false);
        const id=url.searchParams.get('id');if(!id)return reply(200,{items:owners[owner].map(({history,...item})=>item),next_offset:null});
        if(req.method()==='DELETE'){owners[owner]=owners[owner].filter(item=>item.id!==id);return reply(200,{ok:true});}
        const data=owners[owner].find(item=>item.id===id);if(slowDetail)await new Promise(resolve=>setTimeout(resolve,500));
        try{return data?await reply(200,{conversation:data}):await reply(404,{error:'不存在'});}catch(error){if(!slowDetail)throw error;return;}
      }
      throw Error('Unexpected API '+endpoint);
    });
    const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));
    const fits=async label=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label);
    const login=async(user='user-a')=>{await page.locator('[data-login]:visible').first().click();await page.locator('#login-name').fill(user);await page.locator('#login-password').fill('fixture-password-not-real');await page.locator('#login-submit').click();};
    await page.goto(origin+'/gateway/study');await page.locator('#study-guest').waitFor({state:'visible'});await fits('desktop guest overflow');
    assert.equal(apiCalls.filter(c=>c.endpoint==='study/conversations').length,0,'guests must not fetch private records');
    await page.screenshot({path:path.join(root,'same-origin-study-guest-preview.png')});
    // Wrong credentials are separate from connection failures; duplicate submit never sends twice.
    loginMode='wrong';await login();await page.locator('#login-status').filter({hasText:'账号或密码不正确'}).waitFor();
    assert.equal(await page.locator('#login-dialog').isVisible(),true);assert.equal(await page.evaluate(()=>sessionStorage.getItem('gateway-web-session')),null);
    await page.locator('[data-close-login]').click();
    // Browser clock makes the real AbortController timeout deterministic, without a 15-second sleep.
    await page.clock.install();loginMode='timeout';const timeoutRouteStarted=new Promise(resolve=>{onTimeoutRouteStart=resolve;});await login();await timeoutRouteStarted;onTimeoutRouteStart=null;const callsBefore=apiCalls.filter(c=>c.endpoint==='auth/login').length;
    await page.locator('#portal-login-form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await page.clock.fastForward(15001);await page.locator('#login-status').filter({hasText:'连接超时（15 秒）'}).waitFor();
    assert.equal(apiCalls.filter(c=>c.endpoint==='auth/login').length,callsBefore);assert.equal(await page.locator('#login-submit').isEnabled(),true);
    await page.clock.resume();loginMode='ok';await page.locator('#login-submit').click();await page.locator('.conversation-item').first().waitFor();assert.equal(await page.locator('.conversation-item').count(),2);
    await page.locator('.conversation-item button').filter({hasText:'自己的问题 A'}).click();await page.locator('#reader-title').filter({hasText:'自己的问题 A'}).waitFor();
    assert.equal(await page.locator('#reader-messages script,#reader-messages img').count(),0);assert.equal(await page.evaluate(()=>window.__xss||0),0);assert.match(await page.locator('#reader-messages').textContent(),/<img/);
    await page.locator('.conversation-item button').filter({hasText:'梯度复习'}).click();await page.locator('#reader-title').filter({hasText:'梯度复习'}).waitFor();await page.screenshot({path:path.join(root,'same-origin-study-desktop-preview.png')});
    await page.locator('#study-course').selectOption('机器学习');assert.equal(await page.locator('.conversation-item').count(),1);
    await page.locator('#study-search').fill('不存在');await page.locator('#empty-title').filter({hasText:'没有找到'}).waitFor();
    await page.locator('#study-search').fill('');await page.locator('#study-course').selectOption('');
    for(const width of [390,320]){await page.setViewportSize({width,height:844});await fits(width+' study overflow');if(await page.locator('#reader-back').isVisible())await page.locator('#reader-back').click();await page.locator('.conversation-item button').filter({hasText:'梯度复习'}).click();await page.locator('#reader-content').waitFor({state:'visible'});await fits(width+' reader overflow');if(width===390){await page.evaluate(()=>scrollTo(0,0));}if(width===390)await page.screenshot({path:path.join(root,'same-origin-study-mobile-preview.png')});await page.locator('#reader-back').click();}
    // A late response from account A cannot reappear after logout and account B login.
    slowDetail=true;await page.locator('.conversation-item button').first().click();await page.locator('[data-logout]').click();await page.locator('#study-guest').waitFor({state:'visible'});await login('user-b');await page.locator('.conversation-item button').filter({hasText:'自己的问题 B'}).waitFor();await page.waitForTimeout(650);
    assert.doesNotMatch(await page.locator('#study-workspace').textContent(),/自己的问题 A|梯度复习/);slowDetail=false;
    await page.locator('.conversation-item button').click();await page.locator('#reader-content').waitFor({state:'visible'});await page.locator('#conversation-delete').click();await page.locator('#delete-cancel').click();assert.equal(owners.b.length,1);
    await page.locator('#conversation-delete').click();await page.locator('#delete-confirm').click();await page.locator('#empty-title').filter({hasText:'还没有保存'}).waitFor();assert.equal(owners.b.length,0);
    // Expired private sessions immediately remove the last user's content and local token.
    privateExpired=true;await page.locator('#study-refresh').click();await page.locator('#study-guest').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>sessionStorage.getItem('gateway-web-session')),null);assert.match(await page.locator('#study-notice').textContent(),/登录已过期/);privateExpired=false;
    // Initial restore keeps a useful error; HTML 401 still clears the invalid session.
    meMode='html401';await page.evaluate(()=>sessionStorage.setItem('gateway-web-session','fixture-a'));await page.goto(origin+'/gateway/study');await page.locator('#study-notice').filter({hasText:'登录已过期'}).waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('gateway-web-session')),null);
    meMode='network';await page.evaluate(()=>sessionStorage.setItem('gateway-web-session','fixture-a'));await page.goto(origin+'/gateway/study');await page.locator('#study-notice').filter({hasText:'无法连接'}).waitFor();assert.equal(await page.locator('#study-guest').isVisible(),true);
    meMode='ok';await page.evaluate(()=>sessionStorage.removeItem('gateway-web-session'));
    // Manual registration and recharge are closed by default, on unsafe URLs, broken images or API failure.
    for(const tab of ['register','recharge']){
      await page.goto(origin+'/gateway/account?tab='+tab);await page.locator('#channel-notice').filter({hasText:'正在核对'}).waitFor({state:'hidden'}).catch(()=>{});await page.locator('#channel-closed h3').filter({hasText:'暂未开放'}).waitFor();assert.equal(await page.locator('#channel-open').isVisible(),false);
      for(const width of [390,320]){await page.setViewportSize({width,height:844});await fits(tab+width+' account overflow');}
    }
    access={registration:{enabled:true,qr_url:'https://127.0.0.1/private.png',instructions:'不得显示'},recharge:{enabled:true,qr_url:'https://qr.example.org/broken.png',instructions:'不得显示'}};
    await page.goto(origin+'/gateway/account?tab=register');await page.waitForTimeout(80);assert.equal(await page.locator('#channel-qr').getAttribute('src'),null);assert.equal(await page.locator('#channel-open').isVisible(),false);
    await page.goto(origin+'/gateway/account?tab=recharge');await page.locator('#channel-notice').filter({hasText:'无法加载'}).waitFor();assert.equal(await page.locator('#channel-open').isVisible(),false);assert.doesNotMatch(await page.locator('#main').innerText(),/不得显示/);
    await page.screenshot({path:path.join(root,'same-origin-account-mobile-preview.png')});
    access={registration:{enabled:true,qr_url:'https://qr.example.org/good.png',instructions:'测试办理说明',contact:'测试联系人'}};await page.goto(origin+'/gateway/account?tab=register');await page.locator('#channel-open').waitFor({state:'visible'});assert.match(await page.locator('#channel-instructions').textContent(),/测试办理说明/);assert.equal(await page.locator('#channel-closed').isVisible(),false);
    access={registration:{enabled:false},recharge:{enabled:false}};await page.goto(origin+'/gateway/account?tab=register');await page.locator('#channel-notice').filter({hasText:'正在核对'}).waitFor({state:'hidden'}).catch(()=>{});
    await page.setViewportSize({width:1440,height:1050});await page.screenshot({path:path.join(root,'same-origin-account-desktop-preview.png')});
    assert.deepEqual(errors,[]);console.log('Same-origin portal passed: public closed channels, 320/390 layouts, credential/timeout distinction, duplicate submit, user isolation, safe text, search/read/delete and expired session cleanup.');
  }finally{await browser?.close();await new Promise(resolve=>serve.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
