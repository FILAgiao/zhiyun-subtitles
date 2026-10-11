const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://interactivemeta.cmc.zju.edu.cn/',r=>r.fulfill({body:'<html></html>',contentType:'text/html'}));await page.goto('https://interactivemeta.cmc.zju.edu.cn/');
 await page.route('https://slides.test/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#fff9e9"/><text x="60" y="100" font-size="40">PPT '+r.request().url().split('/').pop()+'</text></svg>'}));
 await page.setContent('<style>video{width:900px;height:600px}</style><video></video><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:20</div><div class="trans-lan"><div>second slide sentence</div></div></div></div><div id="pane-ppt">'+Array.from({length:100},(_,i)=>'<div class="tab-ppt"><img src="https://slides.test/'+i+'.svg"><span class="time">'+new Date(i*20000).toISOString().slice(11,19)+'</span></div>').join('')+'</div>');
 await page.evaluate(()=>{
  window.values={'cache-auto':false,'gateway-guide-no-remind-v2':true};window.GM_getValue=(k,d)=>values[k]??d;window.GM_setValue=(k,v)=>values[k]=v;window.GM_deleteValue=k=>delete values[k];window.GM_registerMenuCommand=()=>{};
  window.GM_xmlhttpRequest=()=>({abort(){}});window.videoTime=22;window.seeks=0;
  const key=JSON.stringify([null,null,null]);values['subtitle-sync:'+key]={anchors:[{videoTime:0,offset:5},{videoTime:100,offset:5}],manual:true};values['subtitle-offset:'+key]=5;values['ppt-offset:'+key]=5;
  Object.defineProperties(document.querySelector('video'),{paused:{get:()=>true},readyState:{get:()=>3},duration:{get:()=>3600},currentTime:{get:()=>videoTime,set:v=>{seeks++;videoTime=v;}}});
 });
 await page.addScriptTag({content:fs.readFileSync('zhiyun-subtitles.user.js','utf8').replace(/const DEFAULT_ORIGIN=[^;]+;/,'const DEFAULT_ORIGIN="";')});await page.waitForTimeout(650);
 const ui=page.locator('#zy-subtitle-host');await ui.locator('#show-slides').click();
 assert.equal(await ui.locator('#slide-page').textContent(),'1 / 100');assert.equal(await ui.locator('#slide-thumbs').isHidden(),true);assert.equal(await ui.locator('.slide-thumb').count(),0);
 await page.evaluate(()=>videoTime=26);await page.waitForTimeout(350);assert.equal(await ui.locator('#slide-page').textContent(),'2 / 100');assert.match(await ui.locator('#original').textContent(),/second slide sentence/);
 await ui.locator('#slide-thumbs-toggle').click();assert.equal(await ui.locator('.slide-thumb').count(),100);assert.equal(await ui.locator('.slide-thumb[aria-current=page]').getAttribute('data-index'),'1');assert.match(await ui.locator('.slide-thumb').nth(1).textContent(),/00:00:20/);
 const outer=await ui.locator('#slides').boundingBox(),drawer=await ui.locator('#slide-thumbs').boundingBox();assert.ok(drawer.x>=outer.x&&drawer.x+drawer.width<=outer.x+outer.width);assert.ok(Math.abs(drawer.y+drawer.height-outer.y-outer.height+60)<3);assert.ok(drawer.y>outer.y);
 await ui.locator('.slide-thumb').nth(79).click();assert.equal(await ui.locator('#slide-page').textContent(),'80 / 100');assert.ok(await ui.locator('#slide-thumbs-list').evaluate(e=>e.scrollLeft>0));assert.equal(await page.evaluate(()=>videoTime),26);assert.equal(await page.evaluate(()=>seeks),0);assert.equal(await ui.locator('#slide-follow').getAttribute('aria-pressed'),'false');
 await page.evaluate(()=>videoTime=42);await page.waitForTimeout(350);assert.equal(await ui.locator('#slide-page').textContent(),'80 / 100');
 await ui.locator('#slides').hover();await ui.locator('#slide-follow').click();assert.equal(await ui.locator('#slide-page').textContent(),'2 / 100');assert.equal(await ui.locator('.slide-thumb[aria-current=page]').getAttribute('data-index'),'1');
 await ui.locator('.slide-thumb').nth(1).focus();await page.keyboard.press('Escape');assert.equal(await ui.locator('#slide-thumbs').isHidden(),true);assert.equal(await ui.locator('#slide-thumbs-toggle').getAttribute('aria-expanded'),'false');
 await ui.locator('#slide-thumbs-toggle').click();await page.screenshot({path:'ppt-thumbnails-preview.png'});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);const small=await ui.locator('#slides').boundingBox(),inside=await ui.locator('#slide-thumbs').boundingBox();assert.ok(inside.width<=small.width+1);assert.ok(Math.abs(inside.y+inside.height-small.y-small.height+60)<3);await ui.locator('#slide-thumbs-close').click();
 await page.setViewportSize({width:1440,height:900});await ui.locator('#slides').hover();await ui.locator('#slide-close').click();assert.equal(await ui.locator('#slide-thumbs').isHidden(),true);
 // Closing from manual browsing resets both live and persisted follow state.
 await ui.locator('#show-slides').click();await ui.locator('#slide-thumbs-toggle').click();await ui.locator('.slide-thumb').nth(79).click();await ui.locator('#slide-thumbs-close').click();
 await ui.locator('#slides').hover();await ui.locator('#slide-close').click();
 assert.equal(await ui.locator('#slide-follow').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>values['ppt-state:'+JSON.stringify([null,null,null])].follow),true);
 await page.evaluate(()=>videoTime=46);await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slide-page').textContent(),'3 / 100');
 // The main layout button also returns to video-only with follow restored.
 await ui.locator('#slide-thumbs-toggle').click();await ui.locator('.slide-thumb').nth(79).click();await ui.locator('#slide-thumbs-close').click();
 await ui.locator('#show-slides').click();await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slides').isHidden(),true);assert.equal(await ui.locator('#slide-follow').getAttribute('aria-pressed'),'true');
 await page.evaluate(()=>videoTime=66);await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slide-page').textContent(),'4 / 100');assert.equal(await page.evaluate(()=>seeks),0);
 await ui.locator('#slides').hover();await ui.locator('#slide-close').click();
 await page.evaluate(()=>{location.hash='#/replay?course_id=new';document.querySelector('#pane-ppt').innerHTML='<div class="tab-ppt"><img src="https://slides.test/new.svg"><span class="time">00:00:00</span></div>';});await page.waitForTimeout(650);
 if(await ui.locator('#panel').isHidden())await ui.locator('#compact').click();await ui.locator('#show-slides').click();await ui.locator('#slide-thumbs-toggle').click();assert.equal(await ui.locator('.slide-thumb').count(),1);assert.match(await ui.locator('.slide-thumb img').getAttribute('src'),/new.svg/);
 assert.deepEqual(errors,[]);console.log('PASS: independent subtitle/PPT offsets, 100-page drawer, manual choice without seek, follow restoration, current-page highlight, Escape, narrow viewport, course isolation.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
