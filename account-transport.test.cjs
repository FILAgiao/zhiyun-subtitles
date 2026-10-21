const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(request){
 const timers=new Map();let id=0,now=0;const storage={'gateway-account-v1':{url:'https://api.example.test',token:'existing'}};const calls=[];
 const sandbox={module:{exports:{}},URL,console,setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout(i){timers.delete(i);}};
 vm.runInNewContext(fs.readFileSync('gateway-client.js','utf8'),sandbox);
 const api=sandbox.module.exports.create({getValue:(k,d)=>storage[k]??d,setValue:(k,v)=>storage[k]=v,request(o){calls.push(o);return request?.(o)||{abort(){o.onabort?.();}};}});
 return {api,calls,storage,timers,advance(ms){now+=ms;for(const [i,t] of [...timers])if(t.at<=now){timers.delete(i);t.fn();}}};
}
test('login tolerates a response after the previous 15 second deadline without duplicate POSTs',async()=>{
 const f=fixture(),p=f.api.login('https://api.example.test','fixture','fixture-password');assert.equal(f.calls[0].timeout,30000);f.advance(20000);assert.equal(f.calls.length,1);
 f.calls[0].onload({status:200,responseText:'{"token":"new-session"}'});await p;assert.equal(f.storage['gateway-account-v1'].token,'new-session');assert.equal(f.timers.size,0);
});
test('missing callbacks time out once, abort transport and ignore late login results',async()=>{
 let aborts=0;const f=fixture(o=>({abort(){aborts++;o.onabort();}})),p=f.api.login('https://api.example.test','fixture','fixture-password'),rejected=assert.rejects(p,/登录连接超时.*30 秒/);
 f.advance(30000);await rejected;assert.equal(aborts,1);assert.equal(f.calls.length,1);assert.equal(f.storage['gateway-account-v1'].token,'existing');
 f.calls[0].onload({status:200,responseText:'{"token":"late-session","capabilities":{"web_search":true}}'});assert.equal(f.storage['gateway-account-v1'].token,'existing');assert.equal(f.storage['gateway-capabilities-v1'],undefined);
 const retry=f.api.login('https://api.example.test','fixture','fixture-password');f.calls[1].onload({status:200,responseText:'{"token":"retry-session"}'});await retry;assert.equal(f.storage['gateway-account-v1'].token,'retry-session');assert.equal(f.timers.size,0);
});
test('transport timeout, abort, network error and synchronous failure all settle and clear timers',async()=>{
 for(const [kind,message] of [['timeout',/登录连接超时/],['abort',/登录连接已中断/],['error',/无法连接服务/]]){
  const f=fixture(),p=f.api.login('https://api.example.test','fixture','fixture-password'),rejected=assert.rejects(p,message);f.calls[0]['on'+kind]();await rejected;assert.equal(f.timers.size,0);
 }
 const f=fixture(()=>{throw Error('transport unavailable');});await assert.rejects(f.api.login('https://api.example.test','fixture','fixture-password'),/transport unavailable/);assert.equal(f.timers.size,0);
});
test('usage retains short deadline and its retry message; late 401 cannot clear a session',async()=>{
 const f=fixture(),p=f.api.call('/v1/me'),rejected=assert.rejects(p,/额度读取超时.*查看额度/);assert.equal(f.calls[0].timeout,15000);f.advance(15000);await rejected;
 f.calls[0].onload({status:401,responseText:'{"error":"expired"}'});assert.equal(f.storage['gateway-account-v1'].token,'existing');assert.equal(f.timers.size,0);
});
test('extension adapter delivers background timeout immediately and disconnects once',()=>{
 let receive,disconnected=0,timeout=0;const pending=new Map();let id=0;
 const port={postMessage(){},disconnect(){disconnected++;},onDisconnect:{addListener(){}},onMessage:{addListener(fn){receive=fn;}}};
 const sandbox={chrome:{runtime:{connect:()=>port}},TextDecoder,setTimeout(fn){pending.set(++id,fn);return id;},clearTimeout(i){pending.delete(i);}};
 vm.runInNewContext(fs.readFileSync('extension/adapter.js','utf8'),sandbox);
 sandbox.extensionRequest({url:'https://api.example.test',ontimeout(){timeout++;},onabort(){assert.fail('timeout must not be reported as abort');}});receive({type:'timeout'});receive({type:'done'});assert.equal(timeout,1);assert.equal(disconnected,1);assert.equal(pending.size,0);
});
test('background reports its network deadline as timeout',async()=>{
 let connect,receive,deadline;const messages=[];const noop={addListener(){}};
 const sandbox={URL,AbortController,console,setTimeout(fn){deadline=fn;return 1;},clearTimeout(){},chrome:{runtime:{id:'fixture',onMessage:noop,onInstalled:noop,onConnect:{addListener(fn){connect=fn;}},getManifest:()=>({version:'0.20.69'})},action:{onClicked:noop},commands:{onCommand:noop},contextMenus:{onClicked:noop}},fetch(url,init){return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted'))));}};
 vm.runInNewContext(fs.readFileSync('extension/background.js','utf8'),sandbox);
 connect({name:'zy-request',sender:{id:'fixture',url:'https://public.example/'},onDisconnect:noop,onMessage:{addListener(fn){receive=fn;}},postMessage(m){messages.push(m);},disconnect(){assert.fail('valid sender');}});
 const result=receive({url:'https://47.77.182.216.sslip.io/gateway/v1/auth/login',method:'POST',data:'{}',timeout:30000});deadline();await result;assert.equal(messages.at(-1).type,'timeout');
});
