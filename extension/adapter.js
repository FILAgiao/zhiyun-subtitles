'use strict';
function extensionRequest(o){
 const port=chrome.runtime.connect({name:'zy-request'}),chunks=[];let done=false,status=0,responseHeaders='',mime='',raw='',decoder=new TextDecoder();
 const finish=(kind,result={})=>{if(done)return;done=true;clearTimeout(timer);o['on'+kind]?.(result);try{port.disconnect();}catch(_){}};
 const abort=()=>{if(done)return;try{port.postMessage({abort:true});}catch(_){}finish('abort');};
 const timer=setTimeout(()=>{if(done)return;try{port.postMessage({abort:true});}catch(_){}finish('timeout');},Math.min(120000,Math.max(1000,Number(o.timeout)||90000)));
 port.onDisconnect.addListener(()=>{if(!done)finish('error');});
 port.onMessage.addListener(m=>{
  if(done)return;
  if(m.type==='start'){status=m.status;responseHeaders=m.responseHeaders;mime=m.mime;o.onloadstart?.({status,responseHeaders});}
  if(m.type==='chunk'){
   const bytes=Uint8Array.from(atob(m.data),c=>c.charCodeAt(0));chunks.push(bytes);
   if(!['blob','arraybuffer'].includes(o.responseType))raw+=decoder.decode(bytes,{stream:true});
   o.onprogress?.({status,responseHeaders,responseText:raw,loaded:m.loaded,total:m.total,lengthComputable:m.total>0});
  }
  if(m.type==='done'){
   raw+=decoder.decode();let response=raw;
   if(o.responseType==='blob')response=new Blob(chunks,{type:mime});
   if(o.responseType==='arraybuffer')response=new Blob(chunks).arrayBuffer();
   if(response instanceof Promise)response.then(value=>finish('load',{status,responseHeaders,response:value,responseText:raw}));
   else finish('load',{status,responseHeaders,response,responseText:raw});
  }
  if(m.type==='error'||m.type==='abort'||m.type==='timeout')finish(m.type);
 });
 port.postMessage({url:o.url,method:o.method||'GET',headers:o.headers||{},data:o.data,timeout:o.timeout});
 return {abort};
}
function captureExtensionTab(signal){
 return new Promise((resolve,reject)=>{
  let finished=false;
  const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>finish(new DOMException('Cancelled','AbortError'));
  const timer=setTimeout(()=>finish(Error('原生截图超时，请重试。')),6000);
  if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  try{chrome.runtime.sendMessage({type:'zy-capture-visible'},response=>{
   const error=chrome.runtime.lastError;
   if(error)finish(Error('扩展截图不可用，请重新加载扩展。'));
   else if(!response?.ok)finish(Error(response?.error||'原生截图不可用。'));
   else if(typeof response.data!=='string'||!response.data.startsWith('data:image/png;base64,'))finish(Error('原生截图未返回图片。'));
   else finish(null,response.data);
  });}catch(e){finish(e);}
 });
}
async function startExtension(run){
 // All-sites host access removes Chromium's activeTab gate. Keep each capture
 // behind one real screenshot action in this isolated content-script world.
 const screenshotButtons=new Set(['web-page-ask','ai-capture','ai-screenshot','ai-capture-retry']);
 let activation=null,middle=null,generation=0;
 const available=()=>window.top===window&&document.visibilityState==='visible';
 const focused=()=>available()&&document.hasFocus();
 const modified=event=>event.altKey||event.ctrlKey||event.metaKey||event.shiftKey;
 const assistantHost=()=>{const host=document.getElementById('zy-subtitle-host');return host?.isConnected&&host.shadowRoot?.getElementById('ai-learning')?host:null;};
 function elementVisible(element){
  if(!element?.isConnected||element.hidden||element.disabled)return false;
  const box=element.getBoundingClientRect();if(!box.width||!box.height||box.right<=0||box.bottom<=0||box.left>=innerWidth||box.top>=innerHeight)return false;
  for(let node=element;node&&node!==document;node=node.parentElement||node.getRootNode?.().host){
   if(node.hidden)return false;const css=getComputedStyle(node);if(css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse')return false;
  }
  return true;
 }
 function authorize(runtime=false){
  // A browser toolbar/command invocation may briefly focus browser chrome.
  // Runtime requests are extension-owned; the background still checks active tab.
  if(runtime?!available():!focused())return;
  activation={expiresAt:Date.now()+2500,url:location.href,generation,runtime};
 }
 function revoke(){activation=null;middle=null;generation++;}
 function gestureError(code,message){const error=new Error(message);error.code=code;return error;}
 globalThis.ZYNativeCapture={capture:async signal=>{
  const grant=activation;activation=null;
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  if(!grant||grant.expiresAt<Date.now()||grant.url!==location.href||grant.generation!==generation)throw gestureError('BRIDGE_NO_GESTURE','请用鼠标中键拖框，或亲自点击助手的截图按钮后重试。');
  if(!available())throw gestureError('BRIDGE_NOT_ACTIVE','请回到要截图的页面再操作。');
  const data=await captureExtensionTab(signal);
  if(grant.generation!==generation||grant.url!==location.href||!available())throw gestureError('BRIDGE_NOT_ACTIVE','截图期间页面已切换，请回到页面重新截图。');
  return data;
 }};
 document.addEventListener('mousedown',event=>{
  middle=null;
  if(!event.isTrusted||event.button!==1||modified(event)||!focused()||!assistantHost())return;
  const target=event.composedPath()[0];if(target?.closest?.('a,input,textarea,select,[contenteditable],#ai-crop'))return;
  middle={began:Date.now(),url:location.href};
 },true);
 document.addEventListener('mouseup',event=>{
  if(event.button!==1)return;const candidate=middle;middle=null;
  if(!candidate||!event.isTrusted||modified(event)||candidate.url!==location.href||Date.now()-candidate.began>60000)return;
  const crop=assistantHost()?.shadowRoot?.getElementById('ai-crop');
  if(!crop||crop.getAttribute('aria-label')!=='拖框截图'||!elementVisible(crop))return;
  authorize();
 },true);
 document.addEventListener('click',event=>{
  if(!event.isTrusted||event.button!==0||modified(event)||!focused())return;
  const host=assistantHost(),button=event.composedPath().find(node=>node?.tagName==='BUTTON'&&screenshotButtons.has(node.id));
  if(!host||!button||button.getRootNode()!==host.shadowRoot||!elementVisible(button))return;
  authorize();
 },true);
 // Child-frame focus also emits window.blur; it does not invalidate a trusted
 // screenshot action. The background checks the actual browser window and tab.
 // Hidden/navigated pages still invalidate even if they become visible again.
 window.addEventListener('pagehide',revoke);document.addEventListener('visibilitychange',()=>{if(!available())revoke();});
 globalThis.ZY_CLIENT_TYPE='chrome-extension';
 const saved=await chrome.storage.local.get(null);let pending=Promise.resolve();
 const GM_getValue=(key,fallback)=>Object.hasOwn(saved,key)?saved[key]:fallback;
 const persist=fn=>{pending=pending.then(fn).catch(()=>{console.warn('上课爽：本地设置未保存，请检查浏览器存储空间。');});};
 const GM_setValue=(key,value)=>{saved[key]=value;persist(()=>chrome.storage.local.set({[key]:value}));};
 const GM_deleteValue=key=>{delete saved[key];persist(()=>chrome.storage.local.remove(key));};
 const GM_registerMenuCommand=()=>{};
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local')for(const [key,value] of Object.entries(changes)){if(Object.hasOwn(value,'newValue'))saved[key]=value.newValue;else delete saved[key];}});
 chrome.runtime.onMessage.addListener((m,sender)=>{
  if(sender.id!==chrome.runtime.id)return;const shadow=document.getElementById('zy-subtitle-host')?.shadowRoot;if(!shadow)return;
  if(m.type==='zy-capture-page'){const button=shadow.getElementById('web-page-ask')||shadow.getElementById('ai-screenshot');if(button){authorize(true);button.click();}}
  if(m.type==='zy-open'){const panel=shadow.getElementById('panel');if(panel)panel.hidden=false;const compact=shadow.getElementById('compact');if(compact)compact.hidden=true;shadow.getElementById('web-settings-open')?.click();shadow.getElementById('account-open')?.click();}
  if(m.type==='zy-ask'&&typeof m.text==='string'&&m.text.trim()){
   const panel=shadow.getElementById('ai-learning'),question=shadow.getElementById('ai-question');if(!panel||!question)return;question.value='请解释以下选中文字：\n'+m.text.slice(0,4000);shadow.getElementById('ai-compose')?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  }
 });
 run(extensionRequest,GM_getValue,GM_setValue,GM_deleteValue,GM_registerMenuCommand);
}
