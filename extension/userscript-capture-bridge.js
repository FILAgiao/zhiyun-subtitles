/* Temporary native screenshot bridge for a Tampermonkey installation.
 * This content script exposes capture only. It never exposes extension storage,
 * credentials, arbitrary runtime messages or network access to the page.
 *
 * DOM messages are observable and forgeable by page scripts. The random IDs
 * correlate replies; they are not secret authentication tokens. Capture also
 * requires a recent, real screenshot gesture, consumes that gesture once, and
 * checks that the top-level document remains visible and focused.
 */
(function(){
 'use strict';
 if(window.top!==window||typeof chrome==='undefined'||!chrome.runtime?.sendMessage)return;

 const protocolVersion=1,requestEvent='zy-userscript-capture-request',responseEvent='zy-userscript-capture-response';
 const activationTTL=2500,middleTTL=60000;
 const screenshotButtons=new Set(['web-page-ask','ai-capture','ai-screenshot','ai-capture-retry']);
 let activation=null,middle=null,inflight=null;

 const visible=()=>document.visibilityState==='visible'&&document.hasFocus();
 const requestID=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(value);
 const nonce=()=>{const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');};
 function emit(message){document.dispatchEvent(new CustomEvent(responseEvent,{detail:JSON.stringify({protocolVersion,...message})}));}
 function reply(message,ok,extra={}){emit({type:message.type,requestId:message.requestId,...(message.activationId?{activationId:message.activationId}:{}),ok,...extra});}
 function revoke(){activation=null;middle=null;if(inflight)inflight.cancelled=true;}
 function assistantHost(){
  const host=document.getElementById('zy-subtitle-host');
  return host?.isConnected&&host.shadowRoot?.getElementById('ai-learning')?host:null;
 }
 function elementVisible(element){
  if(!element?.isConnected||element.hidden||element.disabled)return false;
  const box=element.getBoundingClientRect();
  if(!box.width||!box.height||box.right<=0||box.bottom<=0||box.left>=innerWidth||box.top>=innerHeight)return false;
  for(let node=element;node&&node!==document;node=node.parentElement||node.getRootNode?.().host){
   if(node.hidden)return false;
   const style=getComputedStyle(node);
   if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;
  }
  return true;
 }
 function modified(event){return event.altKey||event.ctrlKey||event.metaKey||event.shiftKey;}
 function authorize(gesture){
  if(!visible())return;
  activation={id:nonce(),expiresAt:Date.now()+activationTTL,url:location.href};
  emit({type:'activation',activationId:activation.id,expiresAt:activation.expiresAt,gesture});
 }

 // Both ends of a middle-button gesture must be real. Waiting for mouseup gives
 // long drags their own short authorization window after the rectangle is drawn.
 document.addEventListener('mousedown',event=>{
  middle=null;
  if(!event.isTrusted||event.button!==1||modified(event)||!visible()||!assistantHost())return;
  const target=event.composedPath()[0];
  if(target?.closest?.('a,input,textarea,select,button,[contenteditable],#ai-crop'))return;
  middle={began:Date.now(),url:location.href};
 },true);
 document.addEventListener('mouseup',event=>{
  if(event.button!==1)return;
  const candidate=middle;middle=null;
  if(!candidate||!event.isTrusted||modified(event)||candidate.url!==location.href||Date.now()-candidate.began>middleTTL)return;
  const host=assistantHost(),crop=host?.shadowRoot?.getElementById('ai-crop');
  if(!crop||crop.getAttribute('aria-label')!=='\u62d6\u6846\u622a\u56fe'||!elementVisible(crop))return;
  authorize('middle');
 },true);
 document.addEventListener('click',event=>{
  if(!event.isTrusted||event.button!==0||modified(event)||!visible())return;
  const host=assistantHost();if(!host)return;
  const button=event.composedPath().find(node=>node?.tagName==='BUTTON'&&screenshotButtons.has(node.id));
  if(!button||button.getRootNode()!==host.shadowRoot||!elementVisible(button))return;
  authorize('button');
 },true);

 document.addEventListener(requestEvent,event=>{
  // JSON strings cross Tampermonkey's sandbox and the extension's isolated world.
  if(typeof event.detail!=='string'||event.detail.length>4096)return;
  let message;try{message=JSON.parse(event.detail);}catch(_){return;}
  if(!message||message.protocolVersion!==protocolVersion||!requestID(message.requestId))return;
  if(message.type==='hello'){reply(message,true,{available:true});return;}
  if(!['capture','cancel'].includes(message.type)||!requestID(message.activationId))return;
  if(message.type==='cancel'){
   if(inflight?.requestId===message.requestId&&inflight.activationId===message.activationId)inflight.cancelled=true;
   if(activation?.id===message.activationId)activation=null;
   return;
  }
  if(!visible()){revoke();reply(message,false,{errorCode:'BRIDGE_NOT_ACTIVE'});return;}
  if(inflight){reply(message,false,{errorCode:'BRIDGE_BUSY'});return;}
  const grant=activation;activation=null;
  if(!grant||grant.id!==message.activationId||grant.expiresAt<Date.now()||grant.url!==location.href){
   reply(message,false,{errorCode:'BRIDGE_NO_GESTURE'});return;
  }
  const session={requestId:message.requestId,activationId:message.activationId,url:location.href,cancelled:false};
  inflight=session;
  session.timer=setTimeout(()=>{
   if(inflight!==session)return;
   inflight=null;
   if(!session.cancelled)reply(message,false,{errorCode:'NATIVE_CAPTURE_FAILED'});
   session.cancelled=true;
  },12000);
  try{
   // Forward one fixed message, never a page-supplied type, payload or URL.
   chrome.runtime.sendMessage({type:'zy-capture-visible'},response=>{
    const failed=!!chrome.runtime.lastError;clearTimeout(session.timer);
    if(inflight!==session)return;
    inflight=null;
    if(session.cancelled)return;
    if(!visible()||session.url!==location.href){reply(message,false,{errorCode:'BRIDGE_NOT_ACTIVE'});return;}
    if(failed||response?.ok!==true||typeof response.data!=='string'||!response.data.startsWith('data:image/png;base64,')||response.data.length>64000000){
     reply(message,false,{errorCode:'NATIVE_CAPTURE_FAILED'});return;
    }
    reply(message,true,{data:response.data});
   });
  }catch(_){clearTimeout(session.timer);if(inflight===session)inflight=null;if(!session.cancelled)reply(message,false,{errorCode:'BRIDGE_NOT_ACTIVE'});}
 },true);

 window.addEventListener('blur',revoke);
 window.addEventListener('pagehide',revoke);
 document.addEventListener('visibilitychange',()=>{if(!visible())revoke();});
})();
