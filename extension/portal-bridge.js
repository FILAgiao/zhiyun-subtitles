'use strict';
(() => {
  const WEB_KEY='gateway-web-session',BRIDGE_KEY='gateway-web-bridge-session',STATE='gateway-extension-auth',READY='zy-portal-session-ready';
  if(window.top!==window||location.origin!=='https://47.77.182.216.sslip.io'||!/^\/gateway\/(?:index\.html|(?:download|study|account)(?:\/|\.html)?)?$/.test(location.pathname))return;
  function hasWebsiteChoice(){
    const manual='gateway-web-manual-login';
    try{if(localStorage.getItem(WEB_KEY)||localStorage.getItem('gateway-web-logged-out')||localStorage.getItem(manual))return true;}catch{}
    try{return !!sessionStorage.getItem(manual);}catch{return false;}
  }
  let pending=false;
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
  requestSession();
})();
