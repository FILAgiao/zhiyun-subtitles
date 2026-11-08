/* Bounded, best-effort usage telemetry. No content, images, URLs or credentials. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZYUsageAnalytics=api;})(globalThis,function(){
'use strict';
const MAX_EVENTS=400,MAX_BATCH=100,MAX_AGE=7*86400,KEY='zy-usage-pending-v1';
function opaque(value){return [2166136261,2246822507,3266489909,668265263].map(seed=>{for(const c of String(value))seed=Math.imul(seed^c.codePointAt(0),16777619);return (seed>>>0).toString(16).padStart(8,'0');}).join('');}
function courseKey(raw){try{const ids=JSON.parse(raw);return Array.isArray(ids)&&ids.length===3&&ids[0]&&ids[1]&&ids.every(v=>v===null||typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v))?opaque('zju-classroom:'+JSON.stringify(ids)):'';}catch{return '';}}
function create({context=()=>null,send,storage=null,visible=()=>true,now=()=>Date.now(),monotonic=()=>typeof performance!=='undefined'?performance.now():Date.now(),schedule=setTimeout,cancel=clearTimeout,uuid=()=>globalThis.crypto?.randomUUID?.()||opaque(String(Math.random())+Date.now())}={}){
 let owner='',ownerRaw='',session='',sessionStarted=0,lastActive=0,queue=[],seen=new Set(),segment=null,last=null,watching=false,lastSample=-Infinity,course='',rawCourse=null,restoredCourse='',title='',saved=null,dirty=false,saveTimer=null,inflight=null,nextSend=0,failures=0,disabled=false,closed=false,interactionTimer=null,interactionUntil=0,interactionPrevious=null,dropped=0,batchLimit=MAX_BATCH,loaded=!storage?.load,loading=null,deferred=[];
 const stats={samples:0,acceptedSamples:0,storageWrites:0,requests:0,dropped:0,ownerHashes:0,courseHashes:0};
 function readSaved(raw){try{if(typeof raw==='string'&&raw.length<250000)saved=JSON.parse(raw);}catch{}}
 if(loaded)try{readSaved(storage?.getItem(KEY));}catch{}
 const stamp=()=>now()/1000;
 function persist(){cancel(saveTimer);saveTimer=null;if(!dirty||!loaded)return;dirty=false;try{if(owner){storage?.setItem(KEY,JSON.stringify({owner,session,sessionStarted,lastActive,course,title,seen:[...seen],events:queue,dropped}));stats.storageWrites++;}else storage?.removeItem(KEY);}catch{}}
 function changed(){dirty=true;if(saveTimer===null)saveTimer=schedule(persist,5000);}
 function bind(){
  if(closed)return false;let auth;try{auth=context();}catch{return false;}
  const raw=auth?.enabled&&auth.owner?auth.owner:'';let next=owner;
  if(raw!==ownerRaw){ownerRaw=raw;next=raw?opaque(raw):'';if(raw)stats.ownerHashes++;}
  if(next!==owner){
   // Never attribute a previous account's queue or delayed callback to the new one.
   queue=[];seen.clear();segment=null;last=null;watching=false;lastSample=-Infinity;course='';rawCourse=null;restoredCourse='';title='';session='';sessionStarted=0;lastActive=0;nextSend=0;failures=0;batchLimit=MAX_BATCH;disabled=false;interactionUntil=0;interactionPrevious=null;cancel(interactionTimer);interactionTimer=null;
   owner=next;
   changed();
  }
  if(owner&&!loaded){
   if(!loading)loading=Promise.resolve().then(()=>storage.load()).then(readSaved).catch(()=>{}).then(()=>{loaded=true;loading=null;if(closed)return;bind();const waiting=deferred;deferred=[];for(const e of waiting)feature(e.name,e.id,e.owner,e.at);});
   return false;
  }
  if(owner&&saved){
   if(saved.owner===owner&&Array.isArray(saved.events)){
    queue=saved.events.filter(e=>e&&typeof e.id==='string'&&Number.isFinite(e.at)&&e.at>=stamp()-MAX_AGE).slice(-MAX_EVENTS);
    session=typeof saved.session==='string'?saved.session:'';lastActive=Number(saved.lastActive)||0;sessionStarted=Number(saved.sessionStarted)||lastActive;restoredCourse=String(saved.course||'');seen=new Set(Array.isArray(saved.seen)?saved.seen.slice(0,4):[]);dropped=Number(saved.dropped)||0;
   }
   saved=null;changed();
  }
  return !!owner&&!disabled;
 }
 function begin(at){if(!session||at-lastActive>1800||at-sessionStarted>=86400){finishSegment();session=uuid();sessionStarted=at;seen.clear();}lastActive=at;}
 function push(event){
  if(queue.length>=MAX_EVENTS){queue.shift();dropped++;stats.dropped++;}
  queue.push(event);changed();
 }
 function meta(){return course?{course_id:course,course_title:title}:{};}
 function finishSegment(){if(!segment)return;const e=segment;segment=null;if(e.end>e.start)push(e);}
 function interval(start,end,watch){
  if(end<=start)return;watch=!!watch&&!!course;begin(end);
  if(segment&&(segment.watch!==watch||segment.course_id!==(course||undefined)||segment.session!==session||start>segment.end+.05||end-segment.start>60))finishSegment();
  if(segment){segment.end=Math.max(segment.end,end);segment.at=segment.end;}
  else segment={id:uuid(),kind:'activity',at:end,session,...meta(),start,end,watch};
 }
 function setCourse(raw,label=''){
  if(raw===rawCourse)return;rawCourse=raw;stats.courseHashes++;const key=courseKey(raw);if(key===course)return;finishSegment();course=key;
  // Course labels only; never accept a URL, authentication material or a page title on ordinary sites.
  title=key?String(label).replace(/https?:\/\/\S+|[\x00-\x1f]/gi,' ').slice(0,200):'';
  if(key!==restoredCourse){session='';seen.clear();}restoredCourse='';last=null;lastSample=-Infinity;changed();
 }
 function feature(name,operationId='',boundOwner='',recordedAt=null){
  const ready=bind();if(!visible()||boundOwner&&boundOwner!==owner||!['subtitle','translation','screenshot','ai'].includes(name))return false;
  const at=recordedAt??stamp();
  if(!ready){if(owner&&loading&&deferred.length<100)deferred.push({name,id:operationId,owner,at});return false;}
  begin(at);
  if((name==='subtitle'||name==='translation')&&seen.has(name))return false;
  if(name==='subtitle'||name==='translation')seen.add(name);
  const id=operationId?opaque(owner+':'+name+':'+operationId):uuid();
  if(queue.some(e=>e.id===id))return false;
  push({id,kind:'feature',at,session,...meta(),feature:name});return true;
 }
 function sample(state={}){
  stats.samples++;const mono=monotonic();if(mono-lastSample<950)return;lastSample=mono;stats.acceptedSamples++;
  if(!bind()||!visible()){last=null;watching=false;finishSegment();return;}
  if(state.course!==undefined)setCourse(state.course,state.title);
  const at=stamp(),playing=!!state.playing,position=Number(state.position),rate=Math.max(.1,Math.min(16,Number(state.rate)||1));
  const dt=last?(mono-last.mono)/1000:0,wall=last?at-last.at:0,advance=last?position-last.position:0;
  // A suspended timer, seek, buffer or clock jump must never create catch-up watch time.
  const moving=last&&playing&&last.playing&&dt>0&&dt<=2.5&&Math.abs(wall-dt)<.5&&advance>0&&advance<=dt*Math.max(rate,last.rate)*1.6+.5;
  watching=!!moving;
  if(moving){interval(last.at,at,true);if(state.subtitle)feature('subtitle');if(state.translation)feature('translation');}
  else finishSegment();
  last={mono,at,position,playing,rate};
 }
 function interactionTick(){
  interactionTimer=null;if(!bind()||!visible()||!interactionPrevious){interactionPrevious=null;return;}
  const at=stamp(),mono=monotonic(),dt=(mono-interactionPrevious.mono)/1000,wall=at-interactionPrevious.at;
  if(!(watching&&last&&mono-last.mono<2500)&&dt>0&&dt<=2.5&&Math.abs(wall-dt)<.5)interval(interactionPrevious.at,Math.min(at,interactionUntil),false);
  if(at<interactionUntil){interactionPrevious={at,mono};interactionTimer=schedule(interactionTick,1000);}else{interactionPrevious=null;finishSegment();}
 }
 function touch(){
  if(!bind()||!visible())return;const at=stamp();begin(at);interactionUntil=at+30;
  if(!interactionPrevious)interactionPrevious={at,mono:monotonic()};
  if(interactionTimer===null)interactionTimer=schedule(interactionTick,1000);
 }
 function suspend(){last=null;watching=false;finishSegment();cancel(interactionTimer);interactionTimer=null;interactionPrevious=null;interactionUntil=0;persist();}
 async function flush(){
  if(!bind()){if(loading)await loading;else return false;}if(!bind()||disabled||inflight||stamp()<nextSend)return false;
  finishSegment();queue=queue.filter(e=>(e.start??e.at)>=stamp()-MAX_AGE);persist();if(!queue.length)return false;
  const own=owner,batch=[];let bytes=20;for(const e of queue.slice(0,batchLimit)){const size=new TextEncoder().encode(JSON.stringify(e)).length+1;if(bytes+size>60000)break;batch.push(e);bytes+=size;}
  const ids=new Set(batch.map(e=>e.id));stats.requests++;
  nextSend=stamp()+60;
  const pending=Promise.resolve().then(()=>send({events:batch},own));inflight=pending;
  try{const result=await pending;if(owner!==own)return false;if(result?.ok!==true)throw Error('Unconfirmed analytics batch');const rejected=Array.isArray(result.rejected)?result.rejected.filter(e=>ids.has(e.id)).length:0;dropped+=rejected;stats.dropped+=rejected;queue=queue.filter(e=>!ids.has(e.id));failures=0;batchLimit=MAX_BATCH;changed();persist();return true;}
  catch(error){if(owner===own){failures++;nextSend=stamp()+Math.min(3600,60*2**Math.min(failures,6));if([404,405,501].includes(error.status)){disabled=true;queue=[];changed();persist();}
   else if([400,409,413].includes(error.status)){nextSend=stamp()+60;if(batch.length>1)batchLimit=Math.floor(batch.length/2);else{queue=queue.filter(e=>!ids.has(e.id));batchLimit=MAX_BATCH;dropped++;stats.dropped++;changed();persist();}}}return false;}
  finally{if(inflight===pending)inflight=null;}
 }
 function capture(){const ready=bind();return ready||loading&&!disabled?owner:'';}
 function destroy(){suspend();closed=true;cancel(saveTimer);}
 return {sample,feature,touch,setCourse,flush,suspend,capture,destroy,stats,inspect:()=>({owner,session,queued:queue.length,pending:segment?1:0,disabled,dropped,nextSend}),opaque};
}
return {create,opaque,courseKey,MAX_EVENTS,MAX_BATCH};
});
