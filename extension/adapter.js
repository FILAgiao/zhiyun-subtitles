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
  if(m.type==='error'||m.type==='abort')finish(m.type);
 });
 port.postMessage({url:o.url,method:o.method||'GET',headers:o.headers||{},data:o.data,timeout:o.timeout});
 return {abort};
}
async function startExtension(run){
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
  if(m.type==='zy-open'){const panel=shadow.getElementById('panel');if(panel)panel.hidden=false;const compact=shadow.getElementById('compact');if(compact)compact.hidden=true;shadow.getElementById('web-settings-open')?.click();shadow.getElementById('account-open')?.click();}
  if(m.type==='zy-ask'&&typeof m.text==='string'&&m.text.trim()){
   const panel=shadow.getElementById('ai-learning'),question=shadow.getElementById('ai-question');if(!panel||!question)return;panel.hidden=false;question.value='请解释以下选中文字：\n'+m.text.slice(0,4000);question.focus();shadow.getElementById('ai-compose')?.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  }
 });
 run(extensionRequest,GM_getValue,GM_setValue,GM_deleteValue,GM_registerMenuCommand);
}
