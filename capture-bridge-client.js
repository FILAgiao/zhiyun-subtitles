/* Native screenshot client for the temporary userscript test bridge.
 * The shipping extension calls its own isolated adapter directly. */
(function(root){
'use strict';
function create(win){
 const doc=win.document,protocolVersion=1,requestEvent='zy-userscript-capture-request',responseEvent='zy-userscript-capture-response';
 const pending=new Map();let activation=null;
 const id=()=>win.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
 const error=code=>{const messages={BRIDGE_NO_GESTURE:'请用中键拖框或点击截图按钮重试。',BRIDGE_NOT_ACTIVE:'请回到需要截图的标签页后重试。',BRIDGE_BUSY:'上一张截图还在处理中，请稍后重试。',NATIVE_CAPTURE_FAILED:'原生截图失败，请检查截图扩展的网站访问权限后重试。'};const e=new Error(messages[code]||'截图测试扩展未连接，请加载扩展并刷新页面。');e.code=code;return e;};
 const send=message=>doc.dispatchEvent(new win.CustomEvent(requestEvent,{detail:JSON.stringify({protocolVersion,...message})}));
 function receive(event){
  if(typeof event.detail!=='string'||event.detail.length>64001000)return;
  let m;try{m=JSON.parse(event.detail);}catch(_){return;}
  if(m?.protocolVersion!==protocolVersion)return;
  if(m.type==='activation'&&typeof m.activationId==='string'&&Number.isFinite(m.expiresAt)&&m.expiresAt>Date.now()&&m.expiresAt<=Date.now()+3000){activation={id:m.activationId,expiresAt:m.expiresAt};return;}
  const job=pending.get(m.requestId);if(!job||job.type!==m.type||job.activationId&&job.activationId!==m.activationId)return;
  if(m.type==='hello'){job.finish(null,m.ok===true&&m.available===true);return;}
  if(!m.ok){job.finish(error(m.errorCode));return;}
  if(typeof m.data!=='string'||!m.data.startsWith('data:image/png;base64,')||m.data.length>64000000){job.finish(error('NATIVE_CAPTURE_FAILED'));return;}
  job.finish(null,m.data);
 }
 doc.addEventListener(responseEvent,receive,true);
 function exchange(type,signal,grant){return new Promise((resolve,reject)=>{
  const requestId=id(),job={type,activationId:grant?.id};let timer;
  const cancel=()=>{if(type==='capture')send({type:'cancel',requestId,activationId:grant.id});};
  job.finish=(e,value)=>{if(pending.get(requestId)!==job)return;pending.delete(requestId);win.clearTimeout(timer);signal?.removeEventListener('abort',abort);e?reject(e):resolve(value);};
  const abort=()=>{cancel();job.finish(new win.DOMException('Cancelled','AbortError'));};
  pending.set(requestId,job);if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
  timer=win.setTimeout(()=>{cancel();job.finish(type==='hello'?null:error('NATIVE_CAPTURE_FAILED'),false);},type==='hello'?250:6000);
  send({type,requestId,...(grant?{activationId:grant.id}:{})});
 });}
 function revoke(){activation=null;for(const job of pending.values())if(job.type==='capture')job.finish(error('BRIDGE_NOT_ACTIVE'));}
 win.addEventListener('blur',revoke);win.addEventListener('pagehide',revoke);doc.addEventListener('visibilitychange',()=>{if(doc.visibilityState!=='visible')revoke();});
 return {available:signal=>exchange('hello',signal),capture:signal=>{if(signal?.aborted)return Promise.reject(new win.DOMException('Cancelled','AbortError'));const grant=activation;activation=null;if(!grant||grant.expiresAt<Date.now())return Promise.reject(error('BRIDGE_NO_GESTURE'));return exchange('capture',signal,grant);}};
}
if(typeof module==='object'&&module.exports)module.exports={create};else root.ZYCaptureBridge=create(root);
})(globalThis);
