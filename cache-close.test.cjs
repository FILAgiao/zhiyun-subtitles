const {test}=require('node:test');
const assert=require('node:assert/strict');

test('closing a stream waits for an in-flight disk commit before its lock may be released',async()=>{
 const {openCache}=await import('./progressive-cache.mjs');
 let releaseWrite,writeStarted,closed=false,saves=0;
 const writing=new Promise(resolve=>{writeStarted=resolve;});
 const gate=new Promise(resolve=>{releaseWrite=resolve;});
 const files=new Map();
 const directory={async getFileHandle(name,options){
   if(!files.has(name)&&!options?.create)throw Object.assign(new Error('missing'),{name:'NotFoundError'});
   return {async createWritable(){return {async write(blob){writeStarted();await gate;files.set(name,blob);},async close(){},async abort(){}};},async getFile(){return files.get(name);}};
 }};
 const cache=await openCache({source:'fixture',blockSize:16,directory:async()=>directory,load:async()=>null,save:async()=>{saves++;},request:async()=>({blob:new Blob([new Uint8Array(16)]),total:16,validator:'"v1"'})});
 const indexing=cache.index().catch(()=>{});await writing;
 const closing=cache.close().then(()=>{closed=true;});
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(closed,false,'closing must not release ownership while the writer is open');
 releaseWrite();await closing;await indexing;
 assert.equal(saves,1);assert.equal(files.size,1,'a fully committed block survives a normal stop');
 files.clear();const savedAtDelete=saves;
 await new Promise(resolve=>setTimeout(resolve,20));assert.equal(files.size,0);assert.equal(saves,savedAtDelete,'no later manifest may resurrect deleted blocks');
});
