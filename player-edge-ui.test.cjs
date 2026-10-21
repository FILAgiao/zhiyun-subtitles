const assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH});try{
 const page=await browser.newPage();await page.setContent('<div class="video-player" id="a"><video></video><div class="vjs-control-bar">A</div></div><div class="video-player" id="b"><video id="player"></video><div class="vjs-control-bar">B</div></div><div id="host"></div>');await page.addScriptTag({path:'classroom-media.js'});await page.addScriptTag({path:'player-interactions.js'});
 await page.evaluate(()=>{
  const host=document.getElementById('host'),shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<button id="focus-fullscreen"></button><button id="fullscreen-recover"></button><p id="slides-status"></p><div id="fullscreen-notice" hidden></div><div id="settings-dialog" hidden></div><div id="transcript" hidden></div><button id="transcript-open"></button><button id="transcript-close"></button><button id="transcript-follow"></button><div id="transcript-list"></div><div id="cache-transport"></div><div id="cache-status"></div><div id="edit" contenteditable="plaintext-only">edit</div><div id="role" role="textbox" tabindex="0">edit</div>';
  window.a=document.querySelector('#a video');window.b=document.querySelector('#b video');window.local={video:a};window.seekCount=0;window.fsCount=0;
  b.parentElement.requestFullscreen=async()=>{fsCount++;};
  window.controls=ZYPlayerInteractions.mount({shadow,host,getVideo:()=>b,getLocal:()=>local,getCues:()=>[],getCourse:()=>'',getClock:t=>t,getSeekTime:t=>t,translate:()=>'',seek:()=>seekCount++,onCollapse:()=>{}});controls.update();
 });
 assert.equal(await page.locator('#a video').evaluate(v=>v.controls),false);assert.equal(await page.locator('#b video').evaluate(v=>v.controls),false);
 assert.equal(await page.locator('#a').getAttribute('data-zy-local-player'),'true');assert.equal(await page.locator('#b').getAttribute('data-zy-local-player'),null);
 await page.evaluate(()=>b.requestFullscreen());assert.equal(await page.evaluate(()=>fsCount),1);
 for(const id of ['edit','role']){await page.locator('#host').locator('#'+id).focus();await page.keyboard.press('ArrowLeft');}assert.equal(await page.evaluate(()=>seekCount),0);
 await page.evaluate(()=>{local=null;a.controls=false;controls.update();});assert.equal(await page.locator('#b video').evaluate(v=>v.controls),false);assert.equal(await page.locator('#a').getAttribute('data-zy-local-player'),null);
 await page.evaluate(()=>{b.setAttribute('data-zy-moved-video','true');b.setAttribute('data-zy-original-controls','false');b.controls=false;controls.update();});
 assert.equal(await page.locator('#b').getAttribute('data-zy-local-player'),null);assert.notEqual(await page.locator('#b .vjs-control-bar').evaluate(e=>getComputedStyle(e).display),'none');assert.ok(await page.locator('#host').locator('#zy-playback').isHidden());
 await page.evaluate(()=>{b.removeAttribute('data-zy-moved-video');b.removeAttribute('data-zy-original-controls');b.controls=false;controls.update();});
 assert.equal(await page.locator('#b').getAttribute('data-zy-local-player'),null);assert.equal(await page.locator('#b video').evaluate(v=>v.controls),false);assert.notEqual(await page.locator('#b .vjs-control-bar').evaluate(e=>getComputedStyle(e).display),'none');
 await page.evaluate(()=>{b.controls=true;controls.update();});assert.equal(await page.locator('#b video').evaluate(v=>v.controls),true,'online native controls remain untouched');
 await page.evaluate(()=>{local={video:b,controls:true};controls.update();});assert.equal(await page.locator('#b video').evaluate(v=>v.controls),false);assert.ok(await page.locator('#host').locator('#zy-playback').isVisible());await page.evaluate(()=>{local=null;controls.update();});assert.equal(await page.locator('#b video').evaluate(v=>v.controls),true);assert.ok(await page.locator('#host').locator('#zy-playback').isHidden());
 console.log('PASS: multiple-video controls belong to cached element, fullscreen video id cannot recurse, plaintext-only and role textbox arrows remain editing.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
