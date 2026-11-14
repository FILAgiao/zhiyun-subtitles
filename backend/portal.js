/* Same-origin account session; no external proxy or saved credentials. */
'use strict';
(() => {
  const KEY='gateway-web-session', LOGOUT='gateway-web-logged-out', MANUAL='gateway-web-manual-login', BRIDGE='gateway-web-bridge-session', API='/gateway', APP='zhiyun-subtitles';
  const $=id=>document.getElementById(id), controllers=new Set();
  let token='', profile=null, generation=0, busy=false,sessionNotice='',checking=false;
  function stored(){try{if(localStorage.getItem(LOGOUT))return '';return localStorage.getItem(KEY)||sessionStorage.getItem(KEY)||'';}catch{try{return sessionStorage.getItem(KEY)||'';}catch{return '';}}}
  token=stored();
  const session=()=>({token,profile,generation,notice:sessionNotice});
  function update(){
    document.querySelectorAll('[data-login]').forEach(button=>button.hidden=!!profile||(checking&&button.tagName==='A'));
    document.querySelectorAll('[data-session-pending]').forEach(node=>node.hidden=!checking);
    document.querySelectorAll('.signed-user').forEach(node=>node.hidden=!profile);
    document.querySelectorAll('[data-user-name]').forEach(node=>node.textContent=profile?.username||profile?.email||'我的账号');
    window.dispatchEvent(new CustomEvent('portal-session-change',{detail:{profile,generation}}));
  }
  function rememberManualLogin(){
    for(const area of ['localStorage','sessionStorage'])try{window[area].setItem(MANUAL,'1');}catch{}
  }
  function isBridgeSession(value){
    if(!value)return false;
    try{if(localStorage.getItem(BRIDGE)===value)return true;}catch{}
    try{return sessionStorage.getItem(BRIDGE)===value;}catch{return false;}
  }
  function save(value,loggedOut=false){
    const bridged=isBridgeSession(value);
    try{
      if(value){
        if(bridged)localStorage.setItem(BRIDGE,value);else localStorage.removeItem(BRIDGE);
        localStorage.setItem(KEY,value);
        localStorage.removeItem(LOGOUT);
      }else{
        if(loggedOut)localStorage.setItem(LOGOUT,'1');
        localStorage.removeItem(BRIDGE);
        localStorage.removeItem(KEY);
      }
    }catch{}
    try{
      if(!bridged)sessionStorage.removeItem(BRIDGE);
      if(value)sessionStorage.setItem(KEY,value);else sessionStorage.removeItem(KEY);
    }catch{}
  }
  function resetPassword(){if(!$('login-password'))return;$('login-password').value='';$('login-password').type='password';$('password-toggle').textContent='显示';$('password-toggle').setAttribute('aria-pressed','false');}
  function clear(message='',loggedOut=false){generation++;sessionNotice=message;for(const controller of controllers)controller.abort();controllers.clear();token='';profile=null;checking=false;save('',loggedOut);resetPassword();update();}
  async function api(path,{method='GET',body,auth=token,timeout=15000,responseType='json'}={}){
    if(!path.startsWith('/v1/'))throw Error('请求路径无效');
    const controller=new AbortController();if(auth||method!=='GET')controllers.add(controller);let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
    try{
      const response=await fetch(API+path,{method,headers:{'Content-Type':'application/json','X-App-Id':APP,'X-Client-Type':'study-web',...(auth?{Authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,credentials:'omit',cache:responseType==='blob'?'no-cache':'no-store',redirect:'error'});
      if(response.ok&&responseType==='blob')return await response.blob();
      let data=null;try{data=await response.json();}catch{}
      if(!response.ok){
        let message=typeof data?.error==='string'?data.error:'服务暂时不可用，请稍后再试。';
        if(response.status===401){
          if(path==='/v1/auth/login')message='账号或密码不正确，请核对后重试。';
          else if(typeof data?.error==='string'){
            message='登录已失效，请重新登录。';
            if(auth&&auth===token){
              if(!isBridgeSession(auth))rememberManualLogin();
              clear(message);
              showSessionNotice();
            }
          }
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
  function openLogin(){const dialog=$('login-dialog');if(dialog&&!dialog.open){notice('');dialog.showModal();requestAnimationFrame(()=>$('login-name').focus());}}
  document.querySelectorAll('button[data-login]').forEach(button=>button.addEventListener('click',openLogin));
  $('login-dialog')?.addEventListener('close',resetPassword);
  $('login-dialog')?.querySelector('[data-close-login]').addEventListener('click',()=>$('login-dialog').close());
  $('password-toggle')?.addEventListener('click',()=>{const show=$('login-password').type==='password';$('login-password').type=show?'text':'password';$('password-toggle').textContent=show?'隐藏':'显示';$('password-toggle').setAttribute('aria-pressed',String(show));});
  $('portal-login-form')?.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;busy=true;$('login-submit').disabled=true;notice('正在登录…');
    const own=generation;
    try{
      const data=await api('/v1/auth/login',{method:'POST',auth:'',body:{email:$('login-name').value.trim(),password:$('login-password').value}});
      if(own!==generation)return;
      if(typeof data.token!=='string'||!data.token)throw Error('登录响应异常，请稍后再试。');
      const me=await api('/v1/me',{auth:data.token});if(own!==generation)return;
      generation++;sessionNotice='';token=data.token;profile=me;checking=false;rememberManualLogin();save(token);showSessionNotice();resetPassword();notice('');$('login-dialog').close();update();
      const params=new URLSearchParams(location.search);if(params.has('login')){params.delete('login');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);}
    }catch(error){if(error.name!=='AbortError'&&own===generation)notice(error.message,true);}
    finally{busy=false;$('login-submit').disabled=false;}
  });
  document.querySelectorAll('[data-logout]').forEach(button=>button.addEventListener('click',async()=>{
    const old=token;clear('',true);if(!old)return;
    try{await api('/v1/auth/logout',{method:'POST',auth:old,body:{}});}catch(error){if(error.name!=='AbortError'){sessionNotice='本机已退出；服务器会话撤销未成功，请稍后再试。';showSessionNotice();}}
  }));
  function showSessionNotice(){
    const node=$('study-notice')||$('portal-session-notice');
    if(node){node.textContent=sessionNotice;node.classList.toggle('error',!!sessionNotice);}
  }
  async function waitForExtension(initialGeneration){
    let state;try{state=JSON.parse(sessionStorage.getItem('gateway-extension-auth')||'null');}catch{}
    if(state?.state==='pending'&&Date.now()-state.time<15000)await new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);window.removeEventListener('zy-portal-session-ready',done);resolve();};
      const timer=setTimeout(done,10000);window.addEventListener('zy-portal-session-ready',done,{once:true});
      try{if(JSON.parse(sessionStorage.getItem('gateway-extension-auth')||'null')?.state!=='pending')done();}catch{done();}
    });
    if(initialGeneration!==generation)return;
    try{token=stored();if(token)save(token);const latest=JSON.parse(sessionStorage.getItem('gateway-extension-auth')||'null');if(latest?.notice&&!token&&Date.now()-latest.time<15000){sessionNotice=latest.notice;showSessionNotice();}}catch{}
  }
  async function checkSession(allowHandoff=true){
    const own=generation, canRestore=allowHandoff&&isBridgeSession(token);
    try{
      if(token){
        const me=await api('/v1/me');
        if(own!==generation)return;
        profile=me;
        sessionNotice='';
        showSessionNotice();
      }
    }catch(error){
      if(canRestore&&error.status===401&&!token&&generation===own+1){
        const recovery=generation;
        checking=true;
        update();
        window.dispatchEvent(new Event('zy-portal-session-request'));
        await waitForExtension(recovery);
        if(recovery===generation)await checkSession(false);
        return;
      }
      if(error.name!=='AbortError'&&own===generation){sessionNotice=error.message;showSessionNotice();}
    }finally{
      if(own===generation){checking=false;update();}
    }
  }
  const ready=(async()=>{
    const initialGeneration=generation;
    try{checking=!!token||JSON.parse(sessionStorage.getItem('gateway-extension-auth')||'null')?.state==='pending';}catch{checking=!!token;}
    if(checking)update();
    await waitForExtension(initialGeneration);
    if(initialGeneration!==generation)return;
    await checkSession();
    if(new URLSearchParams(location.search).get('login')==='1'&&!profile&&!token&&!busy)openLogin();
  })();
  function retrySession(){
    if(!token||profile||checking||busy)return;
    checking=true;
    update();
    void checkSession();
  }
  window.addEventListener('online',retrySession);
  window.addEventListener('pageshow',event=>{if(event.persisted)retrySession();});
  window.addEventListener('storage',async event=>{
    if(event.storageArea!==localStorage||(event.key!==KEY&&event.key!==LOGOUT&&event.key!==null))return;
    const next=localStorage.getItem(LOGOUT)?'':localStorage.getItem(KEY)||'';
    if(next===token)return;
    generation++;
    for(const controller of controllers)controller.abort();
    controllers.clear();
    token=next;
    profile=null;
    checking=!!next;
    sessionNotice='';
    showSessionNotice();
    try{next?sessionStorage.setItem(KEY,next):sessionStorage.removeItem(KEY);}catch{}
    update();
    if(next)await checkSession();
  });
  window.ZYPortal={api,session,ready,openLogin,clear,date:(value)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})};
})();
