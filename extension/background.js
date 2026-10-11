'use strict';
const GATEWAY='https://47.77.182.216.sslip.io/gateway';
function allowedRequest(o){
 const u=new URL(o.url),method=(o.method||'GET').toUpperCase();
 if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Request denied');
 const gateway=u.origin===new URL(GATEWAY).origin&&/^\/gateway\/v1\/(?:auth\/(?:login|logout)|me|activity|history|ark\/responses|speech\/(?:submit|query)|learning\/jobs\/(?:create|poll|cancel))$/.test(u.pathname)&&!u.search;
 const school=(u.hostname==='cmc.zju.edu.cn'||u.hostname.endsWith('.cmc.zju.edu.cn'))&&method==='GET';
 if(!gateway&&!school||!['GET','POST'].includes(method)||school&&o.data)throw Error('Request denied');
 if(o.data!==undefined&&(typeof o.data!=='string'||o.data.length>7000000))throw Error('Request too large');
 const headers={};for(const [k,v] of Object.entries(o.headers||{})){
  const lower=k.toLowerCase();if(gateway&&['authorization','content-type','x-app-id','x-api-request-id','x-client-type'].includes(lower)||school&&['range','if-range','accept'].includes(lower))headers[k]=String(v);
 }
 if(gateway){headers['X-App-Id']='zhiyun-subtitles';headers['X-Client-Type']='chrome-extension';}
 return {url:u.href,method,headers,body:method==='POST'?o.data:undefined,credentials:school?'include':'omit',redirect:'error',cache:'no-store'};
}
function toBase64(bytes){let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
if(typeof chrome!=='undefined'){
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
 chrome.action.onClicked.addListener(async tab=>{if(!tab.id||!/^https?:\/\//.test(tab.url||''))return;try{await chrome.tabs.sendMessage(tab.id,{type:'zy-open'});}catch(_){}});
 chrome.runtime.onInstalled.addListener(()=>chrome.contextMenus.create({id:'zy-ask',title:'问上课爽',contexts:['selection'],documentUrlPatterns:['http://*/*','https://*/*']}));
 chrome.contextMenus.onClicked.addListener(async(info,tab)=>{if(info.menuItemId==='zy-ask'&&tab?.id)try{await chrome.tabs.sendMessage(tab.id,{type:'zy-ask',text:String(info.selectionText||'').slice(0,4000)});}catch(_){}});
}
if(typeof module!=='undefined')module.exports={allowedRequest};
