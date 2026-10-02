const {test}=require('node:test');
const assert=require('node:assert/strict');
const {contextualTranslationBody,translationJobs,createTranslator,syncAnchorsValid,addSyncAnchor,syncOffsetAt,syncedSubtitleTime,syncedVideoTime,createSyncSchedule,activeCue,slideAt,srt}=require('./zhiyun-subtitles.user.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('context translation carries neighboring lecture terminology but translates one target sentence',()=>{
  const body=contextualTranslationBody('A register stores a word.','en','zh',{course:'Architecture',subject:'CPU',glossary:'register = 寄存器',before:['We discuss CPU registers.'],after:['It has 64 bits.'],translations:['word → 字']});
  assert.equal(body.model,'doubao-seed-2-1-lite-260915');
  assert.equal(body.stream,false);
  assert.match(body.input[0].content,/仅输出目标字幕/);
  const payload=JSON.parse(body.input[1].content[0].text);
  assert.equal(payload.reference.terminology,'register = 寄存器');
  assert.equal(payload.reference.preceding[0],'We discuss CPU registers.');
  assert.equal(payload.target_subtitle,'A register stores a word.');
  assert.equal(payload.reference.prior_translations[0],'word → 字');
});
test('context payload bounds user supplied references and subtitle windows',()=>{
  const body=contextualTranslationBody('target','en','zh',{before:Array(100).fill('a'.repeat(1000)),after:Array(100).fill('b'),glossary:'x'.repeat(20000)});
  const data=JSON.parse(body.input[1].content[0].text).reference;
  assert.equal(data.preceding.length,30);assert.equal(data.preceding[0].length,600);assert.equal(data.terminology.length,4000);
  const cues=Array.from({length:100},(_,index)=>({start:index,original:'sentence '+index}));
  const jobs=translationJobs(cues,50,12);
  assert.equal(jobs.length,4);assert.equal(jobs[0].context.before.length,12);assert.equal(jobs[0].context.after.length,12);
  assert.equal(jobs[0].context.before.at(-1),'sentence 49');assert.equal(jobs[1].context.before.at(-1),'sentence 50');
  assert.deepEqual(translationJobs(cues,-1),[]);
});
test('the same word in different lecture positions has isolated contextual cache entries',async()=>{
  const calls=[];
  const translator=createTranslator((text,source,target,context)=>{let resolve;const promise=new Promise(yes=>resolve=yes);calls.push({text,context,resolve});return {promise,abort(){}};});
  const cues=[{start:10,original:'register'},{start:500,original:'register'}];
  const jobs=translationJobs(cues,0,3,{subject:'CPU'});
  translator.start('en','zh');translator.schedule(jobs);assert.equal(calls.length,1);
  calls[0].resolve('寄存器');await flush();assert.equal(calls.length,2);
  calls[1].resolve('登记');await flush();
  assert.equal(translator.get(jobs[0]),'寄存器');assert.equal(translator.get(jobs[1]),'登记');
  translator.schedule(jobs);assert.equal(calls.length,2);
});
test('contextual results are discarded on course reset and aborted jobs never leak',async()=>{
  let finish,aborted=0;
  const t=createTranslator(()=>({promise:new Promise(resolve=>finish=resolve),abort(){aborted++;}}));
  const job=translationJobs([{start:1,original:'previous course'}],0)[0];
  t.start('en','zh');t.schedule([job]);t.reset();finish('旧内容');await flush();
  assert.equal(aborted,1);assert.equal(t.get(job),'');
});
test('time anchors model nonuniform drift with stable inverse seeking and SRT export',()=>{
  const anchors=[{videoTime:100,offset:-2},{videoTime:1100,offset:-12},{videoTime:2100,offset:8}];
  assert.equal(syncOffsetAt(600,0,anchors),-7);
  assert.equal(syncOffsetAt(1600,0,anchors),-2);
  for(const video of [0,100,200,600,1100,1600,2100,5000]) assert.ok(Math.abs(syncedVideoTime(syncedSubtitleTime(video,0,anchors),0,anchors)-video)<1e-8);
  const cues=[{start:607,end:617,original:'sample'}],slides=[{time:0},{time:607}];
  assert.equal(activeCue(cues,syncedSubtitleTime(600,0,anchors)).original,'sample');
  assert.equal(slideAt(slides,syncedSubtitleTime(600,0,anchors)),1);
  assert.match(srt(cues,0,anchors),/00:10:00,000/);
});
test('anchors reject malformed and time reversing matches, support repeated calibration positions',()=>{
  assert.deepEqual(syncAnchorsValid([null,{videoTime:-1,offset:0},{videoTime:10,offset:5000},{videoTime:30,offset:5},{videoTime:0,offset:0},{videoTime:20,offset:50}]),[{videoTime:0,offset:0},{videoTime:30,offset:5}]);
  const anchors=[{videoTime:100,offset:0},{videoTime:200,offset:0}];
  assert.equal(addSyncAnchor(anchors,150,60),null);
  assert.equal(addSyncAnchor(anchors,NaN,1),null);
  assert.deepEqual(addSyncAnchor(anchors,100.5,5),[{videoTime:100.5,offset:5},{videoTime:200,offset:0}]);
});
test('periodic calibration is opt in, ignores paused time and seeks, manual stop persists until enable',()=>{
  const schedule=createSyncSchedule();
  for(let time=0;time<400;time++) assert.equal(schedule.advance(time,true,120),false);
  schedule.enable();assert.equal(schedule.advance(0,true,120),false);
  for(let time=1;time<120;time++) assert.equal(schedule.advance(time,true,120),false);
  assert.equal(schedule.advance(120,true,120),true);
  assert.equal(schedule.advance(900,true,120),false);assert.equal(schedule.elapsed,0);
  for(let time=901;time<1100;time++) assert.equal(schedule.advance(time,false,120),false);
  assert.equal(schedule.elapsed,0);
  schedule.stop();for(let time=1100;time<1400;time++) assert.equal(schedule.advance(time,true,120),false);
  assert.equal(schedule.enabled,false);schedule.enable();assert.equal(schedule.enabled,true);assert.equal(schedule.elapsed,0);
});
test('in flight calibration and buffering cannot immediately trigger a second paid job',()=>{
  const s=createSyncSchedule();s.enable();
  for(let time=0;time<=119;time++) s.advance(time,true,120);
  assert.equal(s.advance(120,true,120,true),false);
  assert.equal(s.advance(121,false,120),false);
  assert.equal(s.advance(122,true,120),true);
  for(let time=123;time<=130;time++) assert.equal(s.advance(time,true,120,true),false);
  assert.equal(s.elapsed,0);
});
