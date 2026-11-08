const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,courseKey,MAX_EVENTS}=require('./usage-analytics.js');
function fixture(initial={}){
 let clock=1700000000000,mono=0,id=0,owner='account-one',enabled=true,visible=true,reply={ok:true};
 const sent=[],storage={...initial},timers=new Map();let nextTimer=0;
 const api=create({context:()=>({owner,enabled}),send:async body=>{sent.push(structuredClone(body));if(reply instanceof Error)throw reply;return reply;},storage:{getItem:k=>storage[k],setItem:(k,v)=>storage[k]=v,removeItem:k=>delete storage[k]},now:()=>clock,monotonic:()=>mono,visible:()=>visible,uuid:()=>String(++id).padStart(32,'0'),schedule:(fn,ms)=>{const key=++nextTimer;timers.set(key,{fn,due:mono+ms});return key;},cancel:key=>timers.delete(key)});
 const advance=(ms,{wall=ms,run=false}={})=>{clock+=wall;mono+=ms;if(run){for(const [key,t] of [...timers])if(t.due<=mono){timers.delete(key);t.fn();}}};
 const sample=(position,extra={})=>api.sample({course:'["course-1","video-1","112"]',title:'高等数学',playing:true,position,rate:1,subtitle:true,translation:false,...extra});
 return {api,sent,storage,timers,advance,sample,setOwner:v=>owner=v,setEnabled:v=>enabled=v,setVisible:v=>visible=v,setReply:v=>reply=v};
}
test('stable lecture identity rejects generic routes and never returns URLs',()=>{
 assert.match(courseKey('["course-1","video-1","112"]'),/^[a-f0-9]{32}$/);
 for(const input of ['https://school.test/?token=secret','[null,null,null]','["course",null,"112"]','["https://x","v","t"]'])assert.equal(courseKey(input),'');
 assert.notEqual(courseKey('["c","v1","t"]'),courseKey('["c","v2","t"]'));
});
test('subtitle and displayed translation count once per course session; prefetch is not counted',async()=>{
 const f=fixture();f.sample(0);for(let i=1;i<=65;i++){f.advance(1000);f.sample(i,{translation:i>10});}await f.api.flush();
 const e=f.sent.flatMap(b=>b.events);assert.equal(e.filter(v=>v.feature==='subtitle').length,1);assert.equal(e.filter(v=>v.feature==='translation').length,1);
 assert.equal(e.filter(v=>v.kind==='activity').reduce((n,v)=>n+v.end-v.start,0),65);
 assert.ok(e.filter(v=>v.kind==='activity').every(v=>v.end-v.start<=60));
 f.advance(60000);f.sample(0,{course:'["course-1","video-2","112"]',translation:false});f.advance(1000);f.sample(1,{course:'["course-1","video-2","112"]',translation:false});await f.api.flush();
 assert.equal(f.sent.flatMap(b=>b.events).filter(v=>v.feature==='subtitle').length,2);
});
test('pause, buffer, seek, hidden page, long timer suspension and clock jumps do not inflate time',async()=>{
 const f=fixture();f.sample(0);f.advance(1000);f.sample(1);f.advance(1000);f.sample(1,{playing:false});
 f.advance(1000);f.sample(1);f.advance(1000);f.sample(300);f.advance(1000);f.sample(300);
 f.advance(600000);f.sample(900);f.advance(1000,{wall:5000});f.sample(901);
 f.setVisible(false);f.advance(1000);f.sample(902);f.setVisible(true);f.advance(1000);f.sample(903);f.advance(1000);f.sample(904);
 await f.api.flush();assert.equal(f.sent[0].events.filter(e=>e.kind==='activity').reduce((n,e)=>n+e.end-e.start,0),2);
});
test('2x playback counts elapsed wall seconds and skips a seek',async()=>{
 const f=fixture();f.sample(0,{rate:2});f.advance(1000);f.sample(2,{rate:2});f.advance(1000);f.sample(4,{rate:2});f.advance(1000);f.sample(100,{rate:2});await f.api.flush();
 assert.equal(f.sent[0].events.filter(e=>e.kind==='activity').reduce((n,e)=>n+e.end-e.start,0),2);
});
test('technical retransmission retains event ids, batches and backoff',async()=>{
 const f=fixture();f.api.feature('ai','operation-one');f.api.feature('ai','operation-one');f.setReply(Error('offline'));await f.api.flush();await f.api.flush();assert.equal(f.sent.length,1);
 f.advance(120000);f.setReply({ok:true});await f.api.flush();assert.deepEqual(f.sent[0],f.sent[1]);assert.equal(f.api.inspect().queued,0);
});
test('an invalid event cannot block delivery of later valid events',async()=>{
 const f=fixture();f.api.feature('ai','bad');f.api.feature('screenshot','good');
 f.setReply(Object.assign(Error('rejected'),{status:409}));await f.api.flush();
 f.advance(60000);await f.api.flush();assert.deepEqual(f.sent.map(b=>b.events.length),[2,1]);
 f.advance(60000);f.setReply({ok:true});await f.api.flush();
 assert.deepEqual(f.sent.at(-1).events.map(e=>e.feature),['screenshot']);assert.equal(f.api.stats.dropped,1);
});
test('capability gating and empty queues make no requests; unsupported endpoint stops safely',async()=>{
 const f=fixture();await f.api.flush();assert.equal(f.sent.length,0);f.setEnabled(false);f.api.feature('ai');f.sample(0);await f.api.flush();assert.equal(f.sent.length,0);
 f.setEnabled(true);f.api.feature('ai');f.setReply(Object.assign(Error('old server'),{status:404}));await f.api.flush();f.advance(3600000);f.api.feature('ai');await f.api.flush();assert.equal(f.sent.length,1);assert.equal(f.api.inspect().disabled,true);
});
test('account changes reject delayed successes and never send previous account events',async()=>{
 const f=fixture(),bound=f.api.capture();f.api.feature('screenshot','a',bound);f.setOwner('account-two');assert.equal(f.api.feature('ai','late',bound),false);f.api.feature('ai','b',f.api.capture());await f.api.flush();
 assert.deepEqual(f.sent[0].events.map(e=>e.feature),['ai']);assert.ok(!JSON.stringify(f.storage).includes('account-one'));
});
test('bounded persistence resumes same account and session without double counting captions',async()=>{
 const f=fixture();f.sample(0);f.advance(1000);f.sample(1);f.api.suspend();const restored=fixture(f.storage);restored.sample(1);restored.advance(1000);restored.sample(2);await restored.api.flush();
 assert.equal(restored.sent[0].events.filter(e=>e.feature==='subtitle').length,1);
 const different=fixture(f.storage);different.setOwner('different-account');await different.api.flush();assert.equal(different.sent.length,0);
});
test('queue capacity, batch limit and periodic persistence remain bounded',async()=>{
 const f=fixture();for(let i=0;i<1000;i++)f.api.feature('ai','q'+i);assert.equal(f.api.inspect().queued,MAX_EVENTS);assert.equal(f.api.stats.dropped,600);assert.equal(f.api.stats.storageWrites,0);
 f.advance(5000,{run:true});assert.equal(f.api.stats.storageWrites,1);await f.api.flush();assert.equal(f.sent[0].events.length,100);assert.equal(f.api.inspect().queued,MAX_EVENTS-100);
});
test('interaction window ends at 30 seconds and no idle timer or storage hot loop remains',async()=>{
 const f=fixture();f.api.touch();for(let i=0;i<35;i++)f.advance(1000,{run:true});await f.api.flush();const events=f.sent[0].events;
 assert.equal(events.filter(e=>e.kind==='activity').reduce((n,e)=>n+e.end-e.start,0),30);assert.ok(events.every(e=>!e.course_id&&!e.course_title));assert.equal(f.timers.size,0);
});
test('existing 10Hz render loop performs only 1Hz sampling with bounded storage and one network batch',async()=>{
 const f=fixture(),start=performance.now();for(let i=0;i<600;i++){f.sample(i/10);f.advance(100);}const elapsed=performance.now()-start;
 assert.ok(f.api.stats.acceptedSamples<=62);assert.equal(f.api.stats.storageWrites,0);assert.equal(f.sent.length,0);await f.api.flush();assert.equal(f.sent.length,1);assert.ok(f.sent[0].events.length<=3);
 console.log(JSON.stringify({analytics600CallbacksMs:+elapsed.toFixed(3),acceptedSamples:f.api.stats.acceptedSamples,requests:f.api.stats.requests,events:f.sent[0].events.length}));
});
