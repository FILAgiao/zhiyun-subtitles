/* School classroom DOM adapters shared by replay and live lessons. */
(function(root){
'use strict';
function isClassroom(page){return page.hostname==='interactivemeta.cmc.zju.edu.cn'||(page.hostname==='classroom.zju.edu.cn'&&/^\/(?:livingpage|livingroom)\/?$/.test(page.pathname));}
function voicePane(){return document.querySelector('#pane-voice')||document.querySelector('.spoken-language-body .voice-body_wrap')||document.querySelector('.transform-wrapper .trans-list_wrap')||document.querySelector('.trans-contain');}
function voiceContent(element,parseTime){
 return [...(element?.querySelectorAll('.trans-item')||[])].map(row=>{
  const lines=row.querySelector('.trans-lan')?.children;
  // The shared livingroom/livingpage replay component renders the time as a
  // sibling before the text card. Only accept that immediate time element;
  // walking farther back would assign another caption's time to untimed rows.
  const previous=row.previousElementSibling;
  const time=row.querySelector('.item-title,.item-time')||(previous?.matches('.item-title,.item-time')?previous:null);
  return {element:row,start:parseTime(time?.textContent||''),original:(row.querySelector('.item-origin')?.textContent||lines?.[0]?.textContent||'').trim(),translation:(row.querySelector('[class*="item-tanslate-"]')?.textContent||lines?.[1]?.textContent||'').trim()};
 }).filter(row=>row.original);
}
function voiceRows(element,parseTime){return voiceContent(element,parseTime).filter(row=>Number.isFinite(row.start)).map(({element,...row})=>row);}
const imageSelector='#pane-ppt img,.note-ppt_item img,.ppt-section-wrapper .ppt-item-wrapper img';
function imageURL(image){
 for(const raw of [image.getAttribute('data-src'),image.getAttribute('data-original'),image.currentSrc,image.getAttribute('src')]){
  if(!raw || (['loading','error'].includes(image.getAttribute('lazy')) && raw!==image.getAttribute('data-src') && raw!==image.getAttribute('data-original')))continue;try{const url=new URL(raw,document.baseURI);if(/^https?:$/.test(url.protocol))return url.href;}catch{}
 }return '';
}
function imageKey(url){try{const u=new URL(url);return u.origin+u.pathname.replace(/\/s_([^/]+)$/,'/$1');}catch{return url;}}
function slides(parseTime){
 const replay=document.querySelector('#pane-ppt'),list=document.querySelector('.note-scroll_body');
 const thumbnail=[...document.querySelectorAll('.student-list .video-item')].find(card=>card.querySelector('.tag span')?.textContent.trim()==='PPT')?.querySelector('img');
 const current=[document.querySelector('.ppt-section-wrapper .ppt-item-wrapper img'),thumbnail].find(image=>image&&imageURL(image));
 const images=[...new Set([...document.querySelectorAll(imageSelector),current].filter(Boolean))],full=current?imageURL(current):'',entries=[];
 const rows=replay?[...replay.querySelectorAll('img')]:[...document.querySelectorAll('.note-ppt_item img')];
 for(const image of rows){let url=imageURL(image);if(!url)continue;if(full&&imageKey(url)===imageKey(full))url=full;
  const card=image.closest('.tab-ppt,.note-ppt_item');entries.push({url,time:['.time','.ppt_time','.ppt_order'].map(selector=>parseTime(card?.querySelector(selector)?.textContent||'')).find(Number.isFinite)??NaN,image});
 }
 let activeIndex=-1;
 if(full){activeIndex=entries.findIndex(e=>imageKey(e.url)===imageKey(full));if(activeIndex<0&&!replay){activeIndex=entries.length;entries.push({url:full,time:null,image:current});}}
 if(activeIndex<0&&!replay)activeIndex=entries.findIndex(e=>{const mask=e.image.closest('.note-ppt_item')?.querySelector('.ppt_mask');return mask&&getComputedStyle(mask).display==='none';});
 return{element:replay||list||current?.parentElement||null,items:images,entries,activeIndex,signature:JSON.stringify(entries.map(e=>[e.url,e.time]))};
}
function isLive(video){
 if(!video)return false;
 const route=location.hash+location.pathname,stream=video.closest('#stream-list-wrapper');
 const studentLive=/^#\/studentsrs(?:[/?]|$)/i.test(location.hash)&&stream&&getComputedStyle(stream).display!=='none';
 return /(?:^|[\/#?&=])live(?:[\/?&=]|$)/i.test(route)||!!video.srcObject||!!studentLive||(!Number.isFinite(video.duration)&&!!video.closest('.player-wrapper'));
}
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
function pairedLayout(bounds,videoRatio=16/9,slideRatio=4/3){
 const width=Math.max(160,Number(bounds.width)||160),height=Math.max(100,Number(bounds.height)||100),gap=Math.min(12,width*.02),lane=(width-gap)/2;
 const available={top:bounds.top||0,height:Math.max(100,height-76)};
 const fit=(left,ratio)=>{ratio=Number.isFinite(ratio)&&ratio>0?ratio:16/9;const w=Math.min(lane,available.height*ratio),h=w/ratio;return{left:left+(lane-w)/2,top:available.top+(available.height-h)/2,width:w,height:h};};
 return{slide:fit(bounds.left||0,slideRatio),video:fit((bounds.left||0)+lane+gap,videoRatio)};
}
function placeVideo(video,r){
 const values={position:'fixed',left:'0px',top:'0px',right:'auto',bottom:'auto',width:r.width+'px',height:r.height+'px',margin:'0','z-index':'20','object-fit':'contain',transform:'none',translate:'none',rotate:'none',scale:'none','box-sizing':'border-box','min-width':'0','min-height':'0','max-width':'none','max-height':'none'};
 for(const [key,value] of Object.entries(values))video.style.setProperty(key,value,'important');
 const origin=video.getBoundingClientRect(),sx=origin.width/r.width||1,sy=origin.height/r.height||1;
 video.style.setProperty('width',r.width/sx+'px','important');video.style.setProperty('height',r.height/sy+'px','important');
 video.style.setProperty('left',(r.left-origin.left)/sx+'px','important');video.style.setProperty('top',(r.top-origin.top)/sy+'px','important');
}
root.ZYClassroomMedia={isClassroom,voicePane,voiceContent,voiceRows,slides,imageSelector,imageURL,isLive,timeline,seekTime,pairedLayout,placeVideo,videoStyleKeys:['width','height','margin','margin-left','margin-top','margin-right','margin-bottom','position','left','top','right','bottom','z-index','object-fit','transform','translate','rotate','scale','box-sizing','min-width','min-height','max-width','max-height']};
})(typeof globalThis!=='undefined'?globalThis:this);
