// ==UserScript==
// @name         智云课堂同步字幕
// @namespace    zhiyunzimu.local
// @version      0.13.0
// @description  将右侧语音识别及平台译文同步显示在视频底部，支持字幕导出。
// @match        https://interactivemeta.cmc.zju.edu.cn/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      ark.cn-beijing.volces.com
// @connect      openspeech.bytedance.com
// @connect      video.cmc.zju.edu.cn
// @connect      vod.cmc.zju.edu.cn
// @connect      interactivemeta.cmc.zju.edu.cn
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/responses';
  function downloadVideo(request,url,{signal,limit,range=null,validator=null,onProgress=()=>{}}) {
    return new Promise((resolve,reject)=>{
      const parsed=new URL(url);
      if(!['video.cmc.zju.edu.cn','vod.cmc.zju.edu.cn','interactivemeta.cmc.zju.edu.cn'].includes(parsed.hostname) || !['https:','http:'].includes(parsed.protocol)) {
        reject(new Error('尚未授权此视频域名：'+parsed.hostname+'。请提供缓存诊断，以便添加精确域名权限。'));return;
      }
      let handle,settled=false;
      const finish=(error,blob)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve(blob);};
      const abort=()=>{finish(new Error('缓存已取消'));handle?.abort();};
      if(signal?.aborted){abort();return;}
      signal?.addEventListener('abort',abort,{once:true});
      try {
        handle=request({method:'GET',url,responseType:'blob',timeout:1800000,...(range?{headers:{Range:`bytes=${range.start}-${range.end}`,...(validator?{'If-Range':validator}:{})}}:{}),
          onprogress:event=>{
            if(event.loaded>limit || event.total>limit){finish(new Error('服务器返回的数据超过单块上限；可能不支持分块下载'));handle?.abort();return;}
            onProgress(event.loaded || 0,event.lengthComputable?event.total:0);
          },
          onload:async response=>{
            if(settled)return;
            if(response.status!==200 && !(range && response.status===206)){finish(new Error(response.status===401 || response.status===403?'视频访问被拒绝（HTTP '+response.status+'），请重新登录课程后重试':'下载失败：HTTP '+response.status));return;}
            const blob=response.response;
            if(!blob || typeof blob.slice!=='function' || !blob.size){finish(new Error('服务器未返回有效视频文件'));return;}
            if(blob.size>limit){finish(new Error('服务器返回的数据超过单块上限；可能不支持分块下载'));return;}
            try {
              if(!range || range.start===0) {
              const bytes=new Uint8Array(await blob.slice(0,64).arrayBuffer());
              const mp4=String.fromCharCode(...bytes.slice(4,8))==='ftyp';
              const webm=bytes[0]===0x1a && bytes[1]===0x45 && bytes[2]===0xdf && bytes[3]===0xa3;
              if(!mp4 && !webm) throw new Error('返回内容不是 MP4/WebM，可能是登录页或分片清单；未写入缓存');
              }
              if(range) {
                const header=name=>String(response.responseHeaders || '').match(new RegExp('^'+name+':\\s*(.+)$','im'))?.[1]?.trim();
                if(response.status===200) {
                  if(range.start!==0) throw new Error('视频内容已改变或服务器忽略 Range，请重新缓存');
                  finish(null,{blob,total:blob.size,end:blob.size-1,validator:header('etag') || header('last-modified')});return;
                }
                const match=header('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
                if(!match) throw new Error('分块响应缺少有效 Content-Range');
                const [start,end,total]=match.slice(1).map(Number);
                if(![start,end,total].every(Number.isSafeInteger) || start!==range.start || end>range.end || end<start || end>=total || blob.size!==end-start+1) throw new Error('分块范围或长度不一致，已停止缓存');
                const current=header('etag') || header('last-modified');
                if(validator && current && validator!==current) throw new Error('缓存期间视频版本改变，请重新缓存');
                finish(null,{blob,total,end,validator:current});
              } else finish(null,blob);
            }catch(error){finish(error);}
          },
          onerror:()=>finish(new Error('油猴下载失败：请允许连接 '+parsed.hostname+'，并检查网络或登录状态')),
          ontimeout:()=>finish(new Error('视频下载超时，可重试')),
          onabort:()=>finish(new Error('缓存已取消'))
        });
      }catch(error){finish(new Error('无法启动油猴跨域下载：'+error.message));}
    });
  }
  async function downloadInChunks(request,url,{signal,write,checkSpace=async()=>{},onProgress=()=>{},chunkSize=8*1024*1024}) {
    let offset=0,total=null,validator=null;
    do {
      if(signal?.aborted) throw new Error('缓存已取消');
      const part=await downloadVideo(request,url,{signal,limit:chunkSize,range:{start:offset,end:offset+chunkSize-1},validator,onProgress:(loaded)=>onProgress(offset+loaded,total)});
      if(total===null) {total=part.total;validator=part.validator;await checkSpace(total);}
      else if(total!==part.total) throw new Error('视频总大小发生变化，请重新缓存');
      if(signal?.aborted) throw new Error('缓存已取消');
      await write(part.blob);offset=part.end+1;onProgress(offset,total);
    }while(offset<total);
    return total;
  }
  function wavBytes(samples, rate = 16000) {
    const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
    const ascii = (offset, text) => [...text].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
    ascii(0,'RIFF'); view.setUint32(4,36+samples.length*2,true); ascii(8,'WAVE'); ascii(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    ascii(36,'data'); view.setUint32(40,samples.length*2,true);
    samples.forEach((sample,i)=>{ const n=Math.max(-1,Math.min(1,sample)); view.setInt16(44+i*2,Math.round(n*(n<0?32768:32767)),true); });
    return new Uint8Array(buffer);
  }
  function matchSpeech(utterances, cues, start) {
    const units = text => String(text).toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]/g) || [];
    const grams = list => { const counts=new Map(); for(let i=1;i<list.length;i++){const k=list[i-1]+'\0'+list[i];counts.set(k,(counts.get(k)||0)+1);} return counts; };
    const score = (a,b) => { const aa=grams(a),bb=grams(b); let intersection=0; for(const [k,n] of aa) intersection+=Math.min(n,bb.get(k)||0); return 2*intersection/Math.max(1,a.length+b.length-2); };
    const candidates=cues.flatMap((cue,i)=>[1,2,3].map(size=>({start:cue.start,words:units(cues.slice(i,i+size).map(c=>c.original).join(' '))})));
    const votes=[];
    for(const utterance of utterances) {
      const words=units(utterance.text);
      if(words.length<6 || new Set(words).size<4 || !Number.isFinite(utterance.start_time)) continue;
      const matches=new Map();
      for(const candidate of candidates) matches.set(candidate.start,Math.max(matches.get(candidate.start)||0,score(words,candidate.words)));
      const ranked=[...matches].sort((a,b)=>b[1]-a[1]);
      if(!ranked.length || ranked[0][1]<0.72 || (ranked[1] && ranked[0][1]-ranked[1][1]<0.12)) continue;
      votes.push(start+utterance.start_time/1000-ranked[0][0]);
    }
    votes.sort((a,b)=>a-b);
    if(!votes.length || votes.at(-1)-votes[0]>2) return {matched:false,message:'没有找到可靠且一致的匹配，保留原偏移；请在完整句子开始前再试。'};
    return {matched:true,offset:Math.round(votes[Math.floor(votes.length/2)]*100)/100};
  }
  function speechResult(response) {
    const match=String(response.responseHeaders || '').match(/^x-api-status-code:\s*(\d+)/im);
    if(response.status!==200 || match?.[1]!=='20000000') {
      throw new Error(`语音识别失败（HTTP ${response.status}，状态 ${match?.[1] || '未知'}），请检查 API Key 和 volc.seedasr.auc 权限。`);
    }
    const body=JSON.parse(response.responseText);
    if(!Array.isArray(body.result?.utterances)) throw new Error('语音接口没有返回带时间的语句，未修改偏移。');
    return body.result.utterances;
  }
  async function recognizeStandard(send, wait, audioBase64, apiKey, requestId, cancelled = () => false) {
    const deadline=Date.now()+120000;
    const headers = {'x-api-key':apiKey,'X-Api-Resource-Id':'volc.seedasr.auc','X-Api-Request-Id':requestId,'X-Api-Sequence':'-1','Content-Type':'application/json'};
    const check = () => { if(cancelled()) throw new Error('校准已取消'); };
    const status = response => {
      const code=String(response.responseHeaders || '').match(/^x-api-status-code:\s*(\d+)/im)?.[1];
      if(response.status!==200 || !['20000000','20000001','20000002'].includes(code)) {
        // Only show the service status, never its response body (which may echo credentials or audio).
        throw new Error(`标准版识别失败（HTTP ${response.status}，状态 ${code || '未知'}）。请检查 API Key、volc.seedasr.auc 权限及音频输入是否支持。`);
      }
      return code;
    };
    check();
    const submitted=await send('submit',headers,{user:{uid:'zhiyun-subtitles'},audio:{data:audioBase64,format:'wav',rate:16000,bits:16,channel:1},request:{model_name:'bigmodel',show_utterances:true,enable_itn:true,enable_punc:true}});
    check(); status(submitted);
    // Submit exactly once. Every query uses the same UUID; never create a second paid job on an error.
    for(let i=0;i<60;i++) {
      check(); await wait(2000); check();
      if(Date.now()>=deadline) break;
      const response=await send('query',headers,{});
      check();
      if(status(response)==='20000000') return speechResult(response);
    }
    throw new Error('识别等待超时，未修改偏移；云端任务可能仍在执行。');
  }
  function translationBody(text, source = 'en', target = 'zh') {
    return { model: 'doubao-seed-translation-250915', input: [{ role: 'user', content: [{
      type: 'input_text', text, translation_options: { source_language: source, target_language: target }
    }] }] };
  }
  function translationResult(response) {
    if (response.error || (response.status && response.status !== 'completed')) {
      throw new Error('翻译未完成，请重试');
    }
    const text = (response.output ?? []).filter(item => item.type === 'message')
      .flatMap(item => item.content ?? []).filter(item => item.type === 'output_text')
      .map(item => item.text ?? '').join('\n').trim();
    if (!text) throw new Error('接口未返回译文，请检查模型和接口权限');
    return text;
  }
  // One request at a time. An epoch prevents stopped/old-course results from leaking into new work.
  function isTargetLanguage(text, target) {
    const letters=String(text).match(/\p{L}/gu) || [];
    if(!letters.length) return true;
    const han=letters.filter(c=>/\p{Script=Han}/u.test(c)).length;
    const latin=String(text).match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || [];
    const latinChars=latin.join('').replace(/[^A-Za-z]/g,'').length;
    if(letters.length-han-latinChars>0) return false;
    if(target==='zh') return han>0 && (latin.length===0 || (han>=4 && latin.length<=2 && han>=latinChars));
    if(target==='en') return han===0 && (latin.length>=2 || latinChars>=3);
    return false;
  }
  function createTranslator(request, notify = () => {}) {
    const cache = new Map();
    let enabled = false, epoch = 0, pending = null, queue = [], source = 'en', target = 'zh';
    const key = text => JSON.stringify([source, target, text]);
    const get = text => cache.get(key(text)) || '';
    function stop() {
      enabled = false; epoch++; queue = [];
      const old = pending; pending = null; old?.abort();
    }
    async function pump() {
      if (!enabled || pending) return;
      const text = queue.shift();
      if (!text) return;
      if (get(text)) { pump(); return; }
      const token = epoch, cacheKey = key(text);
      let handle;
      try {
        handle = request(text, source, target);
        pending = handle;
        notify('正在翻译…');
        const result = await handle.promise;
        if (epoch !== token || !enabled) return;
        cache.set(cacheKey, result);
        notify('翻译已开启，当前及后续 3 条字幕按需翻译');
      } catch (error) {
        if (epoch !== token) return;
        stop();
        notify(error.message || '翻译失败，请重新开启');
      } finally {
        if (pending === handle) pending = null;
        if (enabled && epoch === token) pump();
      }
    }
    return {
      get,
      get enabled() { return enabled; },
      start(from, to) { stop(); source = from; target = to; enabled = true; },
      stop,
      reset() { stop(); cache.clear(); },
      schedule(texts) { if (!enabled) return; queue = [...new Set(texts)].filter(text => text && !isTargetLanguage(text,target) && !get(text)); pump(); }
    };
  }
  function parseTime(text) {
    const match = String(text).trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN;
  }
  function timeline(rows, maxDuration = 15) {
    const merged = new Map();
    for (const row of rows) {
      if (!Number.isFinite(row.start) || !row.original) continue;
      const old = merged.get(row.start);
      if (old) {
        old.original += '\n' + row.original;
        if (row.translation) old.translation = (old.translation ? old.translation + '\n' : '') + row.translation;
      } else merged.set(row.start, { ...row });
    }
    const cues = [...merged.values()].sort((a, b) => a.start - b.start);
    return cues.map((cue, i) => ({ ...cue, end: Math.min(cues[i + 1]?.start ?? Infinity, cue.start + maxDuration) }));
  }
  function activeCue(cues, time) {
    let lo = 0, hi = cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cues[mid].start <= time) lo = mid + 1;
      else hi = mid;
    }
    const cue = cues[lo - 1];
    return cue && time < cue.end ? cue : null;
  }
  function stamp(seconds) {
    const ms = Math.round(Math.max(0, seconds) * 1000);
    return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
      .map(n => String(n).padStart(2, '0')).join(':') + ',' + String(ms % 1000).padStart(3, '0');
  }
  function srt(cues, offset = 0) {
    return cues.filter(c => c.end + offset > 0).map((c, i) =>
      `${i + 1}\n${stamp(c.start + offset)} --> ${stamp(c.end + offset)}\n${[c.original, c.translation].filter(Boolean).join('\n')}\n`
    ).join('\n');
  }
  function courseIdentity(hash) {
    const params=new URLSearchParams(String(hash).split('?')[1] || '');
    return JSON.stringify(['course_id','sub_id','tenant_code'].map(key=>params.get(key)));
  }
  function slideTime(text) {
    const match=String(text).trim().match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d)$/);
    return match ? Number(match[1] || 0)*3600+Number(match[2])*60+Number(match[3]) : NaN;
  }
  function slideAt(slides, time) {
    let index=-1, latest=-Infinity;
    slides.forEach((slide,i)=>{if(Number.isFinite(slide.time) && slide.time<=time && slide.time>=latest){latest=slide.time;index=i;}});
    return index;
  }
  function subtitleTime(videoTime, offset) { return videoTime - offset; }
  function captionLayout(rect, viewportWidth, below, bottom = 60) {
    const left = Math.max(0, rect.left) + 4;
    const band = below ? Math.min(160, rect.height * 0.4) : 0;
    return { band, left, width: Math.max(0, Math.min(viewportWidth, rect.right) - left - 4),
      top: below ? rect.bottom - band + 8 : rect.bottom - bottom,
      maxHeight: below ? Math.max(24, band - 48) : rect.height * 0.55 };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseTime, timeline, activeCue, stamp, srt, translationBody, translationResult, createTranslator, subtitleTime, captionLayout, wavBytes, matchSpeech, speechResult, recognizeStandard, courseIdentity, slideTime, slideAt, isTargetLanguage, downloadVideo, downloadInChunks };
    return;
  }
  if (document.getElementById('zy-subtitle-host')) return;
  const host = document.createElement('div');
  host.id = 'zy-subtitle-host';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#304441;color-scheme:light}
    *{box-sizing:border-box} [hidden]{display:none!important}
    button,input,select{font:inherit} button,summary,select{cursor:pointer}
    button{border:1px solid #dce6df;background:#fffefa;color:#38564a;border-radius:12px;padding:9px 12px;transition:background .15s,box-shadow .15s}
    button:hover{background:#eaf3e9;box-shadow:0 2px 6px #284d3510} button:disabled{opacity:.4;cursor:default}
    button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #9abfa8;outline-offset:2px}
    input,select{border:1px solid #dce6df;border-radius:9px;background:#fffefa;padding:6px;color:#304441;max-width:170px} input[type=number]{width:76px} input[type=checkbox]{accent-color:#4f8468}
    #caption{z-index:1;position:fixed;text-align:center;padding:6px 8px;line-height:1.4;text-shadow:0 2px 3px #000;white-space:pre-wrap;overflow-wrap:anywhere;background:#14241ee8;color:white;border-radius:16px;overflow:hidden;pointer-events:none;}
    #translation{color:#f9df9b} #translation:empty{display:none}
    #panel{z-index:30;pointer-events:auto;position:fixed;right:20px;top:60px;width:330px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 84px);display:flex;flex-direction:column;background:#fafbf6;border:1px solid #fff;border-radius:24px;box-shadow:0 16px 56px #18392b38;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
    #panel-head{display:flex;align-items:center;gap:10px;padding:18px 18px 12px;cursor:move;touch-action:none;flex-shrink:0;background:linear-gradient(135deg,#edf4e7,#fff8e8)}
    .mascot{display:grid;place-items:center;width:40px;height:40px;border-radius:15px;background:#dcebd9;font-size:23px;flex-shrink:0}
    h3{margin:0;font-size:17px;letter-spacing:1px} .subtitle{font-size:11px;color:#819083} #collapse{margin-left:auto;padding:4px 10px}
    #panel-body{padding:4px 18px 18px;overflow:auto;overscroll-behavior:contain;min-height:0;scrollbar-width:thin}
    .section{padding:12px 0;border-bottom:1px solid #e6ebe2}.section:last-child{border:0}
    .section-title{display:flex;align-items:center;justify-content:space-between;font-weight:650;margin-bottom:9px}
    label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:9px 0}
    .actions{display:flex;gap:6px;flex-wrap:wrap}.actions button{flex:1;white-space:nowrap} .primary{background:#4e8067;color:white;border-color:#4e8067;width:100%}
    p{font-size:11px;color:#7b887e;margin:8px 0 0;overflow-wrap:anywhere} summary{font-weight:600;padding:4px 0;list-style:none} summary::after{content:'＋';float:right} details[open]>summary::after{content:'−'}
    .badge{font-size:10px;border-radius:20px;padding:3px 7px;background:#eef0e9;color:#889084;white-space:nowrap}.badge[data-ready=true]{background:#e1efdf;color:#347048}
    #compact{z-index:40;pointer-events:auto;position:fixed;right:20px;top:60px;border-radius:18px;background:#fafbf6;box-shadow:0 5px 20px #18392b30}
    #align-progress{width:100%;height:7px;accent-color:#619574;display:block;margin-top:12px} #align-label{display:block;font-size:11px;color:#5a7e63;margin-top:5px}
    #slides{z-index:5;pointer-events:auto;position:fixed;background:#090b0b;border:1px solid #ffffff20;border-radius:10px;overflow:hidden;box-shadow:0 8px 28px #0006;min-width:0;min-height:0}
    #slide-toolbar{position:absolute;bottom:8px;left:8px;right:24px;display:flex;gap:4px;align-items:center;justify-content:center;padding:5px;flex-wrap:wrap;background:#141a18e8;border-radius:10px;font-size:12px;color:#eee;opacity:0;transition:opacity .15s;pointer-events:none}
    #slides:hover #slide-toolbar,#slides:focus-within #slide-toolbar{opacity:1;pointer-events:auto}
    #slide-toolbar button{padding:5px 7px;background:transparent;color:#eee;border-color:#ffffff25;border-radius:7px} #slide-toolbar button:hover{background:#ffffff20} #slide-page{font-variant-numeric:tabular-nums}
    #slide-viewport{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;cursor:move}
    #slide-image{position:absolute;left:50%;transform:translateX(-50%);display:block;width:auto;max-width:none;height:100%;user-select:none;-webkit-user-drag:none}
    #slide-resize{position:absolute;right:0;bottom:0;width:24px;height:24px;padding:0;border:0;border-radius:6px 0 0 0;background:#141a18cc;color:#ddd;cursor:nwse-resize;touch-action:none;font-size:16px}
    .slide-edge{position:absolute;z-index:2;background:transparent;border:0;padding:0;border-radius:0;touch-action:none}
    .slide-edge:hover{background:#8ebaa455;box-shadow:none}
    .slide-edge[data-edge=left]{left:0;top:12px;bottom:26px;width:8px;cursor:ew-resize}
    .slide-edge[data-edge=right]{right:0;top:12px;bottom:26px;width:8px;cursor:ew-resize}
    .slide-edge[data-edge=top]{top:0;left:12px;right:12px;height:8px;cursor:ns-resize}
    .slide-edge[data-edge=bottom]{bottom:0;left:12px;right:26px;height:8px;cursor:ns-resize}
    #slide-resize{z-index:3}
    .layout-handle{position:fixed;z-index:15;pointer-events:auto;outline:2px dashed #9adbb8;border-radius:10px;cursor:move;touch-action:none;background:#65ac8710}
    .layout-handle span{position:absolute;left:4px;top:4px;padding:4px 8px;border-radius:7px;background:#234a3eeb;color:#fff;font-size:12px;pointer-events:none}
    .layout-handle button{position:absolute;right:0;bottom:0;margin:0;width:28px;height:28px;padding:0;cursor:nwse-resize;touch-action:none;background:#234a3e;color:white}
    #video-edit-box{pointer-events:none;outline:none;background:none}
    #video-edit-box span,#video-edit-box button{pointer-events:auto}
    #video-edit-box span{cursor:grab;touch-action:none}
    #video-edit-box button{bottom:48px}
    @media(hover:none){#slide-toolbar{opacity:1;pointer-events:auto}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  </style>
  <div id="caption" hidden><div id="original"></div><div id="translation"></div></div>
  <div id="video-edit-box" class="layout-handle" hidden><span>拖动视频 · 右下角缩放</span><button aria-label="缩放视频">◢</button></div>
  <div id="caption-edit-box" class="layout-handle" hidden><span>拖动字幕 · 右下角调宽度和字号</span><button aria-label="缩放字幕">◢</button></div>
  <button id="compact" hidden aria-label="展开字幕设置">🌱 字幕</button>
  <section id="slides" hidden aria-label="课程幻灯片">
    <div id="slide-viewport" tabindex="0" aria-label="PPT 悬浮窗，拖动图片移动窗口"><img id="slide-image" draggable="false" alt="课程 PPT"></div>
    <nav id="slide-toolbar" aria-label="PPT 翻页"><button id="slide-prev">← 上页</button><span id="slide-page"></span><button id="slide-next">下页 →</button><button id="slide-follow" aria-pressed="true">✓ 跟随老师</button><button id="slide-close">收起</button></nav><button id="slide-resize" aria-label="调整 PPT 窗口大小" title="拖拽缩放；方向键微调">◢</button>
    <button class="slide-edge" data-edge="left" aria-label="调整 PPT 左边缘"></button><button class="slide-edge" data-edge="right" aria-label="调整 PPT 右边缘"></button><button class="slide-edge" data-edge="top" aria-label="调整 PPT 上边缘"></button><button class="slide-edge" data-edge="bottom" aria-label="调整 PPT 下边缘"></button>
  </section>
  <section id="panel" aria-label="智云字幕设置">
    <header id="panel-head"><span class="mascot">🌱</span><div><h3>伴读字幕</h3><span class="subtitle">让每一句，都跟得上 · v0.13.0</span></div><button id="collapse" aria-label="收起字幕设置">−</button></header>
    <div id="panel-body">
    <div class="section"><div class="section-title">一起看懂 <span id="translation-ready" class="badge"></span><input id="enabled" aria-label="显示字幕" type="checkbox" checked></div>
    <label>字幕<select id="mode"><option value="original">仅原文</option><option value="both">中英对照 · 豆包翻译</option></select></label>
    <p id="translation-status">选择中英对照，即开启豆包翻译。</p></div>
    <div class="section"><div class="section-title">跟上老师 <span id="speech-badge" class="badge"></span></div>
    <button class="primary" id="auto-align">听 12 秒自动校准</button>
    <div id="align-feedback" hidden role="status"><progress id="align-progress" max="12" value="0"></progress><span id="align-label"></span></div>
    <p id="align-status">先听 12 秒，成功立即结束。只有匹配失败才再听 12 秒，最多尝试 3 次。语音识别按使用量计费。</p>
    <details><summary>手动微调 <span id="offset-hint">同步偏移：0 秒</span></summary>
    <label>偏移 / 秒<input id="offset" type="number" min="-3600" max="3600" step="0.5" value="0"></label>
    <div class="actions"><button id="earlier">提前 0.5 秒</button><button id="later">延后 0.5 秒</button><button id="reset-offset">归零</button></div></details></div>
    <div class="section"><div class="actions"><button id="show-slides">① 左右并排</button><button id="reset-ppt">复位 PPT</button><button id="focus-fullscreen">⛶ 专注全屏</button></div><p id="slides-status">翻页不会打断视频。拖动可超出屏幕。左右拉边缘裁掉黑边，上下拉边缘按比例放大；复位可找回窗口。</p></div>
    <details class="section"><summary>视频缓存</summary>
    <p>布局按钮循环：左右并排 → PPT 主讲（小课堂在右下）→ 恢复课堂。PPT 可直接拖拽缩放。</p>
    <button id="cache-download">缓存当前视频</button>
    <label>自动使用缓存<input id="cache-auto" type="checkbox" checked></label>
    <p id="cache-source">当前：在线视频</p><p id="cache-status">边看边缓存；完整下载后自动接着当前进度播放本地文件。不是边下载边播放未完成的缓存。</p>
    <details id="cache-details"><summary>缓存详情与诊断</summary>
    <p id="cache-location">位置：浏览器默认存储（随浏览器配置目录）</p>
    <button id="cache-folder">选择缓存文件夹</button><button id="cache-default-folder">使用浏览器默认位置</button>
    <button id="cache-play">立即使用缓存</button><button id="cache-online">本次使用在线来源</button><button id="cache-clear">清除此课缓存</button>
    <button id="cache-diagnose">刷新诊断</button><pre id="cache-diagnostic" style="white-space:pre-wrap;font-size:11px"></pre><label>导入本地视频<input id="cache-file" type="file" accept="video/mp4,video/webm"></label>
    </details>
    </details>
    <details class="section"><summary>偏好与连接 <span id="key-summary" class="badge"></span></summary>
    <button id="edit-layout">调整字幕</button>
    <div id="layout-editor" hidden><p>拖动字幕绿色框移动，拖右下角调宽度和字号。视频和 PPT 随时可直接拖动、缩放。</p><p>视频位置与大小（像素）</p><label>左 / 上<input id="video-x" type="number" value="720"><input id="video-y" type="number" value="400"></label><label>宽 / 高<input id="video-w" type="number" value="400"><input id="video-h" type="number" value="240"></label><button id="apply-layout">应用视频位置</button>
    <label>自定义字幕位置<input id="caption-custom" type="checkbox"></label><label>字幕左 / 下沿<input id="caption-x" type="number" value="20"><input id="caption-y" type="number" value="700"></label><label>字幕宽度<input id="caption-w" type="number" value="900"></label></div>
    <label>翻译连接 <span id="translation-badge" class="badge"></span></label><button id="configure-key">设置翻译 Key</button>
    <label>语音连接 <span id="speech-key-badge" class="badge"></span></label><button id="speech-key">设置语音识别凭证</button><p>绿色勾表示已保存凭证，不代表接口权限已验证。</p>
    <label>翻译方向<select id="direction"><option value="en-zh">英语 → 中文</option><option value="zh-en">中文 → 英语</option></select></label>
    <label>字幕位置<select id="placement"><option value="below">视频正下方</option><option value="overlay">画面内底部</option></select></label>
    <label>字号<input id="size" type="number" min="14" max="48" value="26"></label>
    <label>距底部 / 像素<input id="bottom" type="number" min="0" max="300" value="60"></label>
    <label>最长显示 / 秒<input id="duration" type="number" min="1" max="120" value="15"></label>
    <button id="export">导出字幕 SRT</button><p id="status">等待右侧语音识别字幕…</p>
    <p>翻译仅发送当前及后续 3 条字幕。校准只采集视频音轨，不使用麦克风。导出前请清空字幕搜索并加载完整列表。</p>
    </details></div></section>`;
  document.body.append(host);
  const $ = id => shadow.getElementById(id);
  let editingLayout=false, videoManuallyPlaced=false;
  function updateKeyBadges() {
    const translation=!!GM_getValue('ark-api-key','');
    const speech=!!GM_getValue('speech-credentials',null)?.apiKey;
    for(const [id,ready] of [['translation-badge',translation],['translation-ready',translation],['speech-badge',speech],['speech-key-badge',speech]]) {
      $(id).dataset.ready=String(ready); $(id).textContent=ready?'✓ 已配置':'待配置';
    }
    $('key-summary').textContent=`${Number(translation)+Number(speech)} / 2 已配置`;
    $('configure-key').textContent=translation?'更换翻译 Key':'设置翻译 Key';
    $('speech-key').textContent=speech?'更换语音 Key':'设置语音识别凭证';
  }
  updateKeyBadges();
  const preferences=GM_getValue('display-preferences',{});
  for(const id of ['mode','direction','placement','size','bottom','duration','enabled']) {
    if(preferences[id]!==undefined) { if(id==='enabled') $(id).checked=!!preferences[id]; else $(id).value=preferences[id]; }
    $(id).addEventListener('change',savePreferences);
  }
  function savePreferences() {
    GM_setValue('display-preferences',Object.fromEntries(['mode','direction','placement','size','bottom','duration','enabled'].map(id=>[id,id==='enabled'?$(id).checked:$(id).value])));
  }
  // Isolate our controls from player shortcuts and click handlers without blocking default scrolling.
  for(const event of ['click','pointerdown','pointerup','keydown','keyup','wheel']) host.addEventListener(event,e=>e.stopPropagation());
  function draggable(handle, element, pan=false, onEnd=()=>{}) {
    let drag;
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0 || e.target.closest('button,input,select') || (pan && !handle.classList.contains('zoomed'))) return;
      const rect=element.getBoundingClientRect();
      drag={x:e.clientX,y:e.clientY,left:pan?element.scrollLeft:rect.left,top:pan?element.scrollTop:rect.top};
      handle.setPointerCapture(e.pointerId); e.preventDefault();
    });
    handle.addEventListener('pointermove',e=>{
      if(!drag) return;
      if(pan) { element.scrollLeft=drag.left+drag.x-e.clientX; element.scrollTop=drag.top+drag.y-e.clientY; }
      else if(element===$('slides')) {applySlideGeometry({left:drag.left+e.clientX-drag.x,top:drag.top+e.clientY-drag.y,width:element.offsetWidth,height:element.offsetHeight});}
      else { element.style.right='auto'; element.style.left=Math.max(8,Math.min(innerWidth-element.offsetWidth-8,drag.left+e.clientX-drag.x))+'px'; element.style.top=Math.max(8,Math.min(innerHeight-element.offsetHeight-8,drag.top+e.clientY-drag.y))+'px'; }
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture']) handle.addEventListener(event,()=>{if(drag) onEnd();drag=null;});
  }
  draggable($('panel-head'),$('panel'));
  draggable($('slide-viewport'),$('slides'),false,saveSlideGeometry);
  function clampPanel() {
    const rect=$('panel').getBoundingClientRect();
    if($('panel').hidden) return;
    $('panel').style.top=Math.max(8,Math.min(innerHeight-rect.height-8,rect.top))+'px';
    if($('panel').style.left) $('panel').style.left=Math.max(8,Math.min(innerWidth-rect.width-8,rect.left))+'px';
  }
  window.addEventListener('resize',clampPanel);
  document.addEventListener('fullscreenchange',clampPanel);
  function collapsePanel(collapsed) {
    $('panel').hidden = collapsed; $('compact').hidden = !collapsed;
    GM_setValue('panel-collapsed', collapsed);
  }
  $('collapse').onclick = () => collapsePanel(true);
  $('compact').onclick = () => collapsePanel(false);
  collapsePanel(GM_getValue('panel-collapsed', false));
  let mainVideo = null, cancelAlignment = null;
  $('speech-key').onclick = () => {
    const apiKey = prompt('填写标准版豆包语音 x-api-key（资源 volc.seedasr.auc，不是翻译 API Key）。');
    if(!apiKey?.trim()) return;
    cancelAlignment?.();
    GM_setValue('speech-credentials',{apiKey:apiKey.trim()}); updateKeyBadges();
    $('align-status').textContent='语音凭证已保存，可以点击自动校准。';
  };
  GM_registerMenuCommand('清除语音识别凭证',()=>{cancelAlignment?.();GM_deleteValue('speech-credentials'); updateKeyBadges();$('align-status').textContent='语音识别凭证已清除';});
  $('auto-align').onclick = async () => {
    if (cancelAlignment) { cancelAlignment(); return; }
    const video = mainVideo, credentials = GM_getValue('speech-credentials', null);
    if (!credentials?.apiKey) { $('align-status').textContent = '请点击设置语音识别凭证，填写标准版 x-api-key；旧版 App ID 凭证不适用。'; return; }
    if (!video || video.paused || !cues.length) {
      $('align-status').textContent = '请先加载右侧字幕并播放视频；会临时切到 1 倍速，结束后恢复。'; return;
    }
    const course = courseIdentity(location.hash), previousRate=video.playbackRate;
    video.playbackRate=1;
    let stream, recorder, timer, request, wake, progressTimer, cancelled = false;
    const listeners = ['pause','seeking','emptied'];
    let interrupted=false,buffering=false,resumeRecording=null,bufferRestarts=0;
    const onWaiting=()=>{buffering=true;if(recorder?.state==='recording'){interrupted=true;clearTimeout(timer);recorder.stop();}};
    const onPlaying=()=>{buffering=false;resumeRecording?.();};
    const onRate=()=>{if(video.playbackRate!==1) cancel();};
    video.addEventListener('waiting',onWaiting);video.addEventListener('playing',onPlaying);video.addEventListener('ratechange',onRate);
    const cancel = () => {
      cancelled = true; resumeRecording?.(); clearInterval(progressTimer); $('align-label').textContent='已取消'; clearTimeout(timer); wake?.(); request?.abort();
      if (recorder?.state === 'recording') recorder.stop();
      $('align-status').textContent = '校准已取消，未修改偏移。';
    };
    cancelAlignment = cancel;
    $('auto-align').textContent = '取消自动校准';
    listeners.forEach(event => video.addEventListener(event, cancel));
    try {
      for(let attempt=1;attempt<=3;attempt++) {
      if(buffering) {
        $('align-status').textContent='视频缓冲中，恢复播放后自动重新采音…';
        await new Promise((resolve,reject)=>{resumeRecording=resolve;timer=setTimeout(()=>reject(new Error('等待视频恢复超时，请播放后重试')),120000);});
        clearTimeout(timer);resumeRecording=null;
      }
      if(cancelled || courseIdentity(location.hash)!==course) return;
      interrupted=false;
      const started=video.currentTime;
      $('align-feedback').hidden=false;
      $('align-progress').value=0;
      $('align-label').textContent=`第 ${attempt} 次（成功即停）· 正在听 0 / 12 秒`;
      if (!video.captureStream || typeof MediaRecorder === 'undefined') throw new Error('此浏览器无法直接采集视频音轨。');
      stream = video.captureStream();
      const tracks = stream.getAudioTracks();
      if (!tracks.length) throw new Error('视频音轨不可读取，可能受跨域限制；未改用麦克风。');
      const audio = new MediaStream(tracks);
      const chunks = [];
      recorder = new MediaRecorder(audio);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      await new Promise((resolve, reject) => {
        recorder.onstop = resolve; recorder.onerror = () => reject(new Error('录音失败'));
        recorder.start();
        const began=performance.now();
        progressTimer=setInterval(()=>{const elapsed=Math.min(12,(performance.now()-began)/1000);$('align-progress').value=elapsed;$('align-label').textContent=`第 ${attempt} 次（成功即停）· 正在听 ${Math.floor(elapsed)} / 12 秒`;},100);
        timer = setTimeout(() => recorder.stop(), 12000);
        $('align-status').textContent = '正在听视频中的 12 秒语音…';
      });
      clearInterval(progressTimer);
      if (cancelled || courseIdentity(location.hash) !== course) return;
      stream?.getTracks().forEach(track=>track.stop()); stream=null;
      if(interrupted) {
        if(++bufferRestarts>10) throw new Error('缓冲过于频繁，请先缓存或等待网络稳定后重试');
        attempt--;continue;
      }
      $('align-progress').removeAttribute('value');
      $('align-label').textContent=`第 ${attempt} 次（成功即停）· 正在识别与匹配…`;
      const blob = new Blob(chunks, {type:recorder.mimeType});
      if (blob.size > 2*1024*1024) throw new Error('录音过大，请重试');
      // MediaRecorder usually emits WebM, while the API documents WAV/MP3/OGG.
      // Decode and resample inside the browser; no FFmpeg or local helper required.
      const context = new AudioContext();
      let decoded;
      try { decoded=await context.decodeAudioData(await blob.arrayBuffer()); } finally { await context.close(); }
      if(cancelled) return;
      const offline = new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);
      const source=offline.createBufferSource(); source.buffer=decoded; source.connect(offline.destination); source.start();
      const rendered=await offline.startRendering();
      const samples=rendered.getChannelData(0);
      if(!samples.some(n=>Math.abs(n)>0.001)) throw new Error('未采集到有效声音，可能是视频音轨跨域限制。');
      const bytes=wavBytes(samples);
      let binary=''; for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const audioBase64=btoa(binary);
      if (cancelled) return;
      $('align-status').textContent = '正在识别并匹配字幕…';
      const send = (action,headers,body) => new Promise((resolve,reject) => {
        request = GM_xmlhttpRequest({method:'POST',url:'https://openspeech.bytedance.com/api/v3/auc/bigmodel/'+action,timeout:15000,anonymous:true,
          headers, data:JSON.stringify(body), onload:resolve,
          onerror:()=>reject(new Error('语音请求失败，请检查网络及油猴域名权限')),
          ontimeout:()=>reject(new Error('校准超时，请重试')),onabort:()=>reject(new Error('校准已取消'))});
      });
      const wait = ms => new Promise(resolve=>{wake=resolve;timer=setTimeout(()=>{wake=null;resolve();},ms);});
      const utterances = await recognizeStandard(send,wait,audioBase64,credentials.apiKey,crypto.randomUUID(),()=>cancelled || courseIdentity(location.hash)!==course);
      clearInterval(progressTimer);
      if (cancelled || courseIdentity(location.hash) !== course) return;
      const response=matchSpeech(utterances,cues,started);
      if (!response.matched) {
        $('align-status').textContent=attempt<3 ? `第 ${attempt} 次未找到可靠匹配，继续听下一段…` : '已尝试 3 段，仍未找到可靠匹配。保留原偏移，可手动微调。';
        if(attempt<3) continue;
        $('align-progress').value=12; $('align-label').textContent='3 次尝试完成 · 未修改偏移';
        return;
      }
      if (!Number.isFinite(response.offset) || Math.abs(response.offset)>3600) throw new Error('校准偏移超出范围，未修改');
      $('offset').value=response.offset; updateOffset();
      $('align-status').textContent=`已自动校准：${response.offset>0?'延后':'提前'} ${Math.abs(response.offset)} 秒。可继续手动微调。`;
      $('align-progress').value=12; $('align-label').textContent=`第 ${attempt} 次匹配成功 ✓`;
      return;
      }
    } catch(error) { if(!cancelled) { $('align-status').textContent=error.message || '自动校准失败'; $('align-label').textContent='识别中止 · 未修改偏移'; } }
    finally {
      clearTimeout(timer); clearInterval(progressTimer); $('align-progress').value=12; stream?.getTracks().forEach(track=>track.stop());
      listeners.forEach(event=>video.removeEventListener(event,cancel));
      video.removeEventListener('waiting',onWaiting);video.removeEventListener('playing',onPlaying);video.removeEventListener('ratechange',onRate);
      if(video.playbackRate===1) video.playbackRate=previousRate;
      cancelAlignment=null; $('auto-align').textContent='听 12 秒自动校准';
    }
  };
  let slideUrls=[], slideEntries=[], slideIndex=0, splitVideo=null, splitStyles=null, layoutMode='video', slideDragging=false, slideFollowing=true, slideCourse=null;
  function saveSlideState() {
    GM_setValue('ppt-state:'+slideCourse,{index:slideIndex,url:slideEntries[slideIndex]?.url,time:slideEntries[slideIndex]?.time,follow:slideFollowing});
  }
  function updateFollowButton() {
    $('slide-follow').textContent=slideFollowing?'✓ 跟随老师':'跟随老师';
    $('slide-follow').setAttribute('aria-pressed',String(slideFollowing));
  }
  function syncSlide() {
    if(!slideFollowing || !splitVideo || $('slides').hidden) return;
    const index=slideAt(slideEntries,subtitleTime(splitVideo.currentTime,value('offset',0,-3600,3600)));
    if(index>=0 && index!==slideIndex) {slideIndex=index;renderSlide();}
  }
  function closeSlides() {
    $('slides').hidden=true;
    editingLayout=false;updateEditHandles();$('layout-editor').hidden=true;$('edit-layout').textContent='调整字幕';
    if(splitVideo && splitStyles) for(const [key,saved] of Object.entries(splitStyles)) {
      if(saved.value) splitVideo.style.setProperty(key,saved.value,saved.priority); else splitVideo.style.removeProperty(key);
    }
    splitStyles=null; splitVideo=null;layoutMode='video';$('caption-custom').checked=false;$('show-slides').textContent='① 左右并排';
  }
  function renderSlide() {
    $('slide-image').src=slideUrls[slideIndex]; $('slide-page').textContent=`${slideIndex+1} / ${slideUrls.length}`;
    $('slide-prev').disabled=slideIndex===0; $('slide-next').disabled=slideIndex>=slideUrls.length-1;
    $('slide-viewport').scrollTo(0,0); saveSlideState(); updateFollowButton();
  }
  function showSlides() {
    if(layoutMode==='video' && splitVideo) closeSlides();
    const images=[...document.querySelectorAll('#pane-ppt img')];
    slideEntries=images.map(img=>({url:img.currentSrc || img.src,time:slideTime(img.closest('.tab-ppt')?.querySelector('.time')?.textContent || '')})).filter(slide=>/^https?:/.test(slide.url));
    slideUrls=slideEntries.map(slide=>slide.url);
    const course=courseIdentity(location.hash);
    const saved=GM_getValue('ppt-state:'+course,null);
    if(slideCourse!==course) {slideIndex=0;slideFollowing=true;slideCourse=course;}
    if(saved) {
      const restored=slideEntries.findIndex(slide=>slide.url===saved.url && (slide.time===saved.time || (!Number.isFinite(slide.time) && saved.time==null)));
      slideIndex=restored>=0?restored:Math.max(0,Number(saved.index)||0); slideFollowing=saved.follow!==false;
    }
    if(!slideUrls.length) { $('slides-status').textContent='尚未找到 PPT 图片。请先打开右侧 PPT 标签加载列表，再点此按钮；不要切换顶部老师视频。'; return false; }
    if(!mainVideo) { $('slides-status').textContent='请先打开老师视频，再查看 PPT。'; return false; }
    if(!splitVideo) {
      splitVideo=mainVideo;layoutMode='split';$('show-slides').textContent='② PPT 主讲';
      splitStyles=Object.fromEntries(['width','height','margin-left','position','left','top','right','bottom','z-index'].map(key=>[key,{value:splitVideo.style.getPropertyValue(key),priority:splitVideo.style.getPropertyPriority(key)}]));
      splitVideo.style.setProperty('width','50%','important');
      splitVideo.style.setProperty('margin-left','50%','important');
      restoreSlideGeometry();
    }
    slideIndex=Math.min(slideIndex,slideUrls.length-1); renderSlide(); $('slides').hidden=false; syncSlide();
    $('slides-status').textContent=slideEntries.some(s=>Number.isFinite(s.time))?'PPT 按视频时间自动翻页，沿用字幕偏移。手动翻页可暂停跟随。':'本页未读取到 PPT 时间，保留手动翻页和页码记忆。'; return true;
  }
  $('show-slides').onclick=()=>{
    if(layoutMode==='video') {showSlides();return;}
    if(layoutMode==='split') {
      layoutMode='focus';videoManuallyPlaced=false;$('show-slides').textContent='③ 恢复课堂';
      positionFocusVideo();
      GM_deleteValue('ppt-free-window-v2');restoreSlideGeometry();return;
    }
    closeSlides();
  };
  function focusBounds() {
    if(document.fullscreenElement) return {left:0,top:0,width:innerWidth,height:innerHeight};
    const r=splitVideo.parentElement.getBoundingClientRect();
    const left=Math.max(0,r.left),top=Math.max(0,r.top);
    return {left,top,width:Math.max(160,Math.min(innerWidth,r.right)-left),height:Math.max(100,Math.min(innerHeight,r.bottom)-top)};
  }
  function positionFocusVideo() {
    if(layoutMode!=='focus' || videoManuallyPlaced || !splitVideo) return;
    const r=focusBounds(),ratio=splitVideo.videoWidth/ splitVideo.videoHeight || 16/9;
    const width=Math.max(160,Math.min(r.width*.27,(r.height-80)*ratio)),height=width/ratio;
    setVideoBox({left:r.left+r.width-width-16,top:Math.max(r.top,r.top+r.height-height-64),width,height});
  }
  function setVideoBox(r) {
    for(const [k,v] of Object.entries({position:'fixed',left:r.left+'px',top:r.top+'px',right:'auto',bottom:'auto',width:r.width+'px',height:r.height+'px','margin-left':'0','z-index':'20'})) splitVideo.style.setProperty(k,v,'important');
  }
  function ensureEditableVideo() {
    if(splitVideo) return true;
    if(!mainVideo) {$('slides-status').textContent='请先打开课程视频';return false;}
    splitVideo=mainVideo;
    splitStyles=Object.fromEntries(['width','height','margin-left','position','left','top','right','bottom','z-index'].map(key=>[key,{value:splitVideo.style.getPropertyValue(key),priority:splitVideo.style.getPropertyPriority(key)}]));
    return true;
  }
  function updateEditHandles() {
    for(const [id,target] of [['video-edit-box',mainVideo],['caption-edit-box',$('caption')]]) {
      const box=$(id);box.hidden=!target || (id==='caption-edit-box' && (!editingLayout || target.hidden));
      if(box.hidden) continue;
      const r=target.getBoundingClientRect();Object.assign(box.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    }
  }
  $('edit-layout').onclick=()=>{
    editingLayout=!editingLayout;$('layout-editor').hidden=!editingLayout;
    $('edit-layout').textContent=editingLayout?'完成调整':'调整字幕';updateEditHandles();
  };
  for(const kind of ['video','caption']) {
    const box=$(kind+'-edit-box');let drag=null;
    box.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      const target=kind==='video'?mainVideo:$('caption');if(!target)return;
      const r=target.getBoundingClientRect();
      drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top,width:r.width,height:r.height,bottom:r.bottom,size:value('size',26,14,48),resize:!!e.target.closest('button')};
      box.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
    });
    box.addEventListener('pointermove',e=>{
      if(!drag)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(kind==='video') {
        if(!ensureEditableVideo())return;
        const r={left:drag.left+(drag.resize?0:dx),top:drag.top+(drag.resize?0:dy),width:drag.resize?Math.max(160,Math.min(innerWidth*2,drag.width+dx)):drag.width,height:drag.resize?Math.max(100,Math.min(innerHeight*2,drag.height+dy)):drag.height};
        r.left=Math.max(72-r.width,Math.min(innerWidth-72,r.left));r.top=Math.max(72-r.height,Math.min(innerHeight-72,r.top));
        videoManuallyPlaced=true;setVideoBox(r);for(const [id,n] of [['video-x',r.left],['video-y',r.top],['video-w',r.width],['video-h',r.height]]) $(id).value=Math.round(n);
      } else {
        $('caption-custom').checked=true;
        $('caption-x').value=Math.round(drag.left+(drag.resize?0:dx));
        $('caption-y').value=Math.round(Math.max(20,Math.min(innerHeight*2,drag.bottom+dy)));
        $('caption-w').value=Math.round(drag.resize?Math.max(160,Math.min(innerWidth*2,drag.width+dx)):drag.width);
        if(drag.resize) $('size').value=Math.round(Math.max(14,Math.min(48,drag.size+dy/4)));
      }
      tick();updateEditHandles();
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture']) box.addEventListener(event,()=>{drag=null;});
  }
  $('apply-layout').onclick=()=>{
    if(!ensureEditableVideo()) return;
    videoManuallyPlaced=true;setVideoBox({left:value('video-x',0,-innerWidth,innerWidth),top:value('video-y',0,-innerHeight,innerHeight),width:value('video-w',400,160,innerWidth*2),height:value('video-h',240,100,innerHeight*2)});
  };
  $('slide-close').onclick=closeSlides;
  $('slide-prev').onclick=()=>{slideFollowing=false;slideIndex=Math.max(0,slideIndex-1);renderSlide();};
  $('slide-next').onclick=()=>{slideFollowing=false;slideIndex=Math.min(slideUrls.length-1,slideIndex+1);renderSlide();};
  $('slide-follow').onclick=()=>{slideFollowing=!slideFollowing;updateFollowButton();saveSlideState();syncSlide();};
  $('slide-viewport').addEventListener('keydown',e=>{
    if(e.key==='PageDown' || e.key==='ArrowRight') { e.preventDefault(); $('slide-next').click(); }
    if(e.key==='PageUp' || e.key==='ArrowLeft') { e.preventDefault(); $('slide-prev').click(); }
  });
  $('focus-fullscreen').onclick=async()=>{
    try {
      if(document.fullscreenElement) await document.exitFullscreen();
      else if(mainVideo) await mainVideo.parentElement.requestFullscreen();
      else throw new Error('请先打开视频');
    } catch(error) { $('slides-status').textContent='无法进入全屏：'+error.message; }
  };
  function layoutSlides() {
    if(!splitVideo || $('slides').hidden) return;
    if(!splitVideo.isConnected) { closeSlides(); return; }
    positionFocusVideo();
    if(!slideDragging && !resizing) restoreSlideGeometry();
  }
  function slideBounds() {
    if(layoutMode==='focus') {const r=focusBounds();return {left:Math.max(0,r.left),top:Math.max(0,r.top),width:r.width*.7,height:Math.max(100,r.height-150)};}
    const r=splitVideo.getBoundingClientRect();
    const left=Math.max(0,r.left-r.width),top=Math.max(0,r.top);
    const width=Math.max(0,Math.min(innerWidth,r.left)-left);
    const ratio=$('slide-image').naturalWidth / $('slide-image').naturalHeight;
    return {left,top,width,height:Math.max(0,Math.min(Math.min(innerHeight,r.bottom)-top-64,ratio>0?width/ratio:Infinity))};
  }
  function restoreSlideGeometry() {
    const b=slideBounds(),saved=GM_getValue('ppt-free-window-v2',null);
    applySlideGeometry(saved ? {left:saved.x*innerWidth,top:saved.y*innerHeight,width:saved.w*innerWidth,height:saved.h*innerHeight} : b);
  }
  function applySlideGeometry(rect) {
    const b={left:0,top:0,width:innerWidth,height:innerHeight};
    const width=Math.min(b.width*4,Math.max(160,rect.width)),height=Math.min(b.height*4,Math.max(100,rect.height));
    Object.assign($('slides').style,{left:Math.max(72-width,Math.min(b.width-72,rect.left))+'px',top:Math.max(72-height,Math.min(b.height-72,rect.top))+'px',width:width+'px',height:height+'px'});
  }
  function saveSlideGeometry() {
    if(!splitVideo) return;
    applySlideGeometry($('slides').getBoundingClientRect());
    const {left,top,width,height}=$('slides').getBoundingClientRect();
    if(innerWidth && innerHeight) GM_setValue('ppt-free-window-v2',{x:left/innerWidth,y:top/innerHeight,w:width/innerWidth,h:height/innerHeight});
  }
  $('slide-viewport').addEventListener('pointerdown',()=>{slideDragging=true;});
  for(const event of ['pointerup','pointercancel','lostpointercapture']) $('slide-viewport').addEventListener(event,()=>{slideDragging=false;});
  let resizing=null;
  for(const handle of [$('slide-resize'),...shadow.querySelectorAll('.slide-edge')]) {
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==0) return;
      const r=$('slides').getBoundingClientRect();
      resizing={left:r.left,top:r.top,width:r.width,height:r.height,x:e.clientX,y:e.clientY,edge:handle.dataset.edge || 'corner'};
      handle.setPointerCapture(e.pointerId);e.preventDefault();e.stopPropagation();
    });
    handle.addEventListener('pointermove',e=>{
      if(!resizing) return;
      const r=resizing,dx=e.clientX-r.x,dy=e.clientY-r.y,next={...r};
      if(r.edge==='left') {next.width=Math.max(160,r.width-dx);next.left=r.left+r.width-next.width;}
      if(r.edge==='right' || r.edge==='corner') next.width=r.width+dx;
      if(r.edge==='top') {next.height=Math.max(100,r.height-dy);next.top=r.top+r.height-next.height;}
      if(r.edge==='bottom' || r.edge==='corner') next.height=r.height+dy;
      applySlideGeometry(next);
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture']) handle.addEventListener(event,()=>{if(resizing) saveSlideGeometry();resizing=null;});
  }
  $('reset-ppt').onclick=()=>{GM_deleteValue('ppt-free-window-v2');if(splitVideo) restoreSlideGeometry();else showSlides();};
  $('slide-resize').addEventListener('keydown',e=>{
    const steps={ArrowRight:[20,0],ArrowLeft:[-20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};
    if(!steps[e.key]) return;
    e.preventDefault();const r=$('slides').getBoundingClientRect(),[x,y]=steps[e.key];
    applySlideGeometry({left:r.left,top:r.top,width:r.width+x,height:r.height+y});saveSlideGeometry();
  });

  function imagesIndex(image) {return [...document.querySelectorAll('#pane-ppt img')].filter(img=>/^https?:/.test(img.currentSrc || img.src)).indexOf(image);}
  // Intercept only actual slide-image clicks when images are available; leave unrelated controls alone.
  document.addEventListener('click', event=>{
    const card=event.target.closest?.('#pane-ppt .tab-ppt');
    const image=card?.querySelector('img');
    const pptButton=event.target.closest?.('.eve-student.ppt, #tab-ppt');
    if(!image && !pptButton) return;
    if(showSlides()) { event.preventDefault(); event.stopImmediatePropagation(); if(image) {slideFollowing=false;slideIndex=Math.max(0,imagesIndex(image));} renderSlide(); }
  },true);
  let cacheAbort=null, localPlayback=null, cacheEpoch=0, autoChecked='', preferOnline=false;

  function cacheStore(mode,action) {
    return new Promise((resolve,reject)=>{
      const open=indexedDB.open('zhiyun-video-cache',1);
      open.onupgradeneeded=()=>open.result.createObjectStore('videos');
      open.onerror=()=>reject(new Error('无法打开浏览器缓存存储'));
      open.onsuccess=()=>{const db=open.result,tx=db.transaction('videos',mode);let result;
        const request=action(tx.objectStore('videos'));request.onsuccess=()=>{result=request.result;};
        tx.oncomplete=()=>{db.close();resolve(result);};
        tx.onabort=tx.onerror=()=>{db.close();reject(new Error('缓存读写失败，可能空间不足'));};
      };
    });
  }
  async function checkCacheSpace(bytes) {
    if((await cacheStore("readonly",s=>s.get("cache-folder")))?.handle) return; // External disk free space is not exposed by the browser.
    const estimate=await navigator.storage?.estimate?.();
    if(estimate?.quota && bytes>Math.max(0,estimate.quota-(estimate.usage || 0)-32*1024*1024)) throw new Error('浏览器可用空间不足，需要 '+(bytes/1073741824).toFixed(2)+' GB；请清理缓存后重试');
  }
  async function cacheDirectory(record) {
    const handle=record ? record.directory : (await cacheStore('readonly',s=>s.get('cache-folder')))?.handle;
    if(handle) {
      if(await handle.queryPermission({mode:'readwrite'})!=='granted') throw new Error('缓存文件夹访问权限已失效，请重新选择该文件夹授权');
      return handle;
    }
    if(!navigator.storage?.getDirectory) throw new Error('此浏览器不支持磁盘分块缓存，请使用新版 Chrome / Edge');
    return (await navigator.storage.getDirectory()).getDirectoryHandle('zhiyun-videos',{create:true});
  }
  async function removeCacheFile(record) {
    if(record?.kind==='opfs') {try{await (await cacheDirectory(record)).removeEntry(record.name);}catch(error){if(error.name!=='NotFoundError')throw error;}}
  }
  async function storeLargeVideo(key,producer,signal) {
    if(navigator.locks) return navigator.locks.request('zhiyun-cache:'+key,{ifAvailable:true},lock=>{
      if(!lock) throw new Error('另一个标签页正在缓存此课程，请等待完成');
      return storeLargeVideoLocked(key,producer,signal);
    });
    return storeLargeVideoLocked(key,producer,signal);
  }
  async function storeLargeVideoLocked(key,producer,signal) {
    const dir=await cacheDirectory();
    // A pending entry lets the next attempt reclaim an interrupted tab's partial file.
    await removeCacheFile(await cacheStore('readonly',s=>s.get(key+':pending')));
    const record={kind:'opfs',name:crypto.randomUUID()+'.video',directory:dir};
    await cacheStore('readwrite',s=>s.put(record,key+':pending'));
    let writer,committed=false;
    try {
      const file=await dir.getFileHandle(record.name,{create:true});writer=await file.createWritable();
      record.size=await producer(async blob=>{
        if(!record.type) {const bytes=new Uint8Array(await blob.slice(0,8).arrayBuffer());record.type=bytes[0]===0x1a?'video/webm':'video/mp4';}
        await writer.write(blob);
      });
      if(signal?.aborted) throw new Error('缓存已取消');
      await writer.close();writer=null;
      if(signal?.aborted) throw new Error('缓存已取消');
      const old=await cacheStore('readonly',s=>s.get(key));
      await cacheStore('readwrite',s=>s.put(record,key));committed=true;
      try{await removeCacheFile(old);}catch{} // A cleanup failure must not discard a completed new cache.
    }finally{
      if(writer) await writer.abort().catch(()=>{});
      if(!committed) await removeCacheFile(record);
      await cacheStore('readwrite',s=>s.delete(key+':pending'));
    }
  }
  async function saveVideo(blob,key,signal) {
    if(!blob.size) throw new Error('视频文件为空');
    await checkCacheSpace(blob.size);
    await storeLargeVideo(key,async write=>{for(let offset=0;offset<blob.size;offset+=8*1024*1024){if(signal?.aborted)throw new Error("缓存已取消");await write(blob.slice(offset,offset+8*1024*1024));}return blob.size;},signal);
  }
  async function cachedVideo(key) {
    const record=await cacheStore('readonly',s=>s.get(key));
    if(record?.kind!=='opfs') return record; // Read caches created by older versions as well.
    const file=await (await (await cacheDirectory(record)).getFileHandle(record.name)).getFile();
    if(file.size!==record.size) throw new Error('缓存文件不完整，请重新缓存');
    return file.slice(0,file.size,record.type || 'video/mp4');
  }
  async function updateCacheLocation() {
    try {const config=await cacheStore('readonly',s=>s.get('cache-folder'));
      $('cache-location').textContent=config?.handle?'位置：'+config.label+' / 伴读字幕缓存（仅影响新缓存）':'位置：浏览器默认存储（随浏览器配置目录；无法从网页读取盘符）';
    }catch(error){$('cache-location').textContent=error.message;}
  }
  $('cache-folder').onclick=async()=>{
    if(cacheAbort){$('cache-status').textContent='请先取消当前缓存，再更改目录';return;}
    if(!window.showDirectoryPicker){$('cache-status').textContent='当前浏览器不支持选择文件夹，请使用新版 Chrome / Edge';return;}
    try {
      const root=await window.showDirectoryPicker({id:'zhiyun-video-cache',mode:'readwrite'});
      const handle=await root.getDirectoryHandle('伴读字幕缓存',{create:true});
      await cacheStore('readwrite',s=>s.put({handle,label:root.name},'cache-folder'));await updateCacheLocation();
    }catch(error){if(error.name!=='AbortError')$('cache-status').textContent='选择目录失败：'+error.message;}
  };
  $('cache-default-folder').onclick=async()=>{if(cacheAbort){$('cache-status').textContent='请先取消缓存再更改目录';return;}try{await cacheStore('readwrite',s=>s.delete('cache-folder'));await updateCacheLocation();}catch(error){$('cache-status').textContent=error.message;}};
  updateCacheLocation();
  $('cache-auto').checked=GM_getValue('cache-auto',true);
  $('cache-auto').onchange=()=>{GM_setValue('cache-auto',$('cache-auto').checked);preferOnline=false;autoChecked='';cacheEpoch++;};
  function resumeState(video,state,valid) {
    video.addEventListener('loadedmetadata',()=>{if(!valid())return;
      if(Number.isFinite(video.duration)) video.currentTime=Math.min(state.time,Math.max(0,video.duration-.1));
      video.playbackRate=state.rate;
      if(!state.paused) video.play().catch(()=>{$('cache-status').textContent='来源已切换，请点击播放器继续。';});else video.pause();
    },{once:true});
  }
  function restoreOnline() {
    const epoch=++cacheEpoch;
    if(!localPlayback) return;
    const {video,src,url}=localPlayback;localPlayback=null;
    if(video.getAttribute('src')!==url){URL.revokeObjectURL(url);return;}
    const state={time:video.currentTime,rate:video.playbackRate,paused:video.paused};
    resumeState(video,state,()=>cacheEpoch===epoch && !localPlayback);
    video.pause();if(src===null) video.removeAttribute('src');else video.setAttribute('src',src);
    video.load();URL.revokeObjectURL(url);
    $('cache-source').textContent='当前：在线视频';$('cache-status').textContent='已切回在线来源，保留当前进度与倍速。';
  }
  $('cache-download').onclick=async()=>{
    if(cacheAbort){cacheAbort.abort();return;}
    const downloadVideoElement=mainVideo,key=courseIdentity(location.hash),src=mainVideo?.currentSrc || mainVideo?.src || '';
    if(!/^https?:/i.test(src) || !/\.(mp4|webm)(?:[?#]|$)/i.test(src)) {
      $('cache-status').textContent='当前不是可直接缓存的 MP4/WebM 地址（可能是分片流或 blob 地址）。请查看缓存诊断，需进一步适配此来源。';return;
    }
    const controller=new AbortController();cacheAbort=controller;$('cache-download').textContent='取消缓存';
    try {
      $('cache-status').textContent='正在连接视频服务器；如果油猴询问，请允许连接视频域名…';
      await storeLargeVideo(key,write=>downloadInChunks(GM_xmlhttpRequest,src,{signal:controller.signal,write,checkSpace:checkCacheSpace,onProgress:(size,total)=>{
        $('cache-status').textContent=`正在分块缓存 ${(size/1048576).toFixed(1)} MB${total?' / '+(total/1048576).toFixed(1)+' MB':''}`;
      }}),controller.signal);
      if(key===courseIdentity(location.hash)) { $('cache-status').textContent='缓存完成，已保存在本机。';if($('cache-auto').checked && !preferOnline && mainVideo===downloadVideoElement) await playCached({quiet:true}); }
    } catch(error) {if(key===courseIdentity(location.hash)) $('cache-status').textContent=controller.signal.aborted?'缓存已取消':error.message;}
    finally{cacheAbort=null;$('cache-download').textContent='缓存当前视频';}
  };
  $('cache-diagnose').onclick=()=>{
    const source=mainVideo?.currentSrc || mainVideo?.src || '';let origin='无视频源',kind='未知';
    try{const url=new URL(source);origin=url.origin;kind=url.protocol==='blob:'?'blob / 分片播放':url.pathname.match(/\.(mp4|webm|m3u8|mpd)$/i)?.[1] || '无扩展名';}catch{}
    $('cache-diagnostic').hidden=false;
    $('cache-diagnostic').textContent=`版本：0.13.0\n来源域名：${origin}\n格式：${kind}\n状态：${$('cache-status').textContent}\n（不包含视频完整地址、登录参数或 API Key）`;
  };
  $('cache-details').addEventListener('toggle',()=>{if($('cache-details').open)$('cache-diagnose').click();});
  $('cache-file').onchange=async()=>{
    const file=$('cache-file').files[0],key=courseIdentity(location.hash);if(!file) return;
    if(cacheAbort){$('cache-status').textContent='请等待当前缓存完成或取消后再导入';$('cache-file').value='';return;}
    const controller=new AbortController();cacheAbort=controller;$('cache-download').textContent='取消缓存';
    try {if(!/\.(mp4|webm)$/i.test(file.name)) throw new Error('请选择 MP4 或 WebM 视频');await saveVideo(file,key,controller.signal);if(key===courseIdentity(location.hash)) $('cache-status').textContent='导入完成，可播放已缓存视频。';}
    catch(error){$('cache-status').textContent=error.message;}
    finally{$('cache-file').value='';cacheAbort=null;$('cache-download').textContent='缓存当前视频';}
  };
  async function playCached({quiet=false}={}) {
    const epoch=++cacheEpoch;
    const key=courseIdentity(location.hash),video=mainVideo;
    try {
      if(!video) throw new Error('请先打开课程视频');
      const blob=await cachedVideo(key);
      if(key!==courseIdentity(location.hash) || mainVideo!==video || epoch!==cacheEpoch) return;
      if(!blob && quiet)return;
      if(!blob) throw new Error('本课程还没有缓存');
      if(localPlayback?.video===video) return;
      cancelAlignment?.();
      const state={time:video.currentTime,rate:video.playbackRate,paused:video.paused};
      const url=URL.createObjectURL(blob);localPlayback={video,src:video.getAttribute('src'),url};
      resumeState(video,state,()=>localPlayback?.url===url);
      video.addEventListener('error',()=>{if(localPlayback?.url===url){restoreOnline();$('cache-status').textContent='缓存播放失败，已恢复在线来源。';}},{once:true});
      video.src=url;video.load();$('cache-source').textContent='当前：本机缓存';$('cache-status').textContent='缓存完成，已接续当前进度使用本机视频。';
    }catch(error){$('cache-status').textContent=error.message;}
  };
  $('cache-play').onclick=()=>{preferOnline=false;playCached();};
  $('cache-online').onclick=()=>{preferOnline=true;cancelAlignment?.();restoreOnline();};
  $('cache-clear').onclick=async()=>{try{if(cacheAbort){cacheAbort.abort();$('cache-status').textContent='正在取消下载，结束后再次点击清除';return;}restoreOnline();const key=courseIdentity(location.hash);await removeCacheFile(await cacheStore('readonly',s=>s.get(key)));await removeCacheFile(await cacheStore('readonly',s=>s.get(key+':pending')));await cacheStore('readwrite',s=>s.delete(key+':pending'));await cacheStore('readwrite',store=>store.delete(key));$('cache-status').textContent='本课程缓存已清除';}catch(error){$('cache-status').textContent=error.message;}};
  let apiKey = GM_getValue('ark-api-key', '');
  function arkRequest(text, source, target) {
    let handle;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
      rejectRequest = reject;
      handle = GM_xmlhttpRequest({
        method: 'POST', url: ARK_URL, anonymous: true, timeout: 30000,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        data: JSON.stringify(translationBody(text, source, target)),
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            const reason = ({401:'API Key 无效',403:'没有模型访问权限',429:'请求限流或额度不足'})[response.status];
            reject(new Error(reason || `翻译接口错误（HTTP ${response.status}）`)); return;
          }
          try { resolve(translationResult(JSON.parse(response.responseText))); }
          catch (error) { reject(error instanceof SyntaxError ? new Error('接口返回格式错误') : error); }
        },
        onerror: () => reject(new Error('网络请求失败，请检查网络和油猴的域名授权')),
        ontimeout: () => reject(new Error('翻译请求超时，请重新开启')),
        onabort: () => reject(new Error('已停止翻译'))
      });
    });
    return { promise, abort() { handle?.abort(); rejectRequest(new Error('已停止翻译')); } };
  }
  const translator = createTranslator(arkRequest, message => {
    $('translation-status').textContent = message;
    if(!translator.enabled) { $('mode').value='original'; savePreferences(); }
  });
  function stopTranslation(message = '已停止翻译，已完成的译文仍可对照查看') {
    translator.stop();
    $('mode').value='original'; savePreferences();
    $('translation-status').textContent = message;
  }
  function configureKey() {
    const entered = prompt('输入豆包 API Key（保存在油猴脚本存储中，不写入课程页面）');
    if (entered === null) return;
    const next = entered.trim();
    if (!next || /\s/.test(next)) { alert('请输入有效的 API Key，不要包含 Bearer 或空格。'); return; }
    stopTranslation('API Key 已保存，选择中英对照即可翻译');
    apiKey = next;
    GM_setValue('ark-api-key', apiKey); updateKeyBadges();
  }
  GM_registerMenuCommand('设置豆包 API Key', configureKey);
  $('configure-key').addEventListener('click', configureKey);
  GM_registerMenuCommand('清除豆包 API Key', () => {
    stopTranslation('API Key 已清除'); apiKey = ''; GM_deleteValue('ark-api-key'); updateKeyBadges();
  });
  // One control owns both display mode and paid translation intent.
  $('mode').value='original'; // Restoring appearance must not silently restart paid requests after reload.
  $('mode').addEventListener('change', () => {
    if($('mode').value==='original') {stopTranslation('仅显示原文，已停止翻译请求');return;}
    if(!apiKey) {stopTranslation('请先在「偏好与连接」设置翻译 Key，再选择中英对照。');return;}
    $('enabled').checked=true;
    translator.start(...$('direction').value.split('-'));
    savePreferences();
    $('translation-status').textContent='中英对照已开启 · 豆包按需翻译，可能产生费用';
  });
  $('enabled').addEventListener('change', () => {
    if (!$('enabled').checked) stopTranslation('字幕已关闭，已停止翻译请求');
  });
  $('direction').addEventListener('change', () => {
    const active=translator.enabled; translator.reset();
    if(active) {translator.start(...$('direction').value.split('-')); $('translation-status').textContent='已切换翻译方向';}
    else stopTranslation('翻译方向已更改');
  });
  function translatedCue(cue) {
    if(isTargetLanguage(cue.original,$('direction').value.split('-')[1])) return {...cue,translation:''};
    return { ...cue, translation: translator.get(cue.original) || cue.translation || '' };
  }
  let cues = [], route = courseIdentity(location.hash), pane = null, dirty = true, lastRead = 0;
  const collected = new Map();
  const observer = new MutationObserver(() => { dirty = true; });
  const value = (id, fallback, min, max) => {
    const raw = $(id).value;
    const n = raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  function offsetKey() { return 'subtitle-offset:' + courseIdentity(location.hash); }
  function updateOffset(save = true) {
    const offset = value('offset', 0, -3600, 3600);
    $('offset-hint').textContent = offset === 0 ? '同步偏移：0 秒' :
      `字幕${offset > 0 ? '延后' : '提前'} ${Math.abs(offset)} 秒`;
    if (save) GM_setValue(offsetKey(), offset);
  }
  function loadOffset() { $('offset').value = GM_getValue(offsetKey(), GM_getValue('subtitle-offset:' + location.hash, 0)); updateOffset(false); }
  loadOffset();
  $('offset').addEventListener('input', () => updateOffset());
  for (const [id, delta] of [['earlier', -0.5], ['later', 0.5], ['reset-offset', 0]]) {
    $(id).addEventListener('click', () => {
      $('offset').value = id === 'reset-offset' ? 0 : Math.min(3600, Math.max(-3600, value('offset', 0, -3600, 3600) + delta));
      updateOffset(); tick();
    });
  }
  let paddedVideo = null, originalPadding = null;
  function releaseVideo() {
    if (paddedVideo && originalPadding) {
      for (const [property, saved] of Object.entries(originalPadding)) {
        if (saved.value) paddedVideo.style.setProperty(property, saved.value, saved.priority);
        else paddedVideo.style.removeProperty(property);
      }
    }
    paddedVideo = null; originalPadding = null;
  }
  function reserveBand(video, band) {
    if (paddedVideo !== video) {
      releaseVideo(); paddedVideo = video;
      originalPadding = Object.fromEntries(['padding-bottom', 'box-sizing', 'object-fit'].map(property =>
        [property, { value: video.style.getPropertyValue(property), priority: video.style.getPropertyPriority(property) }]));
    }
    video.style.setProperty('box-sizing', 'border-box', 'important');
    video.style.setProperty('object-fit', 'contain', 'important');
    video.style.setProperty('padding-bottom', band + 'px', 'important');
  }
  function refresh() {
    // Merge by timestamp + source so searching or incremental loading cannot erase earlier cues.
    for (const row of pane?.querySelectorAll('.trans-item') ?? []) {
      const start = parseTime(row.querySelector('.item-title')?.textContent ?? '');
      const lines = row.querySelector('.trans-lan')?.children;
      const original = lines?.[0]?.textContent.trim() ?? '';
      const translation = lines?.[1]?.textContent.trim() ?? '';
      if (Number.isFinite(start) && original) {
        const key = `${start}\u0000${original}`;
        const previous = collected.get(key);
        collected.set(key, { start, original, translation: translation || previous?.translation || '' });
      }
    }
    cues = timeline([...collected.values()], value('duration', 15, 1, 120));
    const translated = cues.filter(c => c.translation).length;
    $('status').textContent = `已读取 ${cues.length} 条，其中 ${translated} 条有译文。仅包含已加载内容。`;
    dirty = false;
  }
  $('duration').addEventListener('input', () => { dirty = true; });
  $('export').addEventListener('click', () => {
    refresh();
    if (!cues.length) { $('status').textContent = '还没有读取到字幕，请先打开右侧语音识别。'; return; }
    const exported = cues.map(cue => $('mode').value === 'original' ? { ...cue, translation: '' } : translatedCue(cue));
    const blob = new Blob(['\ufeff' + srt(exported, value('offset', 0, -3600, 3600))], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${document.title.replace(/[<>:"/\\|?*]/g, '_')}-已读取字幕.srt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  function tick() {
    if (route !== courseIdentity(location.hash)) {
      cacheAbort?.abort();restoreOnline();autoChecked='';preferOnline=false;cancelAlignment?.(); closeSlides(); slideUrls=[];
      translator.reset(); stopTranslation('课程已切换，请按需重新开启翻译');
      route = courseIdentity(location.hash); collected.clear(); cues = []; dirty = true;
      releaseVideo(); loadOffset();
      $('status').textContent = '课程已切换，等待读取字幕…';
    }
    const currentPane = document.querySelector('#pane-voice');
    if (pane !== currentPane) {
      observer.disconnect(); pane = currentPane; dirty = true;
      if (pane) observer.observe(pane, { childList: true, subtree: true, characterData: true });
    }
    if (dirty && performance.now() - lastRead > 500) { refresh(); lastRead = performance.now(); }
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.body;
    if (host.parentElement !== parent) parent.append(host);
    const candidates = [...document.querySelectorAll('video')].map(video => {
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      return { video, rect, area: style.visibility === 'hidden' || style.display === 'none' ? 0 : width * height };
    }).filter(v => v.area > 0).sort((a, b) => b.area - a.area);
    const selected = candidates.find(v=>v.video===splitVideo) || candidates[0];
    layoutSlides(); syncSlide();
    $('focus-fullscreen').textContent=fs?'⛶ 退出全屏':'⛶ 专注全屏';
    mainVideo=selected?.video ?? null;
    if(mainVideo?.readyState>=1 && $('cache-auto').checked && !preferOnline && !localPlayback && autoChecked!==route) {autoChecked=route;playCached({quiet:true});}
    const cue = selected ? activeCue(cues, subtitleTime(selected.video.currentTime, value('offset', 0, -3600, 3600))) : null;
    if (selected && translator.enabled && $('enabled').checked && $('mode').value === 'both') {
      const time = subtitleTime(selected.video.currentTime, value('offset', 0, -3600, 3600));
      const index = cue ? cues.indexOf(cue) : cues.findIndex(c => c.start >= time);
      translator.schedule(index < 0 ? [] : cues.slice(index, index + 4).map(c => c.original));
    }
    const showOriginal = $('mode').value !== 'translation';
    const showTranslation = $('mode').value !== 'original';
    const original = showOriginal ? cue?.original ?? '' : '';
    const translation = showTranslation && cue ? translatedCue(cue).translation : '';
    $('caption').hidden = !$('enabled').checked || !selected || !(original || translation) || fs?.tagName === 'VIDEO';
    if ($('original').textContent !== original) $('original').textContent = original;
    if ($('translation').textContent !== translation) $('translation').textContent = translation;
    const below = $('placement').value === 'below' && $('enabled').checked && fs?.tagName !== 'VIDEO';
    if (!selected || !below) releaseVideo();
    if (selected) {
      const r = layoutMode==='focus' && !$('slides').hidden ? $('slides').getBoundingClientRect() : selected.rect;
      const layout = captionLayout(r, innerWidth, below, value('bottom', 60, 0, 300));
      if (below && layoutMode!=='focus') reserveBand(selected.video, layout.band);else if(layoutMode==='focus') releaseVideo();
      Object.assign($('caption').style, {
        left: ($('caption-custom').checked?value('caption-x',layout.left,-innerWidth,innerWidth):layout.left) + 'px', width: ($('caption-custom').checked?value('caption-w',layout.width,160,innerWidth*2):layout.width) + 'px',
        top: ($('caption-custom').checked?value('caption-y',r.bottom,0,innerHeight*2):layoutMode==='focus'?Math.min(innerHeight-12,r.bottom+110):below?r.bottom-64:Math.min(layout.top,r.bottom-64)) + 'px', transform: 'translateY(-100%)', maxHeight: Math.max(24,r.height-80) + 'px',
        fontSize: value('size', 26, 14, 48) + 'px'
      });
      // Fit long bilingual lines without a scrollbar; keep all pointer input available to the player.
      const caption=$('caption');
      if(!caption.hidden) {
        let font=value('size',26,14,48);
        const target=Math.max(48,below?layout.band-64:Math.min(180,r.height-80));
        while(font>14 && caption.scrollHeight>target) {font--;caption.style.fontSize=font+'px';}
      }
    }
  }
  setInterval(()=>{tick();updateEditHandles();}, 100);
  tick();
})();
