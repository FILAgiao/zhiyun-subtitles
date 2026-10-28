'use strict';
(() => {
  const WEB_KEY='gateway-web-session',STATE='gateway-extension-auth',READY='zy-portal-session-ready';
  if(window.top!==window||location.origin!=='https://47.77.182.216.sslip.io'||!/^\/gateway\/(?:study|account)(?:\/|\.html)?$/.test(location.pathname))return;
  // Set the pending marker synchronously at document_start; portal.js waits
  // before reading sessionStorage, including when extension storage is slow.
  const finish=response=>{
    try{if(response?.ok&&response.token)sessionStorage.setItem(WEB_KEY,response.token);if(response?.ok===false)sessionStorage.removeItem(WEB_KEY);sessionStorage.setItem(STATE,JSON.stringify({state:'ready',time:Date.now(),notice:response?.ok===false?'插件登录衔接暂不可用，请刷新重试。':''}));}catch{}
    window.dispatchEvent(new Event(READY));
  };
  try{
    sessionStorage.setItem(STATE,JSON.stringify({state:'pending',time:Date.now()}));
    chrome.runtime.sendMessage({type:'zy-portal-session'},response=>{if(chrome.runtime.lastError)finish({ok:false});else finish(response||{ok:false});});
  }catch{finish({ok:false});}
})();
