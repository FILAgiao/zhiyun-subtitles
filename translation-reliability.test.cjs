const {test}=require('node:test');
const assert=require('node:assert/strict');
const {failure,create}=require('./translation-request.js');
const {createTranslator}=require('./zhiyun-subtitles.user.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let time=0,id=0;const timers=new Map();return{now:()=>time,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),async advance(ms){time+=ms;for(const [id,t] of [...timers])if(t.at<=time){timers.delete(id);t.fn();}await flush();},get size(){return timers.size;}};}
const ok=text=>({status:200,responseText:JSON.stringify({text})});
const parse=body=>body.text;
const busy=()=>failure({status:429,responseText:JSON.stringify({error:'请等待当前请求完成'})});
function deferred(){const calls=[];return{calls,request:text=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});const call={text,resolve,reject,aborted:false};calls.push(call);return{promise,abort(){call.aborted=true;reject(Error('stopped'));}};}};}

test('known legacy gateway limits are distinct and only rejected busy/rate requests retry',()=>{
 for(const [message,code,safe] of [['本月额度已用完','quota_exhausted',false],['请等待当前请求完成','concurrency_limit',true],['请求过于频繁，请稍后再试','rate_limit',true]]){
  const e=failure({status:429,responseText:JSON.stringify({error:message})});assert.equal(e.code,code);assert.equal(e.safeToRetry,safe);
 }
 for(const status of [401,403,502,503])assert.equal(failure({status,responseText:'{}'}).safeToRetry,false);
});
test('structured limit codes respect Retry-After; unidentified provider 429 never claims exhausted quota',()=>{
 const e=failure({status:429,responseText:JSON.stringify({error:'busy',error_code:'concurrency_limit'}),responseHeaders:'Retry-After: 12\r\n'});assert.equal(e.retryAfterMs,12000);assert.equal(e.safeToRetry,true);
 const unknown=failure({status:429,responseText:JSON.stringify({error:'private provider secret'})});assert.equal(unknown.safeToRetry,false);assert.equal(unknown.code,'unclassified_limit');assert.doesNotMatch(unknown.message,/额度|private|secret/);
});
test('stopping and reopening retains the server lease and submits once only after old completion',async()=>{
 const sends=[];let aborts=0;const request=create(o=>{sends.push(o);return{abort(){aborts++;}};},parse);
 const old=request({data:'old'});const stopped=assert.rejects(old.promise,/停止/);old.abort();await stopped;
 const next=request({data:'new'});assert.equal(sends.length,1);assert.equal(sends[0].timeout,105000);assert.equal(aborts,0);
 sends[0].onload(ok('late old'));await flush();assert.equal(sends.length,2);sends[1].onload(ok('new result'));assert.equal(await next.promise,'new result');
});
test('cancelled queued work never reaches provider; duplicate callbacks cannot release another lease',async()=>{
 const sends=[];const request=create(o=>sends.push(o),parse);
 const a=request({data:'a'}),b=request({data:'b'}),c=request({data:'c'});const stopped=assert.rejects(b.promise,/停止/);b.abort();await stopped;
 sends[0].onload(ok('a'));await a.promise;assert.equal(sends.length,2);assert.equal(sends[1].data,'c');sends[0].onload(ok('duplicate'));assert.equal(sends.length,2);sends[1].onload(ok('c'));assert.equal(await c.promise,'c');
});
test('an ambiguous network result never auto resubmits; explicit retry observes a cooldown',async()=>{
 const time=clock(),sends=[];const request=create(o=>sends.push(o),parse,time);
 const a=request({data:'a'});sends[0].ontimeout();await assert.rejects(a.promise,e=>e.uncertain&&e.code==='result_unknown');assert.equal(sends.length,1);
 const b=request({data:'b'});await time.advance(29999);assert.equal(sends.length,1);await time.advance(1);assert.equal(sends.length,2);sends[1].onload(ok('b'));await b.promise;
});
test('busy backoff survives repeated ticks, prioritizes a seek and resumes without repeating cached work',async()=>{
 const time=clock(),d=deferred(),messages=[];const t=createTranslator(d.request,(m,state)=>messages.push({m,state}),1,time);
 t.start('en','zh');t.schedule(['old','next']);d.calls[0].reject(busy());await flush();assert.equal(t.enabled,true);
 for(let i=0;i<100;i++)t.schedule(['seek','next']);assert.equal(d.calls.length,1);await time.advance(4999);assert.equal(d.calls.length,1);await time.advance(1);assert.equal(d.calls[1].text,'seek');
 d.calls[1].resolve('找到');await flush();assert.equal(messages.at(-1).m,'翻译已恢复');assert.equal(d.calls[2].text,'next');d.calls[2].resolve('下句');await flush();t.schedule(['seek','next']);assert.equal(d.calls.length,3);t.stop();
});
test('busy retries stop after five retries rather than charging or looping forever',async()=>{
 const time=clock(),d=deferred(),states=[];const t=createTranslator(d.request,(m,state)=>states.push(state),1,time);t.start('en','zh');t.schedule(['sentence']);
 for(const delay of [5000,10000,20000,30000,30000]){d.calls.at(-1).reject(busy());await flush();assert.equal(t.enabled,true);await time.advance(delay);}
 assert.equal(d.calls.length,6);d.calls.at(-1).reject(busy());await flush();assert.equal(t.enabled,false);assert.equal(states.at(-1).state,'paused');await time.advance(120000);t.schedule(['sentence']);assert.equal(d.calls.length,6);assert.equal(time.size,0);
});
test('stopping during backoff cancels timer; reset prevents old course requests from returning',async()=>{
 const time=clock(),d=deferred();const t=createTranslator(d.request,()=>{},1,time);t.start('en','zh');t.schedule(['old']);d.calls[0].reject(busy());await flush();t.reset();await time.advance(60000);assert.equal(d.calls.length,1);t.start('en','zh');t.schedule(['new']);assert.equal(d.calls[1].text,'new');d.calls[1].resolve('新课');await flush();assert.equal(t.get('old'),'');assert.equal(t.get('new'),'新课');t.stop();
});
test('quota, unknown 429 and uncertain requests pause with no automatic paid resubmission',async()=>{
 for(const error of [failure({status:429,responseText:'{"error":"本月额度已用完"}'}),failure({status:429,responseText:'{}'}),Object.assign(Error('unknown'),{uncertain:true})]){
  const time=clock(),d=deferred();const t=createTranslator(d.request,()=>{},1,time);t.start('en','zh');t.schedule(['sentence','next']);d.calls[0].reject(error);await flush();await time.advance(120000);assert.equal(t.enabled,false);assert.equal(d.calls.length,1);
 }
});

test('reopening reuses a paid completion, but course/direction/account scopes never share it',async()=>{
 const sends=[];const request=create(o=>sends.push(o),parse);
 const old=request({data:'old',cacheScope:'account-a',cacheKey:'course-one:en-zh:cue-one'});const stopped=assert.rejects(old.promise,/停止/);old.abort();await stopped;
 const same=request({data:'same',cacheScope:'account-a',cacheKey:'course-one:en-zh:cue-one'});assert.equal(sends.length,1);sends[0].onload(ok('already paid'));assert.equal(await same.promise,'already paid');assert.equal(sends.length,1);
 for(const [scope,key] of [['account-b','course-one:en-zh:cue-one'],['account-a','course-two:en-zh:cue-one'],['account-a','course-one:zh-en:cue-one']]){
  const next=request({data:'different scope',cacheScope:scope,cacheKey:key});sends.at(-1).onload(ok('new result'));await next.promise;
 }
 assert.equal(sends.length,4);assert.ok(sends.every(o=>!('cacheScope' in o)&&!('cacheKey' in o)&&!('onWait' in o)));
});

test('legacy slow work lasting 77 seconds can clear before the bounded busy retry budget ends',async()=>{
 const time=clock(),d=deferred();const t=createTranslator(d.request,()=>{},1,time);t.start('en','zh');t.schedule(['sentence']);
 for(const delay of [5000,10000,20000,30000,30000]){d.calls.at(-1).reject(busy());await flush();await time.advance(delay);}
 assert.equal(time.now(),95000);assert.equal(t.enabled,true);d.calls.at(-1).resolve('服务已恢复');await flush();assert.equal(t.get('sentence'),'服务已恢复');t.stop();
});


test('only a structured pre-submission maintenance rejection may retry a 503',()=>{
 const updating=failure({status:503,responseText:JSON.stringify({error:'maintenance',error_code:'server_updating'}),responseHeaders:'Retry-After: 8\r\n'});
 assert.equal(updating.code,'server_updating');assert.equal(updating.safeToRetry,true);assert.equal(updating.retryAfterMs,8000);
 for(const [status,body] of [[503,{error_code:'database_unavailable'}],[503,{}],[502,{error_code:'server_updating'}]]){
  const error=failure({status,responseText:JSON.stringify(body)});assert.equal(error.safeToRetry,false);
 }
});

test('null or malformed error bodies settle the lease and do not strand the next subtitle',async()=>{
 for(const responseText of ['null','"failure"','<html>bad gateway</html>']){
  const sends=[],request=create(o=>sends.push(o),parse);
  const old=request({data:'old'}),next=request({data:'next'});
  sends[0].onload({status:502,responseText});await assert.rejects(old.promise,e=>e.code==='translation_failed'&&!e.safeToRetry);
  assert.equal(sends.length,2);sends[1].onload(ok('下一句'));assert.equal(await next.promise,'下一句');
 }
});

test('invalid successful responses are classified and release work without retrying or caching the paid result',async()=>{
 for(const responseText of ['{',JSON.stringify({error:'missing output'})]){
  const sends=[],request=create(o=>sends.push(o),body=>{if(!body.text)throw Error('provider detail');return body.text;});
  const old=request({data:'old',cacheKey:'same'}),next=request({data:'next'});
  sends[0].onload({status:200,responseText});await assert.rejects(old.promise,e=>e.code==='translation_output_invalid'&&e.safeToRetry===false&&!/provider detail/.test(e.message));
  assert.equal(sends.length,2);sends[1].onload(ok('下一句'));await next.promise;
  const retry=request({data:'retry',cacheKey:'same'});assert.equal(sends.length,3);sends[2].onload(ok('正确译文'));assert.equal(await retry.promise,'正确译文');
 }
});

test('business-invalid paid output is not reused by manual retry and valid completion is cached',async()=>{
 const sends=[],request=create(o=>sends.push(o),parse),cacheResult=text=>text==='正确译文';
 const first=request({data:'same input',cacheKey:'same',cacheResult});sends[0].onload(ok('Untranslated English'));assert.equal(await first.promise,'Untranslated English');
 const retry=request({data:'same input',cacheKey:'same',cacheResult});assert.equal(sends.length,2);sends[1].onload(ok('正确译文'));assert.equal(await retry.promise,'正确译文');
 assert.equal(await request({data:'same input',cacheKey:'same',cacheResult}).promise,'正确译文');assert.equal(sends.length,2);
 assert.ok(sends.every(options=>!('cacheResult' in options)));
});

test('cache validation errors cannot strand the lease or make bad output reusable',async()=>{
 const sends=[],request=create(o=>sends.push(o),parse),cacheResult=()=>{throw Error('bad batch format');};
 const old=request({data:'old',cacheKey:'same',cacheResult}),retry=request({data:'retry',cacheKey:'same',cacheResult});
 sends[0].onload(ok('bad format'));assert.equal(await old.promise,'bad format');assert.equal(sends.length,2);
 sends[1].onload(ok('second result'));assert.equal(await retry.promise,'second result');
});

test('structured server update waits and automatically resumes while database ambiguity pauses',async()=>{
 const time=clock(),d=deferred(),states=[],translator=createTranslator(d.request,(message,state)=>states.push(state),1,time);
 translator.start('en','zh');translator.schedule(['sentence']);
 d.calls[0].reject(failure({status:503,responseText:JSON.stringify({error_code:'server_updating'}),responseHeaders:'Retry-After: 8\r\n'}));await flush();
 assert.equal(translator.enabled,true);assert.equal(states.at(-1).state,'waiting');await time.advance(7999);assert.equal(d.calls.length,1);await time.advance(1);assert.equal(d.calls.length,2);
 d.calls[1].resolve('服务已恢复');await flush();assert.equal(translator.get('sentence'),'服务已恢复');translator.schedule(['next']);
 d.calls[2].reject(failure({status:503,responseText:JSON.stringify({error_code:'database_unavailable'})}));await flush();await time.advance(120000);
 assert.equal(translator.enabled,false);assert.equal(d.calls.length,3);assert.equal(states.at(-1).state,'paused');
});
