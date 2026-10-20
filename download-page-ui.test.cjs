const fs=require('node:fs'),assert=require('node:assert/strict'),cp=require('node:child_process'),{chromium}=require('playwright');
(async()=>{
 const fixture=cp.spawn('python',['-u','-c',`import json,tempfile,threading,sys
from backend.public_preview import make_preview_server
from backend.server import Gateway
with tempfile.TemporaryDirectory() as folder:
 server=make_preview_server(Gateway(folder+'/test.sqlite3'))
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 print(json.dumps({'port':server.server_port}),flush=True)
 sys.stdin.readline();server.shutdown();server.server_close();thread.join()
`],{stdio:['pipe','pipe','inherit']});let browser;
 try{
  const port=await new Promise((resolve,reject)=>{let output='';fixture.stdout.on('data',data=>{output+=data;try{resolve(JSON.parse(output.trim()).port);}catch{}});fixture.on('error',reject);fixture.on('exit',code=>reject(Error('Fixture exited '+code)));});
  const base='http://127.0.0.1:'+port;
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const failures=[];page.on('response',r=>{if(r.url().startsWith(base)&&r.status()>=400)failures.push(r.url()+' '+r.status());});
  for(const path of ['/gateway/','/gateway/download','/gateway/download?from=qr','/gateway/index.html?from=mobile']){const response=await context.request.get(base+path);assert.equal(response.status(),200);assert.match(await response.text(),/网课不硬扛/);assert.match(response.headers()['content-security-policy'],/style-src 'self'/);}
  await page.goto(base+'/gateway/download?from=qr');assert.equal(await page.title(),'浙大上课爽 · 网课不硬扛');
  assert.equal(await page.locator('meta[name=application-version]').getAttribute('content'),JSON.parse(fs.readFileSync('backend/public-page.json','utf8').replace(/^\uFEFF/,'')).pageVersion||require('./package.json').version);
  assert.equal(await page.locator('form,input[type=password],#gateway-login').count(),0,'public page has no login prerequisite');
  assert.equal(await page.locator('h1').evaluate(n=>getComputedStyle(n).color),'rgb(25, 47, 67)','stylesheet loads under production CSP');
  const art=page.locator('.art-link img');assert.equal(await art.count(),6);
  assert.deepEqual(await art.evaluateAll(nodes=>nodes.map(n=>new URL(n.src).pathname.match(/image-(\d+)/)[1])),['02','01','03','04','05','06']);
  for(const image of await art.all()){await image.scrollIntoViewIfNeeded();await image.evaluate(n=>n.decode());assert.deepEqual(await image.evaluate(n=>[n.naturalWidth,n.naturalHeight]),[1280,800]);}
  const settings=JSON.parse(fs.readFileSync('backend/public-page.json','utf8').replace(/^\uFEFF/,''));const chromeLinks=page.getByRole('link',{name:'Chrome 插件商店',exact:true});assert.equal(await chromeLinks.count(),2,'direct store badges in hero and footer');
  for(const chrome of await chromeLinks.all()){assert.equal(await chrome.getAttribute('href'),settings.chromeStoreUrl);assert.equal(await chrome.getAttribute('target'),'_blank');assert.match(await chrome.getAttribute('rel'),/noopener/);}
  const edges=page.getByRole('button',{name:/Edge 插件商店/});assert.equal(await edges.count(),2);for(const edge of await edges.all()){assert.equal(await edge.isDisabled(),true);assert.match(await edge.textContent(),/即将上线.*审核中/);assert.equal(await edge.getAttribute('href'),null);}
  const edge=edges.last();
  assert.equal(await page.getByText('找到你的浏览器插件').count(),0);
  const sync=page.locator('.sync-row .feature-art'),view=page.locator('.view-row .feature-art');const syncBox=await sync.boundingBox(),viewBox=await view.boundingBox();assert.ok(syncBox.width>=800,'second-screen image gets a broad dedicated canvas');assert.ok(viewBox.y>=syncBox.y+syncBox.height+70,'sync and PPT posters no longer squeezed side by side');
  await page.getByRole('link',{name:'获取插件'}).click();await page.waitForURL(/#install$/);assert.ok(await edge.isVisible());
  await page.evaluate(()=>{document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,0);});await page.screenshot({path:'download-page-desktop-preview.png',fullPage:true});await page.screenshot({path:'download-page-hero-preview.png'});await page.locator('#features').screenshot({path:'download-page-classroom-preview.png'});
  for(const width of [390,320,768,1024]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at '+width);for(const badge of await page.locator('.hero-stores .store-button').all()){const r=await badge.boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width,'hero store badges fit viewport');}await edge.scrollIntoViewIfNeeded();const box=await edge.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);if(width===390){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'download-page-mobile-preview.png',fullPage:true});}else if(width===320)await page.screenshot({path:'.testdeps/public-page-320.png',fullPage:true});}
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);assert.deepEqual(await context.cookies(),[],'viewing the introduction needs no account cookies');
  console.log('PASS: anonymous home/QR/query URLs, all six images and CSP, two direct Chrome/Edge badge pairs, spacious stacked feature canvases, installation anchors and 320/390px layouts.');
 }finally{await browser?.close();fixture.stdin.end('\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
