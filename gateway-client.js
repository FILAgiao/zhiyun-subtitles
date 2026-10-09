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
 function transport(options){
  const a=account();let path='';
  if(options.url==='https://ark.cn-beijing.volces.com/api/v3/responses')path='/v1/ark/responses';
  else if(/^https:\/\/openspeech\.bytedance\.com\/api\/v3\/auc\/bigmodel\/(submit|query)$/.test(options.url))path='/v1/speech/'+options.url.split('/').pop();
  if(!a.url||!path)return request(options);
  if(!a.token&&!path.startsWith('/v1/speech/')){queueMicrotask(()=>options.onload?.({status:401,responseText:'{}',responseHeaders:''}));return{abort(){}};}
  // Do not pass vendor credentials or arbitrary provider headers to the gateway.
  const headers={...(a.token?{Authorization:'Bearer '+a.token}:{}),'Content-Type':'application/json','X-App-Id':APP,'X-Client-Type':'userscript'};
  for(const [k,v] of Object.entries(options.headers||{}))if(k.toLowerCase()==='x-api-request-id')headers['X-Api-Request-Id']=v;
  return request({...options,url:baseURL(a.url)+path,headers,anonymous:true,onload:r=>{if(r.status===401&&a.token&&a.token===credential()){setValue(KEY,{url:a.url,token:''});refreshUI?.();changeListener?.();}options.onload?.(r);}});
 }
 function call(path,body,token=account().token,url=account().url){return new Promise((resolve,reject)=>{
  request({method:body===undefined?'GET':'POST',url:baseURL(url)+path,anonymous:true,timeout:15000,headers:{'Content-Type':'application/json','X-App-Id':APP,'X-Client-Type':'userscript',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{data:JSON.stringify(body)}),onload:r=>{try{const data=JSON.parse(r.responseText);if(r.status<200||r.status>=300){if(r.status===401&&token&&token===credential()){setValue(KEY,{url:account().url,token:''});refreshUI?.();changeListener?.();}throw Error(data.error||'服务请求失败');}resolve(data);}catch(e){reject(e);}},onerror:()=>reject(Error('无法连接服务，请检查地址和域名授权')),ontimeout:()=>reject(Error('服务请求超时'))});
 });}
 async function login(url,email,password){url=baseURL(DEFAULT_ORIGIN||url);const data=await call('/v1/auth/login',{email,password},null,url);if(typeof data.token!=='string'||!data.token)throw Error('登录响应异常');setValue(KEY,{url,token:data.token});return data;}
 async function logout(){try{if(credential())await call('/v1/auth/logout',{});}finally{setValue(KEY,{url:account().url||'',token:''});}}
 function mount(shadow,onChange=()=>{}){
  changeListener=onChange;
  const target=shadow.getElementById('settings-connection');if(!target)return;
  const $=id=>shadow.getElementById(id),box=document.createElement('section');box.className='section';box.id='gateway-account';
  box.innerHTML='<div class="account-head"><span id="gateway-avatar" aria-hidden="true">☺</span><div><h4 id="gateway-name">欢迎使用上课爽</h4><p id="gateway-state">游客模式</p></div></div><p>游客可使用原文字幕、语音同步和本机缓存。登录后解锁 AI 对话、PPT 讲解、截图问答与中英翻译。</p><form id="gateway-login-form"><label>账号<input id="gateway-email" autocomplete="username" placeholder="用户名或邮箱" required></label><label>密码<input id="gateway-password" type="password" autocomplete="current-password" required></label><button class="primary" id="gateway-login" type="submit">登录</button><p>暂未开放自助注册。没有账号请联系管理员人工开通，之后将开放注册。</p></form><div id="gateway-member" hidden><button id="gateway-usage">查看额度</button><button id="gateway-logout">退出登录</button></div><p id="gateway-status" role="status" aria-live="polite"></p>';
  const style=document.createElement('style');style.textContent='.account-head{display:flex;gap:14px;align-items:center;margin-bottom:16px}#gateway-avatar{display:grid;place-items:center;width:56px;height:56px;border-radius:50%;background:#dfebff;color:#215da1;font-size:24px}#gateway-login-form{display:grid;gap:12px;max-width:380px}#gateway-login-form label{display:grid;gap:6px}#gateway-login-form input{box-sizing:border-box;width:100%!important;max-width:none!important;padding:12px;border-radius:10px}#account-entry{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid #e3eaf1}#account-entry p{margin:0;font-size:11px;flex:1}#account-entry button{white-space:nowrap}button[data-login-required=true]{background:#edf0f4!important;color:#7b8797!important;border-color:#d9e0e8!important;box-shadow:none!important}';shadow.append(style);for(const child of target.children)child.hidden=true;target.prepend(box);
  const entry=document.createElement('div');entry.id='account-entry';entry.innerHTML='<p id="account-guide"></p><button id="account-open">去登录</button>';shadow.getElementById('panel-body').prepend(entry);
  const openAccount=()=>{shadow.getElementById('settings-tab-connection').click();shadow.getElementById('settings-dialog').hidden=false;(credential()?$('gateway-usage'):$('gateway-email')).focus();};$('account-open').onclick=openAccount;
  let busy=false,profile='';
  const refresh=()=>{const signed=!!credential();if($('compact'))$('compact').textContent=signed?'🐥 上课爽':'🐥 上课爽 · 去登录';$('gateway-login-form').hidden=signed;$('gateway-member').hidden=!signed;$('gateway-name').textContent=signed?(profile||'我的学习账号'):'欢迎使用上课爽';$('gateway-state').textContent=signed?'已登录 · AI 功能已解锁':'游客模式 · AI 功能需登录';$('gateway-avatar').textContent=signed?(profile||'我').slice(0,1):'☺';$('account-guide').textContent=signed?'已登录 · AI 讲解与翻译已解锁':'游客：语音同步、缓存可用；AI 功能请先登录。';$('account-open').textContent=signed?'我的账号':'去登录';for(const id of ['ai-open','ai-capture','slide-explain']){const b=$(id);if(b){b.dataset.loginRequired=String(!signed);b.title=signed?'':'登录后使用；点击查看账号';}}const both=$('mode')?.querySelector('[value="both"]');if(both)both.textContent=signed?'中英对照':'中英对照 · 需登录';};refreshUI=refresh;
  const run=async(fn)=>{if(busy)return;busy=true;box.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){$('gateway-status').textContent=e.message;}finally{busy=false;box.querySelectorAll('button').forEach(b=>b.disabled=false);refresh();}};
  const usage=async()=>{const data=await call('/v1/me');profile=data.username||data.email||'我的学习账号';const u=data.usage;$('gateway-status').textContent=`${profile} · ${u.month}（UTC） · 调用 ${u.requests}/${u.request_limit} · Token ${u.total_tokens} · 音频 ${Math.ceil(u.audio_seconds)}/${u.audio_limit} 秒`;refresh();};
  $('gateway-login-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(!configured())throw Error('服务尚未配置，请联系管理员更新插件。');$('gateway-status').textContent='正在登录…';await login(account().url,$('gateway-email').value,$('gateway-password').value);$('gateway-password').value='';profile=$('gateway-email').value;$('gateway-status').textContent='登录成功，AI 功能已解锁';onChange();refresh();heartbeat();});};
  $('gateway-usage').onclick=()=>run(usage);$('gateway-logout').onclick=()=>run(async()=>{try{await logout();}finally{profile='';$('gateway-password').value='';$('gateway-status').textContent='已退出登录，语音同步和缓存仍可使用。';onChange();}});
  const heartbeat=()=>{if(credential()&&document.visibilityState!=='hidden')call('/v1/activity',{}).catch(()=>{});};setInterval(heartbeat,60000);document.addEventListener('visibilitychange',heartbeat);heartbeat();refresh();
  if(credential())usage().catch(()=>{});
 }

 return{transport,configured,credential,login,logout,call,mount};
}
return{create,baseURL};
});
