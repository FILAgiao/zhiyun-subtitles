/* One capture / one ASR stream. Only provider-confirmed utterances can move subtitles. */
(function(root){
'use strict';
const SAMPLE_RATE=16000,CHUNK_SAMPLES=3200;
function fault(code,message,extra={}){return Object.assign(new Error(message),{code,...extra});}
function bytesBase64(bytes){
 if(typeof Buffer!=='undefined')return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
}
/* Area averaging preserves sample count across callbacks, including 44.1 kHz input. */
function createResampler(inputRate,outputRate=SAMPLE_RATE,chunkSamples=CHUNK_SAMPLES,onChunk=()=>{}){
 if(!(inputRate>=outputRate&&outputRate>0&&chunkSamples>0))throw fault('invalid_sample_rate','音轨采样率不受支持');
 const ratio=inputRate/outputRate;let sum=0,weight=0,chunk=new Int16Array(chunkSamples),used=0,total=0;
 const emit=value=>{const sample=Math.max(-1,Math.min(1,value));chunk[used++]=Math.round(sample*(sample<0?32768:32767));total++;if(used===chunk.length){const bytes=new Uint8Array(chunk.length*2),view=new DataView(bytes.buffer);for(let i=0;i<chunk.length;i++)view.setInt16(i*2,chunk[i],true);onChunk(bytes);chunk=new Int16Array(chunkSamples);used=0;}};
 return {push(channels){
  if(!Array.isArray(channels)||!channels.length)return;
  const length=channels[0].length;if(channels.some(channel=>channel.length!==length))throw fault('invalid_audio','音轨声道长度不一致');
  for(let i=0;i<length;i++){let value=0;for(const channel of channels)value+=Number.isFinite(channel[i])?channel[i]:0;value/=channels.length;let remaining=1;
   while(remaining>1e-9){const take=Math.min(remaining,ratio-weight);sum+=value*take;weight+=take;remaining-=take;if(weight>=ratio-1e-8){emit(sum/ratio);sum=0;weight=0;}}
  }
 },get samples(){return total;},get pendingSamples(){return used;}};
}
function createPCMSource(video,options={}){
 let context,stream,capturedStream,source,processor,gain,resume,stopped=false,started=false,firstVideoTime=null,inputSamples=0,lastTime=null,callbacks={},resampler;
 const listeners=[],AudioContextClass=options.AudioContext||root.AudioContext||root.webkitAudioContext;
 const rate=Number(video?.playbackRate)||1;
 function stop(){if(stopped)return;stopped=true;for(const [name,handler] of listeners)video?.removeEventListener?.(name,handler);listeners.length=0;try{processor&&(processor.onaudioprocess=null);}catch{}for(const node of [source,processor,gain]){try{node?.disconnect();}catch{}}for(const track of [...(stream?.getTracks?.()||[]),...(capturedStream?.getTracks?.()||capturedStream?.getAudioTracks?.()||[])]){try{track.stop();}catch{}}try{Promise.resolve(context?.close()).catch(()=>{});}catch{}}
 function fail(code,message){if(stopped)return;callbacks.onError?.(fault(code,message));stop();}
 function prepare(){
  if(context||stopped)return;
  if(!video||video.paused||video.ended||video.seeking||!Number.isFinite(video.currentTime))throw fault('media_not_playing','请先播放课程，再开始智能同步');
  if(!AudioContextClass)throw fault('audio_capture_unsupported','浏览器未提供课程音轨采集');
  const capture=video.captureStream||video.mozCaptureStream;if(!capture)throw fault('audio_capture_unsupported','浏览器未提供课程音轨采集');
  capturedStream=capture.call(video);const tracks=capturedStream?.getAudioTracks?.()||[];
  if(!tracks.length)throw fault('audio_track_missing','当前视频没有可采集的音轨，请确认正在播放');
  const clones=tracks.map(track=>track.clone());stream=new root.MediaStream(clones);
  context=new AudioContextClass();resume=context.resume();
  // Attach a rejection handler immediately; start() still reports the failure.
  Promise.resolve(resume).catch(()=>{});
 }
 return {prepare,async start(handlers){
  if(started)throw fault('already_started','音轨采集已启动');started=true;callbacks=handlers;prepare();await resume;
  if(stopped)return;
  source=context.createMediaStreamSource(stream);processor=context.createScriptProcessor(1024,Math.max(1,source.channelCount||2),1);gain=context.createGain();gain.gain.value=0;
  resampler=createResampler(context.sampleRate,SAMPLE_RATE,options.chunkSamples||CHUNK_SAMPLES,pcm=>callbacks.onChunk?.({pcm,videoStart:firstVideoTime,playbackRate:rate}));
  const eventFailure=event=>fail('media_'+event.type,'课程播放状态已改变，请继续播放后重新同步');
  for(const name of ['pause','seeking','ratechange','waiting','emptied','ended']){video.addEventListener?.(name,eventFailure);listeners.push([name,eventFailure]);}
  processor.onaudioprocess=event=>{
   if(stopped)return;
   if(video.paused||video.seeking||video.ended||video.readyState<2||Math.abs((Number(video.playbackRate)||1)-rate)>.0001)return fail('media_discontinuity','课程播放已中断，请重新同步');
   const input=event.inputBuffer,duration=input.length/context.sampleRate,now=Number(video.currentTime);
   if(firstVideoTime===null){firstVideoTime=Math.max(0,now-duration*rate);callbacks.onStart?.({videoStart:firstVideoTime,playbackRate:rate});}
   // Sample time, rather than network receive time, defines recognition timestamps.
   const expected=firstVideoTime+(inputSamples/context.sampleRate+duration)*rate;
   if(!Number.isFinite(now)||(lastTime!==null&&now<lastTime-.1)||Math.abs(now-expected)>Math.max(.8,rate*.45))return fail('media_discontinuity','音轨与视频时间不连续，请重新同步');
   lastTime=now;inputSamples+=input.length;const channels=[];for(let channel=0;channel<input.numberOfChannels;channel++)channels.push(input.getChannelData(channel));resampler.push(channels);
  };
  source.connect(processor);processor.connect(gain);gain.connect(context.destination);
 },stop};
}
function timedUtterance(utterance,rate){
 const copy={...utterance};for(const field of ['start_time','end_time'])if(Number.isFinite(copy[field]))copy[field]*=rate;
 if(Array.isArray(copy.words))copy.words=copy.words.map(word=>{const result={...word};for(const field of ['start_time','end_time'])if(Number.isFinite(result[field]))result[field]*=rate;return result;});return copy;
}
function isStable(utterance){return utterance&&(utterance.definite===true||utterance.is_final===true||utterance.final===true);}
function utteranceStart(utterance){
 if(Number.isFinite(utterance.start_time)&&utterance.start_time>=0)return utterance.start_time;
 const word=utterance.words?.find(word=>Number.isFinite(word.start_time)&&word.start_time>=0);return word?word.start_time:null;
}
function explicitUnsupported(error){return [404,405,501].includes(Number(error?.status||error?.error_status))||['stream_unsupported','speech_stream_unsupported','speech_stream_unavailable','speech_stream_disabled'].includes(error?.code||error?.error_code);}
function createSession(options){
 if(typeof options?.transport!=='function')throw new TypeError('speech stream transport is required');
 const video=options.video,transport=options.transport,audioSource=options.audioSource||createPCMSource(video,options);
 const clock={now:()=>Date.now(),setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id),...options.timers};
 const maxSeconds=Math.max(2,Math.min(30,Number(options.maxSeconds)||20)),maxQueuedChunks=options.maxQueuedChunks||40,pollMs=options.pollMs||350;
 const requestId=options.requestId||(root.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,letter=>{const value=Math.random()*16|0;return (letter==='x'?value:value&3|8).toString(16);}));
 let id=requestId,running=false,settled=false,created=false,attemptedCreate=false,sentAudio=false,sourceStopped=false,cancelReason='',failure=null,terminal=null,wake=null;
 let recordedVideoStart=null,playbackRate=Number(video?.playbackRate)||1,capturedSamples=0,acknowledgedSamples=0,sequence=0,nextPoll=0,finishSent=false,finishedAt=0;
 const queue=[],stable=new Map(),controller=new AbortController();let lastResult={text:'',utterances:[]},lastRevision=-1,stableSignature='';
 function stopSource(){if(sourceStopped)return;sourceStopped=true;try{audioSource.stop();}catch{}}
 function wakeWorker(){if(wake){const fn=wake;wake=null;fn();}}
 function cancel(reason='cancelled'){if(settled)return;cancelReason=reason;stopSource();controller.abort();wakeWorker();}
 function report(status){options.onStatus?.({state:status,audioSeconds:capturedSamples/SAMPLE_RATE,sentAudio,recordedVideoStart});}
 function wait(ms){if(cancelReason||failure||terminal)return Promise.resolve();return new Promise(resolve=>{let timer;const finish=()=>{clock.clearTimeout(timer);if(wake===finish)wake=null;resolve();};timer=clock.setTimeout(finish,ms);wake=finish;});}
 async function request(action,payload,cleanup=false){
  if(!cleanup&&controller.signal.aborted)throw fault('cancelled',cancelReason||'已取消');
  const requestController=new AbortController(),timeout=action==='create'?(options.createTimeoutMs||10000):action==='cancel'?2500:(options.requestTimeoutMs||6000);
  let timer,abortHandler;const aborted=new Promise((_,reject)=>{abortHandler=()=>{requestController.abort();reject(fault('cancelled',cancelReason||'已取消'));};if(!cleanup)controller.signal.addEventListener('abort',abortHandler,{once:true});});
  const expired=new Promise((_,reject)=>{timer=clock.setTimeout(()=>{requestController.abort();reject(fault('stream_timeout','流式识别连接超时',{action}));},timeout);});
  try{return await Promise.race([Promise.resolve().then(()=>transport(action,payload,{signal:requestController.signal})),expired,aborted]);}finally{clock.clearTimeout(timer);controller.signal.removeEventListener('abort',abortHandler);}
 }
 function consume(snapshot){
  if(cancelReason||failure||terminal||!snapshot)return;
  if(snapshot.id&&snapshot.id!==id)throw fault('stream_session_mismatch','语音会话不一致');
  if(snapshot.error||snapshot.state==='error'||snapshot.state==='failed')throw fault(snapshot.error_code||'stream_failed',String(snapshot.error||'流式识别失败'),{status:snapshot.error_status});
  const result=snapshot.result||{};if(typeof result.text==='string'||Array.isArray(result.utterances))lastResult={text:typeof result.text==='string'?result.text:lastResult.text,utterances:Array.isArray(result.utterances)?result.utterances:lastResult.utterances};
  for(const utterance of lastResult.utterances)if(isStable(utterance)&&String(utterance.text||'').trim()){
   const start=utteranceStart(utterance),key=start!==null?'start:'+start:Number.isFinite(utterance.end_time)?'end:'+utterance.end_time:'text:'+utterance.text;stable.set(key,utterance);
  }
  const stableUtterances=[...stable.values()].sort((a,b)=>(utteranceStart(a)||0)-(utteranceStart(b)||0));
  const signature=JSON.stringify(stableUtterances);let alignment=null;
  if(signature!==stableSignature&&recordedVideoStart!==null){stableSignature=signature;if(stableUtterances.length&&options.match)alignment=options.match(stableUtterances.map(utterance=>timedUtterance(utterance,playbackRate)),recordedVideoStart);}
  options.onResult?.({...lastResult,stableUtterances,audioSeconds:capturedSamples/SAMPLE_RATE,recordedVideoStart,playbackRate,state:snapshot.state||'listening',revision:snapshot.revision,alignment});
  if(Number.isFinite(snapshot.revision))lastRevision=Math.max(lastRevision,snapshot.revision);
  if(alignment?.matched){terminal={matched:true,alignment};stopSource();wakeWorker();return;}
  if(snapshot.state==='complete'){terminal={matched:false,reason:'no_reliable_match'};stopSource();wakeWorker();}
  else if(snapshot.state==='cancelled')throw fault('stream_cancelled','语音识别会话已结束');
 }
 function onChunk(value){
  if(cancelReason||failure||terminal||sourceStopped)return;
  try{
   const item=value instanceof Uint8Array?{pcm:value}:value,raw=item?.pcm;
   if(!(raw instanceof Uint8Array)||raw.byteLength%2||!raw.byteLength)throw fault('invalid_audio','课程音轨格式无效');
   if(recordedVideoStart===null){recordedVideoStart=Number(item.videoStart);if(!Number.isFinite(recordedVideoStart))throw fault('audio_timebase_missing','课程音轨缺少可靠时间基准');playbackRate=Number(item.playbackRate)||playbackRate;}
   if(Number.isFinite(item.videoStart)&&Math.abs(item.videoStart-recordedVideoStart)>.05)throw fault('media_discontinuity','课程音轨起点发生变化');
   if(Number.isFinite(item.playbackRate)&&Math.abs(item.playbackRate-playbackRate)>.0001)throw fault('media_discontinuity','课程播放速度已改变');
   const remaining=Math.floor(maxSeconds*SAMPLE_RATE)-capturedSamples;if(remaining<=0){stopSource();wakeWorker();return;}
   const pcm=raw.slice(0,Math.min(raw.byteLength,remaining*2));
   // Prevent a slow proxy from retaining unlimited audio or silently dropping samples.
   if(queue.length>=maxQueuedChunks)throw fault('stream_backpressure','语音连接过慢，已停止采音，请检查网络');
   capturedSamples+=pcm.byteLength/2;queue.push({pcm,samples:pcm.byteLength/2});
   if(capturedSamples>=maxSeconds*SAMPLE_RATE)stopSource();wakeWorker();
  }catch(error){failure=error;stopSource();wakeWorker();}
 }
 async function startSource(){
  let timer,abort;const blocked=new Promise((_,reject)=>{abort=()=>reject(fault('cancelled',cancelReason||'已取消'));controller.signal.addEventListener('abort',abort,{once:true});timer=clock.setTimeout(()=>reject(fault('audio_capture_timeout','课程音轨未能启动，请重新播放后重试')),options.audioStartTimeoutMs||5000);});
  try{await Promise.race([audioSource.start({onChunk,onStart:meta=>{if(Number.isFinite(meta?.videoStart)){recordedVideoStart=meta.videoStart;playbackRate=Number(meta.playbackRate)||playbackRate;}},onError:error=>{if(!terminal&&!cancelReason){failure=error||fault('audio_capture_failed','课程音轨采集失败');stopSource();wakeWorker();}}}),blocked]);}finally{clock.clearTimeout(timer);controller.signal.removeEventListener('abort',abort);}
 }
 async function cleanup(){stopSource();if(attemptedCreate){try{await request('cancel',{id},true);}catch{}}}
 async function run(){
  if(running)throw fault('already_started','流式识别会话只能启动一次');running=true;const startedAt=clock.now();
  try{
   // prepare resumes AudioContext in the original button gesture; it does not upload audio.
   if(cancelReason)throw fault('cancelled',cancelReason);audioSource.prepare?.();
   attemptedCreate=true;report('connecting');const opening=await request('create',{request_id:requestId});created=typeof opening?.id==='string'&&opening.id.length>0;id=opening?.id||requestId;consume(opening);
   if(!terminal){report('listening');await startSource();}
   nextPoll=clock.now();
   while(!terminal&&!failure&&!cancelReason){
    const now=clock.now();
    if(now-startedAt>(options.sessionTimeoutMs||maxSeconds*1000+20000))throw fault('stream_timeout','流式识别未及时返回结果');
    // Poll is interleaved with one upload at a time: at most one HTTPS request is active.
    if(now>=nextPoll&&!queue.length){consume(await request('poll',{id,after_revision:lastRevision}));nextPoll=clock.now()+pollMs;if(terminal)break;}
    if(queue.length){
     // First frame goes out immediately. A slow proxy can combine only frames
     // already captured; never wait for a larger packet or change sample timing.
     const batch=[queue.shift()];let samples=batch[0].samples;
     if(sequence>0)while(queue.length&&samples+queue[0].samples<=SAMPLE_RATE){const item=queue.shift();batch.push(item);samples+=item.samples;}
     const bytes=new Uint8Array(samples*2);let byteOffset=0;for(const item of batch){bytes.set(item.pcm,byteOffset);byteOffset+=item.pcm.byteLength;}
     const chunk={sequence:sequence++,audio:bytesBase64(bytes),samples};sentAudio=true;let snapshot;
     try{snapshot=await request('push',{id,sequence:chunk.sequence,audio:chunk.audio});}catch(error){
      if(cancelReason||failure||Number(error.status||error.error_status)>0&&Number(error.status||error.error_status)<500)throw error;
      // Identical sequence / bytes are idempotent; no duplicate audio or second session.
      snapshot=await request('push',{id,sequence:chunk.sequence,audio:chunk.audio});
     }
     acknowledgedSamples+=chunk.samples;consume(snapshot);nextPoll=clock.now()+pollMs;continue;
    }
    if(sourceStopped&&!finishSent){finishSent=true;finishedAt=clock.now();report('finishing');consume(await request('finish',{id}));continue;}
    if(finishSent&&clock.now()-finishedAt>(options.finalTimeoutMs||8000))throw fault('stream_final_timeout','音频已提交，但稳定识别结果未及时返回');
    await wait(Math.min(80,Math.max(1,nextPoll-clock.now())));
   }
   if(failure)throw failure;
   return {...(terminal||{matched:false,reason:cancelReason||'cancelled'}),cancelled:!!cancelReason,sentAudio,fallbackAllowed:false,recordedVideoStart,playbackRate,audioSeconds:acknowledgedSamples/SAMPLE_RATE,utterances:[...stable.values()],text:lastResult.text};
  }catch(error){
   const fallbackAllowed=!created&&!sentAudio&&!cancelReason&&(!attemptedCreate||explicitUnsupported(error));
   return {matched:false,reason:cancelReason||error.code||'stream_failed',error,cancelled:!!cancelReason,sentAudio,fallbackAllowed,recordedVideoStart,playbackRate,audioSeconds:acknowledgedSamples/SAMPLE_RATE,utterances:[...stable.values()],text:lastResult.text};
  }finally{settled=true;await cleanup();}
 }
 return {run,cancel,get sentAudio(){return sentAudio;},get requestId(){return requestId;}};
}
const api={createSession,createPCMSource,createResampler,isStable,SAMPLE_RATE,CHUNK_SAMPLES};root.ZYSpeechStream=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
