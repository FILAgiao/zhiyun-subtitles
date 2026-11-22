const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
let browser,role='admin',mode='normal',analyticsRequests=0,lastRange,delayed;
const now=Date.now()/1000,app='zhiyun-subtitles',usage={month:'2026-11',requests:1248,input_tokens:6284000,output_tokens:1926000,total_tokens:8210000,audio_seconds:0,audio_limit:100,request_limit:100,images:0};
const fixture={timezone:'Asia/Shanghai',generated_at:now,summary:{...usage,uncertain:3,registered_users:320,active_users:186,learning_lessons:724,unique_courses:28,effective_seconds:1463400,watch_seconds:1250400,ai_uses:894,token_estimate:{complete:true,amount_cny:'10.22',known_amount_cny:'10.22',priced_calls:1248,unpriced_calls:0,checked_at:'2026-11-06',source_url:'https://docs.volcengine.com/docs/ark/model-pricing?lang=zh',note:'按官方参考费率估算，缓存明细缺失按未命中估算。'}},features:[{feature:'subtitle',users:174,uses:628},{feature:'translation',users:132,uses:462},{feature:'screenshot',users:96,uses:312},{feature:'ai',users:118,uses:894}],trend:Array.from({length:7},(_,i)=>({date:'2026-11-0'+(i+1),tokens:[620000,910000,750000,1330000,1080000,1690000,1830000][i],users:[42,65,56,94,81,124,136][i],lessons:[32,45,43,92,76,110,134][i],effective_seconds:(20+i*9)*3600})),courses:[{title:'概率论与数理统计',users:82,lessons:176,watch_seconds:348000},{title:'微积分（甲）Ⅰ',users:67,lessons:142,watch_seconds:284000},{title:'数据结构与算法',users:54,lessons:118,watch_seconds:238000},{title:'大学物理（甲）',users:43,lessons:96,watch_seconds:172800},{title:'Python 程序设计',users:38,lessons:84,watch_seconds:155000}],users:[{user_id:1,username:'林同学',last_seen:now-120,lessons:24,effective_seconds:43200,total_tokens:382400,ai_uses:46},{user_id:2,username:'陈同学',last_seen:now-300,lessons:32,effective_seconds:52600,total_tokens:462100,ai_uses:38},{user_id:3,username:'周同学',last_seen:now-1200,lessons:18,effective_seconds:31600,total_tokens:225800,ai_uses:29}],retention:{d1_rate:.674,within7_rate:.812,d7_rate:.536,d1_eligible_users:138,d7_eligible_users:112,first_observed:true,cohorts:[{date:'2026-10-26',users:28,d1_rate:.75,d7_rate:.5,within7_rate:.82,d1_mature:true,d7_mature:true},{date:'2026-11-05',users:18,d1_rate:null,d7_rate:null,within7_rate:null,d1_mature:false,d7_mature:false}]},coverage:{started_at:now-30*86400,observed_users:248,partial:false,note:'仅包含已登录且启用统计的新版扩展；不代表全站真实总量。'}};
fixture.summary.completed_call_users=125;
fixture.users.forEach((user,i)=>{user.completed_ai_calls=10+i;});
const root=path.join(__dirname,'backend'),server=http.createServer((req,res)=>{const name=req.url.split('?')[0],file=path.join(root,name==='/admin'?'admin.html':name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));});
fixture.trend.forEach((row,i)=>Object.assign(row,{
 date:new Date((now+(i-6)*86400+28800)*1000).toISOString().slice(0,10),
 input_tokens:row.tokens-70000,output_tokens:70000,requests:54+i,token_requests:49+i,
 account_total:i?308+i*2:null,account_change:i>1?2:null,
 ai_uses:42+11*i,ai_users:24+4*i,screenshot_uses:19+8*i,speech_uses:13+2*i,speech_seconds:84+i,subtitle_uses:28+i,translation_uses:22+3*i,
 completed_ai_calls:18+i,completed_ai_users:7+i,completed_translation_calls:30+i,
 api_cost_cny:i===2?null:(.46+i*.31).toFixed(2),unpriced_token_calls:i===2||i===4?3:0,
 login_sessions:40+i,login_users:35+i,registrations:i<5?null:i-5
}));
fixture.coverage.registrations_started_at=Date.parse(fixture.trend[5].date+'T12:00:00+08:00')/1000;
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});const page=await browser.newPage({viewport:{width:1440,height:1120}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/v1/**',async route=>{const url=new URL(route.request().url()),p=url.pathname,send=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});if(p==='/v1/auth/login')return send({token:role+'-token'});if(p==='/v1/auth/logout')return send({ok:true});if(p==='/v1/me')return send({username:role==='admin'?'管理员':'普通用户',is_admin:role==='admin',usage});if(p==='/v1/admin/overview')return send({month:usage.month,totals:usage,users:[],calls:[],sessions:[],actions:[]});if(p==='/v1/history')return send({calls:[],sessions:[]});if(p==='/v1/admin/analytics'){analyticsRequests++;lastRange={start:url.searchParams.get('start'),end:url.searchParams.get('end')};if(mode==='delay')return new Promise(resolve=>{delayed=async()=>{await send(fixture);resolve();};});if(mode==='malformed')return route.fulfill({status:200,contentType:'text/html',body:'invalid analytics response'});if(mode==='oldhtml')return route.fulfill({status:404,contentType:'text/html',body:'not found'});if(mode==='old')return send({error:'not found'},404);if(mode==='error')return send({error:'暂时不可用'},503);if(mode==='unknown'||mode==='history')return send({...fixture,summary:{...usage,registered_users:320,completed_call_users:7,uncertain:0,active_users:null,learning_lessons:null,unique_courses:null,effective_seconds:null},features:[],trend:fixture.trend.map(r=>({...r,users:null,lessons:null,effective_seconds:null,ai_uses:null,ai_users:null,screenshot_uses:null,subtitle_uses:null,translation_uses:null})),courses:[],users:[{...fixture.users[0],lessons:null,effective_seconds:null,ai_uses:null}],retention:{cohorts:[]},coverage:{started_at:mode==='history'?now+86400:null,observed_users:0,partial:true}});if(mode==='single')return send({...fixture,trend:fixture.trend.slice(-1)});if(mode==='empty')return send({...fixture,summary:{total_tokens:0,input_tokens:0,output_tokens:0,requests:0,uncertain:0,active_users:0,learning_lessons:0,unique_courses:0,effective_seconds:0},features:fixture.features.map(f=>({...f,users:0,uses:0})),trend:fixture.trend.map(r=>({...r,tokens:0,users:0,lessons:0,effective_seconds:0})),courses:[],users:[],retention:{cohorts:[],d1_eligible_users:0,d7_eligible_users:0}});return send(fixture);}return send({error:'unexpected '+p},404);});
const login=async()=>{await page.locator('#login-name').fill('fixture');await page.locator('#login-password').fill('fixture-password');await page.locator('#login-button').click();await page.locator('#dashboard').waitFor({state:'visible'});};
await page.goto('http://127.0.0.1:'+server.address().port+'/admin');await login();await page.locator('#analytics-content').waitFor({state:'visible'});assert.equal(await page.locator('#analytics-tab').getAttribute('aria-selected'),'true');assert.equal(await page.locator('#stats').isVisible(),false);assert.equal(await page.locator('#analytics-stats .analytics-stat').count(),4);assert.match(await page.locator('#analytics-stats').textContent(),/8,210,000/);assert.match(await page.locator('#analytics-cost-detail').textContent(),/10.22/);assert.equal(await page.locator('#analytics-cost-detail a').getAttribute('href'),fixture.summary.token_estimate.source_url);assert.match(await page.locator('#analytics-cost-detail').getAttribute('title'),/缓存明细缺失/);assert.deepEqual(await page.locator('#analytics-features tr').first().locator('td').allTextContents(),['字幕','174','628','93.5%']);assert.match(await page.locator('#analytics-retention').textContent(),/67.4%/);assert.equal((Date.parse(lastRange.end)-Date.parse(lastRange.start))/86400000,6);
const card=name=>page.locator('.analytics-chart-card[aria-labelledby="analytics-'+name+'-title"]');
const plot=name=>card(name).locator('.analytics-chart');
const metric=name=>card(name).locator('[data-chart-metric]');
const details=name=>card(name).locator('.analytics-chart-details > summary');
const plotGrid=page.locator('.analytics-chart-grid');
const positions=()=>plotGrid.locator(':scope > section').evaluateAll(cards=>cards.map(card=>{
 const rect=card.getBoundingClientRect();
 return {top:rect.top,left:rect.left,tableCount:card.querySelectorAll('table').length};
}));
assert.equal(await plotGrid.locator(':scope > section').count(),14);
assert.equal(await plotGrid.locator('svg').count(),11);
assert.deepEqual((await positions()).map(item=>item.tableCount),Array(14).fill(1));
assert.equal(new Set((await positions()).map(item=>item.left)).size,3);
assert.equal(new Set((await positions()).map(item=>item.top)).size,5);
assert.equal(await plotGrid.locator('table:visible').count(),0);
assert.equal(await page.locator('#analytics-cohorts').isVisible(),false);
await details('retention').click();
assert.equal(await page.locator('#analytics-cohorts').isVisible(),true);
assert.match(await page.locator('#analytics-cohorts').textContent(),/观察中/);
await details('retention').click();

await page.locator('#analytics-user-title').click();
await page.locator('#analytics-user-sort').selectOption('total_tokens');
assert.match(await page.locator('#analytics-users tr').first().textContent(),/陈同学/);
await page.locator('#analytics-user-search').fill('周');
assert.equal(await page.locator('#analytics-users tr').count(),1);
assert.match(await page.locator('#analytics-users').textContent(),/周同学/);
await page.locator('#analytics-user-search').fill('');
await page.locator('#analytics-user-sort').selectOption('last_seen');
await page.locator('#analytics-user-title').click();
assert.deepEqual(await page.locator('#analytics-stats strong').allTextContents(),['320','8,210,000','1,248','125']);

const barColor=name=>plot(name).locator('.chart-bar').first().evaluate(bar=>getComputedStyle(bar).fill);
assert.equal(await barColor('ai'),await barColor('token'));
assert.notEqual(await barColor('accounts'),await barColor('token'));
assert.notEqual(await barColor('fee'),await barColor('token'));
assert.equal(await plot('courses').locator('meter').count(),5);
assert.equal(await plot('features').locator('meter').count(),4);
assert.equal(await plot('retention').locator('meter').count(),3);
assert.equal(await plot('token').locator('.chart-bar').count(),7);
await plot('token').locator('.chart-bar[tabindex="0"]').focus();
await page.keyboard.press('ArrowLeft');
assert.match(await plot('token').locator('.analytics-chart-value').textContent(),new RegExp(fixture.trend[5].date));
assert.equal(await plot('token').locator('.chart-bar[tabindex="0"]').count(),1);
await metric('ai').selectOption('ai_uses');
assert.match(await plot('ai').locator('svg').getAttribute('aria-label'),/完整回答/);
await metric('ai').selectOption('completed_ai_calls');
assert.match(await plot('ai').locator('svg').getAttribute('aria-label'),/完成调用/);

const cells=(id,index)=>page.locator('#'+id+' tr').nth(index).locator('td').allTextContents();
const first=fixture.trend[0].date;
assert.deepEqual(await cells('analytics-account-rows',-1),[first,'35','40']);
assert.equal((await positions())[0].top,(await positions())[1].top);
assert.equal((await positions())[1].top,(await positions())[2].top);
assert.equal(await card('account-total').locator('select').count(),0);
assert.equal(await card('registrations').locator('select').count(),0);
assert.match(await page.locator('#analytics-account-total-rows tr').first().textContent(),/320较前日 \+2/);
assert.deepEqual(await cells('analytics-token-rows',-1),[first,'550,000','70,000','620,000']);
assert.deepEqual(await cells('analytics-request-rows',-1),[first,'54','49']);
assert.deepEqual(await cells('analytics-ai-rows',-1),[first,'18','7','42','24']);
assert.deepEqual(await cells('analytics-speech-rows',-1),[first,'13','1.4 分钟']);
assert.deepEqual(await cells('analytics-language-rows',-1),[first,'30','28','22']);
assert.deepEqual(await cells('analytics-fee-rows',4),[fixture.trend[2].date,'待核对','3']);
assert.match((await cells('analytics-fee-rows',2))[1],/部分计价/);
assert.equal(await plot('fee').locator('.chart-partial').count(),1);
assert.match(await plot('fee').locator('.chart-unknown').getAttribute('aria-label'),/金额待定 · 3 次待核对/);
assert.equal(await page.locator('#analytics-collection-status').isVisible(),false);
assert.equal(await plot('registrations').locator('.chart-bar').count(),2);
assert.match(await plot('registrations').locator('.chart-bar').first().getAttribute('aria-label'),/自助注册 0/);
await metric('accounts').selectOption('login_sessions');
assert.match(await plot('accounts').locator('svg').getAttribute('aria-label'),/登录会话/);
await metric('accounts').selectOption('login_users');

await page.evaluate(()=>window.scrollTo(0,0));
fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
await plotGrid.screenshot({path:path.join(__dirname,'dist/admin-chart-grid-desktop.png')});
await page.setViewportSize({width:960,height:900});
assert.equal(new Set((await positions()).map(item=>item.left)).size,2);
assert.equal((await positions())[1].top,(await positions())[2].top);
await page.setViewportSize({width:390,height:844});
assert.equal(new Set((await positions()).map(item=>item.left)).size,1);
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await details('accounts').click();
assert.ok(await card('accounts').locator('.table-wrap').evaluate(box=>getComputedStyle(box).overflowX==='auto'&&box.getBoundingClientRect().right<=innerWidth));
await details('accounts').click();
await plotGrid.screenshot({path:path.join(__dirname,'dist/admin-chart-grid-mobile.png')});
await page.setViewportSize({width:1440,height:1120});
mode='single';
await page.locator('[data-range="today"]').click();
await page.locator('#analytics-content').waitFor({state:'visible'});
assert.equal(lastRange.start,lastRange.end);
assert.equal(await plot('token').locator('.chart-bar').count(),1);
assert.match(await plot('token').locator('svg').textContent(),new RegExp(lastRange.end.slice(5)));
mode='normal';
await page.locator('[data-range="month"]').click();await page.locator('#analytics-content').waitFor({state:'visible'});assert.equal(lastRange.start.slice(-2),'01');await page.locator('[data-range="custom"]').click();await page.locator('#analytics-start').fill('2026-10-01');await page.locator('#analytics-end').fill('2026-10-10');await page.locator('#analytics-filter button').click();await page.locator('#analytics-content').waitFor({state:'visible'});assert.deepEqual(lastRange,{start:'2026-10-01',end:'2026-10-10'});await page.locator('#analytics-start').fill('2026-01-01');const before=analyticsRequests;await page.locator('#analytics-filter button').click();assert.match(await page.locator('#analytics-status').textContent(),/最多查看 93 天/);assert.equal(analyticsRequests,before);await page.locator('[data-range="7d"]').click();await page.locator('#analytics-content').waitFor({state:'visible'});
for(const variant of ['old','oldhtml','error','malformed']){mode=variant;await page.locator('#analytics-refresh').click();await page.waitForFunction(()=>document.querySelector('#analytics-status').dataset.state==='error');assert.equal(await page.locator('#analytics-content').isVisible(),false);assert.match(await page.locator('#analytics-status').textContent(),variant.startsWith('old')?/尚未上线/:/稍后刷新/);await page.locator('[data-tab="calls"]').click();assert.equal(await page.locator('#calls-panel').isVisible(),true);mode='normal';await page.locator('#analytics-tab').click();await page.locator('#analytics-content').waitFor({state:'visible'});}
mode='unknown';await page.locator('#analytics-refresh').click();await page.locator('#analytics-content').waitFor({state:'visible'});assert.deepEqual(await page.locator('#analytics-learning-summary dd').allTextContents(),['待上报','待上报','待上报']);assert.deepEqual(await page.locator('#analytics-stats strong').allTextContents(),['320','8,210,000','1,248','7']);assert.match(await page.locator('#analytics-coverage-title').textContent(),/尚未收到学习事件/);assert.match(await page.locator('#analytics-collection-status').textContent(),/尚未收到客户端学习事件/);assert.equal(await page.locator('#analytics-collection-status').isVisible(),true);assert.deepEqual(await cells('analytics-ai-rows',-1),[first,'18','7']);
assert.deepEqual(await cells('analytics-language-rows',-1),[first,'30']);
assert.equal(await page.locator('[aria-labelledby="analytics-ai-title"] caption').textContent(),'完整回答、回答账号 · 待上报');
assert.equal(await page.locator('[aria-labelledby="analytics-language-title"] caption').textContent(),'字幕展示、翻译展示 · 待上报');
assert.equal(await page.locator('#analytics-watch-rows .table-empty').textContent(),'待上报');
assert.match(await page.locator('#analytics-users').textContent(),/待上报/);
assert.equal(await plot('watch').locator('svg').count(),0);
assert.equal(await plot('watch').locator('.analytics-chart-empty').textContent(),'待上报');
assert.equal(await plot('ai').locator('.chart-bar').count(),7);
assert.equal(await plot('language').locator('.chart-bar').count(),7);
await metric('ai').selectOption('ai_uses');
assert.equal(await plot('ai').locator('.analytics-chart-empty').textContent(),'待上报');
await metric('ai').selectOption('completed_ai_calls');
mode='history';await page.locator('#analytics-refresh').click();await page.locator('#analytics-content').waitFor({state:'visible'});assert.deepEqual(await page.locator('#analytics-learning-summary dd').allTextContents(),['无历史数据','无历史数据','无历史数据']);
mode='empty';await page.locator('#analytics-refresh').click();await page.locator('#analytics-content').waitFor({state:'visible'});assert.equal(await page.locator('#analytics-learning-summary dd').first().textContent(),'0');assert.match(await page.locator('#analytics-features').textContent(),/无活跃样本/);assert.equal(await plot('watch').locator('svg').count(),1);assert.match(await page.locator('#analytics-users').textContent(),/暂无记录/);
mode='delay';await page.locator('#analytics-refresh').click();await page.waitForFunction(()=>document.querySelector('#analytics-refresh').disabled);while(!delayed)await new Promise(r=>setTimeout(r,10));await page.locator('#logout').click();await delayed();await page.waitForTimeout(50);assert.equal(await page.locator('#analytics-users').textContent(),'');assert.equal(await page.locator('#analytics-content').isVisible(),false);role='user';mode='normal';const adminBefore=analyticsRequests;await login();assert.equal(await page.locator('#analytics-tab').isVisible(),false);await page.evaluate(()=>tab('analytics'));assert.equal(analyticsRequests,adminBefore);assert.equal(await page.locator('#calls-panel').isVisible(),true);assert.equal(await page.locator('#analytics-stats').textContent(),'');assert.deepEqual(errors,[]);
console.log('PASS analytics UI: independent accounts and registration charts, responsive 2/1 columns, adjustable date charts, horizontal rankings, per-card details, missing vs zero and logout isolation.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
