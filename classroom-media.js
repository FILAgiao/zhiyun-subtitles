/* School classroom DOM adapters shared by replay and live lessons. */
(function(root){
'use strict';
function isClassroom(page){return page.hostname==='interactivemeta.cmc.zju.edu.cn'||(page.hostname==='classroom.zju.edu.cn'&&/^\/livingpage\/?$/.test(page.pathname));}
function voicePane(){return document.querySelector('#pane-voice')||document.querySelector('.spoken-language-body .voice-body_wrap');}
function voiceRows(element,parseTime){
 return [...(element?.querySelectorAll('.trans-item')||[])].map(row=>{
  const lines=row.querySelector('.trans-lan')?.children;
  return {start:parseTime(row.querySelector('.item-title,.item-time')?.textContent||''),original:(row.querySelector('.item-origin')?.textContent||lines?.[0]?.textContent||'').trim(),translation:(row.querySelector('[class*="item-tanslate-"]')?.textContent||lines?.[1]?.textContent||'').trim()};
 }).filter(row=>Number.isFinite(row.start)&&row.original);
}
const imageSelector='#pane-ppt img,.note-ppt_item img,.ppt-section-wrapper .ppt-item-wrapper img';
function imageURL(image){
 for(const raw of [image.getAttribute('data-src'),image.getAttribute('data-original'),image.currentSrc,image.getAttribute('src')]){
  if(!raw || (['loading','error'].includes(image.getAttribute('lazy')) && raw!==image.getAttribute('data-src') && raw!==image.getAttribute('data-original')))continue;try{const url=new URL(raw,document.baseURI);if(/^https?:$/.test(url.protocol))return url.href;}catch{}
 }return '';
}
function imageKey(url){try{const u=new URL(url);return u.origin+u.pathname.replace(/\/s_([^/]+)$/,'/$1');}catch{return url;}}
function slides(parseTime){
 const replay=document.querySelector('#pane-ppt'),list=document.querySelector('.note-scroll_body'),current=document.querySelector('.ppt-section-wrapper .ppt-item-wrapper img');
 const images=[...document.querySelectorAll(imageSelector)],full=current?imageURL(current):'',entries=[];
 const rows=replay?[...replay.querySelectorAll('img')]:[...document.querySelectorAll('.note-ppt_item img')];
 for(const image of rows){let url=imageURL(image);if(!url)continue;if(full&&imageKey(url)===imageKey(full))url=full;
  const card=image.closest('.tab-ppt,.note-ppt_item');entries.push({url,time:parseTime((card?.querySelector('.time,.ppt_time')||card?.querySelector('.ppt_order'))?.textContent||''),image});
 }
 let activeIndex=-1;
 if(full){activeIndex=entries.findIndex(e=>imageKey(e.url)===imageKey(full));if(activeIndex<0&&!replay){activeIndex=entries.length;entries.push({url:full,time:null,image:current});}}
 if(activeIndex<0&&!replay)activeIndex=entries.findIndex(e=>{const mask=e.image.closest('.note-ppt_item')?.querySelector('.ppt_mask');return mask&&getComputedStyle(mask).display==='none';});
 return{element:replay||list||current?.parentElement||null,items:images,entries,activeIndex,signature:JSON.stringify(entries.map(e=>[e.url,e.time]))};
}
function isLive(video){return !!video&&(/(?:^|[\/#?&=])live(?:[\/?&=]|$)/i.test(location.hash+location.pathname)||(!Number.isFinite(video.duration)&&(!!video.srcObject||!!video.closest('.player-wrapper'))));}
function timeline(video){
 const live=isLive(video),ranges=[];
 if(live){try{for(let i=0;i<video.seekable.length;i++){const start=video.seekable.start(i),end=video.seekable.end(i);if(Number.isFinite(start)&&Number.isFinite(end)&&end>start)ranges.push([start,end]);}}catch{}}
 else if(Number.isFinite(video?.duration)&&video.duration>0)ranges.push([0,video.duration]);
 return{live,ranges,start:ranges[0]?.[0]||0,end:ranges.at(-1)?.[1]||0};
}
function seekTime(video,time){
 if(!Number.isFinite(time))return null;const {ranges}=timeline(video);if(!ranges.length)return null;
 let closest=null,distance=Infinity;
 for(const [start,end] of ranges){const value=Math.max(start,Math.min(Math.max(start,end-.05),time)),d=Math.abs(value-time);if(d<distance){closest=value;distance=d;}}
 return closest;
}
// A transformed live-player ancestor is the fixed containing block. Measure its
// actual scale and origin instead of treating its local CSS coordinates as screen coordinates.
function placeVideo(video,r){
 const values={position:'fixed',left:'0px',top:'0px',right:'auto',bottom:'auto',width:r.width+'px',height:r.height+'px',margin:'0','z-index':'20',transform:'none',translate:'none',rotate:'none',scale:'none','box-sizing':'border-box','min-width':'0','min-height':'0','max-width':'none','max-height':'none'};
 for(const [key,value] of Object.entries(values))video.style.setProperty(key,value,'important');
 const origin=video.getBoundingClientRect(),sx=origin.width/r.width||1,sy=origin.height/r.height||1;
 video.style.setProperty('width',r.width/sx+'px','important');video.style.setProperty('height',r.height/sy+'px','important');
 video.style.setProperty('left',(r.left-origin.left)/sx+'px','important');video.style.setProperty('top',(r.top-origin.top)/sy+'px','important');
}
root.ZYClassroomMedia={isClassroom,voicePane,voiceRows,slides,imageSelector,imageURL,isLive,timeline,seekTime,placeVideo,videoStyleKeys:['width','height','margin','margin-left','margin-top','margin-right','margin-bottom','position','left','top','right','bottom','z-index','object-fit','transform','translate','rotate','scale','box-sizing','min-width','min-height','max-width','max-height']};
})(typeof globalThis!=='undefined'?globalThis:this);
