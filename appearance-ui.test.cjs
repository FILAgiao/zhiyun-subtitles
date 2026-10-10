const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const body='<style>body{margin:0;background:linear-gradient(135deg,#fff0d7,#e0ecff);font-family:Segoe UI}#player{margin:60px;width:850px;height:540px;background:#ffffffaa}video{width:100%;height:100%}</style><div id="player"><video></video></div><div id="pane-voice"><div class="trans-item"><div class="item-title">00:00:10</div><div class="trans-lan"><div>Learning about data structures.</div></div></div></div>';
  await page.route('https://interactivemeta.cmc.zju.edu.cn/**',r=>r.fulfill({contentType:'text/html',body}));
  await page.addInitScript(()=>{window.GM_getValue=(k,d)=>{const v=localStorage.getItem('test-gm:'+k);return v===null?d:JSON.parse(v)};window.GM_setValue=(k,v)=>localStorage.setItem('test-gm:'+k,JSON.stringify(v));window.GM_deleteValue=k=>localStorage.removeItem('test-gm:'+k);window.GM_registerMenuCommand=()=>{};window.GM_xmlhttpRequest=()=>{throw Error('Theme test must not call cloud services')};});
  const source=fs.readFileSync('zhiyun-subtitles.user.js','utf8');
  await page.goto('https://interactivemeta.cmc.zju.edu.cn/#/replay?course_id=themes');await page.evaluate(()=>GM_setValue('cache-auto',false));await page.addScriptTag({content:source});
  const ui=page.locator('#zy-subtitle-host');await ui.locator('#settings-open').click();await ui.locator('[data-settings=appearance]').click();
  for(const theme of ['blue','warm','glass']){
   await ui.locator('.zy-theme-choice[data-theme='+theme+']').click();
   assert.equal(await ui.getAttribute('data-zy-theme'),theme);assert.equal(await ui.locator('.zy-theme-choice[aria-pressed=true]').count(),1);
   assert.equal(await page.evaluate(()=>GM_getValue('appearance-theme')),theme);
   await ui.locator('#settings-close').click();
   for(const id of ['ai-open','transcript-open','sync-toggle','cache-download','cache-details-toggle','show-slides','focus-fullscreen'])assert.ok(await ui.locator('#'+id).isVisible(),id+' survives switching');
   await ui.locator('#panel').screenshot({path:'theme-'+theme+'-preview.png'});
   if(theme==='glass'){
    const result=await ui.locator('#panel').evaluate(n=>({filter:getComputedStyle(n).backdropFilter,bg:getComputedStyle(n).backgroundImage}));assert.match(result.filter,/blur\(12px\)/);assert.match(result.bg,/gradient/);const alphas=[...result.bg.matchAll(/rgba\([^)]*, ([\d.]+)\)/g)].map(m=>Number(m[1]));assert.ok(alphas.length>=3&&alphas.every(a=>a<=.46),'glass shell must transmit the page background');const controlAlpha=await ui.locator('#sync-toggle').evaluate(n=>Number(getComputedStyle(n).backgroundColor.match(/, ([\d.]+)\)$/)?.[1]));assert.ok(controlAlpha<=.32,'utility controls must not cover the glass with an opaque layer');
    await ui.locator('#ai-open').evaluate(n=>n.click());assert.equal(await ui.locator('#settings-dialog').isVisible(),true,'logged-out AI still opens account dialog');await ui.locator('#settings-close').click();
    await page.evaluate(()=>{const sh=document.querySelector('#zy-subtitle-host').shadowRoot;sh.querySelector('#ai-learning').hidden=false;sh.querySelector('#ai-questions').hidden=false});
    for(const id of ['ai-learning','ai-questions'])assert.match(await ui.locator('#'+id).evaluate(n=>getComputedStyle(n).backdropFilter),/blur/);
    await page.evaluate(()=>{const sh=document.querySelector('#zy-subtitle-host').shadowRoot;sh.querySelector('#ai-learning').hidden=true;sh.querySelector('#ai-questions').hidden=true});
   }
   await ui.locator('#settings-open').click();await ui.locator('[data-settings=appearance]').click();
  }
  await page.setViewportSize({width:360,height:760});
  assert.equal(await ui.locator('.zy-theme-choice').count(),3);await ui.locator('.zy-theme-choice[data-theme=glass]').click();
  const box=await ui.locator('#settings-card').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=361);assert.equal(await ui.locator('#settings-appearance').evaluate(n=>n.scrollWidth>n.clientWidth),false);
  await ui.locator('#settings-card').screenshot({path:'theme-settings-mobile-preview.png'});
  await page.reload();await page.addScriptTag({content:source});await ui.locator('#panel').waitFor();assert.equal(await ui.getAttribute('data-zy-theme'),'glass','saved choice restored after reload');
  await page.setViewportSize({width:1440,height:900});await ui.locator('#settings-open').click();await ui.locator('[data-settings=appearance]').click();assert.equal(await ui.locator('.zy-theme-choice[data-theme=glass]').getAttribute('aria-pressed'),'true');await ui.locator('#settings-card').screenshot({path:'theme-settings-preview.png'});
  // Other webpage uses the same settings path and applies preference to the whole host.
  await page.route('https://appearance.test/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Ordinary webpage</h1>'}));await page.goto('https://appearance.test/');await page.evaluate(()=>GM_setValue('appearance-theme','glass'));await page.addScriptTag({content:source});
  const web=page.locator('#zy-subtitle-host');await web.locator('#web-settings-open').click();await web.locator('#settings-tab-appearance').click();await web.locator('.zy-theme-choice[data-theme=blue]').click();assert.equal(await web.getAttribute('data-zy-theme'),'blue');assert.equal(await web.locator('#settings-appearance').isVisible(),true);
  await page.goto(require('node:url').pathToFileURL(require('node:path').resolve('theme-preview.html')).href);
  const local=page.locator('#preview-host');await local.locator('#panel').waitFor();
  await page.locator('[data-preview-theme=glass]').click();assert.equal(await local.getAttribute('data-zy-theme'),'glass');
  await local.locator('#panel').screenshot({path:'theme-glass-local-preview.png'});
  await page.evaluate(()=>{const bg=document.createElement('div');bg.id='glass-test-backdrop';bg.style.cssText='position:fixed;right:0;top:0;bottom:0;width:440px;background:linear-gradient(145deg,#82bdd6,#d4afd0 50%,#f2c788);pointer-events:none';for(const [color,x,y] of [['#65b4d4',30,220],['#eaa384',180,370],['#879fc9',10,520]]){const s=document.createElement('span');s.style.cssText='position:absolute;width:160px;height:160px;border-radius:50%;background:'+color+';left:'+x+'px;top:'+y+'px';bg.append(s)}document.body.insertBefore(bg,document.querySelector('#preview-host'))});
  await page.mouse.move(0,0);await local.locator('#panel').screenshot({path:'theme-glass-transparent-preview.png'});
  await page.evaluate(()=>document.querySelector('#glass-test-backdrop').remove());
  await page.locator('#preview-settings').click();assert.equal(await local.locator('#settings-appearance').isVisible(),true);await local.locator('.zy-theme-choice[data-theme=blue]').click();await local.locator('#settings-close').click();
  await page.reload();await local.locator('#panel').waitFor();assert.equal(await local.getAttribute('data-zy-theme'),'blue');
  await local.locator('#ai-open').click();assert.equal(await local.locator('#ai-learning').isVisible(),true);
  assert.deepEqual(errors,[]);console.log('PASS: all 3 themes, instant switching, saved preference/reload, actual blur, account gate, AI/list surfaces, mobile settings and ordinary webpages.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
