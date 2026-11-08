const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
// Controlled slow-network fixtures: no real account, provider, or server is contacted.
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PORTAL_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 const base='http://clips.test',token='fixture-clips-owner',requests=[],errors=[],pending=new Map();let releaseList;
 try{
  page.on('pageerror',error=>errors.push(error.message));
  const pixels=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=760;const c=canvas.getContext('2d');c.fillStyle='#fffdf7';c.fillRect(0,0,1200,760);c.fillStyle='#38665e';c.fillRect(0,0,1200,15);c.font='25px sans-serif';c.fillText('PHYSICS / 01',70,90);c.font='bold 48px sans-serif';c.fillText('动量守恒与系统边界',70,190);c.font='32px serif';c.fillText('p = m₁v₁ + m₂v₂ = constant',70,310);c.lineWidth=4;c.strokeStyle='#38665e';c.beginPath();c.moveTo(70,600);c.lineTo(1050,600);c.moveTo(70,600);c.lineTo(70,380);c.stroke();c.beginPath();c.moveTo(70,595);c.bezierCurveTo(250,550,600,430,1000,400);c.stroke();const thumb=document.createElement('canvas');thumb.width=320;thumb.height=203;thumb.getContext('2d').drawImage(canvas,0,0,320,203);return {image:canvas.toDataURL(),thumbnail:thumb.toDataURL()};});
  const png=Buffer.from(pixels.image.split(',')[1],'base64'),items=Array.from({length:14},(_,index)=>({id:'image-'+index,title:'课堂笔记 '+index,course:'大学物理',courseKey:'physics',created:1700000000000+index,updated:1700000000000+index,width:1200,height:760,thumbnail:pixels.thumbnail,note:'先确定研究系统，再判断外力是否可忽略。',origin:'https://school.example.test/lesson',position:'12:30'}));
  let held=new Set(['image-0']),broken=new Set(['image-1']);
  const listGate=new Promise(resolve=>releaseList=resolve);
  await context.addInitScript(token=>{sessionStorage.setItem('gateway-web-session',token);window.liveImageURLs=new Set();const make=URL.createObjectURL.bind(URL),drop=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=make(blob);liveImageURLs.add(url);return url;};URL.revokeObjectURL=url=>{liveImageURLs.delete(url);drop(url);};},token);
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url()),endpoint=u.pathname.slice('/gateway'.length),reply=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(u.origin!==base)return route.abort();
   if(endpoint==='/v1/me')return reply(200,{username:'加载测试同学',email:'fixture@example.test'});
   if(endpoint==='/v1/auth/logout')return reply(200,{ok:true});
   if(endpoint==='/v1/study/conversations')return reply(200,{items:[],next_offset:null});
   if(endpoint==='/v1/study/clips'){await listGate;return reply(200,{items,next_offset:null});}
   if(endpoint==='/v1/study/clip-image'){
    assert.equal(route.request().headers().authorization,'Bearer '+token);assert.equal(u.searchParams.get('format'),'png');
    const id=u.searchParams.get('id');requests.push(id);if(held.has(id))await new Promise(resolve=>pending.set(id,resolve));
    const bad=broken.delete(id);return route.fulfill({status:200,contentType:'image/png',body:bad?Buffer.from('corrupt png'):png});
   }
   const name=endpoint==='/study'?'study.html':endpoint.slice(1),allowed=['study.html','portal.js','portal.css','study.js','study.css','clips.js','clips.css'];
   if(allowed.includes(name))return route.fulfill({status:200,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(path.join(__dirname,'backend',name))});
   return route.fulfill({status:404,body:''});
  });
  await page.goto(base+'/gateway/study#clips');await page.locator('.clip-skeleton').first().waitFor();assert.equal(await page.locator('#clips-grid').getAttribute('aria-busy'),'true');releaseList();await page.locator('.clip-card').nth(13).waitFor();assert.equal(requests.length,0,'gallery never requests originals');
  const open=id=>page.locator('.clip-card[data-clip-id="'+id+'"]').click();
  const ready=()=>page.waitForFunction(()=>document.querySelector('#clip-stage').dataset.state==='ready');
  await open('image-0');await page.waitForFunction(()=>document.querySelector('#clip-stage').dataset.state==='loading');assert.ok((await page.locator('#clip-full-image').getAttribute('src')).startsWith('data:image/png;base64,'));assert.equal(await page.locator('#clip-zoom').isDisabled(),true);
  assert.notEqual(await page.locator('#clip-stage').evaluate(n=>getComputedStyle(n,'::after').animationName),'none','loading shimmer is active');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#clip-stage').evaluate(n=>getComputedStyle(n,'::after').animationName),'none','reduced motion disables shimmer');await page.emulateMedia({reducedMotion:'no-preference'});
  fs.mkdirSync('dist',{recursive:true});await page.waitForTimeout(300);await page.screenshot({path:'dist/study-clip-shimmer-preview.png'});
  await page.locator('#clip-close').click();await open('image-0');assert.equal(requests.length,1,'opening the same pending original shares its request');pending.get('image-0')();await ready();
  await page.locator('#clip-close').click();await open('image-0');await ready();assert.equal(requests.length,1,'reopening a decoded original uses memory cache');
  await page.locator('#clip-next').click();await page.waitForFunction(()=>document.querySelector('#clip-stage').dataset.state==='error');assert.ok((await page.locator('#clip-full-image').getAttribute('src')).startsWith('data:'));assert.equal(await page.locator('#clip-zoom').isDisabled(),true);await page.locator('#clip-image-status button').click();await ready();assert.equal(requests.filter(id=>id==='image-1').length,2,'bad decode removes the cached blob so retry downloads again');
  held=new Set(['image-2','image-3','image-4']);
  await page.locator('#clip-next').click();await page.waitForTimeout(40);await page.locator('#clip-next').click();await page.waitForTimeout(40);await page.locator('#clip-next').click();await page.waitForTimeout(80);
  assert.equal(pending.has('image-4'),false,'only two original requests can be active');pending.get('image-2')();await page.waitForTimeout(100);assert.ok(pending.has('image-4'));pending.get('image-3')();await page.waitForTimeout(100);assert.equal(await page.locator('#clip-reader-title').innerText(),'课堂笔记 4');assert.equal(await page.locator('#clip-stage').getAttribute('data-state'),'loading','late previous results cannot replace the current preview');pending.get('image-4')();await ready();
  held=new Set();for(let index=5;index<14;index++){await page.locator('#clip-next').click();await ready();}
  assert.ok(await page.evaluate(()=>liveImageURLs.size<=12),'decoded originals have a bounded memory cache');await page.locator('#clip-close').click();await open('image-0');await ready();assert.equal(requests.filter(id=>id==='image-0').length,2,'least recently used original was evicted');
  held=new Set(['image-1']);await page.locator('#clip-next').click();await page.waitForTimeout(80);assert.equal(await page.locator('#clip-stage').getAttribute('data-state'),'loading');await page.locator('#clip-close').click();await page.locator('[data-logout]').click();pending.get('image-1')();await page.waitForTimeout(100);
  assert.equal(await page.locator('.clip-card').count(),0);assert.equal(await page.locator('#clip-full-image').getAttribute('src'),null);assert.equal(await page.evaluate(()=>liveImageURLs.size),0,'logout revokes every private object URL');assert.deepEqual(errors,[]);
  console.log('PASS: slow-list skeleton, zero gallery original requests, immediate preview, shimmer/reduced motion, pending deduplication, bounded LRU, bad-image retry, two-request ceiling, rapid-selection race and logout privacy.');
 }finally{releaseList?.();for(const resolve of pending.values())resolve();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
