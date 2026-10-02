const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||undefined});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://classroom.test/',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto('https://classroom.test/');
  await page.route('https://slides.test/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="white"/></svg>'}));
  const row=(seconds,text)=>`<div class="trans-item"><div class="item-title">00:00:${String(seconds).padStart(2,'0')}</div><div class="trans-lan"><div>${text}</div></div></div>`;
  await page.setContent('<div id="player" style="width:900px;height:600px"><video style="width:100%;height:100%"></video></div><div id="pane-voice">'+row(10,'old course sentence')+'</div><div id="pane-ppt"><div class="tab-ppt"><img src="https://slides.test/old.svg"><span class="time">00:00:00</span></div></div>');
  await page.evaluate(()=>{
   window.values={'cache-auto':false};window.GM_getValue=(key,fallback)=>values[key]??fallback;window.GM_setValue=(key,value)=>values[key]=value;window.GM_deleteValue=key=>delete values[key];window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>{throw Error('This test must not call cloud services');};
   const video=document.querySelector('video');Object.defineProperties(video,{paused:{get:()=>true},readyState:{get:()=>3},duration:{get:()=>100},currentTime:{get:()=>12,set(){}}});location.hash='#/replay?course_id=one';
  });
  await page.addScriptTag({content:fs.readFileSync('zhiyun-subtitles.user.js','utf8')});await page.waitForTimeout(750);
  const ui=page.locator('#zy-subtitle-host'),transcript=ui.locator('#transcript-list');
  await ui.locator('#transcript-open').click();assert.match(await transcript.textContent(),/old course sentence/);
  // URL changes first: unchanged old content must never seed the new course cache.
  await page.evaluate(()=>location.hash='#/replay?course_id=two');await page.waitForTimeout(650);
  assert.doesNotMatch(await transcript.textContent(),/old course sentence/);
  if(await ui.locator('#panel').isHidden())await ui.locator('#compact').click();await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slides').isHidden(),true);assert.match(await ui.locator('#slides-status').textContent(),/等待新课程 PPT/);
  // Translation-only updates are not evidence that the source subtitles belong to the new lesson.
  await page.evaluate(()=>document.querySelector('.trans-lan').insertAdjacentHTML('beforeend','<div>旧课译文更新</div>'));await page.waitForTimeout(650);assert.doesNotMatch(await transcript.textContent(),/old course sentence/);
  // A second navigation during the loading gap must retain the original stale-content gate.
  await page.evaluate(()=>location.hash='#/replay?course_id=three');await page.waitForTimeout(650);assert.doesNotMatch(await transcript.textContent(),/old course sentence/);
  await page.evaluate(html=>{document.querySelector('#pane-voice').innerHTML=html;document.querySelector('#pane-ppt img').src='https://slides.test/new.svg';},row(20,'new course sentence'));await page.waitForTimeout(750);
  assert.match(await transcript.textContent(),/new course sentence/);assert.doesNotMatch(await transcript.textContent(),/old course sentence/);
  if(await ui.locator('#panel').isHidden())await ui.locator('#compact').click();await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slides').isHidden(),false);assert.match(await ui.locator('#slide-image').getAttribute('src'),/new\.svg/);await ui.locator('#slides').hover();await ui.locator('#slide-close').click();
  // Searching/incremental loading within a course still preserves earlier collected rows.
  await page.evaluate(html=>document.querySelector('#pane-voice').innerHTML=html,row(30,'another current course sentence'));await page.waitForTimeout(650);
  assert.match(await transcript.textContent(),/new course sentence/);assert.match(await transcript.textContent(),/another current course sentence/);
  // DOM changes first in the same SPA transaction: accept it immediately after the hash changes.
  await page.evaluate(html=>{document.querySelector('#pane-voice').innerHTML=html;document.querySelector('#pane-ppt img').src='https://slides.test/four.svg';location.hash='#/replay?course_id=four';},row(40,'already new DOM sentence'));await page.waitForTimeout(750);
  assert.match(await transcript.textContent(),/already new DOM sentence/);assert.doesNotMatch(await transcript.textContent(),/new course sentence|another current/);
  if(await ui.locator('#panel').isHidden())await ui.locator('#compact').click();await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slides').isHidden(),false);assert.match(await ui.locator('#slide-image').getAttribute('src'),/four\.svg/);await ui.locator('#slides').hover();await ui.locator('#slide-close').click();
  // A newly mounted pane is valid even when its text matches the previous lesson exactly.
  await page.evaluate(()=>location.hash='#/replay?course_id=five');await page.waitForTimeout(650);assert.doesNotMatch(await transcript.textContent(),/already new DOM sentence/);
  await page.evaluate(()=>{const old=document.querySelector('#pane-voice');old.replaceWith(old.cloneNode(true));});await page.waitForTimeout(750);assert.match(await transcript.textContent(),/already new DOM sentence/);
  // SPA frameworks can retain the pane wrapper while mounting new identical subtitle rows.
  await page.evaluate(()=>{const pane=document.querySelector('#pane-voice');pane.innerHTML=pane.innerHTML;location.hash='#/replay?course_id=six';});await page.waitForTimeout(750);assert.match(await transcript.textContent(),/already new DOM sentence/);
  assert.deepEqual(errors,[]);console.log('Course isolation passed: delayed panes, translation-only mutations, rapid navigation, new DOM before route, same-course merge, remounted panes, PPT transition gate.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
