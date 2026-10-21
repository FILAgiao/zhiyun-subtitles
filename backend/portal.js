/* Same-origin account session; no external proxy or saved credentials. */
'use strict';
(() => {
  const KEY='gateway-web-session', API='/gateway', APP='zhiyun-subtitles';
  const $=id=>document.getElementById(id), controllers=new Set();
  let token='', profile=null, generation=0, busy=false,sessionNotice='';
  try { token=sessionStorage.getItem(KEY)||''; } catch {}
  const session=()=>({token,profile,generation,notice:sessionNotice});
  function update(){
    document.querySelectorAll('[data-login]').forEach(button=>button.hidden=!!profile);
    document.querySelectorAll('.signed-user').forEach(node=>node.hidden=!profile);
    document.querySelectorAll('[data-user-name]').forEach(node=>node.textContent=profile?.username||profile?.email||'我的账号');
    window.dispatchEvent(new CustomEvent('portal-session-change',{detail:{profile,generation}}));
  }
  function save(value){try{value?sessionStorage.setItem(KEY,value):sessionStorage.removeItem(KEY);}catch{}}
  function resetPassword(){$('login-password').value='';$('login-password').type='password';$('password-toggle').textContent='显示';$('password-toggle').setAttribute('aria-pressed','false');}
  function clear(message=''){generation++;sessionNotice=message;for(const controller of controllers)controller.abort();controllers.clear();token='';profile=null;save('');resetPassword();update();}
  async function api(path,{method='GET',body,auth=token,timeout=15000}={}){
    if(!path.startsWith('/v1/'))throw Error('请求路径无效');
    const controller=new AbortController();controllers.add(controller);let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
    try{
      const response=await fetch(API+path,{method,headers:{'Content-Type':'application/json','X-App-Id':APP,'X-Client-Type':'study-web',...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});
      let data=null;try{data=await response.json();}catch{}
      if(!response.ok){
        let message=typeof data?.error==='string'?data.error:'服务暂时不可用，请稍后再试。';
        if(response.status===401){
          if(path==='/v1/auth/login')message='账号或密码不正确，请核对后重试。';
          else {message='登录已过期，请重新登录。';if(auth&&auth===token){clear(message);const notice=$('study-notice')||$('channel-notice');if(notice){notice.textContent=message;notice.classList.add('error');}}}
        }else if(response.status===404)message='当前服务尚未开放此功能，请稍后再试。';
        else if(response.status===429)message='操作较频繁，请稍后再试。';
        const error=Error(message);error.status=response.status;throw error;
      }
      if(data===null||typeof data!=='object')throw Error('服务返回异常，请稍后再试。');
      return data;
    }catch(error){
      if(timedOut)throw Error('连接超时（15 秒），请检查网络后手动重试。');
      if(error.name==='AbortError')throw error;
      if(error instanceof TypeError)throw Error('无法连接服务，请检查网络后重试。');
      throw error;
    }finally{clearTimeout(timer);controllers.delete(controller);}
  }
  function notice(message,error=false){$('login-status').textContent=message;$('login-status').classList.toggle('error',error);}
  function openLogin(){const dialog=$('login-dialog');if(!dialog.open){notice('');dialog.showModal();requestAnimationFrame(()=>$('login-name').focus());}}
  document.querySelectorAll('[data-login]').forEach(button=>button.addEventListener('click',openLogin));
  $('login-dialog').addEventListener('close',resetPassword);
  $('login-dialog').querySelector('[data-close-login]').addEventListener('click',()=>$('login-dialog').close());
  $('password-toggle').addEventListener('click',()=>{const show=$('login-password').type==='password';$('login-password').type=show?'text':'password';$('password-toggle').textContent=show?'隐藏':'显示';$('password-toggle').setAttribute('aria-pressed',String(show));});
  $('portal-login-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;$('login-submit').disabled=true;notice('正在登录…');
    const own=generation;
    try{
      const data=await api('/v1/auth/login',{method:'POST',auth:'',body:{email:$('login-name').value.trim(),password:$('login-password').value}});
      if(own!==generation)return;
      if(typeof data.token!=='string'||!data.token)throw Error('登录响应异常，请稍后再试。');
      const me=await api('/v1/me',{auth:data.token});if(own!==generation)return;
      generation++;sessionNotice='';token=data.token;profile=me;save(token);resetPassword();notice('');$('login-dialog').close();update();
      const params=new URLSearchParams(location.search);if(params.has('login')){params.delete('login');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);}
    }catch(error){if(error.name!=='AbortError'&&own===generation)notice(error.message,true);}
    finally{busy=false;$('login-submit').disabled=false;}
  });
  document.querySelectorAll('[data-logout]').forEach(button=>button.addEventListener('click',async()=>{
    const old=token;clear();if(!old)return;
    try{await api('/v1/auth/logout',{method:'POST',auth:old,body:{}});}catch(error){if(error.name!=='AbortError'){const node=$('study-notice')||$('channel-notice');if(node){node.textContent='本机已退出；服务器会话撤销未成功，请稍后再试。';node.classList.add('error');}}}
  }));
  const ready=(async()=>{if(token){const own=generation;try{const me=await api('/v1/me');if(own===generation)profile=me;}catch(error){if(error.name!=='AbortError'&&own===generation){sessionNotice=error.message;const node=$('study-notice')||$('channel-notice');if(node){node.textContent=error.message;node.classList.add('error');}}}}update();if(new URLSearchParams(location.search).get('login')==='1'&&!profile)openLogin();})();
  window.ZYPortal={api,session,ready,openLogin,clear,date:(value)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})};
})();
