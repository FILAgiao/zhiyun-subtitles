/* Unified keyboard, fullscreen and native cached-player controls. */
(function(root){
'use strict';
function isEditing(target){return !!target?.closest?.('textarea,select,input,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');}
function mount({shadow,host,getVideo,getLocal,getCues,getCourse,getClock,getSeekTime,translate,seek,onCollapse}){
 const $=id=>shadow.getElementById(id);
 const style=document.createElement('style');style.id='zy-player-control-rules';style.textContent=`
 video[data-zy-enhanced]::-webkit-media-controls-fullscreen-button{display:none!important}
 [data-zy-local-player] .vjs-control-bar,[data-zy-local-player] .prism-controlbar,[data-zy-local-player] .dplayer-controller,[data-zy-local-player] .xgplayer-controls,[data-zy-local-player] xg-controls,[data-zy-local-player] .jw-controlbar,[data-zy-local-player] .video-controls,[data-zy-local-player] .player-controls,[data-zy-local-player] .control-bar,[data-zy-local-player] .vjs-big-play-button,[data-zy-local-player] .prism-big-play-btn,[data-zy-local-player] .dplayer-controller-mask{display:none!important;pointer-events:none!important}
 `;document.head.append(style);
 let current=null,controlRoot=null,method=null,ownMethod=null,nativeFsRecovery=false,signature='',following=true,lastCue=null;
 function playerRoot(video){return video?.parentElement?.closest('.video-js,.prism-player,.dplayer,.xgplayer,.jwplayer,#player,.video-player,.player-container')||video?.parentElement;}
 async function enterFullscreen(){const video=getVideo();if(!video)throw Error('请先打开课程视频');const container=playerRoot(video);if(!container?.requestFullscreen)throw Error('浏览器不支持课堂全屏');await container.requestFullscreen();$('fullscreen-notice').hidden=true;}
 async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await enterFullscreen();}catch(e){$('slides-status').textContent='全屏未完成：'+e.message;}}
 $('focus-fullscreen').onclick=toggleFullscreen;
 $('fullscreen-recover').onclick=async()=>{try{await enterFullscreen();}catch{ $('slides-status').textContent='请点击“专注全屏”进入课堂全屏。';}};
 // Pointer clicks should not leave a stale cache action owning the space bar.
 window.addEventListener('pointerup',event=>{const target=event.composedPath()[0]?.closest?.('button,summary');if(!target||!event.composedPath().includes(host))return;setTimeout(()=>{if(shadow.activeElement===target)target.blur();},0);},true);
 const onFs=async()=>{
  if(document.fullscreenElement?.tagName==='VIDEO'&&!nativeFsRecovery){nativeFsRecovery=true;try{await document.exitFullscreen();await enterFullscreen();}catch{$('fullscreen-notice').hidden=false;}finally{nativeFsRecovery=false;}}
  const fs=document.fullscreenElement;if(fs&&fs.tagName!=='VIDEO')fs.append(host);
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
 $('transcript-open').onclick=()=>{$('transcript').hidden=!$('transcript').hidden;if(!$('transcript').hidden){onCollapse();signature='';updateTranscript();}};
 $('transcript-close').onclick=()=>{$('transcript').hidden=true;};
 $('transcript-follow').onclick=()=>{following=!following;$('transcript-follow').setAttribute('aria-pressed',String(following));$('transcript-follow').textContent=following?'跟随':'自由浏览';signature='';};
 function updateTranscript(){
  if($('transcript').hidden)return;const cues=getCues(),video=getVideo(),time=video?getClock(video.currentTime):0;
  const index=cues.findIndex(c=>c.start<=time&&c.end>time),start=following?Math.max(0,index-20):0;
  // A bounded moving window in follow mode, full loaded list in browse mode.
  const shown=following?cues.slice(start,start+80):cues;
  const sig=JSON.stringify([getCourse(),$('mode').value,following,start,shown.map(c=>[c.start,c.original,$('mode').value==='both'?translate(c):''])]);
  const list=$('transcript-list');
  if(sig!==signature){signature=sig;const old=list.scrollTop;list.replaceChildren();if(!shown.length)list.textContent='请先打开课堂右侧“语音识别”，加载字幕后会显示在这里。';
   for(const c of shown){const b=document.createElement('button');b.className='transcript-cue';b.dataset.time=c.start;const t=document.createElement('small');t.textContent=new Date(Math.max(0,c.start)*1000).toISOString().slice(11,19);b.append(t,document.createTextNode(c.original));if($('mode').value==='both'){const tr=document.createElement('em');tr.textContent=translate(c);b.append(tr);}b.onclick=()=>seek(getSeekTime(c.start));list.append(b);}list.scrollTop=old;
  }
  const cue=cues[index];for(const b of list.children)b.setAttribute('aria-current',String(cue&&Number(b.dataset.time)===cue.start));
  if(following&&cue!==lastCue)list.querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest'});lastCue=cue;
 }
 function update(){
  const video=getVideo();
  if(video!==current){if(current){current.removeAttribute('data-zy-enhanced');if(current.requestFullscreen===method){if(ownMethod)Object.defineProperty(current,'requestFullscreen',ownMethod);else delete current.requestFullscreen;}}current=video;
   if(video){video.dataset.zyEnhanced='true';ownMethod=Object.getOwnPropertyDescriptor(video,'requestFullscreen');method=()=>enterFullscreen();try{video.requestFullscreen=method;}catch{}}
  }
  const local=getLocal(),localVideo=local?.video;const next=localVideo?.isConnected?playerRoot(localVideo):null;if(controlRoot!==next){controlRoot?.removeAttribute('data-zy-local-player');controlRoot=next;controlRoot?.setAttribute('data-zy-local-player','true');}
  if(localVideo?.isConnected)localVideo.controls=true;
  $('cache-transport').hidden=true;
  updateTranscript();
 }
 return{update,toggleFullscreen,enterFullscreen};
}
if(typeof module!=='undefined'&&module.exports)module.exports={isEditing};else root.ZYPlayerInteractions={mount};
})(typeof globalThis!=='undefined'?globalThis:this);
