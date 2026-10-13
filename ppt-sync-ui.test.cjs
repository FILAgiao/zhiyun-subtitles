const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://interactivemeta.cmc.zju.edu.cn/',r=>r.fulfill({body:'<html></html>',contentType:'text/html'}));await page.goto('https://interactivemeta.cmc.zju.edu.cn/');
 await page.route('https://slides.test/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#fff9e9"/><text x="60" y="100" font-size="40">PPT '+r.request().url().split('/').pop()+'</text></svg>'}));
 await page.setContent('<style>video{width:900px;height:600px}</style><video></video><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:20</div><div class="trans-lan"><div>second slide sentence</div></div></div></div><div id="pane-ppt">'+Array.from({length:100},(_,i)=>'<div class="tab-ppt"><img src="https://slides.test/'+i+'.svg"><span class="time">'+new Date(i*20000).toISOString().slice(11,19)+'</span></div>').join('')+'</div>');
 await page.evaluate(()=>{
  window.values={'cache-auto':false,'gateway-guide-no-remind-v2':true};window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;window.GM_deleteValue=k=>delete values[k];window.GM_registerMenuCommand=()=>{};
  window.GM_xmlhttpRequest=()=>({abort(){}});window.videoTime=34;window.seeks=0;
  const key=JSON.stringify([null,null,null]);values['subtitle-sync:'+key]={anchors:[{videoTime:0,offset:13.5},{videoTime:100,offset:13.5}],manual:true};values['subtitle-offset:'+key]=13.5;
  Object.defineProperties(document.querySelector('video'),{paused:{get:()=>true},readyState:{get:()=>3},duration:{get:()=>3600},currentTime:{get:()=>videoTime,set:v=>{seeks++;videoTime=v;}}});
 });
 await page.addScriptTag({content:fs.readFileSync('zhiyun-subtitles.user.js','utf8').replace(/const DEFAULT_ORIGIN=[^;]+;/,'const DEFAULT_ORIGIN="";')});await page.waitForTimeout(650);

 const ui=page.locator('#zy-subtitle-host');await ui.locator('#show-slides').click();await ui.locator('#slides').hover();await ui.locator('#ppt-sync-toggle').click();await page.waitForTimeout(250);await ui.locator('#slides').hover();await ui.locator('#slide-thumbs-toggle').click();
 assert.equal(await ui.locator('#ppt-offset').inputValue(),'0');assert.equal(await ui.locator('#slide-page').textContent(),'2 / 100');assert.match(await ui.locator('#original').textContent(),/second slide sentence/);
 assert.equal(await ui.locator('#study-sync #slide-ppt-sync').count(),0);assert.equal(await ui.locator('#slide-toolbar #slide-ppt-sync').count(),1);
 assert.equal(await ui.locator('#ppt-sync-toggle').evaluate(e=>e.previousElementSibling.id),'slide-follow');
 const follow=await ui.locator('#slide-follow').boundingBox(),field=await ui.locator('#ppt-offset').boundingBox();assert.ok(Math.abs(follow.y-field.y)<6,'calibration stays in follow toolbar row');
 await ui.locator('#ppt-offset').focus();await page.keyboard.press('ArrowUp');assert.equal(await ui.locator('#ppt-offset').inputValue(),'1');await page.keyboard.press('ArrowDown');assert.equal(await ui.locator('#ppt-offset').inputValue(),'0');
 await page.keyboard.press('Escape');assert.ok(await ui.locator('#slide-ppt-sync').isHidden());await ui.locator('#ppt-sync-toggle').click();
 const anchors=await page.evaluate(()=>JSON.stringify(values['subtitle-sync:'+JSON.stringify([null,null,null])]));
 // Changing subtitle calibration never moves PPT.
 await ui.locator('#offset').evaluate(e=>{e.value=30;e.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await ui.locator('#slide-page').textContent(),'2 / 100');assert.equal(await ui.locator('#ppt-offset').inputValue(),'0');
 await ui.locator('#offset').evaluate(e=>{e.value=13.5;e.dispatchEvent(new Event('input',{bubbles:true}));});assert.match(await ui.locator('#original').textContent(),/second slide sentence/);
 // Independent positive and negative PPT offsets leave subtitle matching intact.
 await ui.locator('#ppt-offset').fill('30');assert.equal(await ui.locator('#slide-page').textContent(),'1 / 100');assert.match(await ui.locator('#original').textContent(),/second slide sentence/);
 await ui.locator('#ppt-offset').fill('-30');assert.equal(await ui.locator('#slide-page').textContent(),'4 / 100');assert.match(await ui.locator('#original').textContent(),/second slide sentence/);assert.equal(await ui.locator('#offset').inputValue(),'13.5');
 for(const rate of [1,1.5,2]){
  await page.evaluate(rate=>{document.querySelector('video').playbackRate=rate;videoTime=34;},rate);await page.waitForTimeout(250);assert.equal(await ui.locator('#slide-page').textContent(),'4 / 100');
  await page.evaluate(()=>videoTime=54);await page.waitForTimeout(250);assert.equal(await ui.locator('#slide-page').textContent(),'5 / 100');
 }
 // Backward seek before the first timestamp must not leave a later page displayed.
 await ui.locator('#ppt-offset').fill('100');assert.equal(await ui.locator('#slide-page').textContent(),'1 / 100');
 // Teacher switches to page 4 at video time 30; calibrate this exact transition.
 await page.evaluate(()=>videoTime=30);await ui.locator('.slide-thumb').nth(3).click();assert.equal(await ui.locator('#slide-follow').getAttribute('aria-pressed'),'false');
 await ui.locator('#ppt-align-page').click();assert.equal(await ui.locator('#ppt-offset').inputValue(),'-30');assert.equal(await ui.locator('#slide-follow').getAttribute('aria-pressed'),'true');assert.equal(await ui.locator('#slide-page').textContent(),'4 / 100');assert.equal(await page.evaluate(()=>seeks),0);
 assert.equal(await page.evaluate(()=>values['ppt-offset:'+JSON.stringify([null,null,null])]),-30);assert.equal(await page.evaluate(()=>JSON.stringify(values['subtitle-sync:'+JSON.stringify([null,null,null])])),anchors);
 await ui.locator('#slide-thumbs-close').click();await ui.locator('#slides').hover();await ui.locator('#slide-close').click();assert.ok(await ui.locator('#slide-ppt-sync').isHidden());assert.equal(await ui.locator('#ppt-sync-toggle').getAttribute('aria-expanded'),'false');await page.evaluate(()=>videoTime=70);await ui.locator('#show-slides').click();await ui.locator('#slides').hover();await ui.locator('#ppt-sync-toggle').click();assert.equal(await ui.locator('#slide-page').textContent(),'6 / 100');await page.waitForTimeout(250);await ui.locator('#slides').hover();await ui.locator('#slide-thumbs-toggle').click();assert.equal(await ui.locator('#ppt-offset').inputValue(),'-30');
 await ui.locator('#ppt-reset').click();assert.equal(await ui.locator('#slide-page').textContent(),'4 / 100');assert.equal(await ui.locator('#offset').inputValue(),'13.5');
 await ui.locator('#ppt-earlier').click();assert.equal(await ui.locator('#ppt-offset').inputValue(),'-1');await ui.locator('#ppt-later').click();assert.equal(await ui.locator('#ppt-offset').inputValue(),'0');
 await page.screenshot({path:'ppt-independent-sync-preview.png'});
 await ui.locator('#slide-thumbs-close').click();await ui.locator('#slides').hover();await ui.locator('#slide-close').click();
 await page.evaluate(()=>{location.hash='#/replay?course_id=new';document.querySelector('#pane-ppt').innerHTML='<div class="tab-ppt"><img src="https://slides.test/new.svg"><span class="time">00:00:00</span></div><div class="tab-ppt"><img src="https://slides.test/missing.svg"></div>';});await page.waitForTimeout(650);
 if(await ui.locator('#panel').isHidden())await ui.locator('#compact').click();await ui.locator('#show-slides').click();await ui.locator('#slides').hover();await ui.locator('#ppt-sync-toggle').click();await page.waitForTimeout(250);await ui.locator('#slides').hover();await ui.locator('#slide-thumbs-toggle').click();assert.equal(await ui.locator('#ppt-offset').inputValue(),'0');await ui.locator('.slide-thumb').nth(1).click();assert.equal(await ui.locator('#ppt-align-page').isDisabled(),true);
 await ui.locator('#slide-thumbs-close').click();await ui.locator('#collapse').click();await page.setViewportSize({width:390,height:844});await ui.locator('#ppt-offset').focus();await page.keyboard.press('ArrowUp');assert.equal(await ui.locator('#ppt-offset').inputValue(),'1');
 assert.equal(await ui.locator('#slide-toolbar').evaluate(e=>getComputedStyle(e).flexWrap),'nowrap');await page.keyboard.press('Escape');assert.ok(await ui.locator('#slide-ppt-sync').isHidden());
 assert.deepEqual(errors,[]);console.log('PASS: 13.5-second speech calibration stays independent; PPT offset +/-30, 1x/1.5x/2x, backward seeks, exact-page calibration, persistence, course isolation, missing timestamps, no video seek.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
