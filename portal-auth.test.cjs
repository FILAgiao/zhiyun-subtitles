'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPortalSession,portalLocation,allowedRequest}=require('./extension/background.js');
const BASE='https://47.77.182.216.sslip.io/gateway',KEY='gateway-account-v1';
function fixture(){
 const account={url:BASE,token:'private-extension-credential'},calls=[];
 const sender={id:'extension-id',frameId:0,url:BASE+'/study?login=1#clips',tab:{id:42}};
 const api={runtime:{id:sender.id,getManifest:()=>({version:'0.20.89'})},storage:{local:{get:async()=>({[KEY]:{...account}})}},tabs:{get:async()=>({url:sender.url})}};
 const request=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({token:'separate-private-web-session'})};};
 return {api,sender,request,account,calls};
}
test('website handoff is pinned to official top-level study and account pages',async()=>{
 for(const page of ['study','study/','study.html','account','account/','account.html'])assert.ok(portalLocation(BASE+'/'+page+'?login=1#clips'));
 for(const url of [BASE+'/',BASE+'/study/elsewhere','https://elsewhere.test/gateway/study','http://47.77.182.216.sslip.io/gateway/study','https://user:pass@47.77.182.216.sslip.io/gateway/study'])assert.equal(portalLocation(url),'');
 const f=fixture();for(const sender of [{...f.sender,id:'other'},{...f.sender,frameId:1},{...f.sender,url:'https://elsewhere.test/'},{...f.sender,tab:{}}])await assert.rejects(createPortalSession(f.api,sender,f.request));assert.equal(f.calls.length,0);
 assert.throws(()=>allowedRequest({url:BASE+'/v1/auth/web-session',method:'POST',data:'{}'}),'the general all-sites proxy cannot mint website sessions');
});
test('extension credential only reaches pinned server; page receives an independent session',async()=>{
 const f=fixture(),response=await createPortalSession(f.api,f.sender,f.request);
 assert.deepEqual(response,{ok:true,token:'separate-private-web-session'});assert.equal(f.calls.length,1);
 const {url,options}=f.calls[0];assert.equal(url,BASE+'/v1/auth/web-session');assert.equal(options.headers.Authorization,'Bearer '+f.account.token);assert.equal(options.body,'{}');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers['X-Client-Type'],'chrome-extension');assert.ok(!JSON.stringify(response).includes(f.account.token));
});
test('handoff rejects navigation, account changes, expired tokens and echoed extension tokens',async()=>{
 let f=fixture();f.api.tabs.get=async()=>({url:BASE+'/account'});await assert.rejects(createPortalSession(f.api,f.sender,f.request));assert.equal(f.calls.length,0);
 f=fixture();f.request=async()=>{f.account.token='different-account-token';return {ok:true,json:async()=>({token:'separate-web-token'})};};await assert.rejects(createPortalSession(f.api,f.sender,f.request));
 f=fixture();f.request=async()=>({ok:false,status:401});await assert.rejects(createPortalSession(f.api,f.sender,f.request),/已过期/);
 f=fixture();f.request=async()=>({ok:true,json:async()=>({token:f.account.token})});await assert.rejects(createPortalSession(f.api,f.sender,f.request),/异常/);
 f=fixture();f.account.url='https://elsewhere.test/gateway';assert.deepEqual(await createPortalSession(f.api,f.sender,f.request),{ok:true,token:''});assert.equal(f.calls.length,0);
});
