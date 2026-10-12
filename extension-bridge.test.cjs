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
