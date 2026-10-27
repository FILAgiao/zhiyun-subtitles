const vm=require('node:vm');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('bridge reconstructs binary responses and aborts exactly once',async()=>{
 let receive,disconnect,posted,abortCount=0;const port={onMessage:{addListener:f=>receive=f},onDisconnect:{addListener:f=>disconnect=f},postMessage:m=>posted=m,disconnect:()=>disconnect?.()};
 const context=vm.createContext({chrome:{runtime:{connect:()=>port}},TextDecoder,Uint8Array,Blob,Promise,setTimeout,clearTimeout,atob,console});vm.runInContext(fs.readFileSync('extension/adapter.js','utf8'),context);
 let response;const handle=context.extensionRequest({url:'https://video.cmc.zju.edu.cn/a',responseType:'blob',onload:r=>response=r,onabort:()=>abortCount++});assert.equal(posted.url,'https://video.cmc.zju.edu.cn/a');receive({type:'start',status:206,mime:'video/mp4',responseHeaders:'Content-Range: bytes 0-2/3'});receive({type:'chunk',data:Buffer.from([0,128,255]).toString('base64'),loaded:3,total:3});receive({type:'done'});assert.equal(response.status,206);assert.deepEqual([...new Uint8Array(await response.response.arrayBuffer())],[0,128,255]);handle.abort();assert.equal(abortCount,0);
 const cancelled=context.extensionRequest({url:'https://video.cmc.zju.edu.cn/a',onabort:()=>abortCount++,onload:()=>assert.fail('late response')});cancelled.abort();cancelled.abort();receive({type:'done'});assert.equal(abortCount,1);
});

test('native screenshot adapter resolves, validates errors and ignores cancelled late replies',async()=>{
 let callback,posted;const runtime={sendMessage:(message,cb)=>{posted=message;callback=cb;},lastError:null};const context=vm.createContext({chrome:{runtime},DOMException,Promise,setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,30)),clearTimeout,console});vm.runInContext(fs.readFileSync('extension/adapter.js','utf8'),context);
 const success=context.captureExtensionTab();assert.equal(posted.type,'zy-capture-visible');callback({ok:true,data:'data:image/png;base64,fixture'});assert.equal(await success,'data:image/png;base64,fixture');
 const error=context.captureExtensionTab();callback({ok:false,error:'No current tab grant'});await assert.rejects(error,/current tab/);
 const control=new AbortController(),cancelled=context.captureExtensionTab(control.signal);control.abort();callback({ok:true,data:'data:image/png;base64,late'});await assert.rejects(cancelled,e=>e.name==='AbortError');
 const timeout=context.captureExtensionTab();await assert.rejects(timeout,/超时/);
});


test('storage writes dispatch before earlier writes finish so navigation cannot strand the last choice',async()=>{
 const writes=[],pending=[],warnings=[];let api,changed;
 const storage={get:async()=>({initial:'kept'}),set:body=>{writes.push(['set',structuredClone(body)]);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},remove:key=>{writes.push(['remove',key]);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
 const doc={visibilityState:'visible',addEventListener(){},getElementById(){return null;}};
 const win={addEventListener(){}};win.top=win;
 const chrome={runtime:{id:'fixture',onMessage:{addListener(){}}},storage:{local:storage,onChanged:{addListener:fn=>changed=fn}}};
 const context=vm.createContext({chrome,document:doc,window:win,console:{warn:text=>warnings.push(text)},Promise,setTimeout,clearTimeout,Date,location:{href:'https://example.test/'}});
 vm.runInContext(fs.readFileSync('extension/adapter.js','utf8'),context);await context.startExtension((request,get,set,remove)=>api={get,set,remove});
 api.set('sync',{autoSync:true});api.set('sync',{autoSync:false});api.remove('obsolete');
 assert.deepEqual(writes,[['set',{sync:{autoSync:true}}],['set',{sync:{autoSync:false}}],['remove','obsolete']],'every operation reaches chrome.storage immediately without waiting for a content-script microtask');
 assert.equal(api.get('sync').autoSync,false);assert.equal(api.get('initial'),'kept');
 pending[0].reject(Error('quota'));pending[1].resolve();pending[2].resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(warnings.length,1,'a rejected write is reported without blocking later browser operations');
 changed({external:{newValue:4}},'local');assert.equal(api.get('external'),4);
});
