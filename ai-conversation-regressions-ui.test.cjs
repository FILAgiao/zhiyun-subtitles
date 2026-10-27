const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://conversation-regressions.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="host"></div>'}));
  await page.goto('https://conversation-regressions.test/');await page.addScriptTag({path:'ai-learning.js'});
  await page.evaluate(()=>{
   window.saved={'ai-learning-settings-v1':{mode:'feynman'}};window.account='alice-token';window.owner='https://gateway.test|id:alice';window.calls=[];window.cloud=[];window.failCloud=false;window.cloudGate=null;window.promptGate=null;
   const shadow=document.querySelector('#host').attachShadow({mode:'open'});shadow.innerHTML='<style>[hidden]{display:none!important}</style><div id="settings-ai" hidden></div><nav id="compact-launcher"><button id="compact">上课爽</button></nav><button id="transcript-open" hidden>问题列表</button>';
   const canvas=document.createElement('canvas');canvas.width=300;canvas.height=180;const image=canvas.toDataURL();
   const prompts=[{id:'feynman',label:'简单',prompt:'FEYNMAN_LATEST',scope:'official'},{id:'technical',label:'专业',prompt:'TECHNICAL_LATEST',scope:'official'},{id:'exam',label:'考试',prompt:'EXAM_LATEST',scope:'official'}];
   window.ai=ZhiyunLearning.mountLearningAssistant({shadow,collapsedEntry:false,
    getValue:(key,fallback)=>saved[key]??fallback,setValue:(key,value)=>saved[key]=structuredClone(value),getApiKey:()=>account,canUse:()=>!!account,
    getCourseId:()=>location.href,getCourseTitle:()=> '测试课堂',getSlide:()=>({index:1,dataUrl:image}),
    promptStore:{account:()=>account,list:async()=>{if(promptGate)await new Promise(r=>window.releasePrompt=r);return{prompts};}},
    studyStore:{account:()=>account,identity:()=>owner,save:async(body,opts)=>{cloud.push({body:structuredClone(body),opts:structuredClone(opts)});if(cloudGate)await new Promise(r=>window.releaseCloud=r);if(failCloud)throw Error('offline');}},
    request:options=>{calls.push(JSON.parse(options.data));window.pending=options;window.raw='';return {abort:()=>options.onabort?.()};}
   });
   window.answer=text=>pending.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text}]}]})});
   window.stream=text=>{raw+='data: '+JSON.stringify({type:'response.output_text.delta',delta:text})+'\n\n';pending.onprogress({status:200,responseText:raw});};
  });
  const ui=page.locator('#host'),log=ui.locator('#ai-log'),mode=ui.locator('#ai-mode');
  await page.waitForFunction(()=>ai.getSettings().catalog.some(p=>p.id==='exam'));
  // Simulate another settings surface changing the shared preference while closed.
  await page.evaluate(()=>{saved['ai-learning-settings-v1'].mode='technical';ai.open();});
  assert.equal(await mode.inputValue(),'technical','open applies a changed shared default immediately');
  await page.evaluate(()=>{void ai.explainSlide();});await page.waitForFunction(()=>calls.length===1);
  assert.match(await page.evaluate(()=>calls[0].input[0].content),/TECHNICAL_LATEST/,'the first PPT request uses the current template');
  await page.evaluate(()=>answer(('第一条完整回答。\n\n').repeat(70)));await ui.locator('#ai-send').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#host').shadowRoot.getElementById('ai-send').disabled);
  await page.evaluate(()=>document.querySelector('#host').shadowRoot.dispatchEvent(new Event('zy-account-state')));await page.waitForFunction(()=>cloud.some(c=>c.body.history.some(t=>t.role==='assistant')));
  assert.equal(await page.evaluate(()=>cloud.at(-1).opts.identity), 'https://gateway.test|id:alice');
  assert.ok(await log.evaluate(e=>e.scrollTop<25),'first answer never scrolls beyond its question');
  // Read an older area, then ask again: jump only to that new question.
  await log.evaluate(e=>e.scrollTop=0);await ui.locator('#ai-question').fill('这是第二个问题');await ui.locator('#ai-send').click();
  await page.waitForFunction(()=>calls.length===2);
  const newQuestion=ui.locator('.ai-message[data-role=user]').last();
  const pinned=await log.evaluate(e=>e.scrollTop);assert.ok(pinned>1000,'sending from old content reaches the new question');
  let align=await newQuestion.evaluate(el=>{const log=el.parentElement;return el.getBoundingClientRect().top-log.getBoundingClientRect().top-parseFloat(getComputedStyle(log).paddingTop);});assert.ok(Math.abs(align)<3,'new question is aligned at the reading start');
  await page.evaluate(()=>stream(('这部分回答由读者自己滚动。\n\n').repeat(60)));await page.waitForTimeout(140);
  assert.ok(Math.abs(await log.evaluate(e=>e.scrollTop)-pinned)<3,'streaming never follows below the question');
  await page.evaluate(()=>answer(('这部分回答由读者自己滚动。\n\n').repeat(60)));await page.waitForFunction(()=>!document.querySelector('#host').shadowRoot.getElementById('ai-send').disabled);
  // A changed preference during a held catalog fetch is used on the first send.
  await page.evaluate(()=>{promptGate=true;ai.refreshAccess();});await page.waitForFunction(()=>!!window.releasePrompt);
  await page.evaluate(()=>{saved['ai-learning-settings-v1'].mode='exam';ai.send('第一次截图问题',{image:document.createElement('canvas').toDataURL()});});
  await page.evaluate(()=>{promptGate=false;releasePrompt();});await page.waitForFunction(()=>calls.length===3);
  assert.match(await page.evaluate(()=>calls[2].input[0].content),/EXAM_LATEST/);assert.equal(await mode.inputValue(),'exam');
  await page.evaluate(()=>answer('新的截图解释'));await page.waitForFunction(()=>!document.querySelector('#host').shadowRoot.getElementById('ai-send').disabled);
  await ui.locator('#ai-close').click();assert.equal(await ui.locator('#ai-resume').isVisible(),false,'classroom omits the separate resume bubble');
  await ui.locator('#compact-launcher').waitFor({state:'visible'});assert.ok((await ui.locator('#compact-launcher').boundingBox()).x>=0);
  // Failed automatic sync keeps a visible retry, then saves the latest content.
  await page.waitForTimeout(550);await page.evaluate(()=>{failCloud=true;ai.open();ai.send('自动同步失败测试');});await page.waitForFunction(()=>calls.length===4);await page.evaluate(()=>answer('失败后仍保留的完整答案'));
  await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.getElementById('ai-cloud-save').textContent==='重试同步');
  await page.evaluate(()=>failCloud=false);await ui.locator('#ai-cloud-save').click();await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.getElementById('ai-cloud-save').textContent==='已自动同步');
  assert.match(await page.evaluate(()=>cloud.at(-1).body.history.at(-1).text),/失败后仍保留/);
  // Restoring unbound local history never uploads; an explicit new question claims it.
  await page.evaluate(()=>{ai.resetCourse();saved['ai-question-v1:legacy']={title:'旧本机问题',history:[{role:'user',text:'LEGACY_PRIVATE'},{role:'assistant',text:'旧答案'}]};saved['ai-question-index-v1']=[{id:'legacy',title:'旧本机问题',course:'旧课堂',source:'文字提问',updated:1}];});
  await ui.locator('#ai-questions-back').click();await ui.locator('.ai-question-record').getByText('旧本机问题',{exact:true}).click();
  await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>cloud.some(c=>c.body.history.some(t=>t.text.includes('LEGACY_PRIVATE')))),false,'restoring a legacy history does not silently bind it');
  await ui.locator('#ai-question').fill('对旧问题的新追问');await ui.locator('#ai-send').click();await page.waitForFunction(()=>calls.length===5);await page.evaluate(()=>answer('仍等待手动绑定'));
  await page.waitForFunction(()=>cloud.some(c=>c.body.history.some(t=>t.text.includes('LEGACY_PRIVATE'))));
  // An Alice-owned conversation remains local when logged in as Bob.
  const beforeBob=await page.evaluate(()=>cloud.length);
  await page.evaluate(()=>{account='bob-token';owner='https://gateway.test|id:bob';document.querySelector('#host').shadowRoot.dispatchEvent(new Event('zy-account-state'));ai.refreshAccess();ai.open();});
  await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>cloud.length),beforeBob,'account change cannot claim existing Alice conversation');assert.equal(await ui.locator('#ai-cloud-save').isDisabled(),true,'a bound history cannot be rebound by another account');
  await page.evaluate(()=>{ai.resetCourse();ai.send('BOB_NEW');});await page.waitForFunction(()=>calls.length===6);await page.evaluate(()=>answer('Bob的新答案'));
  await page.waitForFunction(()=>cloud.some(c=>c.opts.identity==='https://gateway.test|id:bob'));
  const bob=await page.evaluate(()=>cloud.filter(c=>c.opts.identity==='https://gateway.test|id:bob'));assert.ok(bob.every(c=>!JSON.stringify(c.body).includes('LEGACY_PRIVATE')));
  // Login can allow AI before /me identifies the stable owner. Only a new explicit send may claim it later.
  await page.evaluate(()=>{ai.resetCourse();owner='';document.querySelector('#host').shadowRoot.dispatchEvent(new Event('zy-account-state'));ai.send('IDENTITY_PENDING');});
  await page.waitForFunction(()=>calls.length===7);await page.evaluate(()=>answer('身份确认前已生成的答案'));await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>cloud.some(c=>c.body.history.some(t=>t.text==='IDENTITY_PENDING'))),false);
  await page.evaluate(()=>{owner='https://gateway.test|id:bob';document.querySelector('#host').shadowRoot.dispatchEvent(new Event('zy-account-state'));});
  await page.waitForFunction(()=>cloud.some(c=>c.body.history.some(t=>t.text==='IDENTITY_PENDING')));
  // A failed save for a conversation that has already been closed persists its retry state.
  await page.evaluate(()=>{ai.resetCourse();cloudGate=true;failCloud=true;ai.send('BACKGROUND_FAILED');});await page.waitForFunction(()=>calls.length===8);await page.evaluate(()=>answer('后台失败的回答'));
  await page.waitForFunction(()=>!!window.releaseCloud);const failedId=await page.evaluate(()=>saved['ai-question-index-v1'][0].id);
  await page.evaluate(()=>{ai.resetCourse();cloudGate=false;releaseCloud();});await page.waitForFunction(id=>saved['ai-question-v1:'+id]?.cloudSync==='failed',failedId);
  assert.equal(await page.evaluate(id=>saved['ai-question-index-v1'].find(r=>r.id===id).cloudSync,failedId),'failed');
  await ui.locator('#ai-questions-back').click();await ui.locator('.ai-question-record').filter({hasText:'BACKGROUND_FAILED'}).click();await page.waitForFunction(()=>document.querySelector('#host').shadowRoot.getElementById('ai-cloud-save').textContent==='重试同步');
  await page.evaluate(()=>failCloud=false);await ui.locator('#ai-cloud-save').click();await page.waitForFunction(id=>saved['ai-question-v1:'+id].cloudSync==='saved',failedId);
  await page.evaluate(()=>ai.destroy());assert.deepEqual(errors,[]);
  console.log('PASS: first-use prompt refresh/race, question-only scroll, classroom collapsed entry, automatic cloud sync/retry, legacy restore privacy, explicit continuation and account isolation.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
