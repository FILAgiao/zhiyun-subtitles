/* Shared appearance preferences. Does not touch playback, captions or saved chats. */
(function(root){
'use strict';
const key='appearance-theme';
const options=[['blue','经典蓝黄','清爽蓝色操作与淡黄色页眉。'],['warm','晨光橘红','橘红操作，页眉采用柔和的晨光渐变。'],['glass','苹果毛玻璃','轻透玻璃、细边框与柔和阴影。']];
let current='warm',storage=null;
const shadows=new Set();
const css=`
:host([data-zy-theme]){color-scheme:light}
.zy-theme-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}
.zy-theme-choice{display:flex!important;flex-direction:column;align-items:flex-start;gap:8px;padding:14px!important;min-width:0;text-align:left;white-space:normal;border:1px solid var(--zy-line);border-radius:14px;background:var(--zy-card);color:var(--zy-text)}
.zy-theme-choice[aria-pressed=true]{outline:2px solid var(--zy-accent);outline-offset:2px}
.zy-theme-choice small{font-size:11px;line-height:1.6;color:var(--zy-muted)}
.zy-theme-swatch{display:block;width:100%;height:46px;border:1px solid #ffffffbb;border-radius:9px;box-shadow:inset 0 0 0 1px #00000008}
.zy-theme-choice[data-theme=blue] .zy-theme-swatch{background:linear-gradient(120deg,#e8f2ff,#fff7d7)}
.zy-theme-choice[data-theme=warm] .zy-theme-swatch{background:linear-gradient(120deg,#fff8f0,#fff0b6)}
.zy-theme-choice[data-theme=glass] .zy-theme-swatch{background:linear-gradient(120deg,#fff0d4bb,#fffaf8cc,#dbe7ffbb);backdrop-filter:blur(12px)}
:host([data-zy-theme=warm]) #panel-head{background:linear-gradient(115deg,#fff9f2 0%,#fff6d8 65%,#fff0b8 100%)}
:host([data-zy-theme=warm]) #panel-head:before{opacity:0}
:host([data-zy-theme=blue]){--zy-bg:#F3F7FC;--zy-card:#FFFFFF;--zy-accent:#235FA2;--zy-accent-hover:#184B83;--zy-soft:#EAF2FC;--zy-text:#263C55;--zy-muted:#61738A;--zy-line:#DCE6F2;--zy-yellow:#FFD166}
:host([data-zy-theme=blue]) :is(#panel-head,#settings-card header,#web-settings-card header,.ai-head,#transcript header,#ai-questions header){background:linear-gradient(120deg,#eaf3ff,#fff8dd)}
:host([data-zy-theme=blue]) #panel-head:before{opacity:0}
:host([data-zy-theme=blue]) :is(#panel,#settings-card,#web-settings-card,#ai-learning,#ai-questions,#transcript){box-shadow:0 14px 46px #204a7b20}
:host([data-zy-theme=blue]) :is(#study-tools #show-slides,#study-tools #focus-fullscreen){background:#eef4fc;color:var(--zy-accent);border-color:var(--zy-line)}
:host([data-zy-theme=blue]) :is(#transcript-open:hover,#cache-details-toggle:hover){background:#dceaf9}
:host([data-zy-theme=blue]) #settings-dialog{background:#18304955}
:host([data-zy-theme=blue]) #ai-mode option{background:#fff;color:var(--zy-text)}
:host([data-zy-theme=glass]){--zy-bg:rgba(247,248,252,.16);--zy-card:rgba(255,255,255,.24);--zy-accent:#B94420;--zy-accent-hover:#973716;--zy-soft:rgba(255,238,222,.32);--zy-text:#29313D;--zy-muted:#465160;--zy-line:rgba(162,172,187,.30);--zy-yellow:#FFD166}
:host([data-zy-theme=glass]) :is(#panel,#settings-card,#web-settings-card,#ai-learning,#ai-questions,#transcript,#slides,.ai-prompt-card,#ai-crop.ai-crop-preview){background:linear-gradient(135deg,rgba(255,249,234,.42),rgba(255,255,255,.46) 42%,rgba(235,242,255,.40));border:1px solid rgba(255,255,255,.85);border-radius:22px;backdrop-filter:blur(12px) saturate(115%);-webkit-backdrop-filter:blur(12px) saturate(115%);box-shadow:0 16px 46px rgba(42,51,71,.16),inset 0 1px 0 #ffffffd9;color:var(--zy-text)}
:host([data-zy-theme=glass]) :is(#panel-head,#settings-card header,#web-settings-card header,.ai-head,#transcript header,#ai-questions header){background:linear-gradient(115deg,#fff9e830,#ffffff18);border-color:#ffffff99}
:host([data-zy-theme=glass]) #panel-head:before{opacity:0}
:host([data-zy-theme=glass]) :is(#settings-content,#settings-nav,#ai-learning #ai-log,#ai-learning .ai-toolbar,#ai-learning #ai-compose){background:rgba(255,255,255,.08);color:var(--zy-text)}
:host([data-zy-theme=glass]) :is(#study-caption,#study-sync[open],#cache-quick-details,#cache-progress-area,.quota-row,.ai-prompt-row,.social-accounts p){background:rgba(255,255,255,.20);border-color:rgba(255,255,255,.85)}
:host([data-zy-theme=glass]) :is(#ai-open,#web-ask,#ai-learning #ai-send,#ai-crop-send,#gateway-login){background:linear-gradient(115deg,#bd4228,#ca5024);border-color:#c64b2c;color:#fff;box-shadow:0 4px 12px #b840201a}
:host([data-zy-theme=glass]) :is(#ai-open:hover,#web-ask:hover,#ai-learning #ai-send:hover,#ai-crop-send:hover,#gateway-login:hover){background:var(--zy-accent-hover)}
:host([data-zy-theme=glass]) :is(#sync-toggle,#study-cache-quick #cache-download,#study-tools #show-slides,#study-tools #focus-fullscreen){background:rgba(255,255,255,.18);border:1px solid rgba(185,68,32,.28);color:var(--zy-accent);box-shadow:none}
:host([data-zy-theme=glass]) :is(#sync-toggle:hover,#study-cache-quick #cache-download:hover,#study-tools #show-slides:hover,#study-tools #focus-fullscreen:hover){background:rgba(255,235,219,.32)}
:host([data-zy-theme=glass]) :is(#transcript-open,#cache-details-toggle,#study-cache-quick #stream-play){background:rgba(255,255,255,.16);border-color:#ffffffd9;color:var(--zy-accent)}
:host([data-zy-theme=glass]) .ai-message[data-role=assistant]{background:#ffffffa8;color:var(--zy-text);border-color:#ffffffd9}
:host([data-zy-theme=glass]) .ai-message[data-role=user]{background:#fff1e4ad;color:var(--zy-text);border-color:#ffffffc9}
:host([data-zy-theme=glass]) #settings-dialog{background:rgba(32,41,57,.30)}
:host([data-zy-theme=glass]) #ai-mode option{background:#fff;color:var(--zy-text)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){:host([data-zy-theme=glass]) :is(#panel,#settings-card,#web-settings-card,#ai-learning,#ai-questions,#transcript,#slides,.ai-prompt-card,#ai-crop.ai-crop-preview){background:#f9fafc}}
@media(prefers-reduced-transparency:reduce){:host([data-zy-theme=glass]) :is(#panel,#settings-card,#web-settings-card,#ai-learning,#ai-questions,#transcript,#slides,.ai-prompt-card,#ai-crop.ai-crop-preview){background:#f9fafc;backdrop-filter:none;-webkit-backdrop-filter:none}}
@media(max-width:600px){.zy-theme-options{grid-template-columns:1fr}.zy-theme-choice{display:grid!important;grid-template-columns:56px 1fr;column-gap:12px}.zy-theme-swatch{grid-row:1/3}.zy-theme-choice small{grid-column:2}}
`;
function valid(value){return options.some(([id])=>id===value)?value:'warm';}
function refresh(){for(const shadow of shadows){shadow.host.dataset.zyTheme=current;for(const b of shadow.querySelectorAll('.zy-theme-choice'))b.setAttribute('aria-pressed',String(b.dataset.theme===current));}}
function configure(getValue,setValue){storage={getValue,setValue};current=valid(getValue(key,'warm'));refresh();}
function attach(shadow){if(!shadows.has(shadow)){shadows.add(shadow);const style=document.createElement('style');style.dataset.zyAppearance='';style.textContent=css;shadow.append(style);}refresh();}
function select(value){current=valid(value);storage?.setValue(key,current);refresh();}
function mountSettings(target){if(!target||target.querySelector('.zy-theme-options'))return;const note=document.createElement('p');note.textContent='选择后立即生效，并记住你的选择；主面板、问答和设置一起切换。';target.append(note);const group=document.createElement('div');group.className='zy-theme-options';group.setAttribute('role','group');group.setAttribute('aria-label','界面主题');for(const [id,title,description] of options){const b=document.createElement('button');b.type='button';b.className='zy-theme-choice';b.dataset.theme=id;const swatch=document.createElement('span');swatch.className='zy-theme-swatch';swatch.setAttribute('aria-hidden','true');const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('small');small.textContent=description;b.append(swatch,strong,small);b.onclick=()=>select(id);group.append(b);}target.append(group);refresh();}
root.ZYAppearance=Object.freeze({configure,attach,select,mountSettings,get:()=>current});
})(globalThis);
