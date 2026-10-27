const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://clip-resolution.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="host"></div>'}));await page.goto('https://clip-resolution.test/');await page.addScriptTag({path:'ai-learning.js'});
  await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=3840;canvas.height=2700;const x=canvas.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,canvas.width,canvas.height);x.fillStyle='#123';x.font='32px sans-serif';
   for(let n=0;n<70;n++)x.fillText('Original native text 0123456789 / line '+n,30,40+n*36);
   window.source=canvas.toDataURL();window.savedClips=[];window.limits={max_edge:3840,max_image:4000000};window.aiCalls=0;
   window.ZYNativeCapture={capture:async()=>source};window.html2canvas=()=>{throw Error('DOM rendering forbidden');};
   const shadow=document.querySelector('#host').attachShadow({mode:'open'});shadow.innerHTML='<style>[hidden]{display:none!important}</style>';
   window.ai=ZhiyunLearning.mountLearningAssistant({shadow,getApiKey:()=> 'fixture',getCourseId:()=>location.href,getCourseTitle:()=> '高清课堂',
    request:()=>{aiCalls++;throw Error('Collection must not call AI');},
    studyStore:{account:()=> 'token',identity:()=> 'fixture-user',clipLimits:()=>limits,saveClip:async clip=>{savedClips.push(structuredClone(clip));}}
   });
  });
  const ui=page.locator('#host');
  const dimensions=src=>page.evaluate(src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve([img.naturalWidth,img.naturalHeight]);img.onerror=reject;img.src=src;}),src);
  async function collect(){
   await page.evaluate(()=>{void ai.startCapture();});await ui.locator('#ai-crop-image').waitFor({state:'visible'});
   assert.equal(await ui.locator('#ai-crop-image').evaluate(i=>i.naturalWidth),3840,'capture preview retains original native pixels');
   await page.mouse.move(20,20);await page.mouse.down();await page.mouse.move(1200,600,{steps:5});await page.mouse.up();await ui.locator('#ai-crop-preview').waitFor({state:'visible'});
   const crop=await ui.locator('#ai-crop-preview').evaluate(c=>[c.width,c.height]);assert.ok(crop[0]>3000,'full-resolution crop survives until collection');
   await ui.locator('#ai-crop-save').click();await ui.getByText('已收藏',{exact:true}).waitFor();await ui.locator('#ai-crop-cancel').click();return crop;
  }
  const original=await collect();let clip=await page.evaluate(()=>savedClips[0]),size=await dimensions(clip.image);
  assert.deepEqual(size,original,'new backend retains native crop resolution below 3840');assert.ok(Buffer.from(clip.image.split(',')[1],'base64').length<=4000000);
  assert.ok(Math.max(...await dimensions(clip.thumbnail))<=280,'list thumbnails remain small');
  // No advertised capability means the collector remains compatible with the deployed old backend.
  await page.evaluate(()=>limits=null);await collect();clip=await page.evaluate(()=>savedClips[1]);size=await dimensions(clip.image);
  assert.equal(Math.max(...size),1600);assert.ok(Buffer.from(clip.image.split(',')[1],'base64').length<=1500000);
  assert.equal(await page.evaluate(()=>aiCalls),0);assert.deepEqual(errors,[]);await page.evaluate(()=>ai.destroy());
  console.log('PASS: native 3840 preview/crop, 4 MB capable-backend original collection, legacy 1600/1.5 MB fallback, small thumbnails and no DOM rendering or AI request.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
