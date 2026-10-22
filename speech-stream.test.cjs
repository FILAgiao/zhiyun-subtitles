const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSession,createResampler,createPCMSource,isStable}=require('./speech-stream.js');
const pcm=samples=>new Uint8Array(samples*2);
const final=(text='工业相机采集图像然后算法检测边缘',start=0)=>({text,start_time:start,end_time:start+1200,definite:true,words:[{text,start_time:start,end_time:start+1200}]});
function sourceFixture(onStart){
 let stopped=0,handlers;
 return {prepare(){},start(value){handlers=value;onStart?.(value);},stop(){stopped++;},emit(samples=3200,meta={}){handlers.onChunk({pcm:pcm(samples),videoStart:100,playbackRate:1,...meta});},get handlers(){return handlers;},get stopped(){return stopped;}};
}
function basicOptions(source,transport,extra={}){return {audioSource:source,transport,requestId:'test-session',maxSeconds:2,pollMs:1,requestTimeoutMs:100,createTimeoutMs:100,finalTimeoutMs:100,sessionTimeoutMs:1000,...extra};}
function snapshot(extra={}){return {id:'test-session',state:'listening',revision:1,result:{text:'',utterances:[]},...extra};}

test('first provider-confirmed sentence matches immediately without recording a second round',async()=>{
 const actions=[],previews=[];let pushed=0,matched=0;const source=sourceFixture(h=>h.onChunk({pcm:pcm(3200),videoStart:100}));
 const result=await createSession(basicOptions(source,async(action,payload)=>{actions.push(action);if(action==='push'){pushed++;return snapshot({result:{text:'真实识别',utterances:[final()]}});}return snapshot();},{match:(utterances,start)=>{matched++;assert.equal(start,100);assert.equal(utterances[0].definite,true);return {matched:true,offset:2.4};},onResult:value=>previews.push(value.text)})).run();
 assert.equal(result.matched,true);assert.deepEqual(result.alignment,{matched:true,offset:2.4});assert.equal(pushed,1);assert.equal(matched,1);assert.equal(source.stopped,1);assert.equal(actions.at(-1),'cancel');assert.equal(actions.includes('finish'),false);assert.equal(previews.at(-1),'真实识别');
});

test('partial text is displayed but cannot change alignment',async()=>{
 let matching=0,partialSeen=false;const source=sourceFixture(h=>{h.onChunk({pcm:pcm(16000),videoStart:100});h.onChunk({pcm:pcm(16000),videoStart:100});});
 const result=await createSession(basicOptions(source,async action=>action==='push'?snapshot({result:{text:'正在识别的真实内容',utterances:[{...final(),definite:false}]}}):action==='finish'?snapshot({state:'complete'}):snapshot(),{match:()=>{matching++;return {matched:true};},onResult:value=>{partialSeen||=value.text==='正在识别的真实内容';}})).run();
 assert.equal(matching,0);assert.equal(partialSeen,true);assert.equal(result.matched,false);assert.equal(result.reason,'no_reliable_match');assert.equal(result.audioSeconds,2);
});

test('a nonmatching stable first sentence accumulates context in the same ASR session',async()=>{
 let pushes=0,creates=0,matchCalls=0;const source=sourceFixture(h=>{for(let i=0;i<3;i++)h.onChunk({pcm:pcm(3200),videoStart:100});});
 const first=final('这个片段暂时找不到字幕',0),second=final('电荷信号根据后面的模数转换器处理',300);
 const result=await createSession(basicOptions(source,async action=>{if(action==='create')creates++;if(action==='push'){pushes++;return snapshot({revision:pushes,result:{text:pushes===1?first.text:first.text+second.text,utterances:pushes===1?[first]:[first,second]}});}return snapshot();},{match:utterances=>{matchCalls++;return {matched:utterances.length>=2,offset:1};}})).run();
 assert.equal(result.matched,true);assert.equal(creates,1);assert.equal(pushes,2);assert.equal(matchCalls,2);
});

test('accumulates stable utterances even when provider snapshots contain only the latest sentence',async()=>{
 let pushes=0;const source=sourceFixture(h=>{for(let i=0;i<2;i++)h.onChunk({pcm:pcm(3200),videoStart:100});});
 const result=await createSession(basicOptions(source,async action=>action==='push'?snapshot({result:{text:'更新',utterances:[final('句子'+(++pushes),pushes*1000)]}}):snapshot(),{match:utterances=>({matched:utterances.length===2})})).run();assert.equal(result.utterances.length,2);assert.equal(result.matched,true);
});

test('playback rate scales real word timestamps into the video timebase',async()=>{
 const source=sourceFixture(h=>h.onChunk({pcm:pcm(3200),videoStart:100,playbackRate:2}));
 const result=await createSession(basicOptions(source,async action=>action==='push'?snapshot({result:{text:'内容',utterances:[final('内容',500)]}}):snapshot(),{match:(utterances,start)=>{assert.equal(start,100);assert.equal(utterances[0].start_time,1000);assert.equal(utterances[0].words[0].start_time,1000);return {matched:true};}})).run();assert.equal(result.playbackRate,2);assert.equal(result.utterances[0].start_time,500);
});

test('one failed upload retries identical sequence and bytes without opening another upstream session',async()=>{
 let pushes=0,creates=0;const seen=[],source=sourceFixture(h=>h.onChunk({pcm:pcm(3200),videoStart:100}));
 const result=await createSession(basicOptions(source,async(action,payload)=>{if(action==='create')creates++;if(action==='push'){seen.push(payload);if(++pushes===1)throw new Error('network');return snapshot({result:{utterances:[final()]}});}return snapshot();},{match:()=>({matched:true})})).run();assert.equal(result.matched,true);assert.equal(creates,1);assert.deepEqual(seen[0],seen[1]);
});

test('a push rejected after possible audio acceptance forbids file fallback',async()=>{
 let pushes=0;const source=sourceFixture(h=>h.onChunk({pcm:pcm(3200),videoStart:100}));
 const result=await createSession(basicOptions(source,async action=>{if(action==='push'){pushes++;throw Object.assign(new Error('forbidden'),{status:403});}return snapshot();})).run();assert.equal(pushes,1);assert.equal(result.sentAudio,true);assert.equal(result.fallbackAllowed,false);
});

test('create network failure cancels by request id and cannot silently fall back',async()=>{
 const seen=[],source=sourceFixture();const result=await createSession(basicOptions(source,async(action,payload)=>{seen.push([action,payload]);if(action==='create')throw new Error('response lost');return snapshot();})).run();assert.equal(result.fallbackAllowed,false);assert.equal(result.sentAudio,false);assert.deepEqual(seen.at(-1),['cancel',{id:'test-session'}]);
});

test('explicit unsupported endpoint allows file fallback before audio has been sent',async()=>{
 const source=sourceFixture();const result=await createSession(basicOptions(source,async action=>{if(action==='create')throw Object.assign(new Error('unsupported'),{status:404});return snapshot();})).run();assert.equal(result.fallbackAllowed,true);assert.equal(result.sentAudio,false);
});

test('a capture preparation failure makes no upstream session and allows safe fallback',async()=>{
 let requests=0;const source={prepare(){throw Object.assign(new Error('capture unavailable'),{code:'audio_capture_unsupported'});},stop(){}};const result=await createSession(basicOptions(source,async()=>{requests++;})).run();assert.equal(requests,0);assert.equal(result.fallbackAllowed,true);
});

test('cancel aborts a pending push, preserves one session and does not try file recognition',async()=>{
 let session,aborted=false,entered;const pushing=new Promise(resolve=>entered=resolve),source=sourceFixture(h=>h.onChunk({pcm:pcm(3200),videoStart:100}));
 session=createSession(basicOptions(source,async(action,payload,{signal})=>{if(action==='push'){entered();return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));}));}return snapshot();}));
 const running=session.run();await pushing;session.cancel('course_changed');const result=await running;assert.equal(aborted,true);assert.equal(result.reason,'course_changed');assert.equal(result.cancelled,true);assert.equal(result.fallbackAllowed,false);
});

test('source discontinuity ends the stream and cannot reuse its old sample timebase',async()=>{
 const source=sourceFixture(h=>{h.onChunk({pcm:pcm(3200),videoStart:100});h.onChunk({pcm:pcm(3200),videoStart:500});});const result=await createSession(basicOptions(source,async()=>snapshot())).run();assert.equal(result.reason,'media_discontinuity');assert.equal(result.matched,false);assert.equal(result.fallbackAllowed,false);
});

test('unbounded audio queues stop rather than dropping or shifting samples',async()=>{
 const source=sourceFixture(h=>{for(let i=0;i<4;i++)h.onChunk({pcm:pcm(3200),videoStart:100});});const result=await createSession(basicOptions(source,async()=>snapshot(),{maxQueuedChunks:2})).run();assert.equal(result.reason,'stream_backpressure');assert.equal(result.matched,false);
});

test('missing sample video timestamp never applies an apparently perfect subtitle match',async()=>{
 const source=sourceFixture(h=>h.onChunk({pcm:pcm(3200)}));let matches=0;const result=await createSession(basicOptions(source,async()=>snapshot({result:{utterances:[final()]}}),{match:()=>{matches++;return {matched:true};}})).run();assert.equal(result.reason,'audio_timebase_missing');assert.equal(matches,0);
});

test('all requests are serialized even while audio queues and polls update',async()=>{
 let active=0,maximum=0,pushes=0;const source=sourceFixture(h=>{for(let i=0;i<3;i++)h.onChunk({pcm:pcm(3200),videoStart:100});});
 const result=await createSession(basicOptions(source,async action=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return action==='push'&&++pushes>=2?snapshot({result:{utterances:[final()]}}):snapshot();},{match:()=>({matched:true})})).run();assert.equal(result.matched,true);assert.equal(maximum,1);
});

test('request timeouts remain bounded, retry upload once, and disallow a second billable session',async()=>{
 let pushes=0;const source=sourceFixture(h=>h.onChunk({pcm:pcm(3200),videoStart:100}));const result=await createSession(basicOptions(source,async action=>{if(action==='push'){pushes++;return new Promise(()=>{});}return snapshot();},{requestTimeoutMs:10})).run();assert.equal(result.reason,'stream_timeout');assert.equal(pushes,2);assert.equal(result.fallbackAllowed,false);
});

test('backend error snapshots fail explicitly and clean up the upstream websocket',async()=>{
 const actions=[],source=sourceFixture(h=>h.onChunk({pcm:pcm(3200),videoStart:100}));const result=await createSession(basicOptions(source,async action=>{actions.push(action);return action==='push'?snapshot({state:'error',error:'quota exceeded',error_code:'quota_exhausted',error_status:402}):snapshot();})).run();assert.equal(result.reason,'quota_exhausted');assert.equal(result.sentAudio,true);assert.equal(actions.at(-1),'cancel');
});

test('a cross-session response cannot align the current course',async()=>{
 const source=sourceFixture(h=>h.onChunk({pcm:pcm(3200),videoStart:100}));let matched=0;const result=await createSession(basicOptions(source,async action=>action==='push'?{...snapshot({result:{utterances:[final()]}}),id:'another-account-session'}:snapshot(),{match:()=>{matched++;return {matched:true};}})).run();assert.equal(result.reason,'stream_session_mismatch');assert.equal(matched,0);
});

test('resamples 48 kHz stereo into little-endian 16 kHz mono with exact sample counts',()=>{
 const output=[],resampler=createResampler(48000,16000,3200,chunk=>output.push(chunk));resampler.push([new Float32Array(48000).fill(.75),new Float32Array(48000).fill(.25)]);assert.equal(output.length,5);assert.equal(resampler.samples,16000);const view=new DataView(output[0].buffer);assert.equal(view.getInt16(0,true),16384);assert.equal(view.getInt16(1*2,true),16384);
});

test('44.1 kHz resampling retains fractional phase across irregular callback boundaries',()=>{
 const output=[],resampler=createResampler(44100,16000,1600,chunk=>output.push(chunk));for(let i=0;i<44100;i+=1024)resampler.push([new Float32Array(Math.min(1024,44100-i)).fill(-1)]);assert.equal(resampler.samples,16000);assert.equal(output.length,10);assert.equal(new DataView(output[0].buffer).getInt16(0,true),-32768);
});

test('stable flags require an explicit provider final marker',()=>{
 assert.equal(isStable({definite:false}),false);assert.equal(isStable({}),false);assert.equal(isStable({definite:true}),true);assert.equal(isStable({is_final:true}),true);
});

function browserFixture(){
 const events=new Map(),clones=[],originals=[];let processor,closed=0,disconnected=0;
 const video={paused:false,ended:false,seeking:false,readyState:4,currentTime:100,playbackRate:1,addEventListener(name,fn){events.set(name,fn);},removeEventListener(name){events.delete(name);},captureStream(){const track={stopped:false,stop(){this.stopped=true;},clone(){const cloned={stopped:false,stop(){this.stopped=true;}};clones.push(cloned);return cloned;}};originals.push(track);return {getAudioTracks:()=>[track]};}};
 class FakeAudioContext{constructor(){this.sampleRate=48000;this.destination={};}resume(){return Promise.resolve();}createMediaStreamSource(){return {channelCount:2,connect(){},disconnect(){disconnected++;}};}createScriptProcessor(){return processor={connect(){},disconnect(){disconnected++;},onaudioprocess:null};}createGain(){return {gain:{value:1},connect(){},disconnect(){disconnected++;}};}close(){closed++;return Promise.resolve();}}
 return {video,AudioContext:FakeAudioContext,clones,originals,events,get processor(){return processor;},get closed(){return closed;},get disconnected(){return disconnected;}};
}

test('native source captures the existing course audio only and stops on pause without recapturing',async()=>{
 const previous=global.MediaStream;global.MediaStream=class {constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}};
 try{const env=browserFixture(),chunks=[],errors=[],source=createPCMSource(env.video,{AudioContext:env.AudioContext,chunkSamples:1600});source.prepare();await source.start({onChunk:value=>chunks.push(value),onError:error=>errors.push(error)});
  for(let i=0;i<5;i++){env.video.currentTime=100+(i+1)*1024/48000;env.processor.onaudioprocess({inputBuffer:{length:1024,numberOfChannels:2,getChannelData:()=>new Float32Array(1024).fill(.5)}});}
  assert.equal(chunks.length,1);assert.ok(Math.abs(chunks[0].videoStart-100)<.00001);assert.equal(chunks[0].pcm.length,3200);env.events.get('pause')({type:'pause'});assert.equal(errors[0].code,'media_pause');assert.equal(env.clones.every(track=>track.stopped),true);assert.equal(env.originals.every(track=>track.stopped),true);assert.equal(env.closed,1);assert.equal(env.events.size,0);assert.equal(env.disconnected,3);
 }finally{global.MediaStream=previous;}
});

test('native source cancels if video time jumps even without a seeking event',async()=>{
 const previous=global.MediaStream;global.MediaStream=class {constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}};
 try{const env=browserFixture(),errors=[],source=createPCMSource(env.video,{AudioContext:env.AudioContext});await source.start({onError:error=>errors.push(error)});env.processor.onaudioprocess({inputBuffer:{length:1024,numberOfChannels:1,getChannelData:()=>new Float32Array(1024)}});env.video.currentTime=150;env.processor.onaudioprocess({inputBuffer:{length:1024,numberOfChannels:1,getChannelData:()=>new Float32Array(1024)}});assert.equal(errors[0].code,'media_discontinuity');assert.equal(env.closed,1);
 }finally{global.MediaStream=previous;}
});

test('real provider response replay aligns from word time when utterance.start_time is absent',async()=>{
 const fixture=require('./fixtures/speech-stream-provider.json'),{match}=require('./speech-alignment.js');let creates=0,uploads=0,uploadedSeconds=0,next=0,latest=fixture.events[0];const previews=[];
 const source=sourceFixture(h=>{for(let i=0;i<40;i++)h.onChunk({pcm:pcm(3200),videoStart:101});});
 const result=await createSession(basicOptions(source,async(action,payload)=>{
  if(action==='create')creates++;
  if(action==='push'){uploads++;uploadedSeconds+=Buffer.from(payload.audio,'base64').byteLength/32000;while(next<fixture.events.length&&fixture.events[next].seconds<=uploadedSeconds+.001)latest=fixture.events[next++];}
  return snapshot({revision:next,result:{text:latest.text,utterances:latest.utterances}});
 },{maxSeconds:8,match:(utterances,start)=>match(utterances,[{start:100,original:'This is a speech alignment test.'}],start),onResult:result=>previews.push(result.text)})).run();
 assert.equal(result.matched,true);assert.equal(result.alignment.offset,2.89);assert.equal(creates,1);assert.equal(uploads,7);assert.equal(Number(uploadedSeconds.toFixed(1)),6.2);assert.ok(previews.includes('Hello.'));assert.equal(result.utterances.length,2);assert.equal(result.utterances.some(utterance=>utterance.start_time===undefined),true);assert.equal(result.utterances[1].words.find(word=>word.start_time>=0).start_time,1892);
});

test('stable sentence corrections replace the same real word boundary rather than adding false evidence',async()=>{
 let pushed=0;const source=sourceFixture(h=>{for(let i=0;i<2;i++)h.onChunk({pcm:pcm(3200),videoStart:100});});
 const counts=[];const result=await createSession(basicOptions(source,async action=>action==='push'?snapshot({result:{utterances:[{definite:true,text:++pushed===1?'stable sentence':'stable sentence corrected',end_time:1200,words:[{text:'stable',start_time:200}]}]}}):snapshot(),{match:utterances=>{counts.push(utterances.length);return {matched:utterances[0].text.includes('corrected')};}})).run();assert.equal(result.matched,true);assert.deepEqual(counts,[1,1]);assert.equal(result.utterances.length,1);
});

test('cancellation while AudioContext resume is pending remains bounded and cleans the created stream',async()=>{
 let ready;const started=new Promise(resolve=>ready=resolve),source={prepare(){},start(){ready();return new Promise(()=>{});},stop(){}};const actions=[],session=createSession(basicOptions(source,async action=>{actions.push(action);return snapshot();}));const running=session.run();await started;session.cancel('cancel_before_audio');const result=await running;assert.equal(result.cancelled,true);assert.equal(result.reason,'cancel_before_audio');assert.equal(result.sentAudio,false);assert.equal(actions.at(-1),'cancel');
});

test('cancelling before run has no AudioContext or network side effects',async()=>{
 let prepared=0,requests=0;const source={prepare(){prepared++;},stop(){}},session=createSession(basicOptions(source,async()=>{requests++;return snapshot();}));session.cancel('cancelled');const result=await session.run();assert.equal(result.cancelled,true);assert.equal(prepared,0);assert.equal(requests,0);
});

test('injected monotonic clock enforces a whole-session deadline even if the source never emits frames',async()=>{
 let now=0;const source=sourceFixture(()=>{now=1500;}),actions=[];const result=await createSession(basicOptions(source,async action=>{actions.push(action);return snapshot();},{timers:{now:()=>now},sessionTimeoutMs:1000})).run();assert.equal(result.reason,'stream_timeout');assert.equal(result.sentAudio,false);assert.equal(actions.at(-1),'cancel');assert.equal(source.stopped,1);
});

function virtualClock(){
 let now=0,nextId=1;const pending=new Map();
 return {now:()=>now,setTimeout(fn,delay){const id=nextId++;pending.set(id,{at:now+delay,fn});return id;},clearTimeout(id){pending.delete(id);},async drive(promise){let done=false,value,error;promise.then(result=>{done=true;value=result;},reason=>{done=true;error=reason;});for(let step=0;!done&&step<2000;step++){for(let i=0;i<30;i++)await Promise.resolve();if(done)break;let firstId=null,first=null;for(const [id,item] of pending)if(!first||item.at<first.at){first=item;firstId=id;}if(!first)throw Error('virtual stream stalled without timers');pending.delete(firstId);now=first.at;first.fn();}if(!done)throw Error('virtual stream exceeded the step bound');if(error)throw error;return value;}};
}

test('slow 600 ms proxy merges already-captured frames to sustain real-time PCM without delaying the first packet',async()=>{
 const clock=virtualClock(),uploads=[],actions=[];let captured=0,stopped=false,active=0,maxActive=0;
 const source={prepare(){},start(handlers){for(let i=0;i<20;i++)clock.setTimeout(()=>{if(stopped)return;captured++;handlers.onChunk({pcm:pcm(3200),videoStart:100});},i*200);},stop(){stopped=true;}};
 const session=createSession(basicOptions(source,async(action,payload)=>{
  actions.push(action);if(action==='push'){active++;maxActive=Math.max(maxActive,active);uploads.push({sequence:payload.sequence,bytes:Buffer.from(payload.audio,'base64').byteLength,at:clock.now(),captured});await new Promise(resolve=>clock.setTimeout(resolve,600));active--;}
  return snapshot({state:action==='finish'?'complete':'listening'});
 },{maxSeconds:4,timers:clock,requestTimeoutMs:3000,sessionTimeoutMs:12000}));
 const result=await clock.drive(session.run());assert.equal(result.audioSeconds,4);assert.equal(result.sentAudio,true);assert.equal(result.matched,false);assert.equal(result.reason,'no_reliable_match');assert.equal(uploads[0].bytes,6400);assert.ok(uploads[0].at<200,'do not wait for five frames before the first upload');assert.ok(uploads.some(upload=>upload.bytes>6400));assert.ok(uploads.every(upload=>upload.bytes<=32000));assert.deepEqual(uploads.map(upload=>upload.sequence),uploads.map((_,index)=>index));assert.equal(uploads.reduce((bytes,upload)=>bytes+upload.bytes,0),4*32000);assert.ok(uploads.length<12,'batching avoids twenty individual 600 ms round trips');assert.ok(clock.now()<6000,'four seconds of audio complete near real time');assert.equal(maxActive,1);assert.equal(actions.filter(action=>action==='create').length,1);
});

test('a merged packet retry keeps exactly the same sequence and PCM bytes',async()=>{
 const source=sourceFixture(h=>{for(let i=0;i<8;i++)h.onChunk({pcm:pcm(3200),videoStart:100});}),packets=[];let failed=false;
 const result=await createSession(basicOptions(source,async(action,payload)=>{
  if(action==='push'){packets.push(payload);if(payload.sequence===1&&!failed){failed=true;throw Error('lost acknowledgement');}if(payload.sequence===1)return snapshot({result:{utterances:[final()]}});}return snapshot();
 },{match:()=>({matched:true})})).run();assert.equal(result.matched,true);assert.equal(Buffer.from(packets[0].audio,'base64').byteLength,6400);assert.equal(Buffer.from(packets[1].audio,'base64').byteLength,32000);assert.deepEqual(packets[1],packets[2]);assert.equal(result.audioSeconds,1.2);
});

test('a reserved create error snapshot forbids a second file task even before audio upload',async()=>{
 const actions=[],source=sourceFixture();const result=await createSession(basicOptions(source,async(action,payload)=>{actions.push({action,payload});return action==='create'?snapshot({state:'error',error:'upstream unavailable after reservation',error_code:'speech_stream_unavailable',error_status:503,audio_seconds:0}):snapshot({state:'cancelled'});})).run();assert.equal(result.matched,false);assert.equal(result.sentAudio,false);assert.equal(result.fallbackAllowed,false);assert.equal(result.reason,'speech_stream_unavailable');assert.deepEqual(actions.map(item=>item.action),['create','cancel']);assert.equal(actions.at(-1).payload.id,'test-session');
});
