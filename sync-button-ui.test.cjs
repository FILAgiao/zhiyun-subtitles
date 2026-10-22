'use strict';
// Visual/interaction checks use local fixtures only; no audio or cloud service is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const native=process.argv.includes('--extension');
const executables=native?[['edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]:[['chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],['edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']];
const source=fs.readFileSync('zhiyun-subtitles.user.js','utf8');
const base=source.match(/shadow\.innerHTML = `([\s\S]*?)`;\s*document\.body\.append\(host\)/)?.[1];
assert.ok(base,'base markup exists');
const modules=['warm-theme.js','appearance-theme.js','study-ui.js'].map(file=>fs.readFileSync(file,'utf8')).join('\n');
const mascot='data:image/png;base64,'+fs.readFileSync('assets/study-eagle.png').toString('base64');
const fixture='<style>body{margin:0;background:#eee4d9;font-family:Segoe UI,sans-serif}.cmc-main{margin:45px;width:760px;height:480px;background:#263d4c}video{width:100%;height:100%}</style><div class="cmc-main"><video></video></div><div id="fixture-host"></div>';
fs.mkdirSync('.test-media',{recursive:true});
(async()=>{
 let checks=0;
 for(const [name,executablePath] of executables){
  let browser;
  const context=native?await chromium.launchPersistentContext(path.resolve('.test-media/sync-button-extension-'+Date.now()),{headless:true,executablePath,viewport:{width:1440,height:1000},args:['--disable-extensions-except='+path.resolve('dist/extension'),'--load-extension='+path.resolve('dist/extension')]}):await(browser=await chromium.launch({headless:true,executablePath})).newContext({viewport:{width:1440,height:1000}});
  try{
   const errors=[],cloudRequests=[];
   await context.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html; charset=utf-8',body:fixture}):r.abort());
   if(native){const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.local.set({'cache-auto':false,'gateway-guide-no-remind-v2':true}));}
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/(speech|learning)\//.test(r.url()))cloudRequests.push(r.url());});
   await page.goto('https://classroom.zju.edu.cn/livingpage?tenant_code=112&course_id=sync-button&sub_id=1');
   if(!native){
    await page.evaluate(markup=>{const host=document.getElementById('fixture-host');host.id='zy-subtitle-host';host.attachShadow({mode:'open'}).innerHTML=markup;},base);
    await page.addScriptTag({content:modules});
    await page.evaluate(mascot=>{window.syncClicks=0;const shadow=document.getElementById('zy-subtitle-host').shadowRoot;window.syncButtonStudy=ZYStudyUI.mount({shadow,mascot});shadow.getElementById('auto-align').addEventListener('click',()=>syncClicks++);},mascot);
   }
   const ui=page.locator('#zy-subtitle-host');await ui.locator('#sync-toggle').waitFor();
   for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});
    for(const theme of ['warm','blue','glass']){
     await ui.locator('#settings-open').click();await ui.locator('[data-settings=appearance]').click();await ui.locator('.zy-theme-choice[data-theme='+theme+']').click();await ui.locator('#settings-close').click();await page.mouse.move(0,0);
     const metrics=await ui.locator('#study-sync-tools').evaluate(e=>{
      const shadow=e.getRootNode(),box=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};},style=getComputedStyle(e),body=shadow.getElementById('panel-body'),bodyStyle=getComputedStyle(body);
      return{shell:box(e),row:box(shadow.getElementById('sync-action-row')),button:box(shadow.getElementById('sync-toggle')),plus:box(shadow.getElementById('sync-manual-toggle')),body:box(body),paddingLeft:parseFloat(bodyStyle.paddingLeft),paddingRight:parseFloat(bodyStyle.paddingRight),padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],border:style.borderWidth,radius:style.borderRadius,bg:style.backgroundColor,shadow:style.boxShadow,overflow:e.scrollWidth>e.clientWidth};
     });
     const detail=JSON.stringify({name,native,width,theme,metrics});
     assert.equal(metrics.border,'0px',detail);assert.equal(metrics.radius,'0px',detail);assert.deepEqual(metrics.padding,['0px','0px','0px','0px'],detail);assert.equal(metrics.bg,'rgba(0, 0, 0, 0)',detail);assert.equal(metrics.shadow,'none',detail);
     assert.equal(metrics.button.height,42,detail);assert.equal(metrics.plus.width,30,detail);assert.ok(Math.abs(metrics.button.width-(metrics.shell.width-37))<1,detail);
     assert.ok(Math.abs(metrics.button.x-(metrics.body.x+metrics.paddingLeft))<1,detail);assert.ok(Math.abs(metrics.plus.right-(metrics.body.right-metrics.paddingRight))<1,detail);assert.ok(Math.abs(metrics.plus.x-metrics.button.right-7)<1,detail);assert.equal(metrics.overflow,false,detail);assert.ok(metrics.button.x>=0&&metrics.plus.right<=width,detail);
     assert.equal(await ui.locator('#study-sync').evaluate(e=>e.open),false);
     await ui.locator('#sync-manual-toggle').click();assert.equal(await ui.locator('#study-sync').evaluate(e=>e.open),true);assert.equal(await ui.locator('#sync-manual-toggle').getAttribute('aria-expanded'),'true');assert.equal((await ui.locator('#sync-manual-toggle').textContent()).trim(),'−');assert.ok(await ui.locator('#offset').isVisible());
     await ui.locator('#sync-manual-toggle').click();assert.equal(await ui.locator('#study-sync').evaluate(e=>e.open),false);assert.equal(await ui.locator('#sync-manual-toggle').getAttribute('aria-expanded'),'false');assert.equal((await ui.locator('#sync-manual-toggle').textContent()).trim(),'＋');
     await page.evaluate(()=>{const shadow=document.getElementById('zy-subtitle-host').shadowRoot;shadow.getElementById('sync-result').dataset.available='true';shadow.getElementById('sync-result').hidden=false;shadow.getElementById('align-transcript').textContent='光信号变成了一些电荷信号。那电荷信号再根据后面的这个 A D C，就是模拟信号。';shadow.getElementById('align-status').textContent='第 2 次已匹配成功，时间差 +2 秒，当前结果已经生效，后续采样继续校验。';const li=document.createElement('li');li.textContent='第 2 次：识别已返回，已匹配当前课堂字幕。';shadow.getElementById('align-attempts').replaceChildren(li);});
     await page.waitForFunction(()=>document.getElementById('zy-subtitle-host').shadowRoot.getElementById('sync-live-status').textContent.includes('第 2 次'));
     assert.equal(await ui.locator('#align-attempts li').count(),1);assert.ok(await ui.locator('#sync-live-status').isVisible());assert.doesNotMatch(await ui.locator('#sync-live-status').textContent(),/第 [13] 次/);
     for(const id of ['align-label','align-transcript','align-status','align-attempts'])assert.ok(await ui.locator('#'+id).isHidden(),id+' is a hidden compatibility data source');
     const line=await ui.locator('#sync-live-status').evaluate(e=>{const style=getComputedStyle(e),box=e.getBoundingClientRect();return{whiteSpace:style.whiteSpace,overflow:style.overflow,textOverflow:style.textOverflow,height:box.height,lineHeight:parseFloat(style.lineHeight),title:e.title,text:e.textContent,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth};});
     assert.equal(line.whiteSpace,'nowrap',detail);assert.equal(line.overflow,'hidden',detail);assert.equal(line.textOverflow,'ellipsis',detail);assert.ok(line.height<=line.lineHeight+1,JSON.stringify({name,native,width,theme,line}));assert.ok(line.title.includes('光信号变成了'),line.title);assert.ok(line.title.includes('第 2 次'),line.title);
     assert.equal(await ui.locator('#sync-manual-toggle').getAttribute('aria-expanded'),'true');assert.equal((await ui.locator('#sync-manual-toggle').textContent()).trim(),'−');
     await ui.locator('#panel').screenshot({path:'.test-media/sync-button-'+name+(native?'-extension':'')+'-'+theme+'-'+width+'.png'});
     await ui.locator('#sync-manual-toggle').click();assert.ok(await ui.locator('#sync-result').isHidden());assert.ok(await ui.locator('#sync-live-status').isHidden());assert.equal(await ui.locator('#study-sync').evaluate(e=>e.open),false);assert.equal(await ui.locator('#sync-manual-toggle').getAttribute('aria-expanded'),'false');
     await ui.locator('#sync-manual-toggle').click();assert.ok(await ui.locator('#sync-live-status').isVisible());assert.ok(await ui.locator('#offset').isVisible());assert.match(await ui.locator('#sync-live-status').textContent(),/第 2 次/);
     await ui.locator('#sync-manual-toggle').click();assert.ok(await ui.locator('#sync-result').isHidden());assert.ok(await ui.locator('#offset').isHidden());
     checks++;
    }
   }
   if(!native){await ui.locator('#sync-toggle').click();assert.equal(await page.evaluate(()=>syncClicks),1,'main button still forwards one synchronization action');}
   assert.deepEqual(errors,[]);assert.deepEqual(cloudRequests,[],'no cloud work is triggered');
  }finally{await context.close();if(browser)await browser.close();}
 }
 console.log('PASS: '+checks+' '+(native?'native Edge extension':'Chrome/Edge local fixture')+' layouts; warm/blue/glass at 320/390/1440; no wrapper background/border/padding/shadow; full available button width and original 42px height; shared +/- collapses latest feedback and manual controls; one ellipsized live line retains its full title; zero cloud/audio requests.');
})().catch(e=>{console.error(e);process.exitCode=1;});
