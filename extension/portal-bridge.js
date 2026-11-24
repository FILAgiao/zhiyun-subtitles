'use strict';
(() => {
  const WEB_KEY='gateway-web-session',BRIDGE_KEY='gateway-web-bridge-session',STATE='gateway-extension-auth',READY='zy-portal-session-ready';
  if(window.top!==window||location.origin!=='https://47.77.182.216.sslip.io'||!/^\/gateway\/(?:index\.html|(?:download|study|account)(?:\/|\.html)?)?$/.test(location.pathname))return;
  function hasWebsiteChoice(){
    const manual='gateway-web-manual-login';
    try{if(localStorage.getItem(WEB_KEY)||localStorage.getItem('gateway-web-logged-out')||localStorage.getItem(manual))return true;}catch{}
    try{return !!sessionStorage.getItem(manual);}catch{return false;}
  }
  let pending=false, websiteToken='', attemptedToken='';
  function syncWebsiteLogin(){
    let token;
    try{
      token=localStorage.getItem(WEB_KEY)||sessionStorage.getItem(WEB_KEY)||'';
      if(localStorage.getItem('gateway-web-logged-out')||token===localStorage.getItem(BRIDGE_KEY)||token===sessionStorage.getItem(BRIDGE_KEY))return;
    }catch{return;}
    if(!token||token===attemptedToken)return;
    websiteToken=attemptedToken=token;
    try{
      chrome.runtime.sendMessage({type:'zy-portal-use-website-session',token},response=>{
        if((chrome.runtime.lastError||!response?.ok)&&attemptedToken===token)attemptedToken='';
      });
    }catch{attemptedToken='';}
  }
  function syncWebsiteLogout(){
    if(!websiteToken)return;
    const token=websiteToken;
    websiteToken=attemptedToken='';
    try{chrome.runtime.sendMessage({type:'zy-portal-website-logout',token},()=>{void chrome.runtime.lastError;});}catch{}
  }
  function requestSession(){
    if(pending||hasWebsiteChoice())return;
    pending=true;
    const finish=response=>{
      pending=false;
      try{
        if(!hasWebsiteChoice()){
          if(response?.ok&&response.token){
            sessionStorage.setItem(BRIDGE_KEY,response.token);
            sessionStorage.setItem(WEB_KEY,response.token);
          }else{
            sessionStorage.removeItem(BRIDGE_KEY);
            sessionStorage.removeItem(WEB_KEY);
          }
        }
        sessionStorage.setItem(STATE,JSON.stringify({state:'ready',time:Date.now(),notice:response?.ok===false?'插件登录衔接暂不可用，请刷新重试。':''}));
      }catch{}
      window.dispatchEvent(new Event(READY));
    };
    try{
      sessionStorage.setItem(STATE,JSON.stringify({state:'pending',time:Date.now()}));
      chrome.runtime.sendMessage({type:'zy-portal-session'},response=>finish(chrome.runtime.lastError?{ok:false}:response||{ok:false}));
    }catch{finish({ok:false});}
  }
  window.addEventListener('zy-portal-session-request',requestSession);
  window.addEventListener('zy-portal-website-login',syncWebsiteLogin);
  window.addEventListener('zy-portal-website-logout',syncWebsiteLogout);
  window.addEventListener('storage',event=>{
    if(event.key==='gateway-web-logged-out'&&event.newValue)syncWebsiteLogout();
    else if(event.key===WEB_KEY&&event.newValue)syncWebsiteLogin();
  });
  if(hasWebsiteChoice())syncWebsiteLogin();
  else requestSession();
})();
