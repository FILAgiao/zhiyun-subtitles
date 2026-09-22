import {createFile} from 'mp4box';

const MiB=1024*1024;
const abortError=()=>new Error('分段下载已停止；已完成块保留');
const concat=arrays=>{const out=new Uint8Array(arrays.reduce((n,a)=>n+a.byteLength,0));let at=0;for(const a of arrays){out.set(new Uint8Array(a),at);at+=a.byteLength;}return out.buffer;};
function lower(samples,time){let a=0,b=samples.length;while(a<b){const m=(a+b)>>1;if(samples[m].dts/samples[m].timescale<time)a=m+1;else b=m;}return a;}

// HTTP, storage permission and course identity remain in the userscript adapter.
export async function openCache({source,load,save,directory,request,checkSpace=async()=>{},onChange=()=>{},blockSize=2*MiB}) {
  let record=await load();
  if(!record)record={kind:'stream-v1',id:crypto.randomUUID(),blockSize,parts:{},total:0,validator:null,directory:await directory()};
  if(record.kind!=='stream-v1')throw new Error('分段缓存版本不兼容，请删除后重新缓存');
  const dir=record.directory;blockSize=record.blockSize;
  let stopped=false,closed=false,validated=false,working=false,network=new AbortController(),parser=null,tracks=[],segments=[],duration=0,inits=[],playback=null;
  const pending=new Map(),queue=[],readCache=new Map();
  const notify=()=>onChange({bytes:Object.values(record.parts).reduce((n,p)=>n+p.size,0),total:record.total,duration,ranges:ranges(),complete:complete()});
  const complete=()=>record.total>0 && Object.keys(record.parts).length===Math.ceil(record.total/blockSize);
  async function persist(){await save(record);notify();}
  async function disk(n){const part=record.parts[n];if(!part)return null;try{const f=await(await dir.getFileHandle(part.name)).getFile();if(f.size===part.size)return f;}catch(error){if(error.name!=='NotFoundError')throw error;}delete record.parts[n];await persist();return null;}
  async function validate(){
    if(validated)return;
    if(stopped || closed)throw abortError();
    const first=await request(source,{signal:network.signal,limit:blockSize,range:{start:0,end:blockSize-1}});
    if(record.total && (record.total!==first.total || !record.validator || /^W\//.test(record.validator) || !first.validator || record.validator!==first.validator))throw new Error('源文件无法核验或已改变，请删除此课分段缓存再重新下载；旧块未被混用');
    await checkSpace(Math.max(0,first.total-Object.values(record.parts).reduce((n,p)=>n+p.size,0)));
    record.total=first.total;record.validator=first.validator || null;validated=true;
    if(!await disk(0))await commit(0,first.blob);
  }
  async function commit(n,blob){
    const name=record.id+'-'+n+'.part',handle=await dir.getFileHandle(name,{create:true});let writer;
    try{writer=await handle.createWritable();await writer.write(blob);await writer.close();writer=null;record.parts[n]={name,size:blob.size};await persist();}
    finally{if(writer)await writer.abort().catch(()=>{});}
  }
  async function pump(){
    if(working)return;working=true;
    try{while(queue.length){queue.sort((a,b)=>b.priority-a.priority);const task=queue.shift();
      try{if(stopped || closed)throw abortError();await validate();let file=await disk(task.n);
        if(!file){const start=task.n*blockSize;if(start>=record.total)throw new Error('请求超出视频范围');
          const part=await request(source,{signal:network.signal,limit:blockSize,range:{start,end:Math.min(record.total-1,start+blockSize-1)},validator:record.validator});
          if(part.total!==record.total || (record.validator && part.validator!==record.validator))throw new Error('视频版本变化，下载已停止');
          await commit(task.n,part.blob);file=await disk(task.n);
        }task.resolve(file);
      }catch(error){stopped=true;network.abort();task.reject(error);}finally{pending.delete(task.n);}
    }}finally{working=false;}
  }
  async function block(n,priority=2){
    const cached=await disk(n);if(cached)return cached;
    if(stopped || closed)throw abortError();
    if(pending.has(n)){const task=pending.get(n);task.priority=Math.max(task.priority,priority);return task.promise;}
    const task={n,priority};task.promise=new Promise((resolve,reject)=>Object.assign(task,{resolve,reject}));pending.set(n,task);queue.push(task);pump();return task.promise;
  }
  async function read(offset,size,priority=2){
    if(size<0 || size>64*MiB)throw new Error('媒体索引或单个片段过大，无法安全载入');
    const arrays=[];let at=offset,left=size;
    while(left){const n=Math.floor(at/blockSize);let data=readCache.get(n);if(!data){data=await(await block(n,priority)).arrayBuffer();readCache.set(n,data);while(readCache.size>4)readCache.delete(readCache.keys().next().value);}else{readCache.delete(n);readCache.set(n,data);}const start=at%blockSize,take=Math.min(left,data.byteLength-start);if(take<=0)throw new Error('视频分块不完整');arrays.push(data.slice(start,start+take));at+=take;left-=take;}return concat(arrays);
  }
  async function index(){
    if(parser)return;
    await block(0);let at=0,ftyp=null,moov=null;
    for(let count=0;count<10000 && at<record.total;count++){
      const head=await read(at,Math.min(16,record.total-at));if(head.byteLength<8)throw new Error('MP4 文件头不完整');
      const view=new DataView(head),type=String.fromCharCode(...new Uint8Array(head,4,4));let size=view.getUint32(0);
      if(size===1){if(head.byteLength<16)throw new Error('MP4 长度异常');size=Number(view.getBigUint64(8));}else if(size===0)size=record.total-at;
      if(!Number.isSafeInteger(size)||size<8||at+size>record.total)throw new Error('MP4 索引长度异常');
      if(type==='ftyp')ftyp=await read(at,size);
      if(type==='moov')moov=await read(at,size);
      if(ftyp&&moov)break;at+=size;
    }
    if(!ftyp||!moov)throw new Error('未找到完整 MP4 索引；此来源暂不支持分段播放');
    const file=createFile(false);let info,error;
    file.onReady=value=>{info=value;};file.onError=()=>{error=new Error('MP4 索引解析失败');};
    const meta=concat([ftyp,moov]);meta.fileStart=0;file.appendBuffer(meta);
    if(error)throw error;
    if(!info || info.isFragmented)throw new Error('当前仅支持普通 MP4；分片 MP4 请使用完整缓存');
    const selected=[info.videoTracks?.[0],info.audioTracks?.[0]].filter(Boolean);
    if(!selected.some(t=>t.video))throw new Error('未找到可播放的视频轨');
    for(const t of selected){
      if(/^enc/.test(t.codec))throw new Error('加密视频不支持此缓存方式');
      const mime=(t.video?'video':'audio')+'/mp4; codecs="'+t.codec+'"';
      if(!globalThis.MediaSource?.isTypeSupported(mime))throw new Error('浏览器不支持此视频编码：'+t.codec);
      const samples=file.getTrackSamplesInfo(t.id);if(!samples?.length)throw new Error('音视频轨缺少时间索引');
      // Complex edit lists need a separate timeline adapter; never report false playable ranges.
      const edits=file.getTrackById(t.id).edts?.elst?.entries || [];
      if(edits.length>1 || edits.some(e=>e.media_time<0))throw new Error('此 MP4 时间编辑列表暂不支持，请使用完整缓存');
      tracks.push({id:t.id,mime,samples,video:!!t.video});file.setSegmentOptions(t.id,null,{nbSamples:1000});
    }
    duration=info.duration/info.timescale;
    if(selected.some(t=>Math.abs(t.duration/t.timescale-duration)>1))throw new Error('音视频轨时长差异过大，请使用完整缓存');
    const video=tracks.find(t=>t.video),sync=[];video.samples.forEach((s,i)=>{if(s.is_sync)sync.push(i);});
    if(!sync.length || sync[0]!==0)throw new Error('视频缺少起始关键帧');
    for(let g=0;g<sync.length;g++){
      const start=video.samples[sync[g]].dts/video.samples[sync[g]].timescale;
      const end=g+1<sync.length?video.samples[sync[g+1]].dts/video.samples[sync[g+1]].timescale:duration;
      const spans=tracks.map(t=>({track:t,first:t.video?sync[g]:lower(t.samples,start),last:t.video?(sync[g+1]??t.samples.length):lower(t.samples,end)}));
      if(g===sync.length-1)for(const span of spans)span.last=span.track.samples.length;
      const blocks=new Set();let bytes=0;
      for(const span of spans)for(let i=span.first;i<span.last;i++){const s=span.track.samples[i];bytes+=s.size;for(let n=Math.floor(s.offset/blockSize);n<=Math.floor((s.offset+s.size-1)/blockSize);n++)blocks.add(n);}
      if(bytes>48*MiB || end-start>120)throw new Error('关键帧间隔或片段过大，请使用完整缓存');
      segments.push({start,end,spans,blocks:[...blocks]});
    }
    inits=file.initializeSegmentation('per-track');parser=file;notify();
  }
  function available(segment){return segment.blocks.every(n=>record.parts[n]);}
  function ranges(){const out=[];for(const s of segments){if(!available(s))continue;const last=out.at(-1);if(last && s.start<=last[1]+.1)last[1]=s.end;else out.push([s.start,s.end]);}return out;}
  async function prepare(from,seconds){await index();const end=Math.min(duration,from+seconds),needed=new Set();for(const s of segments){if(s.end<=from || s.start>=end)continue;for(const n of s.blocks)needed.add(n);}for(const n of needed)await block(n,3);notify();return end;}
  async function download(){await index();for(let n=0;n<Math.ceil(record.total/blockSize);n++){if(stopped||closed)throw abortError();await block(n,0);}notify();}
  async function fragment(segment){
    const buffers=[];
    // Only one GOP's sample bytes are held; disk keeps the rest, including rewind history.
    for(const span of segment.spans){const loaded=[];
      try{for(let i=span.first;i<span.last;i++){const s=span.track.samples[i];s.data=new Uint8Array(await read(s.offset,s.size,4));s.alreadyRead=s.size;loaded.push(s);}
        if(span.last>span.first){const stream=parser.createFragment(span.track.id,span.first,span.last-1);if(!stream)throw new Error('无法生成播放片段');buffers.push({id:span.track.id,buffer:stream.buffer});}
      }finally{for(const s of loaded){s.data=undefined;s.alreadyRead=0;}}
    }return buffers;
  }
  function pause(){stopped=true;network.abort();notify();}
  function resume(){if(closed)throw new Error('缓存会话已关闭');stopped=false;network=new AbortController();}
  async function play(video,{time=0,paused=false,rate=1,onStatus=()=>{},onError=()=>{},onAttach=()=>{}}={}){
    await index();playback?.dispose();
    const media=new MediaSource(),url=URL.createObjectURL(media),sourceBuffers=new Map();let disposed=false,busy=false,epoch=0,wanted=time,initial=true,timer,readyTimer,rejectReady;
    const appended=new Set(),listeners=[];
    const listen=(target,event,fn)=>{target.addEventListener(event,fn);listeners.push(()=>target.removeEventListener(event,fn));};
    const update=(sb,operation)=>new Promise((resolve,reject)=>{
      if(disposed){reject(abortError());return;}
      const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error('播放器无法解码缓存片段'));};
      const cleanup=()=>{sb.removeEventListener('updateend',done);sb.removeEventListener('error',fail);media.removeEventListener('sourceclose',fail);};
      sb.addEventListener('updateend',done,{once:true});sb.addEventListener('error',fail,{once:true});media.addEventListener('sourceclose',fail,{once:true});
      try{operation();}catch(error){cleanup();reject(error);}
    });
    const enough=(t)=>{for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=t+.1&&video.buffered.end(i)>t+.2)return true;return false;};
    async function fill(){
      if(busy||disposed||!['open','ended'].includes(media.readyState)||video.ended||sourceBuffers.size!==tracks.length)return;busy=true;const generation=epoch;
      try{const at=initial?wanted:video.currentTime;
        // Evict decoded history and distant seek windows, while retaining all disk blocks.
        for(const sb of sourceBuffers.values()){
          if(at>40)await update(sb,()=>sb.remove(0,at-30));
          if(media.duration>at+100)await update(sb,()=>sb.remove(at+90,media.duration));
        }
        for(const id of [...appended]){const s=segments[id];if(s.start<at-30 || s.end>at+90)appended.delete(id);}
        const targets=segments.map((s,i)=>({s,i})).filter(({s})=>s.end>at && s.start<at+30);
        for(const {s,i} of targets){
          if(disposed||epoch!==generation)break;if(appended.has(i))continue;
          if(!available(s))onStatus('正在准备 '+Math.floor(s.start/60)+' 分钟附近的片段…');
          const parts=await fragment(s);if(disposed||epoch!==generation)break;
          for(const part of parts)await update(sourceBuffers.get(part.id),()=>sourceBuffers.get(part.id).appendBuffer(part.buffer));
          appended.add(i);
          if(initial && enough(wanted)){initial=false;video.currentTime=wanted;video.playbackRate=rate;if(!paused)await video.play().catch(()=>onStatus('片段已就绪，请点击播放'));else video.pause();}
        }
        if(!disposed && media.readyState==='open' && appended.has(segments.length-1) && ![...sourceBuffers.values()].some(sb=>sb.updating))media.endOfStream();
        if(!disposed)onStatus('正在播放磁盘分块；后续内容继续缓存');
      }catch(error){if(!disposed)onError(error);}finally{busy=false;}
    }
    const ready=new Promise((resolve,reject)=>{rejectReady=reject;readyTimer=setTimeout(()=>reject(new Error('播放器初始化超时，请切回在线来源')),15000);
      const open=async()=>{media.removeEventListener('sourceopen',open);try{media.duration=duration;
        for(const t of tracks)sourceBuffers.set(t.id,media.addSourceBuffer(t.mime));
        for(const init of inits)await update(sourceBuffers.get(init.id),()=>sourceBuffers.get(init.id).appendBuffer(init.buffer));
        clearTimeout(readyTimer);resolve();fill();
      }catch(error){reject(error);}};listen(media,'sourceopen',open);
    });
    ready.catch(()=>{}); // Disposal may happen before the caller starts awaiting initialization.
    listen(video,'seeking',()=>{if(initial)return;epoch++;fill();});
    listen(video,'error',()=>onError(new Error('浏览器未能解码此视频片段，请切回在线来源')));
    const dispose=()=>{if(disposed)return;disposed=true;epoch++;clearTimeout(readyTimer);rejectReady?.(abortError());clearInterval(timer);listeners.forEach(fn=>fn());for(const sb of sourceBuffers.values()){try{if(sb.updating)sb.abort();}catch{}}URL.revokeObjectURL(url);};
    playback={dispose,url};try{onAttach(playback);}catch(error){dispose();throw error;}video.src=url;video.load();timer=setInterval(fill,750);try{await ready;return playback;}catch(error){dispose();throw error;}
  }
  function close(){closed=true;pause();playback?.dispose();parser=null;tracks=[];segments=[];inits=[];readCache.clear();}
  // Recheck committed files after reload before advertising their time ranges.
  for(const n of Object.keys(record.parts))await disk(n);
  return {record,index,prepare,download,play,pause,resume,close,ranges,complete,refresh:notify,get duration(){return duration;}};
}
