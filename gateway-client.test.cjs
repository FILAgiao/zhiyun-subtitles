const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,baseURL}=require('./gateway-client.js');
function setup(account={}){const calls=[],storage={'gateway-account-v1':account};const api=create({getValue:(k,d)=>storage[k]??d,setValue:(k,v)=>storage[k]=v,request:o=>{calls.push(o);return{abort(){}};}});return{calls,storage,api};}
test('only safe service origins accepted',()=>{assert.equal(baseURL('https://api.example.test'),'https://api.example.test');for(const url of ['http://evil.test','https://user:pass@api.test','https://api.test/path','https://api.test/?key=x'])assert.throws(()=>baseURL(url));});
test('vendor credentials stripped for both providers; ordinary media untouched',()=>{const {api,calls}=setup({url:'https://api.test',token:'user-session'});for(const url of ['https://ark.cn-beijing.volces.com/api/v3/responses','https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit','https://openspeech.bytedance.com/api/v3/auc/bigmodel/query'])api.transport({url,headers:{Authorization:'Bearer vendor-secret','x-api-key':'vendor-secret','X-Api-Request-Id':'task'},data:'{}'});for(const o of calls){assert.ok(o.url.startsWith('https://api.test/v1/'));assert.equal(o.headers.Authorization,'Bearer user-session');assert.equal(o.headers['X-App-Id'],'zhiyun-subtitles');assert.ok(!JSON.stringify(o).includes('vendor-secret'));}api.transport({url:'https://vod.cmc.zju.edu.cn/movie.mp4'});assert.equal(calls[3].url,'https://vod.cmc.zju.edu.cn/movie.mp4');});
test('configured service never falls back after logout',async()=>{const {api,calls}=setup({url:'https://api.test',token:''});const response=await new Promise(resolve=>api.transport({url:'https://ark.cn-beijing.volces.com/api/v3/responses',headers:{Authorization:'Bearer vendor-secret'},onload:resolve}));assert.equal(response.status,401);assert.equal(calls.length,0);});
test('login saves session only, logout revokes and clears it',async()=>{const {api,calls,storage}=setup();const login=api.login('https://api.test','a@test','password');calls[0].onload({status:200,responseText:JSON.stringify({token:'opaque',expires_in:604800})});await login;assert.deepEqual(storage['gateway-account-v1'],{url:'https://api.test',token:'opaque'});assert.equal(calls[0].headers.Authorization,undefined);const logout=api.logout();calls[1].onload({status:200,responseText:'{}'});await logout;assert.equal(api.credential(),'');assert.equal(api.configured(),true);});
test('production build pins gateway domain and cannot use vendor key while logged out',()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gateway-build-'));
 try{
  for(const f of ['package.json','load-onboarding-assets.cjs','load-card-quotes.cjs','build-userscript.cjs','zhiyun-subtitles.user.js','progressive-cache.bundle.js','cache-storage.js','study-ui.js','warm-theme.js','appearance-theme.js','card-render.bundle.js','classroom-media.js','speech-phonetics.bundle.js','speech-alignment.js','speech-stream.js','player-interactions.js','math-render.bundle.js','ai-learning.js','capture-bridge-client.js','translation-request.js','gateway-client.js','web-assistant.js'])fs.copyFileSync(f,path.join(dir,f));
  fs.mkdirSync(path.join(dir,'assets'));for(const asset of ['study-eagle.png','qiushi-eagle.svg','brand-logo.png','share-qr.png'])fs.copyFileSync('assets/'+asset,path.join(dir,'assets',asset));
  fs.cpSync('assets/onboarding',path.join(dir,'assets/onboarding'),{recursive:true});
  fs.mkdirSync(path.join(dir,'assets/quotes'));fs.copyFileSync('assets/quotes/quotes.json',path.join(dir,'assets/quotes/quotes.json'));
  const quotesPath=path.join(dir,'assets/quotes/quotes.json'),library=JSON.parse(fs.readFileSync(quotesPath,'utf8'));library.quotes.push({id:'editable-fixture',text:'名言库编辑示例句',author:'测试作者',sourceTitle:'夹具来源',source:'https://example.test/quote'});fs.writeFileSync(quotesPath,JSON.stringify(library));
  execFileSync(process.execPath,['build-userscript.cjs'],{cwd:dir,env:{...process.env,GATEWAY_ORIGIN:'https://api.production.test'},stdio:'pipe'});
  const script=fs.readFileSync(path.join(dir,'zhiyun-subtitles.user.js'),'utf8');assert.match(script,/名言库编辑示例句/,'editing the JSON library changes the built client');assert.match(script,/\/\/ @connect\s+api\.production\.test/);assert.ok(!script.includes('const DEFAULT_ORIGIN=\'\';'));
  const start=script.indexOf('/* Account and transport adapter;'),end=script.indexOf('const ZY_STUDY_MASCOT=',start);const context={URL,queueMicrotask};vm.createContext(context);vm.runInContext(script.slice(start,end),context);
  const api=context.ZYGateway.create({getValue:()=>({}),setValue(){},request(){throw Error('provider must not be contacted');}});assert.equal(api.configured(),true);assert.equal(api.credential(),'');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('guest speech is rejected before any network request',async()=>{const {api,calls}=setup({url:'https://api.test'});const response=await new Promise(resolve=>api.transport({url:'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit',headers:{'X-Api-Key':'guest-speech','X-Api-Request-Id':'task'},onload:resolve}));assert.equal(response.status,401);assert.equal(calls.length,0);});

test('expired session clears stored token',()=>{const {api,calls,storage}=setup({url:'https://api.test',token:'expired'});let status;api.transport({url:'https://ark.cn-beijing.volces.com/api/v3/responses',onload:r=>status=r.status});calls[0].onload({status:401});assert.equal(status,401);assert.equal(storage['gateway-account-v1'].token,'');});

test('Incremental learning uses short JSON requests when GM stream is unavailable',async()=>{
 const calls=[];let polls=0,creates=0;const texts=[];const account={url:'https://api.test',token:'session'};
 const api=create({getValue:()=>account,setValue(){},request:o=>{
  assert.notEqual(o.responseType,'stream');assert.equal(o.fetch,undefined);calls.push(o);
  const path=new URL(o.url).pathname;let result;
  if(path.endsWith('/create')){creates++;result={id:'opaque-job',state:'pending'};}
  else if(path.endsWith('/poll')){polls++;result=polls===1?{state:'generating',text:'hi'}:{state:'complete',text:'hi there',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'hi there'}]}]}};}
  else throw Error('unexpected route');
  queueMicrotask(()=>o.onload({status:path.endsWith('/create')?202:200,responseText:JSON.stringify(result)}));return{abort(){}};
 }});
 const ai=require('./ai-learning.js');const answer=await ai.requestResponse(api.transport,ai.makeBody({question:'hi'}),'session',null,t=>texts.push(t));
 assert.equal(answer,'hi there');assert.deepEqual(texts,['hi','hi there']);assert.equal(creates,1);assert.equal(polls,2);assert.ok(calls.every(o=>o.headers.Authorization==='Bearer session'));
});
test('Aborting incremental learning stops polling and cancels the same server job',async()=>{
 const calls=[];let handle;
 const api=create({getValue:()=>({url:'https://api.test',token:'session'}),setValue(){},request:o=>{calls.push(o);if(o.url.endsWith('/create'))queueMicrotask(()=>o.onload({status:202,responseText:'{"id":"one-job"}'}));return{abort(){}};}});
 handle=api.transport({url:'https://ark.cn-beijing.volces.com/api/v3/responses',responseType:'stream',data:'{}'});await new Promise(r=>setImmediate(r));handle.abort();
 assert.equal(calls.filter(o=>o.url.endsWith('/cancel')).length,1);assert.equal(JSON.parse(calls.at(-1).data).id,'one-job');assert.equal(calls.filter(o=>o.url.endsWith('/create')).length,1);
});

test('server plan metadata controls all premium features and stale sessions cannot reuse it',async()=>{
 const features=['learning','translation','speech','learning_records','card_export'];
 const {api,calls,storage}=setup();
 for(const plan of ['free','pro','ultra']){
  const promise=api.login('https://api.test','a@test','password');
  calls.at(-1).onload({status:200,responseText:JSON.stringify({token:'session-'+plan,membership:{plan,active:plan!=='free'},permissions:Object.fromEntries(features.map(f=>[f,plan!=='free']))})});
  await promise;for(const feature of features)assert.equal(api.canUse(feature),plan!=='free');
 }
 storage['gateway-account-v1'].token='a-different-session';
 assert.equal(api.canUse('learning'),false);
});

test('trial status separates expiry from usage, never invents a deadline, and respects exact expiry',()=>{
 const {accessSummary}=require('./gateway-client.js'),now=Date.UTC(2026,9,19,0);
 const data={membership:{plan:'trial',active:true,expires:now/1000+6*86400+3600},usage:{request_limit:20,requests:4}};
 let summary=accessSummary(data,now);assert.match(summary.text,/免费体验.*剩 6 天/);assert.equal(summary.remaining,16);assert.match(summary.deadline,/北京时间/);
 summary=accessSummary({...data,membership:{...data.membership,expires:null}},now);assert.equal(summary.text,'免费体验');assert.equal(summary.deadline,'未设置到期时间');
 summary=accessSummary({...data,usage:{request_limit:20,requests:20}},now);assert.equal(summary.text,'体验额度已用完');
 summary=accessSummary({...data,membership:{...data.membership,expires:now/1000}},now);assert.equal(summary.text,'体验已结束');assert.equal(summary.expired,true);
 summary=accessSummary({membership:{plan:'trial',active:true},usage:{}},now);assert.equal(summary.remaining,null);assert.equal(summary.quota,'额度待刷新');
 assert.equal(accessSummary({membership:{plan:'free'}},now),null);
 assert.ok(!accessSummary({...data,membership:{plan:'pro',active:true}},now).text.includes('免费'));
});

async function authenticatedStream(extra={}){
 const context=setup();const pending=context.api.login('https://api.test','a@test','password');context.calls.at(-1).onload({status:200,responseText:JSON.stringify({token:'stream-account',membership:{plan:'pro',active:true},permissions:{speech:true},capabilities:{speech_stream:true},...extra})});await pending;return context;
}

test('stream support uses the live authenticated account profile, never globally cached capabilities',async()=>{
 const context=setup({url:'https://api.test',token:'saved-session'});context.storage['gateway-capabilities-v1']={speech_stream:true};assert.equal(context.api.speechStream.supported(),false);
 const refresh=context.api.call('/v1/me');context.calls.at(-1).onload({status:200,responseText:JSON.stringify({membership:{active:true},permissions:{speech:true},capabilities:{speech_stream:true}})});await refresh;assert.equal(context.api.speechStream.supported(),true);
 context.storage['gateway-account-v1'].token='someone-else';assert.equal(context.api.speechStream.supported(),false);
});

test('stream support respects explicit account speech permission and current service capability',async()=>{
 for(const extra of [{permissions:{speech:false}},{membership:{plan:'free',active:false}},{capabilities:{}},{capabilities:{speech_stream:false}}]){const context=await authenticatedStream(extra);assert.equal(context.api.speechStream.supported(),false);}
});

test('bound stream transport sends only account credentials to fixed HTTPS routes',async()=>{
 const {api,calls}=await authenticatedStream();const transport=api.speechStream.bindTransport();
 for(const action of ['create','push','poll','finish','cancel']){
  const payload=action==='create'?{request_id:'d7c96f78-d974-4c28-8656-7a555366d226'}:{id:'one-session'};const pending=transport(action,payload);const call=calls.at(-1);assert.equal(call.method,'POST');assert.equal(call.url,'https://api.test/v1/speech/stream/'+action);assert.equal(call.headers.Authorization,'Bearer stream-account');assert.equal(call.headers['Content-Type'],'application/json');assert.equal(call.headers['X-App-Id'],'zhiyun-subtitles');assert.equal(call.headers['X-Api-Key'],undefined);assert.deepEqual(JSON.parse(call.data),payload);if(action==='create')assert.equal(call.headers['X-Api-Request-Id'],payload.request_id);call.onload({status:action==='create'?202:200,responseText:'{"id":"one-session","state":"listening"}'});assert.equal((await pending).id,'one-session');
 }
 const count=calls.length;await assert.rejects(transport('../ark/responses',{}),{code:'invalid_stream_action'});assert.equal(calls.length,count);
});

test('stream transport cannot start for an unauthenticated cached session',async()=>{
 const {api,calls,storage}=setup({url:'https://api.test',token:'old-session'});storage['gateway-capabilities-v1']={speech_stream:true};await assert.rejects(api.speechStream.bindTransport()('create',{request_id:'new-session'}),{code:'speech_stream_unsupported'});assert.equal(calls.length,0);
});

test('account changes block uploads while cleanup still uses the original session token',async()=>{
 const {api,calls,storage}=await authenticatedStream();const transport=api.speechStream.bindTransport(),before=calls.length;storage['gateway-account-v1']={url:'https://api.test',token:'new-account'};await assert.rejects(transport('push',{id:'one',sequence:0,audio:'AA=='}),{code:'account_changed'});assert.equal(calls.length,before);
 const cancel=transport('cancel',{id:'one'});assert.equal(calls.at(-1).headers.Authorization,'Bearer stream-account');calls.at(-1).onload({status:200,responseText:'{"state":"cancelled"}'});await cancel;assert.equal(storage['gateway-account-v1'].token,'new-account');
});

test('a response after an account switch cannot deliver old account recognition results',async()=>{
 const {api,calls,storage}=await authenticatedStream();const transport=api.speechStream.bindTransport(),pending=transport('poll',{id:'one'});storage['gateway-account-v1'].token='new-account';calls.at(-1).onload({status:200,responseText:'{"result":{"text":"private old words"}}'});await assert.rejects(pending,{code:'account_changed'});
});

test('stream HTTP errors retain status and code for safe fallback and retry decisions',async()=>{
 const {api,calls}=await authenticatedStream(),transport=api.speechStream.bindTransport();const pending=transport('create',{request_id:'one'});calls.at(-1).onload({status:503,responseText:'{"error":"stream missing","error_code":"speech_stream_unavailable"}'});await assert.rejects(pending,{status:503,code:'speech_stream_unavailable',message:'stream missing'});
});

test('a matching token HTTP 401 clears the current profile and prevents further stream use',async()=>{
 const {api,calls,storage}=await authenticatedStream(),transport=api.speechStream.bindTransport(),pending=transport('poll',{id:'one'});calls.at(-1).onload({status:401,responseText:'{"error":"expired"}'});await assert.rejects(pending,{status:401});assert.equal(storage['gateway-account-v1'].token,'');assert.equal(api.speechStream.supported(),false);
});

test('old-account cleanup HTTP 401 cannot clear a newly signed-in account',async()=>{
 const {api,calls,storage}=await authenticatedStream(),transport=api.speechStream.bindTransport();storage['gateway-account-v1'].token='new-account';const pending=transport('cancel',{id:'one'});calls.at(-1).onload({status:401,responseText:'{"error":"old session expired"}'});await assert.rejects(pending,{status:401});assert.equal(storage['gateway-account-v1'].token,'new-account');
});

test('AbortSignal stops the actual GM request and rejects the stream operation exactly once',async()=>{
 const {api,calls}=await authenticatedStream();let aborted=0;const transport=api.speechStream.bindTransport(),controller=new AbortController(),pending=transport('push',{id:'one',sequence:0,audio:'AA=='},{signal:controller.signal});const request=calls.at(-1);request.abort=()=>aborted++;
 // setup's handle is intentionally separate from options; verify through a purpose-built adapter below.
 controller.abort();await assert.rejects(pending,{code:'cancelled'});request.onload({status:200,responseText:'{}'});
 const storage={'gateway-account-v1':{url:'https://api.test',token:'one'}},requests=[];let handleAborts=0;const second=create({getValue:(k,d)=>storage[k]??d,setValue:(k,v)=>storage[k]=v,request:o=>{requests.push(o);return{abort(){handleAborts++;o.onabort?.();}};}});const refresh=second.call('/v1/me');requests.at(-1).onload({status:200,responseText:'{"permissions":{"speech":true},"capabilities":{"speech_stream":true}}'});await refresh;const abortController=new AbortController(),upload=second.speechStream.bindTransport()('push',{id:'one',sequence:0,audio:'AA=='},{signal:abortController.signal});abortController.abort();await assert.rejects(upload,{code:'cancelled'});assert.equal(handleAborts,1);
});

test('pre-aborted stream operations never send network requests',async()=>{
 const {api,calls}=await authenticatedStream(),controller=new AbortController();controller.abort();const before=calls.length;await assert.rejects(api.speechStream.bindTransport()('poll',{id:'one'},{signal:controller.signal}),{code:'cancelled'});assert.equal(calls.length,before);
});

test('stream transport reports malformed successful JSON and network failures explicitly',async()=>{
 const {api,calls}=await authenticatedStream(),transport=api.speechStream.bindTransport();let pending=transport('poll',{id:'one'});calls.at(-1).onload({status:200,responseText:'not json'});await assert.rejects(pending,{code:'invalid_stream_response',status:200});pending=transport('push',{id:'one',sequence:0,audio:'AA=='});calls.at(-1).onerror();await assert.rejects(pending,{code:'stream_network_error'});
});

test('stream transport exposes GM timeout as a bounded stream timeout and aborts its request',async()=>{
 const {api,calls}=await authenticatedStream(),transport=api.speechStream.bindTransport(),pending=transport('push',{id:'one',sequence:0,audio:'AA=='});calls.at(-1).ontimeout();await assert.rejects(pending,{code:'stream_timeout'});
});


test('first-click access preparation shares the initial profile request and awaits live capabilities',async()=>{
 const {api,calls}=setup({url:'https://api.test',token:'saved-session'});
 const initial=api.ensureAccess(true),click=api.ensureAccess();assert.equal(initial,click);assert.equal(calls.length,1);assert.equal(api.canUse('speech'),false);
 calls[0].onload({status:200,responseText:JSON.stringify({permissions:{speech:true},capabilities:{speech_stream:true}})});
 await click;assert.equal(api.canUse('speech'),true);assert.equal(api.speechStream.supported(),true);await api.ensureAccess();assert.equal(calls.length,1);
});

test('access preparation rejects account or service switches and cannot restore stale permissions',async()=>{
 for(const next of [{url:'https://api.test',token:'new-session'},{url:'https://other.test',token:'saved-session'}]){
  const {api,calls,storage}=setup({url:'https://api.test',token:'saved-session'}),pending=api.ensureAccess();storage['gateway-account-v1']=next;
  calls[0].onload({status:200,responseText:JSON.stringify({permissions:{speech:true},capabilities:{speech_stream:true}})});
  await assert.rejects(pending,{code:'account_changed'});assert.equal(api.canUse('speech'),false);assert.equal(api.speechStream.supported(),false);
 }
});

test('failed preparation makes no paid request and a later click can retry the profile',async()=>{
 const {api,calls}=setup({url:'https://api.test',token:'saved-session'}),first=api.ensureAccess();calls[0].onerror();await assert.rejects(first);
 const retry=api.ensureAccess();assert.equal(calls.length,2);assert.ok(calls.every(call=>call.url.endsWith('/v1/me')));
 calls[1].onload({status:200,responseText:JSON.stringify({permissions:{speech:false},capabilities:{speech_stream:true}})});await retry;assert.equal(api.canUse('speech'),false);
});


test('standard speech forwards only known safe gateway error meanings without upstream body text',()=>{
 const {api,calls}=setup({url:'https://api.test',token:'session'});let response;
 api.transport({url:'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query',onload:r=>response=r});
 calls.at(-1).onload({status:502,responseText:JSON.stringify({error_code:'speech_upstream_auth',error:'secret-provider-key and audio'})});
 assert.equal(response.gatewaySpeechError.code,'speech_upstream_auth');assert.match(response.gatewaySpeechError.message,/授权失败/);assert.ok(!response.gatewaySpeechError.message.includes('secret-provider-key'));
 api.transport({url:'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query',onload:r=>response=r});calls.at(-1).onload({status:502,responseText:JSON.stringify({error_code:'unknown',error:'secret-provider-key'})});assert.equal(response.gatewaySpeechError,undefined);
});
