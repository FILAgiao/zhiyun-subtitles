const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');

// Public studentsrs live DOM: untimed socket rows and an initially empty PPT card.
const fixture='<style>body{margin:0;background:#2e2f34;color:white;font:18px sans-serif}.client-content-left{width:1140px}.player-wrapper{position:relative;width:1100px;height:700px}.ratio{position:absolute;inset:30px 0 0;width:1100px;height:620px}.ratio video{width:100%;height:100%;background:#233c50}.client-content-right{position:absolute;left:1160px;top:180px;width:350px}.trans-item{padding:8px}.trans-item.active{outline:1px solid #789}.note-scroll_body{display:none}.student-list-box{position:absolute;left:220px;top:20px}.video-item{width:200px;height:112px;background:#000;color:#428cff;display:grid;place-items:center}.ppt-section-wrapper{position:absolute;left:220px;top:20px}.ppt-item-wrapper img{width:200px}</style><div class="student-list-box"><div class="student-list" id="student-list"><div class="video-item" id="video-ppt-parent"><img><div class="user-name">PPT</div><p class="tag"><span>PPT</span></p></div></div></div><div class="client-content-left"><div class="player-wrapper"><div id="stream-list-wrapper"><div class="template-item"><div class="ratio"><video id="ppt-stream-video" class="ppt-stream-video" muted playsinline></video></div></div></div></div></div><div class="client-content-right"><div class="chart-room-wrapper"><div class="course-interactive-wrapper"><div class="interactive-wrapper-content"><div class="trans-contain"></div></div></div></div></div><div class="note-scroll_body"></div>';

function setupMediaAndClock(){
 const root=document.documentElement,video=document.querySelector('#ppt-stream-video');if(!video)return;
 root.dataset.testClockOffset||='0';video.dataset.testTime||='37';video.dataset.testPaused||='false';video.dataset.testSeekable||='[]';
 const nativeNow=performance.now.bind(performance),nativeDateNow=Date.now.bind(Date);
 Object.defineProperty(performance,'now',{configurable:true,value:()=>nativeNow()+Number(root.dataset.testClockOffset)});Date.now=()=>nativeDateNow()+Number(root.dataset.testClockOffset);
 Object.defineProperties(video,{
  duration:{configurable:true,get:()=>Infinity},readyState:{configurable:true,get:()=>3},
  paused:{configurable:true,get:()=>video.dataset.testPaused==='true'},
  currentTime:{configurable:true,get:()=>Number(video.dataset.testTime),set:value=>{video.dataset.testTime=String(value);video.dataset.testSeekCount=String(Number(video.dataset.testSeekCount||0)+1);}},
  seekable:{configurable:true,get:()=>{const ranges=JSON.parse(video.dataset.testSeekable);return{length:ranges.length,start:i=>ranges[i][0],end:i=>ranges[i][1]};}}
 });
 video.play=async()=>{video.dataset.testPaused='false';};video.pause=()=>{video.dataset.testPaused='true';};
}

(async()=>{
 const extension=process.argv.includes('--extension'),extensionDir=path.resolve(process.env.ZY_TEST_EXTENSION_DIR||'dist/extension');
 const browser=extension?null:await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=extension?await chromium.launchPersistentContext(path.resolve('.test-media/studentsrs-extension-'+Date.now()),{headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1600,height:1000},args:['--disable-extensions-except='+extensionDir,'--load-extension='+extensionDir]}):await browser.newContext({viewport:{width:1600,height:1000}});
 try{
  if(extension){const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(async()=>{await chrome.storage.local.set({'cache-auto':false,'gateway-guide-no-remind-v2':true});globalThis.fetch=async()=>{throw Error('studentsrs regression must not access cloud or paid APIs');};});}
  await context.route('**/*',route=>{
   const request=route.request();
   if(request.isNavigationRequest())return route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});
   if(request.url().startsWith('https://ppt.cmc.zju.edu.cn/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#fff9e7"/><text x="100" y="140" font-size="48">Independent course PPT</text></svg>'});
   return route.abort();
  });
  await context.addInitScript(fn=>document.addEventListener('DOMContentLoaded',()=>{(0,eval)('('+fn+')()');}),setupMediaAndClock.toString());
  const page=await context.newPage(),errors=[],worlds=new Map();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  let session;if(extension){session=await context.newCDPSession(page);session.on('Runtime.executionContextCreated',event=>worlds.set(event.context.id,event.context));session.on('Runtime.executionContextDestroyed',event=>worlds.delete(event.executionContextId));session.on('Runtime.executionContextsCleared',()=>worlds.clear());await session.send('Runtime.enable');}
  await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/studentsrs?course_id=89414&sub_id=2023951&tenant_code=112');
  if(!extension){await page.evaluate(()=>{window.values={'cache-auto':false,'gateway-guide-no-remind-v2':true};window.GM_getValue=(key,fallback)=>values[key]??fallback;window.GM_setValue=(key,value)=>values[key]=value;window.GM_deleteValue=key=>delete values[key];window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>{throw Error('studentsrs regression must not call cloud or paid APIs');};});await page.addScriptTag({content:fs.readFileSync('zhiyun-subtitles.user.js','utf8').replace(/const DEFAULT_ORIGIN=[^;]+;/,'const DEFAULT_ORIGIN="";')});}
  const ui=page.locator('#zy-subtitle-host');await ui.locator('#classroom-caption-source').waitFor();
  if(extension){let isolated;for(const [id,info]of worlds){if(info.auxData?.isDefault)continue;try{const result=await session.send('Runtime.evaluate',{contextId:id,expression:'typeof ZYClassroomMedia',returnByValue:true});if(result.result.value==='object'){isolated=id;break;}}catch{}}assert.ok(isolated,'the production content script must run in an isolated world');const result=await session.send('Runtime.evaluate',{contextId:isolated,expression:'('+setupMediaAndClock.toString()+')()',returnByValue:true});assert.equal(result.exceptionDetails,undefined);}
  const caption=ui.locator('#original'),translation=ui.locator('#translation'),video=page.locator('#ppt-stream-video');
  const textIs=async(id,text)=>page.waitForFunction(({id,text})=>document.getElementById('zy-subtitle-host')?.shadowRoot.getElementById(id)?.textContent===text,{id,text});
  const appendRow=async(text,english='')=>page.evaluate(({text,english})=>{const list=document.querySelector('.trans-contain');list.querySelector('.active')?.classList.remove('active');const row=document.createElement('div');row.className='trans-item active';const lines=document.createElement('div');lines.className='trans-lan';for(const value of[text,english]){const line=document.createElement('div');line.textContent=value;lines.append(line);}row.append(lines);list.append(row);},{text,english});
  const advanceClock=async(ms)=>page.evaluate(ms=>{const root=document.documentElement;root.dataset.testClockOffset=String(Number(root.dataset.testClockOffset)+ms);},ms);
  const setPaused=async(paused)=>video.evaluate((node,paused)=>node.dataset.testPaused=String(paused),paused);
  const checkEmpty=async()=>{await textIs('original','');assert.equal(await translation.textContent(),'');};

  // Empty sources and a blue "PPT" card do not imply available resources.
  await checkEmpty();assert.match(await ui.locator('#classroom-caption-source').textContent(),/字幕/);assert.match(await ui.locator('#classroom-ppt-source').textContent(),/PPT/);
  assert.equal(await ui.locator('#zy-playback').isVisible(),false,'online live lessons use native controls');assert.equal(await video.evaluate(node=>node.controls),true);
  await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slides').isVisible(),false);assert.match(await ui.locator('#slides-status').textContent(),/尚未读取到独立 PPT 图片/);assert.match(await ui.locator('#slides-status').textContent(),/屏幕共享/);
  await page.waitForTimeout(650);await checkEmpty();

  // The active socket row changes in place and carries no timestamp.
  await appendRow('现在讲授直播课程第一句','The first live sentence');await textIs('original','现在讲授直播课程第一句');assert.match(await ui.locator('#classroom-caption-source').getAttribute('title'),/实时|直播/);
  await ui.locator('#direction').evaluate(node=>{node.value='zh-en';node.dispatchEvent(new Event('change'));});await ui.locator('#mode').evaluate(node=>{node.value='both';});await textIs('translation','The first live sentence');
  await page.evaluate(()=>{const lines=document.querySelector('.trans-item.active .trans-lan').children;lines[0].textContent='流式修订后的完整句子';lines[1].textContent='The revised complete sentence';});await textIs('original','流式修订后的完整句子');await textIs('translation','The revised complete sentence');
  await video.evaluate(node=>node.dataset.testTime='9800');await page.waitForTimeout(250);assert.equal(await caption.textContent(),'流式修订后的完整句子','join-relative media time cannot select untimed live text');

  // Automatic source polling does not reset expiry; a new row with identical words does.
  await advanceClock(16000);await checkEmpty();await page.waitForTimeout(650);await page.waitForTimeout(650);await checkEmpty();
  await appendRow('流式修订后的完整句子','The revised complete sentence');await textIs('original','流式修订后的完整句子');
  await setPaused(true);await page.waitForTimeout(150);await appendRow('暂停期间到达的新句子','A sentence received while paused');await page.waitForTimeout(700);assert.equal(await caption.textContent(),'流式修订后的完整句子','paused playback retains its displayed live caption');
  await setPaused(false);await textIs('original','暂停期间到达的新句子');await textIs('translation','A sentence received while paused');
  await advanceClock(16000);await checkEmpty();await setPaused(true);await setPaused(false);await page.waitForTimeout(250);await checkEmpty();

  // A real DVR window cannot turn current socket text into historical subtitles.
  await appendRow('直播边缘上的当前句子','The sentence at the live edge');await textIs('original','直播边缘上的当前句子');
  await video.evaluate(node=>{node.dataset.testSeekable='[[0,1000]]';node.dataset.testTime='970';});await checkEmpty();
  await video.evaluate(node=>node.dataset.testTime='999');await textIs('original','直播边缘上的当前句子');
  await video.evaluate(node=>node.dataset.testTime='900');await appendRow('回看期间仍在到达的直播字幕','A live arrival during DVR playback');await page.waitForTimeout(700);await checkEmpty();
  await video.evaluate(node=>node.dataset.testTime='999');await textIs('original','回看期间仍在到达的直播字幕');

  // Independent images arriving later can open without seeking the shared screen.
  const seekCount=await video.getAttribute('data-test-seek-count');
  await page.evaluate(()=>{const player=document.createElement('div');player.className='ppt-section-wrapper';player.innerHTML='<div class="ppt-item-wrapper activeStatus"><img alt="ppt" src="https://ppt.cmc.zju.edu.cn/current.jpg"></div>';document.body.append(player);document.querySelector('.note-scroll_body').innerHTML='<div class="note-ppt_item"><div class="ppt_wrap"><div class="ppt_order">1</div><img src="https://ppt.cmc.zju.edu.cn/current.jpg"><div class="ppt_mask" style="display:none"></div></div></div>';});
  await page.waitForTimeout(650);await ui.locator('#show-slides').click();await ui.locator('#slide-image').evaluate(node=>node.decode());assert.equal(await ui.locator('#slides').isVisible(),true);assert.equal(await ui.locator('#slide-page').textContent(),'1 / 1');assert.match(await ui.locator('#slide-image').getAttribute('src'),/current\.jpg$/);assert.equal(await video.getAttribute('data-test-seek-count'),seekCount);assert.match(await ui.locator('#classroom-ppt-source').textContent(),/1/);
  await ui.locator('#show-slides').click();await ui.locator('#show-slides').click();

  // The SPA route changes first. Polling cannot admit the previous lesson's DOM.
  await page.evaluate(()=>location.hash='#/studentsrs?course_id=89414&sub_id=2023952&tenant_code=112');await checkEmpty();await page.waitForTimeout(650);await page.waitForTimeout(650);await checkEmpty();await ui.locator('#show-slides').click();assert.equal(await ui.locator('#slides').isVisible(),false);assert.match(await ui.locator('#slides-status').textContent(),/等待新课程 PPT/);
  await page.evaluate(()=>{document.querySelector('.trans-contain').replaceChildren();document.querySelector('.ppt-section-wrapper').remove();document.querySelector('.note-scroll_body').replaceChildren();});await appendRow('另一节课真实到达的字幕','A fresh subtitle from the next lesson');await textIs('original','另一节课真实到达的字幕');assert.doesNotMatch(await ui.locator('#classroom-caption-source').textContent(),/上一课/);
  await page.screenshot({path:'.test-media/studentsrs-'+(extension?'extension':'userscript')+'.png'});assert.deepEqual(errors,[]);
  console.log('PASS: '+(extension?'Edge MV3 isolated world':'Chrome userscript')+' studentsrs empty/live/revised/repeated/paused/expired captions, media-clock isolation, DVR suppression, native controls, source retry, PPT placeholder/dynamic image and SPA isolation; no cloud APIs.');
 }finally{await context.close();await browser?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

