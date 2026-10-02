/* Learning workspace UI. Inlined into the installable userscript by build-userscript.cjs. */
(function(root){
'use strict';
function mount({shadow,mascot}){
 const $=id=>shadow.getElementById(id),style=document.createElement('style');
 style.textContent=`
 :host{color:#233954}button{color:#214f81;border-color:#d8e4f0}button:hover{background:#edf4ff}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline-color:#347acd}
 #panel{background:#fffefa;border-color:#dfe7ef;width:350px;box-shadow:0 18px 64px #112e572b;border-radius:22px}#panel-head{background:linear-gradient(125deg,#eaf3ff 10%,#fff8dc);padding:16px 14px 14px;gap:9px}
 .mascot{background:#fff;border:1px solid #fff1b0;border-radius:14px;overflow:hidden;width:46px;height:46px}.mascot img{width:44px;height:44px;object-fit:contain}
 .subtitle{color:#5b7190;font-size:10px;white-space:nowrap}h3{color:#174d8c;font-size:18px;letter-spacing:.3px}.primary{background:#215da1;border-color:#215da1}.primary:hover{background:#174d8c}.section{border-color:#e0e9f4}p{color:#65778b;line-height:1.6}
 #settings-open,#collapse{padding:4px 5px;border:0;background:transparent;font-size:17px;min-width:26px}#settings-open{margin-left:auto}#collapse{margin-left:0}input[type=checkbox],progress{accent-color:#2969ad}
 #compact{top:16px}
 #panel-body{padding:2px 16px 7px}#study-caption{padding:9px 0 11px;border:0;display:grid;grid-template-columns:1fr auto;gap:0 10px;align-items:center}#study-caption>label{margin:0;justify-content:flex-start;gap:12px}#study-caption select{max-width:none;flex:1;background:#fff;border-color:#dce6f1;font-size:12px;padding:7px}#study-caption .study-switch{width:28px;justify-content:center}#enabled{width:17px;height:17px;margin:0}#translation-status{grid-column:1 / -1;font-size:10px;margin:5px 0 0;color:#667b92;line-height:1.45;max-height:29px;overflow:auto}#translation-status:empty{display:none}
 #study-actions{display:grid;grid-template-columns:1fr 92px;gap:8px}#study-actions button{padding:11px 9px;font-size:13px;font-weight:600;border-radius:12px}#ai-open{background:#215da1;color:#fff;border-color:#215da1;box-shadow:0 5px 13px #215da11c}#ai-open:hover{background:#164d8c}#ai-capture{background:#fff7db;border-color:#eee3bd;color:#6a5a2f}#study-tools{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin:8px 0 5px}#study-tools button{background:transparent;border:0;padding:7px 2px;font-size:11px;white-space:nowrap;color:#4f6b89}#study-tools button:hover{background:#eef4fc}#study-cache{padding:8px 0 5px;border-top:1px solid #e3eaf1;border-bottom:0}#study-cache>summary{font-size:12px;color:#4f6b89;font-weight:500;padding:3px 0}#study-cache[open]>summary{margin-bottom:9px;color:#214f81}#cache-download{width:100%;background:#e9f2ff;border-color:#d2e3f8;font-weight:600}#study-cache p{font-size:11px}#settings-shortcut{margin-top:10px;width:100%;font-size:11px;background:transparent;border-style:dashed}#study-tip{margin:0}#study-feedback{font-size:11px;line-height:1.5;color:#805f16;background:#fff5d6;padding:8px;border-radius:8px;margin:5px 0}
 #settings-dialog{z-index:90;pointer-events:auto;position:fixed;inset:0;display:grid;place-items:center;background:#0c254c65;padding:20px}
 #settings-card{width:min(800px,100%);height:min(690px,calc(100dvh - 40px));display:flex;flex-direction:column;background:#f9fbff;border:1px solid #d8e5f5;border-radius:22px;box-shadow:0 24px 90px #051a5060;overflow:hidden;font-size:13px}
 #settings-card header{display:flex;align-items:center;padding:18px 22px;border-bottom:1px solid #dde7f2;gap:10px;background:linear-gradient(120deg,#edf4ff,#fff9e6)}#settings-close{margin-left:auto}
 #settings-layout{display:grid;grid-template-columns:155px minmax(0,1fr);min-height:0;flex:1}#settings-nav{padding:18px 10px;display:flex;flex-direction:column;gap:7px;border-right:1px solid #dde7f2;background:#f0f5fc}
 #settings-nav button{text-align:left;border:0;background:transparent}#settings-nav button[aria-selected=true],#settings-nav button[aria-selected=true]:hover,#settings-nav button[aria-selected=true]:focus{background:#215da1!important;color:#fff!important}
 #settings-content{padding:22px;overflow:auto;overscroll-behavior:contain}#settings-content h4{margin:0 0 8px;font-size:17px;color:#214d80}#settings-content .section{padding:12px 0}
 #settings-content input:not([type=checkbox]),#settings-content select{max-width:250px}#settings-content textarea{font:inherit;border:1px solid #d6e3f2;border-radius:10px;padding:10px;width:100%;resize:vertical;min-height:75px}
 #transcript{z-index:25;pointer-events:auto;position:fixed;right:16px;top:70px;bottom:86px;width:min(330px,35vw);display:flex;flex-direction:column;background:#f7fafff5;border:1px solid #d5e4f5;border-radius:18px;box-shadow:0 10px 36px #07214430;overflow:hidden;font-size:13px}
 #transcript header{display:flex;gap:5px;align-items:center;padding:12px;border-bottom:1px solid #dce7f3}#transcript header strong{margin-right:auto}#transcript header button{padding:5px 8px}#transcript-list{overflow:auto;padding:10px;scrollbar-width:thin}
 .transcript-cue{display:block;text-align:left;width:100%;border:0;background:transparent;padding:12px;margin-bottom:3px;line-height:1.6}.transcript-cue[aria-current=true]{background:#e1edff;color:#174d8c}.transcript-cue small{display:block;color:#6080a2}.transcript-cue em{display:block;font-style:normal;color:#5d6f89;margin-top:5px}
 #fullscreen-notice{position:fixed;z-index:60;bottom:22px;left:50%;transform:translateX(-50%);background:#fff4cd;padding:12px;border-radius:12px;pointer-events:auto}
 #cache-progress{width:100%;height:8px;display:block;margin:10px 0 5px}#cache-stage{display:block;color:#386a94;font-size:11px}#cache-progress-area{background:#edf4ff;padding:10px;border-radius:11px;margin:10px 0}
 @media(max-width:600px){#settings-dialog{padding:10px}#settings-card{height:calc(100dvh - 20px);border-radius:17px}#settings-card header{padding:14px}#settings-layout{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}#settings-nav{flex-direction:row;overflow:auto;padding:8px;border-right:0}#settings-nav button{white-space:nowrap}#settings-content{padding:14px}#settings-content input:not([type=checkbox]),#settings-content select{max-width:50%}#transcript{width:calc(100vw - 32px);top:100px}#panel{right:12px;max-height:calc(100dvh - 30px)}}`;
 shadow.append(style);
 const mascotEl=shadow.querySelector('.mascot');mascotEl.replaceChildren();const img=document.createElement('img');img.src=mascot;img.alt='求知小鹰';mascotEl.append(img);
 shadow.querySelector('#panel-head h3').textContent='浙大上课爽';shadow.querySelector('#panel-head .subtitle').textContent='网课不硬扛，浙大上课爽！';$('compact').textContent='🐥 上课爽';
 $('collapse').setAttribute('aria-label','收起上课爽');$('compact').setAttribute('aria-label','展开上课爽');
 $('collapse').insertAdjacentHTML('beforebegin','<button id="settings-open" aria-label="打开设置" title="设置">⚙</button>');
 $('slide-follow').insertAdjacentHTML('beforebegin','<button id="slide-explain">✦ 讲解这页</button>');
 $('stream-status').insertAdjacentHTML('beforebegin','<div id="cache-progress-area" hidden><progress id="cache-progress" max="100"></progress><span id="cache-stage" role="status"></span></div>');
 const captionSection=$('mode').closest('.section'),syncSection=$('auto-align').closest('.section'),layoutSection=$('show-slides').closest('.section'),cacheSection=$('cache-download').closest('details');
 const wrapper=document.createElement('div');wrapper.innerHTML=`<div id="settings-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="settings-title"><section id="settings-card"><header><div><h3 id="settings-title">按你的习惯来</h3><p>调好一次，安心开爽。</p></div><button id="settings-close" aria-label="关闭设置">✕</button></header><div id="settings-layout"><nav id="settings-nav" role="tablist" aria-label="设置分类"></nav><div id="settings-content"></div></div></section></div><aside id="transcript" hidden aria-label="课堂字幕列表"><header><strong>课堂字幕</strong><button id="transcript-follow" aria-pressed="true">跟随</button><button id="transcript-close" aria-label="关闭字幕列表">✕</button></header><div id="transcript-list"></div></aside><div id="fullscreen-notice" hidden><span>带上 PPT 和字幕一起全屏。</span><button id="fullscreen-recover">进入课堂全屏</button></div>`;
 shadow.append(...wrapper.childNodes);
 for(const [id,title] of [['translation','字幕与翻译'],['layout','画面与布局'],['sync','时间同步'],['ai','AI 讲解'],['storage','缓存与播放'],['connection','API 连接'],['about','关于上课爽']]){
  const b=document.createElement('button');b.dataset.settings=id;b.id='settings-tab-'+id;b.setAttribute('role','tab');b.setAttribute('aria-controls',id==='layout'?'settings-layout-panel':'settings-'+id);b.textContent=title;$('settings-nav').append(b);
  const p=document.createElement('section');p.id=id==='layout'?'settings-layout-panel':'settings-'+id;p.setAttribute('role','tabpanel');p.setAttribute('aria-labelledby',b.id);const h=document.createElement('h4');h.textContent=title;p.append(h);$('settings-content').append(p);
 }
 const prefs=$('configure-key').closest('details');prefs.open=true;prefs.querySelector('summary').firstChild.textContent='显示偏好 ';$('settings-translation').append(prefs);
 for(const id of ['configure-key','speech-key']){const b=$(id),label=b.previousElementSibling;$('settings-connection').append(label,b);}
 $('settings-connection').append($('key-summary'));$('settings-connection').insertAdjacentHTML('beforeend','<p>翻译和 AI 讲解共用豆包 API Key，语音校准使用独立凭证。Key 仅保存在本机油猴存储；已保存不代表接口权限已验证。</p>');
 for(const id of ['cache-progressive','cache-auto'])$('settings-storage').append($(id).closest('label'));
 for(const id of ['cache-folder','cache-default-folder','cache-location'])$('settings-storage').append($(id));
 $('settings-storage').insertAdjacentHTML('beforeend','<p>空格播放 / 暂停，← / → 前后 10 秒。输入文字时保留打字操作；PPT 聚焦时方向键翻页。</p>');
 $('settings-translation').insertAdjacentHTML('beforeend','<div class="section"><label>翻译方案<select id="translation-profile"><option value="context">术语增强 · 结合上下文</option><option value="economy">逐句省流</option></select></label><label>前后各参考句数<input id="translation-context-size" type="number" min="3" max="30" value="12"></label><label for="translation-domain">课程背景</label><textarea id="translation-domain" placeholder="例如：计算机体系结构，保持寄存器与指令集术语一致"></textarea><label for="translation-glossary">术语表 · 每行 原词 = 译法</label><textarea id="translation-glossary" placeholder="register = 寄存器"></textarea><p>增强翻译参考前后字幕与术语表；只输出当前句译文。</p></div>');
 $('settings-sync').append(syncSection);
 $('settings-sync').insertAdjacentHTML('beforeend','<p>字幕与 PPT 一起校准，适应课堂不同位置的时间漂移。</p><label>定时自动校准<input id="auto-sync" type="checkbox"></label><label>播放多久后复查<select id="sync-interval"><option value="120">2 分钟</option><option value="300" selected>5 分钟</option><option value="600">10 分钟</option></select></label><p id="sync-status" role="status"></p><p>手动微调立即停用自动校准，重新勾选才恢复。每次采集 12 秒视频音轨进行语音识别，可能产生费用。</p>');
 // Keep the existing controls and listeners; only their visual home changes.
 const layoutSettings=$('settings-layout-panel');
 for(const id of ['reset-ppt','slides-status','edit-layout','layout-editor'])layoutSettings.append($(id));
 $('settings-about').insertAdjacentHTML('beforeend','<p><strong>浙大上课爽 · v0.17.0</strong></p><p>网课不硬扛，浙大上课爽！</p><p>求是蓝与小黄鹰灵感的个人学习工具，非浙江大学官方产品。</p><p>当前使用你自己的 API 额度，尚未接入充值与支付。</p>');
 for(const p of prefs.querySelectorAll('p'))if(p.textContent.includes('翻译仅发送'))p.textContent='增强翻译参考前后字幕与术语表；语音校准仅采集视频音轨，不使用麦克风。导出前请加载完整字幕。';
 // A small daily workspace: captions, one primary action, and contextual tools.
 $('settings-translation').prepend($('translation-ready'));
 const modeLabel=$('mode').closest('label'),enabled=$('enabled'),status=$('translation-status');
 const enabledLabel=document.createElement('label');enabledLabel.className='study-switch';enabledLabel.title='显示字幕';enabledLabel.append(enabled);
 captionSection.id='study-caption';captionSection.replaceChildren(modeLabel,enabledLabel,status);
 $('mode').querySelector('[value="both"]').textContent='中英对照';
 const actionRow=document.createElement('div');actionRow.id='study-actions';actionRow.innerHTML='<button id="ai-open">✦ 讲解这页</button><button id="ai-capture">▧ 截图问</button>';
 const toolsRow=document.createElement('nav');toolsRow.id='study-tools';toolsRow.setAttribute('aria-label','课堂工具');toolsRow.innerHTML='<button id="transcript-open">☷ 字幕列表</button>';
 $('show-slides').textContent='▣ 看 PPT';$('focus-fullscreen').textContent='⛶ 课堂全屏';toolsRow.prepend($('show-slides'));toolsRow.append($('focus-fullscreen'));
 cacheSection.id='study-cache';cacheSection.open=false;
 const cacheIntro=cacheSection.querySelector(':scope > p');if(cacheIntro&&!cacheIntro.id)cacheIntro.remove();
 cacheSection.insertAdjacentHTML('beforeend','<button id="settings-shortcut">缓存偏好与位置 →</button>');
 const feedbackEl=document.createElement('p');feedbackEl.id='study-feedback';feedbackEl.hidden=true;feedbackEl.setAttribute('role','status');
 layoutSection.remove();$('panel-body').replaceChildren(captionSection,actionRow,toolsRow,feedbackEl,cacheSection);
 function feedback(text){feedbackEl.textContent=text||'';feedbackEl.hidden=!text;}
 let returnFocus=null;
 function tab(name){for(const b of $('settings-nav').children){const active=b.dataset.settings===name;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;const section=$('settings-content').querySelector('[aria-labelledby="'+b.id+'"]');section.hidden=!active;}}
 function open(name){returnFocus=shadow.activeElement||document.activeElement;if(name)tab(name);$('settings-dialog').hidden=false;$('settings-close').focus();}
 function close(){$('settings-dialog').hidden=true;returnFocus?.focus?.();}
 $('settings-open').onclick=()=>open();$('settings-shortcut').onclick=()=>open('storage');$('settings-close').onclick=close;
 $('settings-dialog').addEventListener('click',e=>{if(e.target===$('settings-dialog'))close();});
 $('settings-dialog').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Tab'){const all=[...$('settings-card').querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length&&el.tabIndex>=0),i=all.indexOf(shadow.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();all.at(-1)?.focus();}else if(!e.shiftKey&&i===all.length-1){e.preventDefault();all[0]?.focus();}}});
 for(const b of $('settings-nav').children){b.onclick=()=>tab(b.dataset.settings);b.addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=[...$('settings-nav').children],step=['ArrowDown','ArrowRight'].includes(e.key)?1:-1,next=tabs[(tabs.indexOf(b)+step+tabs.length)%tabs.length];tab(next.dataset.settings);next.focus();});}
 tab('translation');return{open,close,tab,feedback};
}
root.ZYStudyUI={mount};
})(typeof globalThis!=='undefined'?globalThis:this);
