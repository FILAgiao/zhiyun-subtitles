/* Account and transport adapter; inlined into the installable userscript. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZYGateway=api;})(globalThis,function(){
'use strict';
const DEFAULT_ORIGIN='';
const CLIENT_VERSION='0.20.61';
function clientHeaders(){return {'X-Client-Version':CLIENT_VERSION,'X-Client-Channel':'userscript'};}
const KEY='gateway-account-v1',APP='zhiyun-subtitles',CLIENT=globalThis.ZY_CLIENT_TYPE||'userscript';
function baseURL(value){const u=new URL(String(value).trim());if(u.username||u.password||u.search||u.hash||!['/','/gateway','/gateway/'].includes(u.pathname)||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw Error('请填写 HTTPS 服务地址；本机调试可使用 http://127.0.0.1:8080');return u.origin+(u.pathname==='/'?'':'/gateway');}
function accessSummary(data,now=Date.now()){
 const membership=data?.membership||{},permissions=data?.permissions||{},plan=membership.plan||'legacy';
 if(!data||plan==='free')return null;
 const expires=membership.expires??permissions.expires??null,seconds=expires==null?null:Math.max(0,Math.ceil(expires-now/1000));
 const expired=membership.state==='expired'||seconds===0,trial=plan==='trial';
 if(!expired&&(membership.active===false||plan==='legacy'&&['learning','translation','speech'].every(key=>permissions[key]===false)))return null;
 const u=data.usage||{},known=u.request_limit!=null&&u.requests!=null&&Number.isFinite(Number(u.request_limit))&&Number.isFinite(Number(u.requests))&&Number(u.request_limit)>=0&&Number(u.requests)>=0;
 const remaining=known?Math.max(0,Math.floor(Number(u.request_limit)-Number(u.requests))):null;
 let time='';if(seconds!=null&&!expired){const days=Math.floor(seconds/86400),hours=Math.floor(seconds/3600);time=days>0?'剩 '+days+' 天':hours>0?'剩 '+hours+' 小时':'剩 '+Math.max(1,Math.ceil(seconds/60))+' 分钟';}
 const name=trial?'免费体验':({pro:'PRO',ultra:'Ultra'}[plan]||'已开通');
 const text=expired?(trial?'体验已结束':'套餐已到期'):remaining===0?(trial?'体验额度已用完':'本月调用额度已用完'):name+(time?' · '+time:'');
 const quota=remaining==null?'额度待刷新':'本月调用剩 '+remaining.toLocaleString('zh-CN')+' 次';
 const deadline=expires==null?'未设置到期时间':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(expires*1000))+' 到期（北京时间）';
 return {plan,trial,expired,remaining,expires,text,quota,deadline,low:!expired&&(seconds!=null&&seconds<=86400||remaining!=null&&remaining<=3)};
}
function create({request,getValue,setValue}){
 let refreshUI=null,changeListener=null,accessProfile=null,accessToken='',showAccount=()=>{},queueUsageRefresh=()=>{},serverOffset=0,cleanupMounted=()=>{};
 const account=()=>{const saved=getValue(KEY,{})||{};return{...saved,url:DEFAULT_ORIGIN||saved.url||''};};
 const configured=()=>!!account().url;
 const credential=()=>configured()?(account().token||''):'';
 function rememberAccess(data,token=credential()){if(!token||token!==credential())return false;accessProfile=data;accessToken=token;if(Number.isFinite(data.server_time))serverOffset=data.server_time*1000-Date.now();return true;}
 function canUse(feature='learning'){
  if(!configured())return feature==='speech'?!!getValue('speech-credentials',{})?.apiKey:!!getValue('ark-api-key','');
  if(!credential()||accessToken!==credential()||!accessProfile)return false;
  if(accessProfile.membership?.active===false)return false;
  const p=accessProfile.permissions||{},expiry=accessProfile.membership?.expires??p.expires;if(expiry&&expiry<=(Date.now()+serverOffset)/1000)return false;
  const key=['learning_records','card_export'].includes(feature)&&p[feature]===undefined?'learning':feature;
  return p[key]===undefined?Number(accessProfile.usage?.request_limit)>0:p[key]===true;
 }
 function statusSummary(){return accessToken===credential()&&credential()?accessSummary(accessProfile,Date.now()+serverOffset):null;}
 function requireFeature(feature='learning'){if(canUse(feature))return true;showAccount(!credential()?'请先登录账号。':accessProfile?.membership?.state==='expired'||statusSummary()?.expired?(accessProfile?.membership?.plan==='trial'?'免费体验已结束，基础功能仍可使用。':'套餐已到期，基础功能仍可使用。'):'申请免费体验或开通 PRO / Ultra 后可使用此功能。');return false;}
 function incremental(options,a,headers){
  let stopped=false,current=null,timer=null,networkTimer=null,jobId='',raw='',lastText='';
  const emit=event=>{if(stopped)return;raw+='data: '+JSON.stringify(event)+'\n\n';options.onprogress?.({status:200,responseText:raw});};
  const fail=message=>{if(stopped)return;queueUsageRefresh();emit({type:'error',message});stopped=true;clearTimeout(timer);clearTimeout(networkTimer);};
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
   if(result.state==='complete'){queueUsageRefresh();emit({type:'response.completed',response:result.response});if(!stopped)options.onload?.({status:200,responseText:raw});stopped=true;clearTimeout(timer);return;}
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
  if(!a.token){queueMicrotask(()=>options.onload?.({status:401,responseText:'{}',responseHeaders:''}));return{abort(){}};}
  // Do not pass vendor credentials or arbitrary provider headers to the gateway.
  const headers={...(a.token?{Authorization:'Bearer '+a.token}:{}),'Content-Type':'application/json','X-App-Id':APP,'X-Client-Type':CLIENT,...clientHeaders()};
  for(const [k,v] of Object.entries(options.headers||{}))if(k.toLowerCase()==='x-api-request-id')headers['X-Api-Request-Id']=v;
  if(path==='/v1/ark/responses'&&options.responseType==='stream')return incremental(options,a,headers);
  return request({...options,url:baseURL(a.url)+path,headers,anonymous:true,onload:r=>{if(r.status===401&&a.token&&a.token===credential()){setValue(KEY,{url:a.url,token:''});refreshUI?.();changeListener?.();}if(path==='/v1/ark/responses'||path==='/v1/speech/submit')queueUsageRefresh();options.onload?.(r);}});
 }
 function call(path,body,token=account().token,url=account().url){return new Promise((resolve,reject)=>{
  request({method:body===undefined?'GET':'POST',url:baseURL(url)+path,anonymous:true,timeout:15000,headers:{'Content-Type':'application/json','X-App-Id':APP,'X-Client-Type':CLIENT,...clientHeaders(),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{data:JSON.stringify(body)}),onload:r=>{try{const data=JSON.parse(r.responseText);if(r.status<200||r.status>=300){if(r.status===401&&token&&token===credential()){setValue(KEY,{url:account().url,token:''});refreshUI?.();changeListener?.();}throw Error(data.error||'服务请求失败');}if(data.capabilities)setValue('gateway-capabilities-v1',data.capabilities);resolve(data);}catch(e){reject(e);}},onerror:()=>reject(Error('无法连接服务，请检查地址和域名授权')),ontimeout:()=>reject(Error('服务请求超时'))});
 });}
 async function login(url,email,password){url=baseURL(DEFAULT_ORIGIN||url);const data=await call('/v1/auth/login',{email,password},null,url);if(typeof data.token!=='string'||!data.token)throw Error('登录响应异常');setValue(KEY,{url,token:data.token});if(data.permissions||data.membership)rememberAccess(data,data.token);return data;}
 async function logout(){try{if(credential())await call('/v1/auth/logout',{});}finally{setValue(KEY,{url:account().url||'',token:''});accessProfile=null;accessToken='';}}
 function mount(shadow,onChange=()=>{},openSettings=null){
  cleanupMounted();changeListener=onChange;
  const target=shadow.getElementById('settings-connection');if(!target)return;
  const $=id=>shadow.getElementById(id),box=document.createElement('section');box.className='section';box.id='gateway-account';
  box.innerHTML=`<div class="account-head"><span id="gateway-avatar" aria-hidden="true"></span><div class="account-brand-copy"><span class="account-eyebrow">浙大上课爽 · 学习账号</span><h4 id="gateway-name">登录，继续你的学习</h4><p id="gateway-state"></p></div><span id="gateway-plan-badge" hidden></span></div>
  <p id="gateway-intro">把看课时的疑问，变成自己的理解。</p>
  <form id="gateway-login-form"><label for="gateway-email">用户名或邮箱<input id="gateway-email" autocomplete="username" placeholder="输入你的用户名或邮箱" required maxlength="254"></label><label for="gateway-password">密码<span class="account-password"><input id="gateway-password" type="password" autocomplete="current-password" placeholder="输入账号密码" required maxlength="256"><button id="gateway-password-toggle" type="button" aria-label="显示密码" aria-pressed="false">显示</button></span></label><button class="primary" id="gateway-login" type="submit">登录账号 <span aria-hidden="true">↗</span></button><div class="account-login-help"><span>已有体验账号？直接登录即可</span><button id="gateway-apply" type="button">申请免费体验</button></div></form>
  <div id="gateway-member" hidden><button id="gateway-usage" type="button">查看额度</button><button id="gateway-logout" type="button">退出登录</button></div>
  <section id="gateway-membership" hidden aria-label="账号有效期"><div><span id="gateway-membership-title"></span><strong id="gateway-membership-value"></strong><p id="gateway-membership-deadline"></p></div><span class="account-access-dot" aria-hidden="true"></span></section>
  <section id="gateway-quota-section" hidden><div class="quota-heading"><strong>我的可用额度</strong><button id="gateway-recharge" type="button">开通 / 增加额度</button></div><div id="gateway-quota" aria-label="剩余额度"></div><p class="account-meter-note">调用次数由 AI 问答、字幕翻译和语音提交共用，按月统计；语音额度按实际识别音频时长计算。</p></section>
  <div id="gateway-recharge-note" hidden role="status"><strong>申请体验 / 账号帮助</strong><p>体验账号按人独立发放。目前还没开放自助注册；抖音、小红书都是「侃侃你的」，私信我申请账号或调整额度就好啦。</p><button id="gateway-recharge-close" type="button">我知道了</button></div>
  <p id="gateway-status" role="status" aria-live="polite"></p><div id="gateway-basic-note"><span>基础看课，始终免费</span><p>原文字幕 · PPT 缩放 · 课堂全屏 · 本机缓存</p><small>AI 对话包含截图问；高级功能按账号授权和额度使用。</small></div>`;
  const style=document.createElement('style');style.textContent=(globalThis.ZYWarmTheme?.css||'')+`
#gateway-account{--account-surface:var(--zy-card,#fff);box-sizing:border-box;max-width:520px;margin:0 auto;padding:12px 0 4px!important;color:var(--zy-text,#30343b)}#gateway-account *{box-sizing:border-box}#gateway-account [hidden]{display:none!important}#gateway-account .account-head{display:flex;gap:14px;align-items:center;margin:0 0 18px}#gateway-avatar{isolation:isolate;flex:none;display:grid;place-items:center;width:58px;height:58px;border-radius:17px;background:var(--zy-soft,#fdebdD);border:1px solid var(--zy-line,#eedccd);color:var(--zy-accent,#c45221);font-size:22px;font-weight:650}#gateway-avatar img{width:42px;height:42px;object-fit:contain;mix-blend-mode:multiply}.account-brand-copy{flex:1;min-width:0}.account-eyebrow{font-size:10px;letter-spacing:.8px;color:var(--zy-muted,#68717d)}#gateway-account #gateway-name{margin:4px 0 0;font-size:23px;line-height:1.35;letter-spacing:-.5px;color:var(--zy-text,#30343b)}#gateway-account #gateway-state{font-size:11px;line-height:1.6;color:var(--zy-muted,#68717d);margin:6px 0 0}#gateway-account #gateway-intro{font-size:14px;color:var(--zy-muted,#68717d);margin:0 0 28px;line-height:1.7}#gateway-plan-badge{font-size:10px;padding:5px 8px;border-radius:7px;background:var(--zy-soft);color:var(--zy-accent);white-space:nowrap;align-self:flex-start;margin-top:4px}
#gateway-account #gateway-login-form{display:grid;gap:20px;max-width:none}#gateway-account #gateway-login-form label{display:grid;gap:9px;margin:0;font-size:12px;font-weight:600;color:var(--zy-text)}#gateway-account #gateway-login-form input{display:block;width:100%!important;max-width:none!important;height:48px;border:1px solid var(--zy-line,#eedccd);border-radius:12px;padding:0 14px;background:var(--account-surface);color:var(--zy-text);font:400 14px 'Segoe UI','Microsoft YaHei',sans-serif;box-shadow:0 2px 5px #392b2303;outline:none}#gateway-account #gateway-login-form input::placeholder{color:var(--zy-muted);opacity:.7}#gateway-account #gateway-login-form input:focus{border-color:var(--zy-accent);box-shadow:0 0 0 3px var(--zy-soft)}#gateway-account .account-password{display:flex;position:relative;align-items:center}#gateway-account .account-password input{padding-right:64px}#gateway-account #gateway-password-toggle{position:absolute;right:7px;top:7px;height:34px;padding:0 10px;border:0;background:transparent;color:var(--zy-muted);font:12px 'Microsoft YaHei',sans-serif;box-shadow:none;border-radius:8px}#gateway-account #gateway-password-toggle:hover{background:var(--zy-soft);color:var(--zy-accent)}#gateway-account #gateway-login{display:flex;align-items:center;justify-content:space-between;width:100%;height:46px;padding:0 17px;border:1px solid var(--zy-accent);border-radius:12px;background:var(--zy-accent);color:white;box-shadow:0 5px 14px #c4522118;font:600 14px 'Microsoft YaHei',sans-serif}#gateway-account #gateway-login:hover{background:var(--zy-accent-hover)}#gateway-account #gateway-login:disabled{opacity:.6;cursor:wait}#gateway-account .account-login-help{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:-6px;font-size:11px;color:var(--zy-muted)}#gateway-account #gateway-apply{padding:3px 0;border:0;box-shadow:none;background:transparent;color:var(--zy-accent);font-size:11px}
#gateway-member{display:flex;gap:8px;justify-content:flex-end;margin:-8px 0 20px}#gateway-account #gateway-member button{padding:5px 8px;background:transparent;border:0;color:var(--zy-muted);font-size:11px;box-shadow:none}#gateway-account #gateway-member button:first-child{color:var(--zy-accent)}#gateway-membership{display:flex;align-items:center;justify-content:space-between;padding:17px 18px;margin:0 0 24px;border:1px solid var(--zy-line);border-radius:14px;background:var(--zy-soft)}#gateway-membership-title{display:block;font-size:11px;color:var(--zy-muted);margin-bottom:5px}#gateway-membership-value{font-size:19px;font-weight:650;color:var(--zy-text)}#gateway-account #gateway-membership-deadline{font-size:10px;color:var(--zy-muted);margin:8px 0 0;line-height:1.6}.account-access-dot{width:8px;height:8px;border-radius:50%;background:var(--zy-accent);margin-left:12px;flex:none}#gateway-membership[data-ended=true]{background:var(--account-surface)}#gateway-membership[data-ended=true] .account-access-dot{background:var(--zy-muted)}
#gateway-account .quota-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 12px}#gateway-account .quota-heading strong{font-size:12px;color:var(--zy-text)}#gateway-account .quota-heading button{padding:4px 6px;border:0;background:transparent;color:var(--zy-accent);font-size:10px;box-shadow:none}#gateway-account #gateway-quota{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0}#gateway-account .quota-row{min-width:0;text-align:left;padding:14px 12px;border:1px solid var(--zy-line);border-radius:12px;background:var(--account-surface)}#gateway-account .quota-label{display:block;min-height:18px;font-size:11px;font-weight:500;color:var(--zy-muted)}#gateway-account .quota-ring{display:block;width:auto;height:auto;margin:10px 0 9px;background:none;border-radius:0}#gateway-account .quota-ring:before{display:none}#gateway-account .quota-ring strong{display:block;position:static;font-size:25px;font-weight:650;line-height:1.2;color:var(--zy-text);font-variant-numeric:tabular-nums}#gateway-account .quota-ring strong span{display:block;font-size:10px;font-weight:400;color:var(--zy-muted);margin-top:5px}#gateway-account .quota-row small{display:block;font-size:9px;line-height:1.7;color:var(--zy-muted);overflow-wrap:anywhere;min-height:30px}#gateway-account .quota-action{padding:4px 0;margin-top:5px;border:0;background:transparent;color:var(--zy-accent);box-shadow:none;font-size:10px}#gateway-account .quota-row[data-locked=true] .quota-ring strong{color:var(--zy-muted)}#gateway-account .account-meter-note{font-size:10px;color:var(--zy-muted);line-height:1.7;margin:12px 0 0}
#gateway-account #gateway-recharge-note{padding:14px;margin:18px 0 0;border:1px solid var(--zy-line);border-radius:12px;background:var(--zy-soft);color:var(--zy-text)}#gateway-recharge-note strong{font-size:12px}#gateway-account #gateway-recharge-note p{font-size:12px;color:var(--zy-muted);margin:7px 0 12px}#gateway-account #gateway-recharge-close{font-size:11px;background:var(--account-surface);color:var(--zy-accent);border:1px solid var(--zy-line);border-radius:8px;padding:5px 9px}#gateway-account #gateway-status{margin:16px 0 0;font-size:11px;line-height:1.6;color:var(--zy-muted);overflow-wrap:anywhere}#gateway-account #gateway-status:empty{display:none}#gateway-account #gateway-status[data-error=true]{padding:10px 12px;background:var(--zy-soft);color:var(--zy-accent);border-radius:10px}#gateway-basic-note{padding-top:22px;margin-top:26px;border-top:1px solid var(--zy-line)}#gateway-basic-note>span{font-size:11px;font-weight:600;color:var(--zy-text)}#gateway-account #gateway-basic-note p{font-size:11px;line-height:1.7;color:var(--zy-muted);margin:7px 0}#gateway-basic-note small{font-size:10px;line-height:1.7;color:var(--zy-muted)}#gateway-account #gateway-help{padding:4px 0;background:transparent;border:0;color:var(--zy-muted);font-size:10px;box-shadow:none;margin-top:12px}
.account-title{display:grid;grid-template-columns:auto auto;column-gap:6px;align-items:center}.account-title h3{font-size:16px}.account-title .subtitle{grid-column:1/-1}.account-title #account-entry{grid-column:2;grid-row:1}#account-entry{display:flex;gap:5px;align-items:center;margin-left:auto;white-space:nowrap}#account-entry #account-guide{font-size:10px;margin:0;color:var(--zy-muted)}#account-entry button{font-size:10px;padding:4px 6px;border:0;color:var(--zy-accent);background:var(--zy-soft);border-radius:7px}button[data-login-required=true]{background:#edf0f4!important;color:#7b8797!important;border-color:#d9e0e8!important;box-shadow:none!important}
@media(max-width:600px){#gateway-account{padding:4px 0!important}#gateway-account .account-head{gap:10px}#gateway-avatar{width:46px;height:46px;border-radius:13px}#gateway-avatar img{width:34px;height:34px}#gateway-account #gateway-name{font-size:20px}#gateway-account #gateway-intro{font-size:12px;margin-bottom:24px}#gateway-account #gateway-quota{gap:7px}#gateway-account .quota-row{padding:12px 8px}#gateway-account .quota-ring strong{font-size:21px}#gateway-account .quota-label{font-size:10px}#gateway-account .account-login-help{align-items:flex-start;flex-wrap:wrap}#gateway-plan-badge{padding:4px 6px;font-size:9px}#gateway-basic-note{margin-top:20px;padding-top:18px}}
`;shadow.append(style);for(const child of target.children)child.hidden=true;target.prepend(box);
  const entry=document.createElement('div');entry.id='account-entry';entry.innerHTML='<p id="account-guide"></p><button id="account-open">去登录</button>';const heading=shadow.querySelector('#panel-head > div');if(heading){heading.classList.add('account-title');heading.append(entry);}else (shadow.getElementById('panel-head')||shadow.getElementById('panel-body')).append(entry);
  const openAccount=(message='')=>{if(openSettings)openSettings('connection');else{shadow.getElementById('settings-tab-connection')?.click();shadow.getElementById('settings-dialog').hidden=false;}if(message)$('gateway-status').textContent=message;(credential()?$('gateway-usage'):$('gateway-email')).focus();};showAccount=openAccount;$('account-open').onclick=()=>openAccount();shadow.addEventListener('click',e=>{const button=e.composedPath().find(n=>n?.dataset?.loginRequired==='true'||n?.dataset?.featureBlocked==='true');if(button&&!canUse(button.dataset.gatewayFeature||'learning')){e.preventDefault();e.stopImmediatePropagation();requireFeature(button.dataset.gatewayFeature||'learning');}},true);
  let busy=false,profile='',usageData=null,permissions=null,previousAccess=false;
  let noteReturn=null;const contact=button=>{noteReturn=button;$('gateway-recharge-note').hidden=false;$('gateway-recharge-close').focus();};
  $('gateway-recharge').onclick=()=>contact($('gateway-recharge'));$('gateway-apply').onclick=()=>contact($('gateway-apply'));
  $('gateway-recharge-close').onclick=()=>{$('gateway-recharge-note').hidden=true;noteReturn?.focus();};
  $('gateway-password-toggle').onclick=()=>{const visible=$('gateway-password').type==='password';$('gateway-password').type=visible?'text':'password';$('gateway-password-toggle').textContent=visible?'隐藏':'显示';$('gateway-password-toggle').setAttribute('aria-label',visible?'隐藏密码':'显示密码');$('gateway-password-toggle').setAttribute('aria-pressed',String(visible));};
  const renderQuota=()=>{
   const signed=!!credential(),u=signed?usageData:null,quota=$('gateway-quota');quota.replaceChildren();
   for(const item of [
    {label:'基础字幕与缓存',color:'#2c9a83',unlimited:true,detail:'原文字幕、手动同步与缓存 · 免费使用'},
    {feature:'learning',label:'AI 问答与翻译',color:'#C45221',used:u?.requests,total:u?.request_limit,unit:'次',detail:'AI、翻译与语音提交共享调用次数'},
    {feature:'speech',label:'语音识别',color:'#df9a36',used:u?.audio_seconds==null?null:Math.ceil(u.audio_seconds),total:u?.audio_limit,unit:'秒',detail:'自动语音校准使用识别额度'}
   ]){
    const locked=(!signed||!canUse(item.feature))&&!item.unlimited,limit=Number(item.total),spent=Number(item.used),known=item.total!=null&&item.used!=null&&Number.isFinite(limit)&&limit>=0&&Number.isFinite(spent)&&spent>=0,remaining=known?Math.max(0,limit-spent):0;
    const row=document.createElement('div');row.className='quota-row';row.dataset.locked=String(locked);row.style.setProperty('--quota-color',locked||(!known&&!item.unlimited)?'#a0adbc':item.color);row.style.setProperty('--quota-angle',(item.unlimited?360:known&&limit>0?Math.min(1,remaining/limit)*360:0)+'deg');
    const title=document.createElement('span');title.className='quota-label';title.textContent=item.label;
    const ring=document.createElement('div');ring.className='quota-ring';const value=document.createElement('strong'),caption=document.createElement('span');value.textContent=item.unlimited?'∞':locked?'—':known?remaining.toLocaleString():'—';caption.textContent=item.unlimited?'无限量':locked?(signed?'未开通':'未登录'):known?'剩余 '+item.unit:'待刷新';value.append(caption);ring.append(value);ring.setAttribute('role','img');ring.setAttribute('aria-label',item.label+'：'+(item.unlimited?'无限量':locked?(signed?'未开通':'未登录'):known?'剩余 '+remaining.toLocaleString()+' '+item.unit:'额度暂不可用'));
    const detail=document.createElement('small');detail.textContent=known?'已用 '+spent.toLocaleString()+' / '+limit.toLocaleString()+' '+item.unit:item.detail;row.append(title,ring,detail);
    if(!item.unlimited){const action=document.createElement('button');action.type='button';action.className='quota-action';action.textContent=!signed?'登录查看':locked?'开通套餐':statusSummary()?.trial?'申请增加':'增加额度';action.onclick=!signed?()=>openAccount():()=>$('gateway-recharge').click();row.append(action);}
    quota.append(row);
   }
  };
  const refresh=()=>{const signed=!!credential(),membership=accessToken===credential()?accessProfile?.membership:null,ready=accessToken===credential()&&!!accessProfile,paid=canUse('learning');if($('compact'))$('compact').textContent=signed?'🐥 上课爽':'🐥 上课爽 · 去登录';$('gateway-login-form').hidden=signed;$('gateway-member').hidden=!signed;$('gateway-name').textContent=signed?(profile||'我的学习账号'):'登录，继续你的学习';$('gateway-quota-section').hidden=!signed;$('gateway-basic-note').hidden=signed;$('gateway-intro').hidden=signed;$('gateway-state').textContent=!signed?'未登录 · 基础功能免费':!ready?'已登录 · 正在读取套餐':membership?.state==='expired'||statusSummary()?.expired?(membership?.plan==='trial'?'已登录 · 免费体验已结束':'已登录 · 套餐已到期'):paid?'已登录 · '+({trial:'免费体验',pro:'PRO',ultra:'Ultra'}[membership?.plan]||'原有授权'):'已登录 · 免费账号（未充值）';$('gateway-avatar').replaceChildren();if(signed)$('gateway-avatar').textContent=(profile||'我').slice(0,1);else if(typeof ZY_STUDY_MASCOT!=='undefined'){const logo=document.createElement('img');logo.alt='';logo.src=ZY_STUDY_MASCOT;$('gateway-avatar').append(logo);}else $('gateway-avatar').textContent='爽';const summary=statusSummary();$('gateway-membership').hidden=!signed||!summary;if(summary){$('gateway-membership-title').textContent=summary.trial?'免费体验资格':'账号有效期';$('gateway-membership-value').textContent=summary.text;$('gateway-membership-deadline').textContent=summary.deadline;$('gateway-membership').dataset.ended=String(summary.expired);}$('gateway-plan-badge').hidden=!signed||!ready;$('gateway-plan-badge').textContent=summary?.trial?'免费体验':({pro:'PRO',ultra:'Ultra'}[membership?.plan]||(paid?'已开通':'基础免费'));$('account-guide').textContent=summary?.trial?summary.text:signed?'● 已登录':'○ 游客';$('account-guide').title=summary?[summary.quota,summary.deadline].join(' · '):'';$('account-open').textContent=signed?'账号':'登录';for(const id of ['ai-open','ai-capture','slide-explain','transcript-open','web-ask','web-page-ask']){const b=$(id);if(b){b.dataset.loginRequired=String(!signed);b.title=signed?'':'登录后使用；点击查看账号';b.setAttribute('aria-disabled',String(!signed));}}if(!signed){usageData=null;permissions=null;}for(const id of ['ai-open','ai-capture','slide-explain','transcript-open','web-ask','web-page-ask','sync-toggle']){const b=$(id),feature=id==='sync-toggle'?'speech':id==='transcript-open'?'learning_records':'learning';if(b){b.dataset.gatewayFeature=feature;b.dataset.loginRequired=String(!signed);b.dataset.featureBlocked=String(signed&&!canUse(feature));b.setAttribute('aria-disabled',String(!canUse(feature)));b.title=!signed?'登录后使用体验资格或套餐':!canUse(feature)?'申请体验或开通套餐后使用':'';}}renderQuota();const both=$('mode')?.querySelector('[value="both"]');if(both){both.textContent=signed&&!canUse('translation')?'中外对照（需开通套餐）':'中外对照';both.disabled=false;}previousAccess=canUse('learning');shadow.dispatchEvent(new CustomEvent('zy-account-state'));};refreshUI=refresh;
  const run=async(fn)=>{if(busy)return;busy=true;box.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){$('gateway-status').dataset.error='true';$('gateway-status').textContent=e.message;}finally{busy=false;box.querySelectorAll('button').forEach(b=>b.disabled=false);refresh();}};
  const usage=async()=>{const previous=JSON.stringify([accessToken,accessProfile?.permissions,accessProfile?.membership]),token=credential(),data=await call('/v1/me');if(!rememberAccess(data,token))return;permissions=data.permissions||null;profile=data.username||data.email||'我的学习账号';const u=data.usage;usageData=u; $('gateway-status').dataset.error='false';$('gateway-status').textContent='额度已更新';refresh();if(previous!==JSON.stringify([accessToken,accessProfile?.permissions,accessProfile?.membership]))onChange();};
  $('gateway-login-form').onsubmit=e=>{e.preventDefault();run(async()=>{if(!configured())throw Error('服务尚未配置，请联系管理员更新插件。');$('gateway-status').dataset.error='false';$('gateway-status').textContent='正在登录…';await login(account().url,$('gateway-email').value,$('gateway-password').value);$('gateway-password').value='';$('gateway-password').type='password';$('gateway-password-toggle').textContent='显示';$('gateway-password-toggle').setAttribute('aria-pressed','false');$('gateway-password-toggle').setAttribute('aria-label','显示密码');profile=$('gateway-email').value;$('gateway-status').textContent='登录成功，正在读取权限和额度';onChange();refresh();heartbeat();await usage();});};
  $('gateway-usage').onclick=()=>run(usage);$('gateway-logout').onclick=()=>run(async()=>{try{await logout();}finally{profile='';usageData=null;permissions=null;$('gateway-password').value='';$('gateway-status').textContent='已退出登录，原文字幕、手动同步和缓存仍可使用。';onChange();}});
  let quotaTimer=null,lastQuotaRefresh=0;queueUsageRefresh=()=>{if(!credential()||quotaTimer)return;quotaTimer=setTimeout(()=>{quotaTimer=null;lastQuotaRefresh=Date.now();if(credential())usage().catch(()=>{});},Math.max(700,5000-(Date.now()-lastQuotaRefresh)));};
  const expiryTimer=setInterval(()=>{const changed=canUse('learning')!==previousAccess;refresh();if(changed)onChange();},60000);
  const heartbeat=()=>{if(credential()&&document.visibilityState!=='hidden')call('/v1/activity',{}).catch(()=>{});};const heartbeatTimer=setInterval(heartbeat,60000);document.addEventListener('visibilitychange',heartbeat);cleanupMounted=()=>{clearInterval(expiryTimer);clearInterval(heartbeatTimer);clearTimeout(quotaTimer);document.removeEventListener('visibilitychange',heartbeat);queueUsageRefresh=()=>{};refreshUI=null;changeListener=null;showAccount=()=>{};};heartbeat();refresh();
  if(credential())usage().catch(e=>{$('gateway-status').textContent=e.message;});

  if($('sync-toggle')){
   const GUIDE='gateway-guide-no-remind-v2',dialog=document.createElement('dialog');dialog.id='gateway-guide';dialog.setAttribute('aria-labelledby','guide-title');dialog.setAttribute('aria-describedby','guide-copy');
   dialog.innerHTML=`<header class="guide-header"><div class="guide-top"><span id="guide-step" aria-live="polite"></span><button type="button" id="guide-skip">先逛逛 <span aria-hidden="true">×</span></button></div><h2 id="guide-title"></h2><p id="guide-copy"></p></header>
    <div id="guide-content"><div id="guide-cards" aria-label="本页功能介绍"></div></div>
    <footer class="guide-bottom"><nav id="guide-dots" aria-label="欢迎页导航"></nav><p class="guide-access-note">基础字幕与缓存免费 · AI、翻译、自动校准需有效体验或套餐</p><div class="guide-actions"><label class="guide-reminder"><input type="checkbox" id="guide-no-remind"> 下次不提醒</label><div class="guide-buttons"><button type="button" id="guide-back">上一页</button><button type="button" id="guide-next" class="primary">下一页</button><button type="button" id="guide-login" class="primary" hidden>登录账号</button></div></div><p id="guide-account-note" hidden>还没账号？在抖音或小红书搜「侃侃你的」，私信申请测试账号。暂未开放自助注册。</p></footer>`;
   const viewer=document.createElement('dialog');viewer.id='guide-image-viewer';viewer.setAttribute('aria-labelledby','guide-viewer-title');viewer.setAttribute('aria-describedby','guide-viewer-copy');viewer.innerHTML='<header class="guide-viewer-head"><strong id="guide-viewer-title"></strong><button type="button" id="guide-viewer-close">返回 ×</button></header><div id="guide-viewer-scroll"><div id="guide-viewer-art" class="guide-frog-art" role="img"></div><p id="guide-viewer-copy"></p></div>';
   const artwork=typeof ZY_ONBOARDING_ARTWORK==='undefined'?'':ZY_ONBOARDING_ARTWORK;dialog.style.setProperty('--guide-artwork','url("'+artwork+'")');viewer.style.setProperty('--guide-artwork','url("'+artwork+'")');
   const guideStyle=document.createElement('style');guideStyle.textContent=`
    #gateway-guide,#guide-image-viewer{pointer-events:auto;box-sizing:border-box;border:1px solid #e9d7c5;border-radius:22px;background:#fffbf5;color:#243447;box-shadow:0 22px 80px #25150f38;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;padding:0;max-width:none;max-height:calc(100dvh - 32px);overflow:hidden}
    #gateway-guide{width:min(680px,calc(100vw - 32px));height:fit-content}
    #gateway-guide[open],#guide-image-viewer[open]{display:flex;flex-direction:column}
    #gateway-guide::backdrop,#guide-image-viewer::backdrop{background:#27190c75;backdrop-filter:blur(3px)}
    #gateway-guide *,#guide-image-viewer *{box-sizing:border-box}
    #gateway-guide [hidden],#guide-image-viewer [hidden]{display:none!important}
    #gateway-guide button,#guide-image-viewer button{cursor:pointer;border:1px solid #e9d7c5;border-radius:10px;padding:8px 15px;background:#fffaf3;color:#8a4b2b;font:inherit;line-height:1.5;white-space:nowrap;box-shadow:none}
    #gateway-guide button:hover,#guide-image-viewer button:hover{background:#faecdc}
    #gateway-guide button:focus-visible,#guide-image-viewer button:focus-visible{outline:3px solid #bc4b20;outline-offset:-3px}
    #gateway-guide button.primary{min-width:110px;background:linear-gradient(110deg,#d24d15,#bd431c);color:#fff;border-color:#c64a1c;font-weight:600}
    #gateway-guide button.primary:hover{background:#ad3915}
    #gateway-guide .guide-header{padding:14px 24px 8px;flex-shrink:0}
    #gateway-guide .guide-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
    #guide-step{font-size:11px;color:#bd4c22;letter-spacing:.4px}
    #gateway-guide #guide-skip{font-size:12px;background:transparent;border:0;padding:3px 0 3px 10px;color:#8b7563}
    #guide-skip span{font-size:18px;margin-left:6px}
    #gateway-guide h2{font-size:23px;line-height:1.4;color:#243447;letter-spacing:.5px;margin:6px 0 4px}
    #gateway-guide p{margin:0;color:#817161;font-size:12px;line-height:1.7;overflow-wrap:anywhere}
    #guide-content{padding:10px 24px 14px;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
    #guide-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    #gateway-guide button.guide-feature-card{display:flex;flex-direction:column;align-items:stretch;min-width:0;width:100%;padding:6px 15px 13px;background:#fffefa;border:1px solid #efdfcf;border-radius:17px;text-align:left;white-space:normal;box-shadow:0 5px 16px #7a4d1509}
    #gateway-guide button.guide-feature-card:hover{background:#fff8ee;border-color:#e6c9ad}
    #gateway-guide .guide-frog-art,#guide-image-viewer .guide-frog-art{display:block;background-image:var(--guide-artwork);background-repeat:no-repeat;background-size:400% 200%;background-position:var(--guide-art-x) var(--guide-art-y);width:128px;height:128px;flex-shrink:0;margin:0 auto}
    #gateway-guide .guide-card-title{display:block;font-size:16px;font-weight:650;line-height:1.5;color:#243447;margin:0 0 4px}
    #gateway-guide .guide-card-copy{display:block;color:#817161;font-size:12px;line-height:1.6;min-height:19px}
    #gateway-guide .guide-bottom{padding:4px 24px 18px;flex-shrink:0}
    #gateway-guide #guide-dots{display:flex;justify-content:center;gap:8px;margin:0 0 7px}
    #gateway-guide #guide-dots button{font-size:11px;padding:4px 12px;background:transparent;border-color:transparent;color:#927b68}
    #gateway-guide #guide-dots button[aria-current=step]{color:#a1411d;background:#fcebdc;border-color:#f1d5bb}
    #gateway-guide .guide-access-note{text-align:center;font-size:11px;color:#927b68;margin-bottom:12px}
    #gateway-guide .guide-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
    #gateway-guide .guide-buttons{display:flex;gap:8px}
    #gateway-guide .guide-reminder{display:flex;align-items:center;justify-content:flex-start;gap:7px;font-size:12px;color:#87715f;cursor:pointer;white-space:nowrap;margin:0}
    #gateway-guide .guide-reminder input{margin:0;width:16px;height:16px;accent-color:#c45221}
    #gateway-guide #guide-account-note{padding:8px 10px;background:#fff1df;border-radius:9px;font-size:11px;line-height:1.6;margin-top:10px}
    #guide-image-viewer{width:min(450px,calc(100vw - 24px));height:fit-content}
    #guide-image-viewer .guide-viewer-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid #efdfcf;flex-shrink:0}
    #guide-image-viewer .guide-viewer-head strong{font-size:16px;min-width:0}
    #guide-image-viewer #guide-viewer-close{font-size:12px;padding:6px 10px}
    #guide-viewer-scroll{padding:16px 24px 24px;min-height:0;overflow:auto;overscroll-behavior:contain}
    #guide-image-viewer .guide-frog-art{width:240px;height:240px;max-width:100%;aspect-ratio:1}
    #guide-viewer-copy{margin:8px 0 0;color:#796756;font-size:14px;line-height:1.8}
    @media(max-width:600px){#gateway-guide{width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:18px}#gateway-guide .guide-header{padding:12px 14px 6px}#gateway-guide h2{font-size:21px}#gateway-guide #guide-content{padding:8px 12px 12px}#guide-cards{gap:9px}#gateway-guide button.guide-feature-card{padding:5px 10px 11px;border-radius:14px}#gateway-guide .guide-frog-art{width:104px;height:104px}#gateway-guide .guide-card-title{font-size:14px}#gateway-guide .guide-card-copy{font-size:11px;min-height:35px}#gateway-guide .guide-bottom{padding:2px 14px 13px}#gateway-guide .guide-actions{flex-wrap:wrap;gap:10px}#gateway-guide .guide-buttons{margin-left:auto}#gateway-guide .guide-access-note{font-size:10px;margin-bottom:10px}#gateway-guide button{padding:8px 12px}#gateway-guide button.primary{min-width:100px}}
    @media(max-width:350px){#gateway-guide .guide-frog-art{width:88px;height:88px}#gateway-guide .guide-actions{display:grid;grid-template-columns:1fr}#gateway-guide .guide-buttons{margin:0;display:flex}#gateway-guide .guide-buttons button{flex:1}#gateway-guide .guide-reminder{font-size:11px}}
    @media(max-height:600px) and (min-width:601px){#gateway-guide .guide-header{padding:8px 18px 4px}#gateway-guide h2{font-size:19px;margin:3px 0}#gateway-guide #guide-content{padding:6px 18px 10px}#gateway-guide button.guide-feature-card{display:grid;grid-template-columns:78px minmax(0,1fr);gap:8px;align-items:center;padding:7px 10px}#gateway-guide .guide-frog-art{width:78px;height:78px}#gateway-guide .guide-card-title{font-size:14px}#gateway-guide .guide-card-copy{font-size:11px}#gateway-guide .guide-bottom{padding:0 18px 10px}#gateway-guide .guide-access-note{margin-bottom:6px}#gateway-guide #guide-dots{margin-bottom:4px}#gateway-guide #guide-account-note{margin-top:6px;padding:5px 8px}}
   `;shadow.append(guideStyle,dialog,viewer);
   const features=[
    ['视频缓存','高峰卡顿？先缓存，再畅看。','点「缓存当前视频」，将支持的视频提前存到本机，减少高峰期等待。基础缓存免费使用。'],
    ['字幕同步','字幕、声音、课件，跟上同一节奏。','原文字幕与手动时间微调免费。需要自动对齐时，可用「字幕同步」中的语音智能校准；原录音爆音时不一定能修复。'],
    ['同屏看 PPT','课件、老师、字幕，一屏看。','点「看 PPT」展开课件，配合「课堂全屏」集中看课；这些基础功能免费使用。'],
    ['AI 讲解','这页不懂？听它拆开讲。','点「讲解这页」理解当前 PPT，也可以在侧边继续追问。需登录并有有效体验资格或套餐。'],
    ['截图提问','中键框选，圈住问题就问。','在网页按住鼠标中键拖框，截图后可画笔批注、圈选并继续提问。需登录并有有效体验资格或套餐。'],
    ['知识卡','把问题与解答，存成复习卡。','在 AI 回答下方点「导出知识卡」，保存全部或逐句摘选，自动带上对应的问题与附图。需有效体验资格或套餐。'],
    ['老师语音字幕','老师讲的话，跟着显示字幕。','打开课堂原有的「语音识别」加载字幕，插件可跟随播放显示原文。想更精确地对齐时，可使用手动微调或语音智能校准。'],
    ['专业课优化翻译','结合专业课语境，翻译更贴切。','在字幕中选择「中外对照」，翻译会参考前后文，帮助理解专业课里的术语和表达。需登录并有有效体验资格或套餐。']
   ];
   const pages=[['先把课看舒服','从播放到理解，四个小帮手陪你上课。','轻松看课'],['把疑问变成理解','截图、复习和字幕翻译，把理解留住。','理解与复习']];let step=0,previousFocus=null,detailTrigger=null;
   function setArt(el,index){el.style.setProperty('--guide-art-x',(index%4)*100/3+'%');el.style.setProperty('--guide-art-y',index<4?'0%':'100%');}
   function primary(){return $('guide-next').hidden?$('guide-login'):$('guide-next');}
   function showDetail(index,trigger){detailTrigger=trigger;$('guide-viewer-title').textContent=features[index][0];$('guide-viewer-copy').textContent=features[index][2];$('guide-viewer-art').setAttribute('aria-label',features[index][0]+'小青蛙动作图');setArt($('guide-viewer-art'),index);viewer.showModal();$('guide-viewer-scroll').scrollTop=0;$('guide-viewer-close').focus();}
   pages.forEach((page,index)=>{const b=document.createElement('button');b.type='button';b.textContent=(index+1)+' · '+page[2];b.setAttribute('aria-label','第 '+(index+1)+' 页：'+page[2]);b.onclick=()=>move(index);$('guide-dots').append(b);});
   function paint(){const last=step===pages.length-1,signed=!!credential();$('guide-title').textContent=pages[step][0];$('guide-copy').textContent=pages[step][1];$('guide-step').textContent='欢迎使用上课爽 · '+(step+1)+' / '+pages.length;$('guide-back').hidden=step===0;$('guide-next').hidden=last&&!signed;$('guide-next').textContent=last?'开始使用':'下一页';$('guide-login').hidden=!last||signed;$('guide-account-note').hidden=!last||signed;
    const cards=$('guide-cards');cards.replaceChildren();features.slice(step*4,step*4+4).forEach((feature,i)=>{const index=step*4+i,b=document.createElement('button'),art=document.createElement('span'),copy=document.createElement('span'),title=document.createElement('strong'),summary=document.createElement('span');b.type='button';b.className='guide-feature-card';b.dataset.featureIndex=index;b.setAttribute('aria-label',feature[0]+'：'+feature[1]+' 点击查看操作说明');b.setAttribute('aria-haspopup','dialog');art.className='guide-frog-art';art.setAttribute('aria-hidden','true');setArt(art,index);copy.className='guide-card-text';title.className='guide-card-title';title.textContent=feature[0];summary.className='guide-card-copy';summary.textContent=feature[1];copy.append(title,summary);b.append(art,copy);b.onclick=()=>showDetail(index,b);cards.append(b);});
    Array.from($('guide-dots').children).forEach((b,i)=>{if(i===step)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});$('guide-content').scrollTop=0;
   }
   function move(index){if(index<0||index>=pages.length||index===step)return;const active=shadow.activeElement,cardFocused=$('guide-cards').contains(active);step=index;paint();if(cardFocused||!active||active.hidden||!active.isConnected)primary().focus();}
   function closeViewer(){if(!viewer.open)return;viewer.close();detailTrigger?.focus();}
   function finish(){closeViewer();setValue(GUIDE,$('guide-no-remind').checked);dialog.close();previousFocus?.focus();}
   function show(){if(dialog.open)return;previousFocus=shadow.activeElement;step=0;$('guide-no-remind').checked=!!getValue(GUIDE,false);paint();dialog.showModal();primary().focus();}
   $('guide-viewer-close').onclick=closeViewer;viewer.addEventListener('cancel',e=>{e.preventDefault();closeViewer();});
   $('guide-skip').onclick=finish;$('guide-back').onclick=()=>move(step-1);$('guide-next').onclick=()=>{if(step===pages.length-1)finish();else move(step+1);};$('guide-login').onclick=()=>{finish();openAccount();};dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
   dialog.addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.target?.tagName==='INPUT')return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();move(step+(e.key==='ArrowRight'?1:-1));}});
   const help=document.createElement('button');help.id='gateway-help';help.type='button';help.textContent='使用引导';help.onclick=show;box.append(help);
   const cleanupAccount=cleanupMounted;cleanupMounted=()=>{viewer.close();dialog.close();viewer.remove();dialog.remove();guideStyle.remove();cleanupAccount();};
   if(!getValue(GUIDE,false))show();
  }

 }

 return{transport,configured,credential,login,logout,call,mount,destroy:()=>cleanupMounted(),canUse,requireFeature,statusSummary,openAccount:(message='')=>showAccount(message),features:()=>({webSearch:!configured()||getValue('gateway-capabilities-v1',{}).web_search===true})};
}
return{create,baseURL,accessSummary};
});
