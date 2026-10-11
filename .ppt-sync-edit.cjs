const fs=require('fs');let s=fs.readFileSync('zhiyun-subtitles.user.js','utf8');
function replace(a,b){if(!s.includes(a))throw Error('Missing '+a.slice(0,100));s=s.replace(a,b);}
replace('// @version      0.20.25','// @version      0.20.26');
replace("  function subtitleTime(videoTime, offset) { return videoTime - offset; }",`  // PPT records have their own clock; speech recognition offsets must not move slides.
  function pptPlaybackTime(videoTime, offset=0) { return videoTime-offset; }
  function pptOffsetForPage(videoTime, slideTime) {
    if(!Number.isFinite(videoTime)||!Number.isFinite(slideTime))return null;
    const offset=videoTime-slideTime;
    return Math.abs(offset)<=3600?offset:null;
  }
  function subtitleTime(videoTime, offset) { return videoTime - offset; }`);
replace('courseIdentity, slideTime, slideAt,','courseIdentity, slideTime, slideAt, pptPlaybackTime, pptOffsetForPage,');
replace('    #slide-thumbs-list{',`    #slide-ppt-sync{padding:8px 10px;border-bottom:1px solid #ffffff25;font-size:12px}
    #slide-ppt-sync label{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;margin:0}
    #slide-ppt-sync input{width:76px;max-width:50%;background:#222b26;color:#fff;border-color:#ffffff40;padding:4px}
    #slide-ppt-sync .actions{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
    #slide-ppt-sync button{padding:5px 6px;font-size:11px;background:transparent;color:#eee;border-color:#ffffff40}
    #ppt-sync-hint{color:#d4e5d9;font-size:11px;line-height:1.5;margin:4px 0 0}
    #slide-thumbs-list{`);
replace('</header><div id="slide-thumbs-list"',`</header><div id="slide-ppt-sync"><label>PPT 偏移（秒）<input id="ppt-offset" type="number" min="-3600" max="3600" step="0.5" value="0"></label><div class="actions"><button id="ppt-earlier">提前 1 秒</button><button id="ppt-later">延后 1 秒</button><button id="ppt-reset">归零</button></div><button id="ppt-align-page" title="老师刚切到这页时，选中这页再点击；在页面中途点击会使校准不准确。">这页刚开始 · 校准</button><p id="ppt-sync-hint" role="status">PPT 与字幕分别校准，正数延后，负数提前。</p></div><div id="slide-thumbs-list"`);
replace("  function syncSlide() {",`  let pptOffset=0;
  function pptOffsetKey() {return 'ppt-offset:'+courseIdentity(location.hash);}
  function loadPptOffset() {
    const saved=GM_getValue(pptOffsetKey(),0);pptOffset=Number.isFinite(saved)?Math.max(-3600,Math.min(3600,saved)):0;
    updatePptSyncHint();
  }
  function updatePptSyncHint(message='') {
    $('ppt-offset').value=Number(pptOffset.toFixed(2));
    $('ppt-sync-hint').textContent=message||('PPT 独立偏移 '+(pptOffset>0?'+':'')+Number(pptOffset.toFixed(2))+' 秒。正数延后，负数提前；字幕不受影响。');
    $('ppt-align-page').disabled=!splitVideo||!Number.isFinite(slideEntries[slideIndex]?.time);
  }
  function setPptOffset(offset,message='') {
    if(!Number.isFinite(offset))return;
    pptOffset=Math.max(-3600,Math.min(3600,offset));GM_setValue(pptOffsetKey(),pptOffset);updatePptSyncHint(message);syncSlide();
  }
  $('ppt-offset').addEventListener('input',()=>{if($('ppt-offset').value.trim()!=='')setPptOffset(Number($('ppt-offset').value));});
  $('ppt-earlier').onclick=()=>setPptOffset(pptOffset-1);
  $('ppt-later').onclick=()=>setPptOffset(pptOffset+1);
  $('ppt-reset').onclick=()=>setPptOffset(0);
  $('ppt-align-page').onclick=()=>{
    if(!splitVideo||!coursePptReady())return;
    const offset=pptOffsetForPage(splitVideo.currentTime,slideEntries[slideIndex]?.time);
    if(offset===null){updatePptSyncHint('这页没有有效时间或校准超出一小时，未修改偏移。');return;}
    slideFollowing=true;updateFollowButton();setPptOffset(offset,'已按这页开始时刻校准，偏移 '+Number(offset.toFixed(2))+' 秒，已恢复跟随老师。');saveSlideState();
  };
  function syncSlide() {`);
replace('slideAt(slideEntries,currentSubtitleTime(splitVideo.currentTime))','slideAt(slideEntries,pptPlaybackTime(splitVideo.currentTime,pptOffset))');
replace('    if(index>=0 && index!==slideIndex) {slideIndex=index;renderSlide();}', '    const target=index>=0?index:0;\n    if(target!==slideIndex && slideEntries.some(slide=>Number.isFinite(slide.time))) {slideIndex=target;renderSlide();}');
replace("updateSlideThumbs(); saveSlideState(); updateFollowButton();learning?.notifySlide();","updateSlideThumbs(); updatePptSyncHint(); saveSlideState(); updateFollowButton();learning?.notifySlide();");
replace('    const course=courseIdentity(location.hash);\n    const saved=', '    const course=courseIdentity(location.hash);\n    loadPptOffset();\n    const saved=');
replace('PPT 按视频时间自动翻页，沿用字幕偏移。手动翻页可暂停跟随。','PPT 按视频进度自动翻页，与字幕分别校准。左侧“选页”可调整 PPT 偏移；手动翻页暂停跟随。');
replace("'字幕 / PPT：同步偏移 0 秒'","'字幕：同步偏移 0 秒（PPT 单独校准）'");
replace('`字幕 / PPT ${offset', '`字幕 ${offset');
replace('已保存的同步点仍用于字幕和 PPT。','已保存的同步点仍用于字幕；PPT 单独校准。');
replace('      releaseVideo(); loadOffset(); loadTranslationPreferences();','      releaseVideo(); loadOffset(); loadPptOffset(); loadTranslationPreferences();');
fs.writeFileSync('zhiyun-subtitles.user.js',s);
for(const p of ['package.json','package-lock.json'])fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('"version": "0.20.25"','"version": "0.20.26"'));
let test=fs.readFileSync('ppt-thumbnails-ui.test.cjs','utf8').replace("values['subtitle-offset:'+key]=5;","values['subtitle-offset:'+key]=5;values['ppt-offset:'+key]=5;").replace('shared subtitle/PPT anchors','independent subtitle/PPT offsets');fs.writeFileSync('ppt-thumbnails-ui.test.cjs',test);
fs.writeFileSync('CHANGELOG.md','## 0.20.26（本地构建，待上线）\n\n- 修正 PPT 跟随直接套用字幕语音校准偏移的假设；PPT 默认按原视频进度，独立保存每课偏移。\n- 缩略图栏新增 PPT 提前、延后、归零及“这页刚开始”校准；校准不修改字幕或视频进度，并恢复跟随。\n- 跟随状态下回退到首个时间戳之前时显示第一页，避免停留在之前浏览的远端页。\n\n'+fs.readFileSync('CHANGELOG.md','utf8'));
