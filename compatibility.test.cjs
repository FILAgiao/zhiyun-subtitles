const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),readline=require('node:readline'),{once}=require('node:events');
const origin='https://47.77.182.216.sslip.io/gateway';
function frozen(){
 const manifest=JSON.parse(fs.readFileSync('fixtures/compat/provenance.json'));
 for(const [name,key] of [['gateway-client-0.20.48.js','gateway_sha256'],['background-0.20.48.js','background_sha256']])assert.equal(crypto.createHash('sha256').update(fs.readFileSync('fixtures/compat/'+name)).digest('hex'),manifest[key]);
 const module={exports:{}};vm.runInNewContext(fs.readFileSync('fixtures/compat/gateway-client-0.20.48.js','utf8'),{module,URL,setTimeout,clearTimeout,queueMicrotask});
 const background={exports:{}};vm.runInNewContext(fs.readFileSync('fixtures/compat/background-0.20.48.js','utf8'),{module:background,URL});
 return {gateway:module.exports,bridge:background.exports.allowedRequest};
}
function makeClient(factory,port,bridge){
 const storage={},requests=[];
 const request=o=>{
  requests.push(o);
  const init=bridge?bridge(o):{url:o.url,method:o.method||'GET',headers:o.headers,body:o.data};
  const url=new URL(init.url);assert.equal(url.origin,new URL(origin).origin,'never send a test request to the real service');assert.ok(url.pathname.startsWith('/gateway/v1/'));
  const control=new AbortController();
  fetch('http://127.0.0.1:'+port+url.pathname.slice('/gateway'.length),{method:init.method,headers:init.headers,body:init.body,signal:control.signal}).then(async r=>o.onload?.({status:r.status,responseText:await r.text(),responseHeaders:[...r.headers].map(([k,v])=>k+': '+v).join('\r\n')})).catch(e=>{if(!control.signal.aborted)o.onerror?.(e);});
  return {abort(){control.abort();}};
 };
 return {api:factory.create({request,getValue:(k,d)=>storage[k]??d,setValue:(k,v)=>storage[k]=v}),requests,storage};
}
function transport(api,o){return new Promise((resolve,reject)=>api.transport({...o,onload:resolve,onerror:reject}));}
function wav(){const b=Buffer.alloc(44+32000);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(32000,40);return {audio:{data:b.toString('base64')}};}

test('frozen 0.20.48 client and current client share the current backend', {timeout:30000},async t=>{
 const child=spawn('python',['-X','utf8','-u','-m','backend.compat_fixture'],{stdio:['pipe','pipe','pipe']});let diagnostics='';child.stderr.on('data',b=>diagnostics+=b);const lines=readline.createInterface({input:child.stdout});
 t.after(async()=>{lines.close();child.stdin.end('exit\n');if(child.exitCode===null)await Promise.race([once(child,'exit'),new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},5000);timer.unref();})]);});
 const ready=await Promise.race([once(lines,'line').then(([line])=>JSON.parse(line)),once(child,'exit').then(()=>{throw Error('fixture failed: '+diagnostics);})]);
 const old=frozen(),legacy=makeClient(old.gateway,ready.port,old.bridge),body={model:'doubao-seed-translation-250915',input:[{role:'user',content:[{type:'input_text',text:'hello',translation_options:{source_language:'en',target_language:'zh'}}]}]};
 await t.test('old login, account fields and headerless identity',async()=>{
  await legacy.api.login(origin,ready.email,ready.password);const me=await legacy.api.call('/v1/me');
  assert.equal(me.membership.plan,'legacy');for(const key of ['month','requests','request_limit','audio_seconds','audio_limit'])assert.ok(key in me.usage);
  assert.equal(me.capabilities.compatibility.baseline,'0.20.48');assert.equal(me.capabilities.compatibility.version_header_required,false);
  assert.ok(legacy.requests.every(o=>!o.headers['X-Client-Version']));
 });
 await t.test('old translation and vendor credential stripping',async()=>{
  const r=await transport(legacy.api,{method:'POST',url:'https://ark.cn-beijing.volces.com/api/v3/responses',headers:{Authorization:'Bearer vendor-secret'},data:JSON.stringify(body)});assert.equal(r.status,200);assert.ok(!JSON.stringify(legacy.requests).includes('vendor-secret'));
 });
 await t.test('old incremental AI protocol returns answer and only charges once',async()=>{
  const before=await legacy.api.call('/v1/me');let raw='';
  await new Promise((resolve,reject)=>legacy.api.transport({method:'POST',url:'https://ark.cn-beijing.volces.com/api/v3/responses',responseType:'stream',data:JSON.stringify({model:'doubao-seed-2-1-lite-260915',input:[{role:'user',content:'hello'}]}),onprogress:r=>{raw=r.responseText;},onload:resolve,onerror:reject}));
  assert.match(raw,/response.output_text.delta/);assert.match(raw,/compat answer/);assert.match(raw,/response.completed/);const after=await legacy.api.call('/v1/me');assert.equal(after.usage.requests-before.usage.requests,1);
 });
 await t.test('old authenticated speech submit and query',async()=>{
  const id=crypto.randomUUID(),headers={'X-Api-Request-Id':id,'X-Api-Key':'must-not-leave-client'};
  const submit=await transport(legacy.api,{method:'POST',url:'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit',headers,data:JSON.stringify(wav())});assert.equal(submit.status,200);
  const query=await transport(legacy.api,{method:'POST',url:'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query',headers,data:'{}'});assert.equal(query.status,200);assert.equal(JSON.parse(query.responseText).result.utterances[0].text,'hello');assert.ok(!JSON.stringify(legacy.requests).includes('must-not-leave-client'));
 });
 await t.test('old guest speech gets a login instruction without vendor calls',async()=>{
  const guest=makeClient(old.gateway,ready.port,old.bridge),before=await legacy.api.call('/v1/me');
  const r=await transport(guest.api,{method:'POST',url:'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit',headers:{'X-Api-Request-Id':crypto.randomUUID()},data:JSON.stringify(wav())});assert.equal(r.status,401);assert.match(JSON.parse(r.responseText).error,/登录/);assert.equal((await legacy.api.call('/v1/me')).usage.requests,before.usage.requests);
 });
 await t.test('new and old versions coexist; new metadata cannot force old upgrades',async()=>{
  const modern=makeClient(require('./gateway-client.js'),ready.port);await modern.api.login(origin,ready.email,ready.password);const me=await modern.api.call('/v1/me');assert.equal(me.usage.requests,3);assert.equal(modern.requests[0].headers['X-Client-Version'],require('./package.json').version);assert.equal((await legacy.api.call('/v1/me')).usage.requests,me.usage.requests);
  await modern.api.logout();assert.equal((await legacy.api.call('/v1/me')).membership.active,true,'logging out new client does not revoke old session');
 });
 const logs=diagnostics.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));assert.equal(logs.length,1);assert.equal(logs[0].error_code,'authentication_required');assert.equal(logs[0].status,401);
});
