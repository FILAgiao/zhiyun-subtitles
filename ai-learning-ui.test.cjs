const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<style>body{font:18px sans-serif;background:#edf3f2}#course-word{position:absolute;left:40px;top:40px}#host{position:fixed;inset:0;pointer-events:none}</style><div id="pane-voice"><span id="course-word">polymorphism</span></div><div id="host"></div>');
 await page.addScriptTag({content:fs.readFileSync('ai-learning.js','utf8')});
 await page.evaluate(()=>{
  const shadow=document.getElementById('host').attachShadow({mode:'open'});shadow.innerHTML='<style>[hidden]{display:none!important}#ai-open{pointer-events:auto;position:absolute;left:30px;top:100px}</style><button id="ai-open">讲解这页</button><div id="settings-ai" hidden></div>';
  const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');ctx.fillStyle='#ffefcc';ctx.fillRect(0,0,960,540);ctx.fillStyle='#18334c';ctx.font='40px sans-serif';ctx.fillText('Polymorphism / virtual methods',45,100);
  window.slide={url:'https://interactivemeta.cmc.zju.edu.cn/ppt/1.jpg',index:0,time:20,dataUrl:canvas.toDataURL('image/png')};
  window.calls=[];window.answers=0;window.abortCount=0;window.delay=5;window.saved={};window.key='fake-test-key';
  window.assistant=ZhiyunLearning.mountLearningAssistant({shadow,getCourseTitle:()=> '程序设计 · 多态与继承',getSlide:()=>window.slide,getContext:()=> '本课程：程序设计；当前字幕：虚函数可以实现多态。',getApiKey:()=>window.key,getValue:(k,d)=>saved[k]||d,setValue:(k,v)=>saved[k]=v,request:o=>{
   calls.push(JSON.parse(o.data));const timer=setTimeout(()=>{answers++;o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'多态让同一个调用呈现不同实现。<img src=x onerror=alert(1)> #'+answers}]}]})});},window.delay);return{abort(){abortCount++;clearTimeout(timer);o.onabort?.();}};
  }});
 });
 const host=page.locator('#host');await host.locator('#ai-open').click();await page.waitForFunction(()=>answers===1);assert.equal(await page.evaluate(()=>calls[0].input.at(-1).content.filter(c=>c.type==='input_image').length),1,'the primary explain action sends the current PPT');await host.locator('#ai-clear').click();await page.evaluate(()=>{calls=[];answers=0;});assert.equal(await host.locator('#ai-save-card').isDisabled(),true);assert.equal(await host.locator('#ai-card-row').isVisible(),false);assert.equal(await host.locator('#ai-context-badge').isVisible(),false);await host.locator('#ai-question').fill('什么是多态？');await host.locator('#ai-send').click();await page.waitForFunction(()=>answers===1);
 assert.match(await host.locator('#ai-log').textContent(),/多态让/);assert.equal(await host.locator('#ai-log img').count(),0);assert.equal(await page.evaluate(()=>calls[0].input.at(-1).content[0].text.includes('虚函数')),true);
 await host.locator('#ai-mode').selectOption('technical');await host.locator('#ai-question').fill('再给一个例子');await host.locator('#ai-send').click();await page.waitForFunction(()=>answers===2);
 assert.equal(await page.evaluate(()=>calls[1].input.length),4);assert.match(await page.evaluate(()=>calls[1].input[0].content),/前置知识/);
 await host.locator('#ai-slide-action').click();await page.waitForFunction(()=>answers===3);assert.equal(await page.evaluate(()=>calls[2].input.at(-1).content.filter(c=>c.type==='input_image').length),1);
 await host.locator('#ai-question').fill('图上这个概念再解释一下');await host.locator('#ai-send').click();await page.waitForFunction(()=>answers===4);assert.equal(await page.evaluate(()=>calls[3].input.at(-1).content.filter(c=>c.type==='input_image').length),1);
 await host.locator('#ai-crop-action').click();await host.locator('#ai-crop-image').waitFor();const box=await host.locator('#ai-crop-image').boundingBox();
 await page.mouse.move(box.x+50,box.y+40);await page.mouse.down();await page.mouse.move(box.x+400,box.y+210);await page.mouse.up();await host.locator('#ai-crop-use').click();
 assert.equal(await page.evaluate(()=>calls.length),4);assert.equal(await host.locator('#ai-attachment').isVisible(),true);await host.locator('#ai-mode').selectOption('exam');await host.locator('#ai-send').click();await page.waitForFunction(()=>answers===5);
 const image=await page.evaluate(()=>calls[4].input.at(-1).content.find(c=>c.type==='input_image').image_url);
 const size=await page.evaluate(src=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve([i.width,i.height]);i.src=src;}),image);assert.ok(size[0]<960&&size[1]<540);assert.match(await page.evaluate(()=>calls[4].input[0].content),/考点/);
 await page.evaluate(()=>{const inputs=document.getElementById('host').shadowRoot.querySelectorAll('.ai-settings input[type=checkbox]');inputs[1].checked=true;inputs[1].dispatchEvent(new Event('change'));slide={...slide,url:'https://interactivemeta.cmc.zju.edu.cn/ppt/2.jpg',index:1};assistant.notifySlide(slide);});
 assert.equal(await page.evaluate(()=>calls.length),5);await host.locator('#ai-question').fill('比较这两页');await host.locator('#ai-send').click();await page.waitForFunction(()=>answers===6);assert.equal(await page.evaluate(()=>calls[5].input.at(-1).content.filter(c=>c.type==='input_image').length),2);
 await host.locator('#ai-close').click();await page.locator('#course-word').click({button:'middle'});await page.waitForFunction(()=>answers===7);assert.match(await page.evaluate(()=>calls[6].input.at(-1).content[0].text),/polymorphism/);
 await page.evaluate(()=>window.delay=1000);await host.locator('#ai-question').fill('一个慢请求');await host.locator('#ai-send').click();await host.locator('#ai-stop').click();assert.equal(await page.evaluate(()=>abortCount),1);
 await host.locator('#ai-question').fill('切课前的问题');await host.locator('#ai-send').click();await page.evaluate(()=>assistant.resetCourse());assert.equal(await page.evaluate(()=>abortCount),2);assert.equal(await host.locator('#ai-save-card').isDisabled(),true);assert.equal(await host.locator('#ai-question').inputValue(),'');
 await page.waitForTimeout(1100);assert.equal(await page.evaluate(()=>answers),7);assert.equal(await host.locator('#ai-log .ai-message').count(),1);
 await page.evaluate(()=>{window.key='';});await host.locator('#ai-question').fill('无 Key');await host.locator('#ai-send').click();assert.match(await host.locator('#ai-status').textContent(),/API Key/);assert.equal(await page.evaluate(()=>calls.length),9);
 await page.evaluate(()=>document.documentElement.requestFullscreen());await page.waitForTimeout(100);assert.equal(await host.locator('#ai-learning').isVisible(),true);await page.evaluate(()=>document.exitFullscreen());

 // Caption hit testing preserves left-click pass-through while reading middle-click text.
 await page.evaluate(()=>{
  window.key='fake-test-key';window.delay=5;
  const button=document.createElement('button');button.id='under-caption';button.textContent='player';button.style.cssText='position:absolute;left:300px;top:120px;width:300px;height:60px';button.onclick=()=>window.leftPassed=true;document.body.insertBefore(button,document.getElementById('host'));
  const caption=document.createElement('div');caption.id='caption';caption.style.cssText='position:fixed;left:300px;top:120px;font:28px sans-serif;pointer-events:none';caption.innerHTML='<span id="original">inheritance</span><span id="translation"></span>';document.getElementById('host').shadowRoot.append(caption);
  const unrelated=document.createElement('span');unrelated.id='settings-copy';unrelated.textContent='configuration';unrelated.style.cssText='position:absolute;left:40px;top:220px';document.body.append(unrelated);
 });
 const captionBox=await host.locator('#original').boundingBox();
 await page.mouse.click(captionBox.x+10,captionBox.y+10);assert.equal(await page.evaluate(()=>leftPassed),true);
 const beforeCaption=await page.evaluate(()=>calls.length);
 await page.locator('#settings-copy').click({button:'middle'});assert.equal(await page.evaluate(()=>calls.length),beforeCaption);
 await page.mouse.click(captionBox.x+10,captionBox.y+10,{button:'middle'});await page.waitForFunction(()=>answers===8);
 assert.match(await page.evaluate(()=>calls.at(-1).input.at(-1).content[0].text),/inheritance/);
 assert.equal(await host.locator('#caption').evaluate(e=>getComputedStyle(e).pointerEvents),'none');


 // A real browser download yields a readable fixed-size PNG without a network request.
 assert.equal(await host.locator('#ai-save-card').isEnabled(),true);assert.equal(await host.locator('#ai-card-row').isVisible(),true);
 const requestsBeforeCard=await page.evaluate(()=>calls.length);
 const downloadEvent=page.waitForEvent('download');await host.locator('#ai-save-card').click();
 const download=await downloadEvent;assert.match(download.suggestedFilename(),/^浙大上课爽-知识卡-.*\.png$/);assert.equal(await download.failure(),null);
 await download.saveAs('knowledge-card-preview.png');
 const png=fs.readFileSync('knowledge-card-preview.png');assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1350);
 assert.equal(await page.evaluate(()=>calls.length),requestsBeforeCard);assert.match(await host.locator('#ai-status').textContent(),/本地.*不会自动发布/);

 await page.screenshot({path:'ai-learning-preview.png'});
 const beforeMissingSlide=await page.evaluate(()=>calls.length);await page.evaluate(()=>{assistant.resetCourse();assistant.close();slide=null;});await host.locator('#ai-open').click();assert.match(await host.locator('#ai-status').textContent(),/请先打开.*PPT/);assert.equal(await page.evaluate(()=>calls.length),beforeMissingSlide,'missing PPT does not trigger a paid model request');
 assert.deepEqual(errors,[]);await page.evaluate(()=>assistant.destroy());assert.equal(await host.locator('#ai-learning').count(),0);
 console.log('AI UI passed: text, modes, crop, image history, middle-click, slide memory, cancel, course reset, fullscreen.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
