/* Website online controls, cached transport, keyboard and classroom fullscreen. */
(function(root){
'use strict';
function isEditing(target){return !!target?.closest?.('textarea,select,input,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');}
function mount({shadow,host,getVideo,getLocal,getCues,getCourse,getClock,getSeekTime,translate,seek,onCollapse}){
 const $=id=>shadow.getElementById(id);
 const style=document.createElement('style');style.id='zy-player-control-rules';style.textContent=`
 video[data-zy-enhanced]::-webkit-media-controls-fullscreen-button{display:none!important}
 [data-zy-external-player] .cmc-player > .control-content,[data-zy-external-player] .cmc-m-control,[data-zy-external-player] .vjs-control-bar,[data-zy-external-player] .prism-controlbar,[data-zy-external-player] .dplayer-controller,[data-zy-external-player] .xgplayer-controls,[data-zy-external-player] xg-controls,[data-zy-external-player] .jw-controlbar,[data-zy-external-player] .video-controls,[data-zy-external-player] .player-controls,[data-zy-external-player] .control-bar,[data-zy-external-player] .vjs-big-play-button,[data-zy-external-player] .prism-big-play-btn,[data-zy-external-player] .dplayer-controller-mask{display:none!important;pointer-events:none!important}
 [data-zy-online-controls] .cmc-player > .control-content,[data-zy-online-controls] .cmc-m-control,[data-zy-online-controls] .vjs-control-bar,[data-zy-online-controls] .prism-controlbar,[data-zy-online-controls] .dplayer-controller,[data-zy-online-controls] .xgplayer-controls,[data-zy-online-controls] xg-controls,[data-zy-online-controls] .jw-controlbar,[data-zy-online-controls] .video-controls,[data-zy-online-controls] .player-controls,[data-zy-online-controls] .control-bar{position:fixed!important;left:0!important;right:0!important;top:auto!important;bottom:0!important;width:100%!important;transform:none!important;z-index:40!important;pointer-events:auto!important}
 `;document.head.append(style);
 const transport=document.createElement('nav');transport.id='zy-playback';transport.setAttribute('aria-label','课程播放控制');transport.hidden=true;transport.innerHTML='<button id=zy-play-toggle type=button aria-label=播放>▶</button><span id=zy-play-time>00:00 / 00:00</span><input id=zy-play-seek type=range min=0 max=0 step=0.1 value=0 aria-label=课程播放进度><button id=zy-play-mute type=button aria-label=静音>音量</button><input id=zy-play-volume type=range min=0 max=1 step=0.05 value=1 aria-label=音量><select id=zy-play-rate aria-label=播放速度><option value=0.75>0.75×</option><option value=1>1×</option><option value=1.25>1.25×</option><option value=1.5>1.5×</option><option value=2>2×</option><option value=3>3×</option></select>';shadow.append(transport);
 const transportStyle=document.createElement('style');transportStyle.textContent='#zy-playback{position:fixed;inset:auto 0 0;z-index:90;display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 16px;box-sizing:border-box;background:var(--zy-bg,#fff7ef);color:var(--zy-text,#513d32);border-top:1px solid var(--zy-line,#e5cdb9);box-shadow:0 -3px 15px #0002;pointer-events:auto;font:13px/1.4 Segoe UI,Microsoft YaHei,sans-serif}#zy-playback[hidden]{display:none!important}#zy-playback button{position:static;inset:auto;flex:none;border:1px solid var(--zy-line,#e5cdb9);border-radius:8px;background:var(--zy-card,#fff);color:var(--zy-accent,#91401e);padding:6px 10px;font:inherit}#zy-playback input{margin:0;padding:0;accent-color:var(--zy-accent,#bb582c)}#zy-play-seek{flex:1;min-width:40px;width:auto;max-width:none}#zy-play-volume{width:75px;flex:none}#zy-play-time{white-space:nowrap;font-variant-numeric:tabular-nums}#zy-play-rate{width:68px;background:var(--zy-card,#fff);color:var(--zy-text,#513d32);border:1px solid var(--zy-line,#e5cdb9);border-radius:7px;padding:5px} @media(max-width:600px){#zy-playback{gap:6px;padding:6px}#zy-play-volume{display:none}#zy-play-time{font-size:11px}}';shadow.append(transportStyle);
 const control=id=>transport.querySelector('#'+id),progress=control('zy-play-seek');let seeking=false;
 const setText=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
 const clock=t=>{const seconds=Math.max(0,Math.floor(Number(t)||0));return (seconds>=3600?Math.floor(seconds/3600)+':':'')+String(Math.floor(seconds/60)%60).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
 control('zy-play-toggle').onclick=()=>{const video=getVideo();if(!video)return;if(video.paused)Promise.resolve(video.play()).catch(()=>{$('cache-status').textContent='视频暂未就绪，请稍后再播放。';});else video.pause();};
 progress.onpointerdown=()=>{seeking=true;};progress.oninput=()=>{seeking=true;control('zy-play-time').textContent=clock(progress.value)+' / '+clock(getVideo()?.duration);};progress.onchange=()=>{seeking=false;seek(Number(progress.value));};window.addEventListener('pointerup',()=>{seeking=false;});window.addEventListener('pointercancel',()=>{seeking=false;});
 control('zy-play-volume').oninput=e=>{const video=getVideo();if(video){video.volume=Number(e.target.value);video.muted=false;}};control('zy-play-mute').onclick=()=>{const video=getVideo();if(video)video.muted=!video.muted;};control('zy-play-rate').onchange=e=>{const video=getVideo();if(video)video.playbackRate=Number(e.target.value);};
 function updateTransport(video,cached){transport.hidden=!video||!cached;if(transport.hidden)return;const duration=Number.isFinite(video.duration)?Math.max(0,video.duration):0;progress.max=String(duration);progress.disabled=!duration;if(!seeking){progress.value=String(Math.max(0,Math.min(duration,video.currentTime||0)));setText(control('zy-play-time'),clock(video.currentTime)+' / '+clock(duration));}setText(control('zy-play-toggle'),video.paused?'▶':'Ⅱ');control('zy-play-toggle').setAttribute('aria-label',video.paused?'播放':'暂停');control('zy-play-volume').value=String(video.volume);setText(control('zy-play-mute'),video.muted?'取消静音':'音量');control('zy-play-rate').value=String(video.playbackRate);}
 let current=null,controlRoot=null,extraControlRoot=null,method=null,ownMethod=null,nativeFsRecovery=false,signature='',following=true,lastCue=null;
 const nativeOwners=new Map();
 function playerRoot(video){return video?.parentElement?.closest('.cmc-main,.video-js,.prism-player,.dplayer,.xgplayer,.jwplayer,#player,.video-player,.player-container')||video?.parentElement;}
 async function enterFullscreen(){const video=getVideo();if(!video)throw Error('请先打开课程视频');const container=playerRoot(video);if(!container?.requestFullscreen)throw Error('浏览器不支持课堂全屏');container.setAttribute('data-zy-classroom-fullscreen','true');try{await container.requestFullscreen();}catch(error){container.removeAttribute('data-zy-classroom-fullscreen');throw error;}$('fullscreen-notice').hidden=true;}
 async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await enterFullscreen();}catch(e){$('slides-status').textContent='全屏未完成：'+e.message;}}
 $('focus-fullscreen').onclick=toggleFullscreen;
 $('fullscreen-recover').onclick=async()=>{try{await enterFullscreen();}catch{ $('slides-status').textContent='请点击“专注全屏”进入课堂全屏。';}};
 // Pointer clicks should not leave a stale cache action owning the space bar.
 window.addEventListener('pointerup',event=>{const target=event.composedPath()[0]?.closest?.('button,summary');if(!target||!event.composedPath().includes(host))return;setTimeout(()=>{if(shadow.activeElement===target)target.blur();},0);},true);
 const onFs=async()=>{
  if(document.fullscreenElement?.tagName==='VIDEO'&&!nativeFsRecovery){nativeFsRecovery=true;try{await document.exitFullscreen();await enterFullscreen();}catch{$('fullscreen-notice').hidden=false;}finally{nativeFsRecovery=false;}}
  const fs=document.fullscreenElement;for(const el of document.querySelectorAll('[data-zy-classroom-fullscreen]'))if(el!==fs)el.removeAttribute('data-zy-classroom-fullscreen');if(fs&&fs.tagName!=='VIDEO')fs.append(host);update();
 };
 document.addEventListener('fullscreenchange',onFs);
 // Capture website fullscreen buttons before handlers that fullscreen only the video.
 document.addEventListener('click',event=>{
  if(event.composedPath().includes(host))return;
  const el=event.target?.closest?.('button,[role="button"],.vjs-fullscreen-control,.prism-fullscreen-btn,.dplayer-full-icon,xg-fullscreen');
  if(!el||!playerRoot(getVideo())?.contains(el))return;
  const label=[el.getAttribute('aria-label'),el.getAttribute('title'),el.className,el.tagName].join(' ');
  if(!/full.?screen|全屏/i.test(label))return;
  event.preventDefault();event.stopImmediatePropagation();toggleFullscreen();
 },true);
 window.addEventListener('keydown',event=>{
  const video=getVideo();if(!video||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||![' ','Spacebar','ArrowLeft','ArrowRight'].includes(event.key))return;
  const target=event.composedPath()[0];if(isEditing(target)||!$('settings-dialog').hidden||target?.closest?.('#ai-learning,#ai-crop'))return;
  if(target?.closest?.('#slides')&&event.key!==' ')return;
  if([' ','Spacebar'].includes(event.key)&&target?.closest?.('button,summary,a,[role=button]'))return;
  // Native range inputs, text fields and settings retain their own keyboard semantics.
  event.preventDefault();event.stopImmediatePropagation();
  if(event.key===' '||event.key==='Spacebar'){if(event.repeat)return;if(video.paused)Promise.resolve(video.play()).catch(()=>{$('cache-status').textContent='视频暂未就绪，请稍后再播放。';});else video.pause();}
  else seek(video.currentTime+(event.key==='ArrowRight'?10:-10));
 },true);
 // Question history now owns the main list entry.
 $('transcript-close').onclick=()=>{$('transcript').hidden=true;};
 $('transcript-follow').onclick=()=>{following=!following;$('transcript-follow').setAttribute('aria-pressed',String(following));$('transcript-follow').textContent=following?'跟随':'自由浏览';signature='';};
 function updateTranscript(){
  if($('transcript').hidden)return;const cues=getCues(),video=getVideo(),time=video?getClock(video.currentTime):0;
  const index=cues.findIndex(c=>c.start<=time&&c.end>time),start=following?Math.max(0,index-20):0;
  // A bounded moving window in follow mode, full loaded list in browse mode.
  const shown=following?cues.slice(start,start+80):cues;
  const sig=JSON.stringify([getCourse(),$('mode').value,following,start,shown.map(c=>[c.start,getSeekTime(c.start),c.original,$('mode').value==='both'?translate(c):''])]);
  const list=$('transcript-list');
  if(sig!==signature){signature=sig;const old=list.scrollTop;list.replaceChildren();if(!shown.length)list.textContent='请先打开课堂右侧“语音识别”，加载字幕后会显示在这里。';
   for(const c of shown){const b=document.createElement('button');b.className='transcript-cue';b.dataset.time=c.start;const t=document.createElement('small');t.textContent=new Date(Math.max(0,getSeekTime(c.start))*1000).toISOString().slice(11,23).replace(/\.000$/,'');b.append(t,document.createTextNode(c.original));if($('mode').value==='both'){const tr=document.createElement('em');tr.textContent=translate(c);b.append(tr);}b.onclick=()=>seek(getSeekTime(c.start));list.append(b);}list.scrollTop=old;
  }
  const cue=cues[index];for(const b of list.children)b.setAttribute('aria-current',String(cue&&Number(b.dataset.time)===cue.start));
  if(following&&cue!==lastCue)list.querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest'});lastCue=cue;
 }
 function update(){
  const video=getVideo();
  if(video!==current){if(current){current.removeAttribute('data-zy-enhanced');if(current.requestFullscreen===method){if(ownMethod)Object.defineProperty(current,'requestFullscreen',ownMethod);else delete current.requestFullscreen;}}current=video;
   if(video){video.dataset.zyEnhanced='true';ownMethod=Object.getOwnPropertyDescriptor(video,'requestFullscreen');method=()=>enterFullscreen();try{video.requestFullscreen=method;}catch{}}
  }
  const local=getLocal(),localVideo=local?.video;
  const next=video?playerRoot(video):null;
  const localRoot=localVideo?.isConnected?playerRoot(localVideo):null;
  const roots=new Set([controlRoot,extraControlRoot,next,localRoot].filter(Boolean));
  const cached=!!video&&localVideo===video;
  for(const root of roots){
   const cacheRoot=root===localRoot&&(cached||root!==next);
   root.toggleAttribute('data-zy-external-player',cacheRoot);
   root.toggleAttribute('data-zy-local-player',cacheRoot);if(cacheRoot)root.setAttribute('data-zy-local-player','true');
   root.toggleAttribute('data-zy-online-controls',root===next&&!cached&&(video.hasAttribute('data-zy-moved-video')||document.fullscreenElement===root));
  }
  controlRoot=next;extraControlRoot=localRoot;
  const ownedVideos=new Set(localVideo?.isConnected?[localVideo]:[]);
  for(const [owned,original] of nativeOwners){if(!ownedVideos.has(owned)){owned.controls=original;nativeOwners.delete(owned);}}
  for(const owned of ownedVideos){if(!nativeOwners.has(owned))nativeOwners.set(owned,local.controls??owned.controls);if(owned.controls)owned.controls=false;}
  updateTransport(video,cached);
  $('cache-transport').hidden=true;
  updateTranscript();
 }
 return{update,toggleFullscreen,enterFullscreen};
}
if(typeof module!=='undefined'&&module.exports)module.exports={isEditing};else root.ZYPlayerInteractions={mount};
})(typeof globalThis!=='undefined'?globalThis:this);
