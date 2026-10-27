/* Paid translation transport: serialize submissions and retain a lease after UI cancellation. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZYTranslationRequest=api;})(globalThis,function(){
'use strict';
function failure(response){
 let body={};try{const parsed=JSON.parse(response.responseText);if(parsed&&typeof parsed==='object')body=parsed;}catch(_){}
 const detail=typeof body.error==='string'?body.error:body.error?.message||'';
 const supplied=body.error_code||body.error?.code;
 const status=Number(response.status)||0;
 const legacy={'本月额度已用完':'quota_exhausted','请等待当前请求完成':'concurrency_limit','请求过于频繁，请稍后再试':'rate_limit'};
 const code=status===429?legacy[detail]||(['quota_exhausted','concurrency_limit','rate_limit'].includes(supplied)?supplied:'unclassified_limit'):status===401?'authentication_required':status===403?'permission_denied':status===503&&supplied==='server_updating'?'server_updating':'translation_failed';
 const messages={quota_exhausted:'本月调用额度已用完，请查看账号额度。',concurrency_limit:'当前请求仍在处理，正在等待空闲名额。',rate_limit:'请求过于频繁，正在等待服务恢复。',server_updating:'翻译服务正在更新，本次请求尚未提交，正在等待服务恢复。',unclassified_limit:'翻译服务暂时限制请求，已暂停；请稍后重试。',authentication_required:'登录已失效，请重新登录账号。',permission_denied:'当前账号没有翻译所需的模型权限，请查看账号权限。'};
 const error=new Error(messages[code]||`翻译服务请求失败（HTTP ${status}），已暂停；请稍后重试。`);
 error.code=code;error.status=status;error.safeToRetry=code==='concurrency_limit'||code==='rate_limit'||code==='server_updating';
 const header=String(response.responseHeaders||'').match(/^retry-after:\s*(.+)$/im)?.[1]?.trim();
 const seconds=header&&/^\d+(?:\.\d+)?$/.test(header)?Number(header):0;
 error.retryAfterMs=seconds>0?Math.min(120000,Math.max(1000,seconds*1000)):(code==='rate_limit'?60000:5000);
 return error;
}
function create(send,parseResult,{now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const queue=[],cache=new Map();let active=null,timer=null,blockedUntil=0;
 function uncertain(){const error=new Error('翻译请求结果尚未确认，已暂停；请稍后点击重试，避免重复提交。');error.code='result_unknown';error.uncertain=true;return error;}
 function pump(){
  if(active||!queue.length)return;
  if(blockedUntil>now()){if(timer===null)timer=setTimer(()=>{timer=null;pump();},blockedUntil-now());return;}
  const item=queue.shift();
  if(item.key&&cache.has(item.key)){item.resolve(cache.get(item.key));pump();return;}
  active=item;let released=false;
  function finish(error,value){
   if(released)return;released=true;
   if(error?.uncertain)blockedUntil=Math.max(blockedUntil,now()+30000);
   if(!error&&item.key){
    // Only validated paid completions may be reused by an explicit retry.
    let reusable=true;try{if(item.cacheResult)reusable=item.cacheResult(value)===true;}catch(_){reusable=false;}
    if(reusable){cache.set(item.key,value);if(cache.size>128)cache.delete(cache.keys().next().value);}
   }
   active=null;if(!item.cancelled)(error?item.reject(error):item.resolve(value));
   pump();
  }
  try{send({...item.options,timeout:105000,
   onload:response=>{
    if(Number(response.status)<200||Number(response.status)>=300){finish(failure(response));return;}
    try{finish(null,parseResult(JSON.parse(response.responseText)));}catch(_){finish(Object.assign(new Error('翻译服务未返回完整译文，可重试此条字幕。'),{code:'translation_output_invalid',safeToRetry:false}));}
   },
   onerror:()=>finish(uncertain()),ontimeout:()=>finish(uncertain()),onabort:()=>finish(uncertain())
  });}catch(_){finish(uncertain());}
 }
 return options=>{
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const {cacheKey,cacheScope,cacheResult,onWait,...transportOptions}=options;
  const key=typeof cacheKey==='string'?JSON.stringify([cacheScope||'',cacheKey]):'';
  const item={options:transportOptions,key,cacheResult:typeof cacheResult==='function'?cacheResult:null,resolve,reject,cancelled:false};queue.push(item);
  if(active||blockedUntil>now())onWait?.();
  pump();
  return{promise,abort(){
   if(item.cancelled)return;item.cancelled=true;reject(new Error('已停止翻译'));
   const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);
   if(!queue.length&&timer!==null){clearTimer(timer);timer=null;}
   // Submitted work may already be billed. Observe completion before reusing its slot.
  }};
 };
}
return{failure,create};
});
