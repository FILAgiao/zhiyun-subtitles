'use strict';
const RELEASE_CHANNEL='unpacked';
const GATEWAY='https://47.77.182.216.sslip.io/gateway';
// Persistent host access is for static tab pixels; the public network bridge remains pinned.
function allowedRequest(o,runtime=globalThis.chrome?.runtime){
 const u=new URL(o.url),method=(o.method||'GET').toUpperCase();
 if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Request denied');
 const gateway=u.origin===new URL(GATEWAY).origin&&/^\/gateway\/v1\/(?:auth\/(?:login|logout)|me|activity|history|ark\/responses|speech\/(?:submit|query)|learning\/jobs\/(?:create|poll|cancel))$/.test(u.pathname)&&!u.search;
 const school=(u.hostname==='cmc.zju.edu.cn'||u.hostname.endsWith('.cmc.zju.edu.cn'))&&method==='GET';
 if(!gateway&&!school||!['GET','POST'].includes(method)||school&&o.data)throw Error('Request denied');
 if(o.data!==undefined&&(typeof o.data!=='string'||o.data.length>7000000))throw Error('Request too large');
 const headers={};for(const [k,v] of Object.entries(o.headers||{})){
  const lower=k.toLowerCase();if(gateway&&['authorization','content-type','x-app-id','x-api-request-id','x-client-type'].includes(lower)||school&&['range','if-range','accept'].includes(lower))headers[k]=String(v);
 }
 if(gateway){headers['X-App-Id']='zhiyun-subtitles';headers['X-Client-Type']='chrome-extension';headers['X-Client-Channel']=RELEASE_CHANNEL;const version=runtime?.getManifest?.()?.version||'';if(version)headers['X-Client-Version']=version;}
 return {url:u.href,method,headers,body:method==='POST'?o.data:undefined,credentials:school?'include':'omit',redirect:'error',cache:'no-store'};
}
function toBase64(bytes){let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
// Serialize captures per window to stay within Chromium's two-captures/second limit.
const captureQueues=new Map(),captureTimes=new Map();
async function captureSenderTab(api,sender){
 if(sender?.id!==api.runtime.id||sender.frameId!==0||!Number.isInteger(sender.tab?.id)||!Number.isInteger(sender.tab?.windowId)||!/^https?:\/\//.test(sender.url||''))throw Error('Screenshot request denied');
 const id=sender.tab.id,windowId=sender.tab.windowId,origin=new URL(sender.url).origin;
 const previous=captureQueues.get(windowId)||Promise.resolve();
 const pending=previous.catch(()=>{}).then(async()=>{
  const delay=550-(Date.now()-(captureTimes.get(windowId)||0));if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
  const tab=await api.tabs.get(id);if(!tab.active||tab.windowId!==windowId||!/^https?:\/\//.test(tab.url||''))throw Error('请回到要截图的标签页后重试。');
  if(new URL(tab.url).origin!==origin)throw Error('页面已跳转，请在当前页面重新截图。');
  captureTimes.set(windowId,Date.now());
  const data=await api.tabs.captureVisibleTab(windowId,{format:'png'});
  const current=await api.tabs.get(id);if(!current.active||current.windowId!==windowId||current.url!==tab.url)throw Error('截图期间切换了标签页，请重试。');
  if(typeof data!=='string'||!data.startsWith('data:image/png;base64,'))throw Error('浏览器截图未返回图片。');
  return data;
 });
 captureQueues.set(windowId,pending);
 try{return await pending;}finally{if(captureQueues.get(windowId)===pending)captureQueues.delete(windowId);}
}
if(typeof chrome!=='undefined'){
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='zy-capture-visible')return;
  captureSenderTab(chrome,sender).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:error.message||'浏览器原生截图暂不可用。'}));return true;
 });
 chrome.runtime.onConnect.addListener(port=>{
  if(port.name!=='zy-request'||port.sender?.id!==chrome.runtime.id||!/^https?:\/\//.test(port.sender?.url||'')){port.disconnect();return;}
  const controller=new AbortController();let started=false,timer;
  const post=message=>{try{port.postMessage(message);}catch(_){controller.abort();}};
  port.onDisconnect.addListener(()=>{clearTimeout(timer);controller.abort();});
  port.onMessage.addListener(async o=>{
   if(o.abort){controller.abort();return;}if(started)return;started=true;
   try{
    const init=allowedRequest(o);timer=setTimeout(()=>controller.abort(),Math.min(120000,Math.max(1000,Number(o.timeout)||90000)));
    const response=await fetch(init.url,{...init,signal:controller.signal});
    const headers=[...response.headers].map(([k,v])=>k+': '+v).join('\r\n'),total=Number(response.headers.get('content-length'))||0;
    post({type:'start',status:response.status,responseHeaders:headers,total,mime:response.headers.get('content-type')||'application/octet-stream'});
    const reader=response.body?.getReader();let loaded=0;
    if(reader)while(true){const {done,value}=await reader.read();if(done)break;loaded+=value.length;if(loaded>64000000)throw Error('Response too large');post({type:'chunk',data:toBase64(value),loaded,total});}
    post({type:'done',status:response.status,responseHeaders:headers});
   }catch(e){post({type:controller.signal.aborted?'abort':'error'});}finally{clearTimeout(timer);}
  });
 });
 chrome.action.onClicked.addListener(async tab=>{if(!tab.id||!/^https?:\/\//.test(tab.url||''))return;try{await chrome.tabs.sendMessage(tab.id,{type:'zy-capture-page'});}catch(_){}});
 chrome.commands.onCommand.addListener(async command=>{if(command!=='zy-capture-page')return;const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(tab?.id&&/^https?:\/\//.test(tab.url||''))try{await chrome.tabs.sendMessage(tab.id,{type:'zy-capture-page'});}catch(_){}});
 chrome.runtime.onInstalled.addListener(()=>chrome.contextMenus.create({id:'zy-ask',title:'问上课爽',contexts:['selection'],documentUrlPatterns:['http://*/*','https://*/*']}));
 chrome.contextMenus.onClicked.addListener(async(info,tab)=>{if(info.menuItemId==='zy-ask'&&tab?.id)try{await chrome.tabs.sendMessage(tab.id,{type:'zy-ask',text:String(info.selectionText||'').slice(0,4000)});}catch(_){}});
}
if(typeof module!=='undefined')module.exports={allowedRequest,captureSenderTab};
