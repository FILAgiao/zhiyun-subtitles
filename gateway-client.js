/* Account and transport adapter; inlined into the installable userscript. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZYGateway=api;})(globalThis,function(){
'use strict';
const DEFAULT_ORIGIN='';
const KEY='gateway-account-v1',APP='zhiyun-subtitles';
function baseURL(value){const u=new URL(String(value).trim());if(u.username||u.password||u.search||u.hash||!['/','/gateway','/gateway/'].includes(u.pathname)||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw Error('请填写 HTTPS 服务地址；本机调试可使用 http://127.0.0.1:8080');return u.origin+(u.pathname==='/'?'':'/gateway');}
function create({request,getValue,setValue}){
 let refreshUI=null,changeListener=null;
 const account=()=>{const saved=getValue(KEY,{})||{};return{...saved,url:DEFAULT_ORIGIN||saved.url||''};};
 const configured=()=>!!account().url;
 const credential=()=>configured()?(account().token||''):'';
 function incremental(options,a,headers){
  let stopped=false,current=null,timer=null,networkTimer=null,jobId='',raw='',lastText='';
  const emit=event=>{if(stopped)return;raw+='data: '+JSON.stringify(event)+'\n\n';options.onprogress?.({status:200,responseText:raw});};
  const fail=message=>{if(stopped)return;emit({type:'error',message});stopped=true;clearTimeout(timer);clearTimeout(networkTimer);};
  const json=(path,body,next)=>{
   if(stopped)return;let delivered=false;
   const done=()=>{if(delivered||stopped)return false;delivered=true;clearTimeout(networkTimer);return true;};
   networkTimer=setTimeout(()=>{if(!done())return;const pending=current;fail('无法读取 AI 增量回复，网络请求超过 15 秒。');pending?.abort?.();},15000);
   try{current=request({method:'POST',url:baseURL(a.url)+path,headers,anonymous:true,timeout:15000,data:JSON.stringify(body),
    onload:r=>{if(!done())return;let result;try{result=JSON.parse(r.responseText);}catch(_){fail('AI 服务响应格式异常，请稍后重试。');return;}
     if(r.status<200||r.status>=300){if(r.status===401&&a.token===credential()){setValue(KEY,{url:a.url,token:''});refreshUI?.();changeListener?.();}fail(r.status===401?'登录已失效，请重新登录。':typeof result.error==='string'?result.error:'AI 服务请求失败（HTTP '+r.status+'）。');return;}
     next(result);},onerror:()=>{if(done())fail('无法连接 AI 服务，请检查网络后重试。');},ontimeout:()=>{if(done())fail('读取 AI 回复超时，请稍后重试。');},onabort:()=>{if(done())fail('AI 网络请求已中止。');}});
   }catch(_){if(done())fail('未能发出 AI 请求，请刷新页面后重试。');}
  };
  const poll=()=>json('/v1/learning/jobs/poll',{id:jobId},result=>{
   if(typeof result.text==='string'&&result.text.length>lastText.length){emit({type:'response.output_text.delta',delta:result.text.slice(lastText.length)});lastText=result.text;}
   if(result.state==='complete'){emit({type:'response.completed',response:result.response});if(!stopped)options.onload?.({status:200,responseText:raw});stopped=true;clearTimeout(timer);return;}
   if(result.state==='error'||result.state==='cancelled'){fail(result.error||'已停止本次回答');return;}
   timer=setTimeout(poll,500);
  });
  let body;try{body=JSON.parse(options.data);}catch(_){queueMicrotask(()=>fail('问题格式无效。'));return{abort(){stopped=true;}};}
  json('/v1/learning/jobs/create',body,result=>{
   if(typeof result.id!=='string'){fail('AI 回答任务未创建，请稍后重试。');return;}jobId=result.id;options.onloadstart?.({status:200});emit({type:'response.in_progress'});poll();
  });
  return{abort(){if(stopped)return;stopped=true;clearTimeout(timer);clearTimeout(networkTimer);current?.abort?.();if(jobId)try{request({method:'POST',url:baseURL(a.url)+'/v1/learning/jobs/cancel',headers,anonymous:true,timeout:15000,data:JSON.stringify({id:jobId}),onload(){},onerror(){}});}catch(_){}options.onabort?.();}};
 }
 function transport(options){
  const a=account();let path='';
  if(options.url==='https://ark.cn-beijing.volces.com/api/v3/responses')path='/v1/ark/responses';
  else if(/^https:\/\/openspeech\.bytedance\.com\/api\/v3\/auc\/bigmodel\/(submit|query)$/.test(options.url))path='/v1/speech/'+options.url.split('/').pop();
  if(!a.url||!path)return request(options);
  if(!a.token&&!path.startsWith('/v1/speech/')){queueMicrotask(()=>options.onload?.({status:401,responseText:'{}',responseHeaders:''}));return{abort(){}};}
  // Do not pass vendor credentials or arbitrary provider headers to the gateway.
  const headers={...(a.token?{Authorization:'Bearer '+a.token}:{}),'Content-Type':'application/json','X-App-Id':APP,'X-Client-Type':'userscript'};
  for(const [k,v] of Object.entries(options.headers||{}))if(k.toLowerCase()==='x-api-request-id')headers['X-Api-Request-Id']=v;
  if(path==='/v1/ark/responses'&&options.responseType==='stream')return incremental(options,a,headers);
  return request({...options,url:baseURL(a.url)+path,headers,anonymous:true,onload:r=>{if(r.status===401&&a.token&&a.token===credential()){setValue(KEY,{url:a.url,token:''});refreshUI?.();changeListener?.();}options.onload?.(r);}});
 }
 function call(path,body,token=account().token,url=account().url){return new Promise((resolve,reject)=>{
  request({method:body===undefined?'GET':'POST',url:baseURL(url)+path,anonymous:true,timeout:15000,headers:{'Content-Type':'application/json','X-App-Id':APP,'X-Client-Type':'userscript',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{data:JSON.stringify(body)}),onload:r=>{try{const data=JSON.parse(r.responseText);if(r.status<200||r.status>=300){if(r.status===401&&token&&token===credential()){setValue(KEY,{url:account().url,token:''});refreshUI?.();changeListener?.();}throw Error(data.error||'服务请求失败');}if(data.capabilities)setValue('gateway-capabilities-v1',data.capabilities);resolve(data);}catch(e){reject(e);}},onerror:()=>reject(Error('无法连接服务，请检查地址和域名授权')),ontimeout:()=>reject(Error('服务请求超时'))});
 });}
 async function login(url,email,password){url=baseURL(DEFAULT_ORIGIN||url);const data=await call('/v1/auth/login',{email,password},null,url);if(typeof data.token!=='string'||!data.token)throw Error('登录响应异常');setValue(KEY,{url,token:data.token});return data;}
 async function logout(){try{if(credential())await call('/v1/auth/logout',{});}finally{setValue(KEY,{url:account().url||'',token:''});}}
 function mount(shadow,onChange=()=>{}){
  changeListener=onChange;
  const target=shadow.getElementById('settings-connection');if(!target)return;
  const $=id=>shadow.getElementById(id),box=document.createElement('section');box.className='section';box.id='gateway-account';
  box.innerHTML='<div class="account-head"><span id="gateway-avatar" aria-hidden="true">☺</span><div><h4 id="gateway-name">欢迎使用上课爽</h4><p id="gateway-state">游客模式</p></div></div><p>游客可使用原文字幕、语音同步和本机缓存。登录后解锁 AI 对话、PPT 讲解、截图问答与中外翻译。</p><form id="gateway-login-form"><label>账号<input id="gateway-email" autocomplete="username" placeholder="用户名或邮箱" required></label><label>密码<input id="gateway-password" type="password" autocomplete="current-password" required></label><button class="primary" id="gateway-login" type="submit">登录</button><p>暂未开放自助注册。没有账号请联系管理员人工开通，之后将开放注册。</p></form><div id="gateway-member" hidden><button id="gateway-usage">查看额度</button><button id="gateway-logout">退出登录</button></div><div class="quota-heading"><strong>我的套餐额度</strong><button id="gateway-recharge" type="button">充值 / 开通</button></div><div id="gateway-quota" aria-label="剩余额度"></div><div id="gateway-recharge-note" hidden role="status"><strong>充值 / 开通账号</strong><p>请在抖音联系「侃侃你的」博主。</p><button id="gateway-recharge-close" type="button">我知道了</button></div><p id="gateway-status" role="status" aria-live="polite"></p>';
  const style=document.createElement('style');style.textContent='.account-head{display:flex;gap:14px;align-items:center;margin-bottom:16px}#gateway-avatar{display:grid;place-items:center;width:56px;height:56px;border-radius:50%;background:#dfebff;color:#215da1;font-size:24px}#gateway-login-form{display:grid;gap:12px;max-width:380px}#gateway-login-form label{display:grid;gap:6px}#gateway-login-form input{box-sizing:border-box;width:100%!important;max-width:none!important;padding:12px;border-radius:10px}.account-title{display:grid;grid-template-columns:auto auto;column-gap:6px;align-items:center}.account-title h3{font-size:16px}.account-title .subtitle{grid-column:1/-1}.account-title #account-entry{grid-column:2;grid-row:1}#account-entry{display:flex;align-items:center;gap:5px;margin-left:auto;padding:0;white-space:nowrap;color:#d7e7f8}#account-entry #account-guide{color:inherit;font-size:10px}#account-entry button{font-size:10px;border:0;padding:4px 6px;background:#ffffff18;color:inherit}#gateway-quota{display:grid;gap:14px;margin-top:20px}.quota-row{background:#f0f5fc;border:1px solid #e0e8f3;border-radius:14px;padding:16px}.quota-row strong{display:block;font-size:22px;color:#215da1}.quota-row progress{display:block;width:100%;height:10px;margin:12px 0;accent-color:#27855b}.quota-row small{color:#6c7f95}#account-entry p{margin:0;font-size:11px;flex:1}#account-entry button{white-space:nowrap}button[data-login-required=true]{background:#edf0f4!important;color:#7b8797!important;border-color:#d9e0e8!important;box-shadow:none!important}';style.textContent+=`#gateway-member{display:flex;gap:8px;flex-wrap:wrap}.quota-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:24px}.quota-heading strong{color:#304b68}.quota-heading button{font-size:12px;background:#edf4ff}#gateway-quota{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}.quota-row{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:16px 8px;background:#fff;min-width:0}.quota-row .quota-label{font-weight:600;font-size:12px;color:#435c76}.quota-row .quota-ring{display:grid;place-items:center;flex:none;width:100px;height:100px;border-radius:50%;background:conic-gradient(var(--quota-color) var(--quota-angle),#EEDCCD 0);position:relative}.quota-ring:before{content:'';position:absolute;inset:8px;border-radius:50%;background:#fff}.quota-ring strong{position:relative;display:grid;gap:2px;color:var(--quota-color);font-size:21px;line-height:1.2;font-variant-numeric:tabular-nums}.quota-ring strong span{font-size:10px;font-weight:400;color:#7a8b9e}.quota-row small{font-size:10px;line-height:1.6;overflow-wrap:anywhere}.quota-row[data-locked=true]{background:#f6f7f9}.quota-row[data-locked=true] .quota-ring:before{background:#f6f7f9}.quota-row .quota-action{font-size:11px;padding:5px 8px;margin-top:auto}#gateway-recharge-note{margin-top:12px;padding:16px;border:1px solid #d9e6f5;border-radius:12px;background:#edf4ff}#gateway-recharge-note p{margin:6px 0 12px}@media(max-width:420px){#gateway-quota{gap:6px}.quota-row{padding:12px 4px}.quota-row .quota-ring{width:78px;height:78px}.quota-ring strong{font-size:17px}.quota-row .quota-label{font-size:11px}}`;style.textContent+=(globalThis.ZYWarmTheme?.css||'');shadow.append(style);for(const child of target.children)child.hidden=true;target.prepend(box);
  const entry=document.createElement('div');entry.id='account-entry';entry.innerHTML='<p id="account-guide"></p><button id="account-open">去登录</button>';const heading=shadow.querySelector('#panel-head > div');if(heading){heading.classList.add('account-title');heading.append(entry);}else (shadow.getElementById('panel-head')||shadow.getElementById('panel-body')).append(entry);
  const openAccount=()=>{shadow.getElementById('settings-tab-connection').click();shadow.getElementById('settings-dialog').hidden=false;(credential()?$('gateway-usage'):$('gateway-email')).focus();};$('account-open').onclick=openAccount;shadow.addEventListener('click',e=>{const button=e.composedPath().find(n=>n?.dataset?.loginRequired==='true');if(button){e.preventDefault();e.stopImmediatePropagation();openAccount();}},true);
  let busy=false,profile='',usageData=null;
  $('gateway-recharge').onclick=()=>{$('gateway-recharge-note').hidden=false;$('gateway-recharge-close').focus();};
  $('gateway-recharge-close').onclick=()=>{$('gateway-recharge-note').hidden=true;$('gateway-recharge').focus();};
  const renderQuota=()=>{
   const signed=!!credential(),u=signed?usageData:null,quota=$('gateway-quota');quota.replaceChildren();
   for(const item of [
    {label:'语音字幕同步',color:'#2c9a83',unlimited:true,detail:'字幕时间同步 · 免费使用'},
    {label:'AI 问答与翻译',color:'#C45221',used:u?.requests,total:u?.request_limit,unit:'次',detail:'AI 问答、PPT 讲解与翻译共享'},
    {label:'语音识别',color:'#df9a36',used:u?.audio_seconds==null?null:Math.ceil(u.audio_seconds),total:u?.audio_limit,unit:'秒',detail:'自动语音校准使用识别额度'}
   ]){
    const locked=!signed&&!item.unlimited,limit=Number(item.total),spent=Number(item.used),known=item.total!=null&&item.used!=null&&Number.isFinite(limit)&&limit>=0&&Number.isFinite(spent)&&spent>=0,remaining=known?Math.max(0,limit-spent):0;
    const row=document.createElement('div');row.className='quota-row';row.dataset.locked=String(locked);row.style.setProperty('--quota-color',locked||(!known&&!item.unlimited)?'#a0adbc':item.color);row.style.setProperty('--quota-angle',(item.unlimited?360:known&&limit>0?Math.min(1,remaining/limit)*360:0)+'deg');
    const title=document.createElement('span');title.className='quota-label';title.textContent=item.label;
    const ring=document.createElement('div');ring.className='quota-ring';const value=document.createElement('strong'),caption=document.createElement('span');value.textContent=item.unlimited?'∞':locked?'—':known?remaining.toLocaleString():'—';caption.textContent=item.unlimited?'无限量':locked?'未登录':known?'剩余 '+item.unit:'待刷新';value.append(caption);ring.append(value);ring.setAttribute('role','img');ring.setAttribute('aria-label',item.label+'：'+(item.unlimited?'无限量':locked?'未登录':known?'剩余 '+remaining.toLocaleString()+' '+item.unit:'额度暂不可用'));
    const detail=document.createElement('small');detail.textContent=known?'已用 '+spent.toLocaleString()+' / '+limit.toLocaleString()+' '+item.unit:item.detail;row.append(title,ring,detail);
    if(!item.unlimited){const action=document.createElement('button');action.type='button';action.className='quota-action';action.textContent=locked?'登录查看':'充值额度';action.onclick=locked?()=>{$('gateway-email').focus();}:()=>$('gateway-recharge').click();row.append(action);}
    quota.append(row);
   }
  };
  const refresh=()=>{const signed=!!credential();if($('compact'))$('compact').textContent=signed?'🐥 上课爽':'🐥 上课爽 · 去登录';$('gateway-login-form').hidden=signed;$('gateway-member').hidden=!signed;$('gateway-name').textContent=signed?(profile||'我的学习账号'):'欢迎使用上课爽';$('gateway-state').textContent=signed?'已登录 · AI 功能已解锁':'游客模式 · AI 功能需登录';$('gateway-avatar').textContent=signed?(profile||'我').slice(0,1):'☺';$('account-guide').textContent=signed?'● 已登录':'○ 游客';$('account-open').textContent=signed?'账号':'登录';for(const id of ['ai-open','ai-capture','slide-explain','transcript-open','web-ask']){const b=$(id);if(b){b.dataset.loginRequired=String(!signed);b.title=signed?'':'登录后使用；点击查看账号';b.setAttribute('aria-disabled',String(!signed));}}if(!signed)usageData=null;renderQuota();const both=$('mode')?.querySelector('[value="both"]');if(both)both.textContent='中外对照';};refreshUI=refresh;
  const run=async(fn)=>{if(busy)return;busy=true;box.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){$('gateway-status').textContent=e.message;}finally{busy=false;box.querySelectorAll('button').forEach(b=>b.disabled=false);refresh();}};
  const usage=async()=>{const data=await call('/v1/me');profile=data.username||data.email||'我的学习账号';const u=data.usage;usageData=u; $('gateway-status').textContent=`${profile} · ${u.month}（UTC） · 调用 ${u.requests}/${u.request_limit} · Token ${u.total_tokens} · 音频 ${Math.ceil(u.audio_seconds)}/${u.audio_limit} 秒`;refresh();};
  $('gateway-login-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(!configured())throw Error('服务尚未配置，请联系管理员更新插件。');$('gateway-status').textContent='正在登录…';await login(account().url,$('gateway-email').value,$('gateway-password').value);$('gateway-password').value='';profile=$('gateway-email').value;$('gateway-status').textContent='登录成功，AI 功能已解锁';onChange();refresh();heartbeat();await usage();});};
  $('gateway-usage').onclick=()=>run(usage);$('gateway-logout').onclick=()=>run(async()=>{try{await logout();}finally{profile='';usageData=null;$('gateway-password').value='';$('gateway-status').textContent='已退出登录，语音同步和缓存仍可使用。';onChange();}});
  const heartbeat=()=>{if(credential()&&document.visibilityState!=='hidden')call('/v1/activity',{}).catch(()=>{});};setInterval(heartbeat,60000);document.addEventListener('visibilitychange',heartbeat);heartbeat();refresh();
  if(credential())usage().catch(()=>{});
 }

 return{transport,configured,credential,login,logout,call,mount,features:()=>({webSearch:!configured()||getValue('gateway-capabilities-v1',{}).web_search===true})};
}
return{create,baseURL};
});
