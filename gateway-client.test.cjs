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
  for(const f of ['build-userscript.cjs','zhiyun-subtitles.user.js','progressive-cache.bundle.js','cache-storage.js','study-ui.js','player-interactions.js','ai-learning.js','gateway-client.js'])fs.copyFileSync(f,path.join(dir,f));
  fs.mkdirSync(path.join(dir,'assets'));fs.copyFileSync('assets/study-eagle.png',path.join(dir,'assets/study-eagle.png'));
  execFileSync(process.execPath,['build-userscript.cjs'],{cwd:dir,env:{...process.env,GATEWAY_ORIGIN:'https://api.production.test'},stdio:'pipe'});
  const script=fs.readFileSync(path.join(dir,'zhiyun-subtitles.user.js'),'utf8');assert.match(script,/\/\/ @connect\s+api\.production\.test/);assert.ok(!script.includes('const DEFAULT_ORIGIN=\'\';'));
  const start=script.indexOf('/* Account and transport adapter;'),end=script.indexOf('const ZY_STUDY_MASCOT=',start);const context={URL,queueMicrotask};vm.createContext(context);vm.runInContext(script.slice(start,end),context);
  const api=context.ZYGateway.create({getValue:()=>({}),setValue(){},request(){throw Error('provider must not be contacted');}});assert.equal(api.configured(),true);assert.equal(api.credential(),'');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('guest speech goes through gateway without a session or vendor secret',()=>{const {api,calls}=setup({url:'https://api.test'});api.transport({url:'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit',headers:{'X-Api-Key':'guest-speech','X-Api-Request-Id':'task'}});assert.equal(calls[0].url,'https://api.test/v1/speech/submit');assert.equal(calls[0].headers.Authorization,undefined);assert.equal(calls[0].headers['X-Api-Key'],undefined);});
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
