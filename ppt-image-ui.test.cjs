const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://interactivemeta.cmc.zju.edu.cn/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="host"></div>'}));
  await page.goto('https://interactivemeta.cmc.zju.edu.cn/');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2400;c.height=1350;const x=c.getContext('2d');x.fillStyle='#f4f0dc';x.fillRect(0,0,c.width,c.height);x.fillStyle='#db442f';x.fillRect(0,0,800,1350);x.fillStyle='#234d77';x.font='100px sans-serif';x.fillText('PPT CONTENT',1000,500);return c.toDataURL('image/png').split(',')[1];});
  await page.route('https://vod.cmc.zju.edu.cn/ppt/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')}));
  await page.addScriptTag({content:fs.readFileSync('ai-learning.js','utf8')});
  await page.evaluate(async png=>{
   const shadow=document.querySelector('#host').attachShadow({mode:'open'});
   shadow.innerHTML='<style>[hidden]{display:none!important}</style><button id="ai-open">Explain PPT</button><div id="settings-ai" hidden></div>';
   const pixels=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
   window.slideBlob=new Blob([pixels],{type:'image/png'});
   const image=new Image();image.src='https://vod.cmc.zju.edu.cn/ppt/current.png';document.body.append(image);await image.decode();
   window.slide={url:image.src,imageElement:image,index:0,time:12,title:'PPT image regression'};
   window.crossOriginCanvasBlocked=false;
   try{const c=document.createElement('canvas');c.getContext('2d').drawImage(image,0,0);c.toDataURL();}catch(e){crossOriginCanvasBlocked=e.name==='SecurityError';}
   window.imageReads=[];window.aiCalls=[];window.abortCount=0;window.deferImage=false;
   window.assistant=ZhiyunLearning.mountLearningAssistant({shadow,getSlide:()=>slide,getApiKey:()=> 'test-session',getContext:()=> 'Teacher: this page explains the concept.',getValue:(_,d)=>d,setValue(){},request:o=>{
    if(o.method==='GET'){
     imageReads.push({url:o.url,type:o.responseType});
     const handle={abort(){abortCount++;o.onabort?.();}};
     if(deferImage)window.pendingRead=o;else queueMicrotask(()=>o.onload({status:200,response:slideBlob}));
     return handle;
    }
    aiCalls.push(JSON.parse(o.data));
    queueMicrotask(()=>o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'Explained PPT content.'}]}]})}));
    return{abort(){}};
   }});
  },png);
  assert.equal(await page.evaluate(()=>crossOriginCanvasBlocked),true,'fixture really taints the canvas before the GM Blob fallback');
  await page.evaluate(()=>assistant.explainSlide());
  assert.equal(await page.evaluate(()=>imageReads.length),1);
  assert.deepEqual(await page.evaluate(()=>imageReads[0]),{url:'https://vod.cmc.zju.edu.cn/ppt/current.png',type:'blob'});
  const image=await page.evaluate(()=>aiCalls[0].input.at(-1).content.find(c=>c.type==='input_image').image_url);
  const decoded=await page.evaluate(async src=>{const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return{size:[i.width,i.height],pixel:[...x.getImageData(100,100,1,1).data]};},image);
  assert.deepEqual(decoded.size,[1600,900]);
  assert.ok(decoded.pixel[0]>180&&decoded.pixel[1]<100&&decoded.pixel[2]<100,'AI receives the actual colored PPT pixels after cross-origin loading');

  await page.evaluate(async()=>{assistant.resetCourse();slide={url:'http://vod.cmc.zju.edu.cn/ppt/legacy.png?course=123',index:1};await assistant.explainSlide();});
  assert.equal(await page.evaluate(()=>imageReads.at(-1).url),'https://vod.cmc.zju.edu.cn/ppt/legacy.png?course=123','legacy school HTTP resources upgrade to HTTPS');
  assert.equal(await page.evaluate(()=>aiCalls.length),2);

  await page.evaluate(async()=>{assistant.resetCourse();window.localObjectURL=URL.createObjectURL(slideBlob);slide={url:localObjectURL,index:2};await assistant.explainSlide();});
  assert.equal(await page.evaluate(()=>imageReads.length),2,'a same-origin Blob URL never goes through network permission checking');
  assert.equal(await page.evaluate(()=>aiCalls.length),3);
  assert.equal(await page.evaluate(async()=>(await fetch(localObjectURL)).status),200,'reading the PPT does not revoke the caller-owned Blob URL');

  await page.evaluate(async png=>{assistant.resetCourse();slide={url:'data:image/png;base64,'+png,index:3};await assistant.explainSlide();},png);
  assert.equal(await page.evaluate(()=>imageReads.length),2);
  assert.equal(await page.evaluate(()=>aiCalls.length),4);
  assert.equal(await page.evaluate(()=>aiCalls.at(-1).input.at(-1).content.find(c=>c.type==='input_image').image_url),'data:image/png;base64,'+png);

  for(const url of ['https://unapproved.test/ppt.png','http://unapproved.test/ppt.png','https://cmc.zju.edu.cn.unapproved.test/ppt.png','https://name:pass@vod.cmc.zju.edu.cn/ppt.png','blob:https://unapproved.test/fake']){
   await page.evaluate(async url=>{assistant.resetCourse();slide={url,index:4};await assistant.explainSlide();},url);
   assert.match(await page.locator('#host').locator('#ai-status').textContent(),/\u5c1a\u672a\u6388\u6743/);
  }
  assert.equal(await page.evaluate(()=>imageReads.length),2,'the fix does not request arbitrary external images');
  assert.equal(await page.evaluate(()=>aiCalls.length),4,'failed image reads do not consume an AI request');

  await page.evaluate(()=>{assistant.resetCourse();deferImage=true;slide={url:'https://vod.cmc.zju.edu.cn/ppt/slow.png',index:5};window.explanation=assistant.explainSlide();});
  await page.locator('#host').locator('#ai-stop').click();
  await page.evaluate(async()=>{pendingRead.onload({status:200,response:slideBlob});await explanation;deferImage=false;});
  assert.equal(await page.evaluate(()=>abortCount),1);
  assert.equal(await page.evaluate(()=>aiCalls.length),4,'a cancelled image read never sends a late AI request');

  await page.evaluate(async()=>{assistant.resetCourse();slideBlob=new Blob([new Uint8Array(15000001)],{type:'image/png'});slide={url:'https://vod.cmc.zju.edu.cn/ppt/oversize.png',index:6};await assistant.explainSlide();});
  assert.match(await page.locator('#host').locator('#ai-status').textContent(),/15 MB/);
  assert.equal(await page.evaluate(()=>aiCalls.length),4);
  await page.evaluate(png=>{slide={url:'data:image/png;base64,'+png,index:6,time:37};},png);
  const assistantUi=page.locator('#host'),question=assistantUi.locator('#ai-question');
  await question.fill('问刚才这一页的定义');
  await assistantUi.getByRole('button',{name:'添加 PPT 到对话'}).click();
  const attachment=assistantUi.locator('#ai-attachment');
  await attachment.getByText('PPT 第 7 页已添加').waitFor();
  assert.equal(await question.inputValue(),'问刚才这一页的定义');
  assert.equal(await page.evaluate(()=>aiCalls.length),4,'attaching the PPT never submits the draft');
  await page.evaluate(()=>{slide={index:7};});
  await assistantUi.locator('#ai-send').click();
  await assistantUi.locator('#ai-log').getByText('Explained PPT content.').waitFor();
  const attached=await page.evaluate(()=>aiCalls[4].input.at(-1).content);
  assert.match(attached[0].text,/PPT 第 7 页.*37 秒/);
  assert.match(attached[0].text,/问刚才这一页的定义/);
  assert.deepEqual(attached.slice(1),[{type:'input_image',image_url:'data:image/png;base64,'+png}]);
  assert.equal(await attachment.isHidden(),true);
  await question.fill('再简单讲一遍');
  await question.press('Enter');
  await page.waitForFunction(()=>aiCalls.length===6);
  assert.equal(await page.evaluate(()=>aiCalls[5].input.at(-1).content.some(c=>c.type==='input_image')),false);
  assert.equal(await page.evaluate(()=>aiCalls[5].input.some(item=>item.content==='问刚才这一页的定义')),true);
  await page.evaluate(()=>{URL.revokeObjectURL(localObjectURL);assistant.destroy();});
  assert.deepEqual(errors,[]);
  console.log('PASS: Chrome cross-origin PPT loading, cancellation, size limit, explicit attachment across page turns, and text-only follow-up.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
