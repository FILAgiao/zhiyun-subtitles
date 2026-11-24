/* Private screenshot library. Wheel/swipe handling stays inside the focused reader. */
'use strict';
(() => {
  const P=window.ZYPortal,$=id=>document.getElementById(id);
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const heading=document.querySelector('h1'),originalHeading=heading?.innerHTML;
  const lead=document.querySelector('.page-lead'),originalLead=lead?.innerHTML;
  const guest=$('study-guest'),guestTitle=guest.querySelector('h2'),guestCopy=guest.querySelector('p'),guestLogin=guest.querySelector('[data-login]');
  const textGuest=[guestTitle.textContent,guestCopy.innerHTML,guestLogin.textContent];
  const clipsGuest=['把课堂截图留在自己的账号里。','登录后查看你主动收藏的截图与批注。','登录查看收藏'];
  const tabs=el('nav',undefined,'study-tabs');tabs.setAttribute('aria-label','学习记录分类');
  tabs.innerHTML='<button type="button" id="study-text-tab">我的问答</button><button type="button" id="study-clips-tab">随意摘 · 收藏夹</button>';
  $('study-guest').before(tabs);
  const section=el('section');section.id='clips-workspace';section.hidden=true;
  section.innerHTML='<div class="clip-intro"><div><p class="eyebrow">留住这一刻的理解</p><h2>收藏夹</h2></div><button type="button" id="clips-resume" class="button subtle" disabled>继续上次阅读</button><button type="button" id="clips-refresh" class="button subtle">刷新收藏</button></div><div class="clip-filters"><label>搜索收藏<input id="clips-search" type="search" placeholder="标题、课程或笔记"></label><label>课程<select id="clips-course"><option value="">全部课程</option></select></label><label>保存日期<input id="clips-date" type="date"></label><label class="clip-name-toggle"><input id="clips-show-name" type="checkbox" checked> 显示名称</label></div><p id="clips-status" role="status" aria-live="polite"></p><div id="clips-grid" class="clips-grid" aria-label="收藏画廊" aria-busy="false"></div><p class="data-note">点击截图中的「收藏」才会上传图片和批注。仅本人可见；删除会移除账号中的图片和缩略图。本机问答与已下载图片保留。</p>';
  $('study-workspace').after(section);
  const reader=el('dialog');reader.id='clip-reader';reader.setAttribute('aria-labelledby','clip-reader-title');
  reader.innerHTML='<header class="clip-reader-head"><div><p id="clip-reader-course" class="eyebrow"></p><h2 id="clip-reader-title"></h2></div><button type="button" id="clip-close" class="button subtle" aria-label="关闭图片阅读器">×</button></header><div class="clip-course-nav"><button type="button" id="clip-prev-course" class="button subtle">← 上门课</button><select id="clip-reader-courses" aria-label="切换课程"></select><button type="button" id="clip-next-course" class="button subtle">下门课 →</button></div><div id="clip-stage" tabindex="0" role="region" aria-label="图片阅读区：左右切换课程，上下切换图片"><img id="clip-full-image" alt="" decoding="async"><p id="clip-image-status" role="status"></p></div><div class="clip-image-nav"><button type="button" id="clip-prev" class="button subtle">↑ 上一张</button><span id="clip-position" aria-live="polite"></span><button type="button" id="clip-next" class="button subtle">↓ 下一张</button><button type="button" id="clip-zoom" class="button subtle">放大</button></div><div class="clip-reader-note"><p id="clip-note"></p><div class="clip-links"><span id="clip-time"></span><a id="clip-origin" target="_blank" rel="noopener noreferrer">回到来源 ↗</a><button type="button" id="clip-delete" class="text-link danger">删除收藏</button></div></div><footer class="clip-reader-footer"><label><input type="checkbox" id="clip-axes" checked> 双向切换</label><span>图片区：左右换课程，上下连续翻图；笔记正常滚动。</span></footer>';
  document.body.append(reader);
  const zoom=el('dialog');zoom.id='clip-zoom-dialog';zoom.innerHTML='<div class="clip-zoom-toolbar"><button type="button" id="clip-zoom-out" class="button subtle" aria-label="缩小图片">−</button><button type="button" id="clip-zoom-reset" class="button subtle" aria-label="恢复适合屏幕">100%</button><button type="button" id="clip-zoom-in" class="button subtle" aria-label="放大图片">＋</button><button type="button" id="clip-zoom-close" class="button subtle">关闭大图</button></div><div id="clip-zoom-viewport" tabindex="0" aria-label="大图，可滚动查看，滚轮缩放"><img id="clip-zoom-image" alt="收藏完整图片"></div><p class="clip-zoom-hint">滚轮或按钮缩放，放大后滚动查看 · 100% 为适合屏幕</p>';document.body.append(zoom);
  const deletion=el('dialog');deletion.id='clip-delete-dialog';deletion.innerHTML='<h2>删除这张收藏？</h2><p>账号中的截图、批注和缩略图会一并删除。已下载图片仍保留。</p><p id="clip-delete-status" role="status"></p><div class="dialog-actions"><button id="clip-delete-cancel" type="button" class="button subtle">保留</button><button id="clip-delete-confirm" type="button" class="button primary">确认删除</button></div>';document.body.append(deletion);
  let items=[],groups=[],courseIndex=0,imageIndex=0,generation=0,imageGeneration=0,loading=false,deleteBusy=false,lastFocused=null;
  const requestedClip=()=>{const id=new URL(location.href).searchParams.get('clip')||'';return /^[A-Za-z0-9_-]{1,100}$/.test(id)?id:'';};
  let positions={},pendingClip=requestedClip(),tab=pendingClip||location.hash==='#clips'?'clips':'text',refreshPending=false,returnTimer=null;
  const namePreference='zy-clips-show-name-v1';
  try{$('clips-show-name').checked=localStorage.getItem(namePreference)!=='false';}catch{}
  const owner=()=>P.session().token;
  const valid=(own,auth)=>own===generation&&auth===owner()&&!!P.session().profile;
  const memoryKey=()=> 'zy-clip-position-v1:'+String(P.session().profile?.email||P.session().profile?.username||'');
  const current=()=>groups[courseIndex]?.items[imageIndex];
  function classify(item){
    try{
      const source=new URL(item.origin);
      const classroom=source.hostname==='interactivemeta.cmc.zju.edu.cn'
        || (source.hostname==='classroom.zju.edu.cn'&&/^\/(?:livingpage|livingroom)\/?$/.test(source.pathname));
      if(!classroom&&['http:','https:'].includes(source.protocol))return {...item,groupKey:'web:all',groupTitle:'网页摘录'};
    }catch{}
    return {...item,groupKey:item.courseKey,groupTitle:item.course||'网页摘录'};
  }
  function resumeItem(){
    const id=positions.clipId||positions[positions.course];
    return groups.flatMap(group=>group.items).find(item=>item.id===id);
  }
  function adjacentImage(delta){
    const group=groups[courseIndex],index=imageIndex+delta;
    if(!group)return null;
    if(index>=0&&index<group.items.length)return {courseIndex,imageIndex:index};
    const nextCourse=courseIndex+delta,next=groups[nextCourse];
    return next?{courseIndex:nextCourse,imageIndex:delta>0?0:next.items.length-1}:null;
  }
  // Private originals live only in a bounded, account-scoped memory cache.
  const originals=new Map(),pendingImages=new Map();
  let cacheBytes=0,cacheEpoch=0,imageActive=0,imageQueue=[];
  const imageKey=item=>item.id+':'+item.updated;
  const thumbnailURLs=new Map(),thumbnailItems=new WeakMap();
  let thumbnailActive=0,thumbnailQueue=[];
  const thumbnailObserver=new IntersectionObserver(entries=>{
    for(const {target,isIntersecting} of entries){
      if(!isIntersecting)continue;
      thumbnailObserver.unobserve(target);
      target.parentElement.dataset.state='loading';
      thumbnailQueue.push(target);
    }
    runThumbnails();
  },{rootMargin:'160px'});
  function clearThumbnails(){
    thumbnailObserver.disconnect();
    thumbnailQueue=[];
    for(const url of thumbnailURLs.values())URL.revokeObjectURL(url);
    thumbnailURLs.clear();
  }
  function runThumbnails(){
    while(thumbnailActive<3&&thumbnailQueue.length){
      const img=thumbnailQueue.shift(),item=thumbnailItems.get(img),auth=owner();
      if(!img.isConnected||!auth||!P.session().profile)continue;
      thumbnailActive++;
      const path='/v1/study/clip-image?id='+encodeURIComponent(item.id)+'&format=png&variant=thumbnail';
      P.api(path,{auth,responseType:'blob'}).then(async blob=>{
        if(!img.isConnected||auth!==owner())return;
        if(blob.type!=='image/png'||!blob.size)throw Error('缩略图返回异常');
        const key=imageKey(item);
        const url=URL.createObjectURL(blob);
        try{
          img.src=url;
          await img.decode();
          if(!img.isConnected||auth!==owner())return;
          thumbnailURLs.set(key,url);
          img.parentElement.dataset.state='ready';
        }finally{if(thumbnailURLs.get(key)!==url)URL.revokeObjectURL(url);}
      }).catch(()=>{
        if(img.isConnected&&auth===owner()){
          img.removeAttribute('src');
          img.parentElement.dataset.state='error';
        }
      }).finally(()=>{thumbnailActive--;runThumbnails();});
    }
  }
  function forgetImage(key){const value=originals.get(key);if(!value)return;URL.revokeObjectURL(value.url);cacheBytes-=value.bytes;originals.delete(key);}
  function clearImages(){cacheEpoch++;for(const key of originals.keys())forgetImage(key);pendingImages.clear();for(const job of imageQueue)job.reject(new DOMException('Session changed','AbortError'));imageQueue=[];}
  function trimImages(){for(const key of originals.keys()){if(originals.size<=12&&cacheBytes<=18*1024*1024)break;if(current()&&key===imageKey(current()))continue;forgetImage(key);}}
  function runImageQueue(){
    while(imageActive<2&&imageQueue.length){
      const job=imageQueue.pop();
      if(job.epoch!==cacheEpoch||job.auth!==owner()||!P.session().profile||!reader.open||!current()||imageKey(current())!==job.key){job.reject(new DOMException('Image no longer selected','AbortError'));continue;}
      imageActive++;
      P.api('/v1/study/clip-image?id='+encodeURIComponent(job.item.id)+'&format=png',{auth:job.auth,responseType:'blob'}).then(blob=>{
        if(job.epoch!==cacheEpoch||job.auth!==owner()||!P.session().profile)throw new DOMException('Session changed','AbortError');
        if(!(blob instanceof Blob)||blob.type!=='image/png'||!blob.size)throw Error('图片返回异常');
        const value={url:URL.createObjectURL(blob),bytes:blob.size};originals.set(job.key,value);cacheBytes+=value.bytes;trimImages();job.resolve(value.url);
      }).catch(job.reject).finally(()=>{imageActive--;runImageQueue();});
    }
  }
  function originalImage(item,auth){
    const key=imageKey(item),cached=originals.get(key);if(cached){originals.delete(key);originals.set(key,cached);return Promise.resolve(cached.url);}
    if(pendingImages.has(key))return pendingImages.get(key);
    const promise=new Promise((resolve,reject)=>{imageQueue.push({item,key,auth,epoch:cacheEpoch,resolve,reject});runImageQueue();});
    pendingImages.set(key,promise);promise.finally(()=>{if(pendingImages.get(key)===promise)pendingImages.delete(key);}).catch(()=>{});return promise;
  }
  function loadingCards(){
    clearThumbnails();
    $('clips-grid').replaceChildren();
    for(let n=0;n<4;n++){const card=el('div',undefined,'clip-skeleton');card.setAttribute('aria-hidden','true');card.innerHTML='<span class="clip-skeleton-image"></span><span class="clip-skeleton-line"></span>';$('clips-grid').append(card);}
  }
  function remember(){const item=current();if(!item)return;positions.clipId=item.id;positions[item.groupKey]=item.id;try{sessionStorage.setItem(memoryKey(),JSON.stringify(positions));}catch{}}
  function close(){imageGeneration++;reader.close();zoom.close();deletion.close();$('clip-full-image').removeAttribute('src');$('clip-zoom-image').removeAttribute('src');$('clip-stage').removeAttribute('data-state');$('clip-stage').setAttribute('aria-busy','false');lastFocused?.focus();if(refreshPending)scheduleReturnRefresh();}
  function showTab(value){
    tab=value;
    const viewingClips=tab==='clips';
    P.markPage(viewingClips?'clips':'study');
    document.title=(viewingClips?'随意摘':'我的问答')+' · 浙大上课爽';
    if(heading){
      if(viewingClips)heading.replaceChildren(document.createTextNode('随意'),el('em','摘。'));
      else heading.innerHTML=originalHeading;
    }
    if(lead){
      if(viewingClips)lead.textContent='收藏截图和批注，按课程回看。';
      else lead.innerHTML=originalLead;
    }
    const [title,copy,login]=viewingClips?clipsGuest:textGuest;
    guestTitle.textContent=title;
    guestCopy.innerHTML=copy;
    guestLogin.textContent=login;
    const signed=!!P.session().profile;
    $('study-text-tab').setAttribute('aria-current',String(!viewingClips));
    $('study-clips-tab').setAttribute('aria-current',String(viewingClips));
    $('study-workspace').hidden=!signed||viewingClips;
    section.hidden=!signed||!viewingClips;
    if(viewingClips&&signed&&!loading)load({keepVisible:items.length>0});
  }
  function filters(){const q=$('clips-search').value.trim().toLocaleLowerCase(),course=$('clips-course').value,date=$('clips-date').value;return items.filter(item=>(!q||(item.title+' '+item.course+' '+item.groupTitle+' '+item.note).toLocaleLowerCase().includes(q))&&(!course||item.groupKey===course)&&(!date||new Date(item.created).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})===date));}
  function render({keepVisible=false}={}){
    const filtered=filters(),grid=$('clips-grid'),cards=[];
    const previous=new Map();
    if(keepVisible){
      for(const card of grid.querySelectorAll('.clip-card'))previous.set(card.dataset.clipId,card);
    }else{
      clearThumbnails();
      grid.replaceChildren();
    }
    const showName=$('clips-show-name').checked;
    for(const item of filtered){
      const key=imageKey(item),existing=previous.get(item.id);
      if(existing&&existing.dataset.imageKey===key&&existing.querySelector('.clip-card-frame').dataset.state!=='error'){
        previous.delete(item.id);
        cards.push(existing);
        continue;
      }
      const card=el('button',undefined,'clip-card');card.type='button';card.dataset.clipId=item.id;card.dataset.imageKey=key;card.setAttribute('aria-label','查看收藏：'+item.title+' · '+(item.course||'网页摘录'));
      const frame=el('span',undefined,'clip-card-frame');frame.dataset.state='pending';const img=el('img');img.alt=item.title;img.decoding='async';if(item.width&&item.height){img.width=item.width;img.height=item.height;}frame.append(img);const hint=el('span','打开图片 ↗','clip-card-open');hint.setAttribute('aria-hidden','true');frame.append(hint);
      const caption=el('span',undefined,'clip-card-caption'),details=[item.course||'网页摘录',P.date(item.created),item.position,item.note?.replace(/\s+/g,' ')].filter(Boolean).join(' · ');
      if(showName){const name=el('strong',item.title,'clip-card-title');name.title=item.title;caption.append(name);}
      const meta=el('small',details,'clip-card-meta');meta.title=details;caption.append(meta);card.append(frame,caption);card.onclick=()=>open(item.id,card);cards.push(card);
      if(item.thumbnail){
        frame.dataset.state='loading';
        img.loading=cards.length<=2?'eager':'lazy';
        img.addEventListener('load',()=>{frame.dataset.state='ready';},{once:true});
        img.addEventListener('error',()=>{frame.dataset.state='error';},{once:true});
        img.src=item.thumbnail;
      }
      else{thumbnailItems.set(img,item);thumbnailObserver.observe(img);}
    }
    for(const card of previous.values()){
      thumbnailObserver.unobserve(card.querySelector('img'));
      const key=card.dataset.imageKey,url=thumbnailURLs.get(key);
      if(url){URL.revokeObjectURL(url);thumbnailURLs.delete(key);}
      card.remove();
    }
    grid.querySelector('.clip-empty')?.remove();
    // Keep connected cards (and their decoded images) attached during a refresh.
    let next=grid.firstElementChild;
    for(const card of cards){
      if(card===next)next=next.nextElementSibling;
      else grid.insertBefore(card,next);
    }
    if(!filtered.length){const empty=el('div',undefined,'clip-empty');empty.append(el('h3',items.length?'没有找到相关收藏':'还没有收藏的截图'),el('p',items.length?'试试其他关键词或清除日期筛选。':'回到插件，截图后点击「收藏」。不用先问 AI，手机登录同一账号即可回看。'));grid.append(empty);}
    $('clips-status').textContent=(filtered.length?'已显示 '+filtered.length+' 张 · ':'')+'图片仅本人可见';
    groups=[];for(const item of filtered.slice().sort((a,b)=>a.created-b.created||a.id.localeCompare(b.id))){let group=groups.find(g=>g.key===item.groupKey);if(!group){group={key:item.groupKey,title:item.groupTitle,items:[]};groups.push(group);}group.items.push(item);}
    $('clips-resume').disabled=!resumeItem();
  }
  function revealRequestedClip(){
    if(!pendingClip||tab!=='clips')return;
    const item=items.find(i=>i.id===pendingClip);
    if(!item){$('clips-status').textContent='当前账号未找到这张收藏。请确认插件与网页使用同一账号，或点击刷新重试。';return;}
    pendingClip='';$('clips-search').value='';$('clips-date').value='';$('clips-course').value='';render();
    open(item.id,Array.from($('clips-grid').children).find(card=>card.dataset.clipId===item.id)||$('clips-refresh'));
  }
  function scheduleReturnRefresh(){
    if(tab!=='clips'||!P.session().profile||document.visibilityState==='hidden')return;
    clearTimeout(returnTimer);
    if(reader.open){refreshPending=true;return;}
    returnTimer=setTimeout(()=>{returnTimer=null;if(tab!=='clips'||!P.session().profile||document.visibilityState==='hidden')return;if(reader.open||loading){refreshPending=true;return;}refreshPending=false;load({keepVisible:true});},150);
  }
  async function load({keepVisible=false}={}){
    if(!P.session().profile||loading)return;const own=++generation,auth=owner();loading=true;refreshPending=false;$('clips-refresh').disabled=true;$('clips-status').textContent='正在读取收藏…';$('clips-grid').setAttribute('aria-busy','true');if(!keepVisible){items=[];loadingCards();}
    try{let offset=0,all=[];while(true){const data=await P.api('/v1/study/clips?thumbnails=0&limit=50&offset='+offset,{auth});if(!valid(own,auth))return;if(!Array.isArray(data.items))throw Error('收藏列表返回异常，请重试。');all.push(...data.items.map(classify));if(data.next_offset===null||data.next_offset===undefined)break;if(!keepVisible&&!reader.open&&offset===0){items=all.slice(0,500);render();$('clips-status').textContent='已读取 '+items.length+' 张 · 正在整理收藏…';}if(!Number.isSafeInteger(data.next_offset)||data.next_offset<=offset||all.length>=500)throw Error('收藏分页异常，请重试。');offset=data.next_offset;}
      if(!valid(own,auth))return;if(reader.open){refreshPending=true;return;}items=all.slice(0,500);const liveKeys=new Set(items.map(imageKey));for(const key of originals.keys())if(!liveKeys.has(key))forgetImage(key);const old=$('clips-course').value,oldName=$('clips-course').selectedOptions[0]?.textContent;$('clips-course').replaceChildren(new Option('全部课程',''));const courses=new Map(items.map(i=>[i.groupKey,i.groupTitle]));for(const [key,name] of courses)$('clips-course').append(new Option(name,key));if(old){if(!courses.has(old))$('clips-course').append(new Option(oldName||old,old));$('clips-course').value=old;}render({keepVisible});revealRequestedClip();
    }catch(error){if(error.name!=='AbortError'&&valid(own,auth)){if(!items.length)$('clips-grid').replaceChildren();$('clips-status').textContent=error.message+' 可点击刷新重试。';}}
    finally{if(own===generation){loading=false;$('clips-grid').setAttribute('aria-busy','false');$('clips-refresh').disabled=false;if(refreshPending&&!reader.open)scheduleReturnRefresh();}}
  }
  async function draw(){
    const item=current();if(!item){close();return;}remember();const own=++imageGeneration,auth=owner(),listGeneration=generation;
    $('clip-reader-course').textContent=groups[courseIndex].title;$('clips-resume').disabled=false;$('clip-reader-title').textContent=item.title;$('clip-note').textContent=item.note||'这张截图还没有笔记。';$('clip-time').textContent=P.date(item.created)+(item.position?' · 课程 '+item.position:'');
    $('clip-reader-courses').replaceChildren(...groups.map((g,i)=>new Option(g.title,String(i))));$('clip-reader-courses').value=String(courseIndex);
    $('clip-position').textContent=(imageIndex+1)+' / '+groups[courseIndex].items.length;$('clip-prev').disabled=!adjacentImage(-1);$('clip-next').disabled=!adjacentImage(1);$('clip-prev-course').disabled=courseIndex===0;$('clip-next-course').disabled=courseIndex===groups.length-1;
    $('clip-origin').hidden=true;try{const u=new URL(item.origin);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password){$('clip-origin').href=u.href;$('clip-origin').hidden=false;}}catch{}
    const stage=$('clip-stage'),img=$('clip-full-image');
    const preview=item.thumbnail||thumbnailURLs.get(imageKey(item));
    const selected=()=>own===imageGeneration&&valid(listGeneration,auth);
    let hasPreview=false;
    stage.dataset.state='loading';stage.setAttribute('aria-busy','true');img.hidden=true;img.alt=item.title;$('clip-zoom').disabled=true;$('clip-image-status').replaceChildren(el('span','正在加载清晰图片…'));
    if(preview){
      img.src=preview;
      img.decode().then(()=>{
        if(!selected()||img.getAttribute('src')!==preview)return;
        hasPreview=true;
        img.hidden=false;
      }).catch(()=>{});
    }else img.removeAttribute('src');
    try{
      const url=await originalImage(item,auth);if(!selected())return;
      // Decode separately: a late decode can never overwrite a newer selection.
      const decoded=new Image();decoded.src=url;try{await decoded.decode();}catch(error){if(originals.get(imageKey(item))?.url===url)forgetImage(imageKey(item));throw error;}if(!selected())return;
      img.src=url;img.hidden=false;stage.dataset.state='ready';stage.setAttribute('aria-busy','false');$('clip-image-status').textContent='';$('clip-zoom').disabled=false;
    }catch(error){if(error.name!=='AbortError'&&selected()){
      stage.dataset.state='error';stage.setAttribute('aria-busy','false');$('clip-image-status').replaceChildren(el('span',hasPreview?'清晰图片加载失败，已保留预览。':'清晰图片加载失败。'));const retry=el('button','重新加载','button subtle');retry.type='button';retry.onclick=draw;$('clip-image-status').append(retry);
    }}
  }

  function open(id,button){close();lastFocused=button;courseIndex=Math.max(0,groups.findIndex(g=>g.items.some(i=>i.id===id)));imageIndex=Math.max(0,groups[courseIndex]?.items.findIndex(i=>i.id===id)||0);reader.showModal();draw();$('clip-stage').focus();}
  function move(axis,delta){if(deletion.open||zoom.open)return false;if(axis==='x'){const next=courseIndex+delta;if(next<0||next>=groups.length)return false;courseIndex=next;imageIndex=Math.max(0,groups[next].items.findIndex(i=>i.id===positions[groups[next].key]));}else{const next=adjacentImage(delta);if(!next)return false;({courseIndex,imageIndex}=next);}draw();return true;}
  $('clip-prev').onclick=()=>move('y',-1);$('clip-next').onclick=()=>move('y',1);$('clip-prev-course').onclick=()=>move('x',-1);$('clip-next-course').onclick=()=>move('x',1);
  $('clip-reader-courses').onchange=()=>{const next=Number($('clip-reader-courses').value);courseIndex=next;imageIndex=Math.max(0,groups[next].items.findIndex(i=>i.id===positions[groups[next].key]));draw();};
  $('clip-close').onclick=close;reader.addEventListener('cancel',event=>{event.preventDefault();close();});
  let zoomScale=1;
  function applyZoom(){const img=$('clip-zoom-image'),view=$('clip-zoom-viewport');if(!img.naturalWidth||!img.naturalHeight)return;const fit=Math.min(view.clientWidth/img.naturalWidth,view.clientHeight/img.naturalHeight);img.style.width=(img.naturalWidth*fit*zoomScale)+'px';$('clip-zoom-reset').textContent=Math.round(zoomScale*100)+'%';$('clip-zoom-out').disabled=zoomScale<=0.5;$('clip-zoom-in').disabled=zoomScale>=4;}
  function changeZoom(value){zoomScale=Math.max(.5,Math.min(4,Math.round(value*100)/100));applyZoom();}
  $('clip-zoom').onclick=()=>{const img=$('clip-zoom-image');zoomScale=1;img.alt=current()?.title||'收藏完整图片';img.src=$('clip-full-image').src;zoom.showModal();applyZoom();$('clip-zoom-close').focus();};
  $('clip-zoom-image').addEventListener('load',applyZoom);window.addEventListener('resize',()=>{if(zoom.open)applyZoom();});
  $('clip-zoom-in').onclick=()=>changeZoom(zoomScale*1.25);$('clip-zoom-out').onclick=()=>changeZoom(zoomScale/1.25);$('clip-zoom-reset').onclick=()=>changeZoom(1);
  $('clip-zoom-viewport').addEventListener('wheel',event=>{if(event.ctrlKey)return;event.preventDefault();changeZoom(zoomScale*(event.deltaY<0?1.25:.8));},{passive:false});
  zoom.addEventListener('keydown',event=>{if(event.key==='+'||event.key==='='){event.preventDefault();changeZoom(zoomScale*1.25);}else if(event.key==='-'){event.preventDefault();changeZoom(zoomScale/1.25);}else if(event.key==='0'){event.preventDefault();changeZoom(1);}});
  $('clip-zoom-close').onclick=()=>zoom.close();zoom.addEventListener('close',()=>{$('clip-zoom-image').removeAttribute('src');$('clip-zoom-image').style.width='';});
  const stage=$('clip-stage');let wheelAxis='',wheelTotal=0,wheelLast=0,cooldown=0,touch=null;
  stage.addEventListener('wheel',event=>{if(!$('clip-axes').checked||event.ctrlKey||!reader.open)return;const x=event.deltaX,y=event.deltaY,axis=Math.abs(x)>Math.abs(y)*1.4?'x':Math.abs(y)>Math.abs(x)*1.4?'y':'';if(!axis)return;const now=performance.now(),amount=(axis==='x'?x:y)*(event.deltaMode===1?16:event.deltaMode===2?stage.clientHeight:1),delta=Math.sign(amount);const boundary=axis==='x'?(delta>0?courseIndex===groups.length-1:courseIndex===0):!adjacentImage(delta);if(boundary){wheelTotal=0;return;}event.preventDefault();if(now<cooldown)return;if(now-wheelLast>220||axis!==wheelAxis||Math.sign(wheelTotal)!==delta)wheelTotal=0;wheelAxis=axis;wheelLast=now;wheelTotal+=amount;if(Math.abs(wheelTotal)>=70){if(move(axis,delta))cooldown=now+450;wheelTotal=0;}},{passive:false});
  stage.addEventListener('keydown',event=>{const keys={ArrowLeft:['x',-1],ArrowRight:['x',1],ArrowUp:['y',-1],ArrowDown:['y',1]};if(keys[event.key]&&move(...keys[event.key]))event.preventDefault();});
  stage.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'||!$('clip-axes').checked||event.target.closest('button'))return;if(touch){touch=null;return;}touch={id:event.pointerId,x:event.clientX,y:event.clientY};stage.setPointerCapture(event.pointerId);});
  stage.addEventListener('pointerup',event=>{if(!touch||touch.id!==event.pointerId)return;const dx=event.clientX-touch.x,dy=event.clientY-touch.y;touch=null;if(Math.max(Math.abs(dx),Math.abs(dy))<64)return;if(Math.abs(dx)>Math.abs(dy)*1.4)move('x',dx<0?1:-1);else if(Math.abs(dy)>Math.abs(dx)*1.4)move('y',dy<0?1:-1);});stage.addEventListener('pointercancel',()=>touch=null);
  $('clip-axes').onchange=()=>stage.classList.toggle('natural-scroll',!$('clip-axes').checked);
  $('clip-delete').onclick=()=>{$('clip-delete-status').textContent='';deletion.showModal();};$('clip-delete-cancel').onclick=()=>deletion.close();
  $('clip-delete-confirm').onclick=async()=>{if(deleteBusy||!current())return;deleteBusy=true;$('clip-delete-confirm').disabled=true;const id=current().id,auth=owner(),own=generation;try{await P.api('/v1/study/clips?id='+encodeURIComponent(id),{method:'DELETE',auth});if(!valid(own,auth))return;items=items.filter(i=>i.id!==id);close();for(const key of originals.keys())if(key.startsWith(id+':'))forgetImage(key);render();}catch(error){if(error.name!=='AbortError'&&valid(own,auth))$('clip-delete-status').textContent=error.message;}finally{deleteBusy=false;$('clip-delete-confirm').disabled=false;}};
  $('study-text-tab').onclick=()=>{history.replaceState(null,'',location.pathname+location.search);showTab('text');};$('study-clips-tab').onclick=()=>{history.replaceState(null,'','#clips');showTab('clips');};window.addEventListener('hashchange',()=>showTab(location.hash==='#clips'?'clips':'text'));
  for(const id of ['clips-search','clips-course','clips-date'])$(id).addEventListener(id==='clips-search'?'input':'change',()=>{close();render();});
  $('clips-show-name').onchange=()=>{try{localStorage.setItem(namePreference,String($('clips-show-name').checked));}catch{}render();};$('clips-refresh').onclick=()=>{close();load();};$('clips-resume').onclick=()=>{const item=resumeItem();if(item)open(item.id,$('clips-resume'));};
  function sessionChanged(){generation++;imageGeneration++;clearImages();clearThumbnails();loading=false;$('clips-grid').setAttribute('aria-busy','false');refreshPending=false;clearTimeout(returnTimer);pendingClip=requestedClip();close();lastFocused=null;items=[];groups=[];positions={};$('clips-resume').disabled=true;$('clips-grid').replaceChildren();$('clips-status').textContent='';$('clips-search').value='';$('clips-date').value='';$('clips-course').replaceChildren(new Option('全部课程',''));try{positions=JSON.parse(sessionStorage.getItem(memoryKey())||'{}')||{};}catch{}showTab(tab);}
  window.addEventListener('focus',scheduleReturnRefresh);document.addEventListener('visibilitychange',scheduleReturnRefresh);window.addEventListener('pageshow',event=>{if(event.persisted)scheduleReturnRefresh();});
  window.addEventListener('portal-session-change',sessionChanged);P.ready.then(()=>showTab(tab));
})();
