/* Shared cream-orange palette for all assistant surfaces. */
(function(root){
 const css=`
:host{--zy-bg:#FFF8EF;--zy-card:#FFFFFF;--zy-accent:#C45221;--zy-accent-hover:#A94018;--zy-soft:#FDEBDD;--zy-text:#30343B;--zy-muted:#68717D;--zy-line:#EEDCCD;--zy-yellow:#FFD166;color:var(--zy-text)}
button,input,select,textarea{border-color:var(--zy-line);color:var(--zy-text);background:var(--zy-card)}
button:hover{background:var(--zy-soft);box-shadow:none}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--zy-accent);outline-offset:3px}input[type=checkbox],progress{accent-color:var(--zy-accent)}
#panel,#settings-card,#web-settings-card,#ai-learning,#ai-questions,#transcript{background:var(--zy-card);color:var(--zy-text);border:1px solid var(--zy-line);border-radius:20px;box-shadow:0 14px 46px #69391720}
#panel-head,#settings-card header,#web-settings-card header,.ai-head,#transcript header{background:linear-gradient(120deg,#FFF5E8,#FFFCF7);color:var(--zy-text);border-color:var(--zy-line)}
#panel-head h3,#panel-head strong,#settings-content h4,#settings-title,.ai-head strong,#gateway-name{color:var(--zy-text)}#panel-head:before{background:var(--zy-accent);opacity:.045}
#panel-head .subtitle,.subtitle,p,.capture-hint,#study-capture-hint,#translation-status,#sync-saved,#align-status,#align-label,#cache-stage,#study-cache-quick #cache-source,.ai-hint,#ai-status,#ai-context-badge,.ai-message small,.ai-question-record small,.transcript-cue small,.transcript-cue em{color:var(--zy-muted)}
#panel-head .mascot,.mascot{background:#FFF0C8;border-color:#F6DDA2}#panel-head #settings-open,#panel-head #collapse,#panel-head #account-entry,#account-entry,#account-guide{color:var(--zy-muted)}#panel-head #account-open,#account-entry button{background:var(--zy-soft);color:var(--zy-accent)}
#study-caption,#study-sync[open],#cache-quick-details,#cache-progress-area{background:var(--zy-bg);border-color:var(--zy-line)}#study-caption>label,#study-tools button,#study-cache>summary,#study-sync summary,#cache-quick-options label{color:var(--zy-text)}#study-caption select,#cache-quick-options select{background:transparent;color:var(--zy-text)}
.primary,#sync-toggle,#ai-open,#web-ask,#study-cache-quick #cache-download,#ai-learning #ai-send,#ai-learning #ai-share-card,#ai-resume,#ai-crop-send,#gateway-login{background:var(--zy-accent);border-color:var(--zy-accent);color:#fff;box-shadow:0 4px 10px #C452211A}
.primary:hover,#sync-toggle:hover,#ai-open:hover,#web-ask:hover,#study-cache-quick #cache-download:hover,#ai-learning #ai-send:hover,#ai-learning #ai-share-card:hover,#ai-resume:hover,#gateway-login:hover{background:var(--zy-accent-hover);border-color:var(--zy-accent-hover)}
#transcript-open,#cache-details-toggle,#study-cache-quick #stream-play{background:var(--zy-soft);border-color:var(--zy-line);color:var(--zy-accent);box-shadow:none}#transcript-open:hover,#cache-details-toggle:hover{background:#F9DDC7}
#cache-details-toggle{font-size:12px;font-weight:600}#study-tools,#study-cache,#sync-stepper,.section,#batch-list .cache-course .actions{border-color:var(--zy-line)}#sync-stepper,#sync-stepper button,.cache-quick-playback button{background:var(--zy-card);color:var(--zy-accent);border-color:var(--zy-line)}#sync-stepper .sync-unit{color:var(--zy-muted)}#study-tools button:hover,#sync-stepper button:hover{background:var(--zy-soft)}
#settings-dialog{background:#392B2366}#settings-nav{background:var(--zy-bg);border-color:var(--zy-line)}#settings-nav button{color:var(--zy-text)}#settings-nav button[aria-selected=true],#settings-nav button[aria-selected=true]:hover,#settings-nav button[aria-selected=true]:focus{background:var(--zy-soft)!important;color:var(--zy-accent)!important;box-shadow:inset 3px 0 var(--zy-accent);font-weight:600}
#settings-content textarea,#settings-content input,#settings-content select,#ai-question,#ai-learning select,#ai-questions input{background:var(--zy-card);color:var(--zy-text);border-color:var(--zy-line)}#web-settings-tabs button[aria-selected=true]{background:var(--zy-soft);color:var(--zy-accent);font-weight:600}#compact{background:var(--zy-card);color:var(--zy-accent);border-color:var(--zy-line)}
#ai-learning .ai-head button,#ai-learning button{background:var(--zy-card);color:var(--zy-accent);border-color:var(--zy-line)}#ai-learning .ai-head,#ai-learning .ai-toolbar,#ai-compose,.ai-card-row{border-color:var(--zy-line)}#ai-learning .ai-toolbar,#ai-compose,#ai-log{background:var(--zy-card)}
.ai-message[data-role=user]{background:var(--zy-soft);color:var(--zy-text)}.ai-message[data-role=assistant]{background:var(--zy-card);border-color:var(--zy-line);color:var(--zy-text)}.ai-markdown h2,.ai-markdown h3,.ai-markdown h4,.ai-markdown a{color:var(--zy-accent)}.ai-markdown code,.ai-math-block,.ai-markdown th{background:var(--zy-bg);color:var(--zy-text)}.ai-markdown pre{background:#392B23;color:#FFF8EF}.ai-markdown pre code{background:transparent;color:inherit}.ai-markdown td,.ai-markdown th,.ai-answer-note{border-color:var(--zy-line)}.ai-markdown blockquote{border-color:var(--zy-yellow);color:var(--zy-muted)}.ai-answer-note{color:var(--zy-muted)}
#ai-questions-list article{background:var(--zy-card);border:1px solid var(--zy-line);border-radius:12px;margin-bottom:10px;padding:12px 8px}#ai-questions-list article:hover{background:var(--zy-soft);border-color:#E5B79A}.ai-question-record{color:var(--zy-text)}#ai-questions-list article>button:last-child{color:#A34635;border-color:var(--zy-line);background:transparent}#ai-questions-list article:focus-within{outline:2px solid var(--zy-accent);outline-offset:2px}
.transcript-cue[aria-current=true]{background:var(--zy-soft);color:var(--zy-accent)}#gateway-avatar,#gateway-recharge-note,.quota-heading button{background:var(--zy-soft);color:var(--zy-accent);border-color:var(--zy-line)}.quota-heading strong,.quota-row .quota-label,#batch-list .cache-course-title{color:var(--zy-text)}.quota-row,#batch-list .cache-course{background:var(--zy-card);border-color:var(--zy-line)}.quota-ring:before{background:var(--zy-card)}.quota-row small,.quota-ring strong span,#batch-list .cache-course-state{color:var(--zy-muted)}
#ai-image-viewer{background:#392B23E8}#ai-image-viewer button{background:var(--zy-card);color:var(--zy-text)}#ai-crop .ai-crop-head,#ai-capture-session{background:#392B23;color:#FFF8EF}#ai-selection-menu{background:var(--zy-card)!important;color:var(--zy-text)!important;border-color:var(--zy-line)!important}#ai-selection-menu button{color:var(--zy-accent)}
#study-tools #show-slides,#study-tools #focus-fullscreen{background:#FDEBDD;border:1px solid #E5B79A;color:#91401E;font-weight:600;border-radius:9px;padding:8px 6px;font-size:12px}
#ai-learning .ai-head{padding:12px 14px;min-height:50px;gap:10px;flex-wrap:wrap}#ai-learning .ai-head button{padding:6px 8px}#ai-learning #ai-mode{background:transparent;border:1px solid var(--zy-line);padding:6px 8px}#ai-mode option{background:#FFFCF7;color:#392B23}
#ai-learning #ai-log{background:#FAFAF8}.ai-message[data-role=user]{background:#F2F3F0;color:#30342F;border:1px solid #E0E4DE}.ai-message[data-role=assistant]{background:#fff;color:#30342F;border-color:#E4E7E1}.ai-markdown p{color:inherit}
#ai-learning #ai-save-card{background:#FFE39A;border-color:#E7C76C;color:#584415;font-weight:600}#ai-learning #ai-save-card:hover{background:#FFD776}#ai-questions header{justify-content:flex-start;gap:14px;min-height:40px}#ai-questions-close{padding:6px 8px;border:1px solid var(--zy-line);border-radius:10px;cursor:pointer}
#ai-crop,#ai-crop *{box-sizing:border-box}#ai-crop{font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}
#ai-crop.ai-crop-preview{inset:0;width:auto;height:auto;max-height:none;overflow:hidden;background:transparent;color:var(--zy-text);border:0;border-radius:0;padding:0;box-shadow:none}
#ai-crop.ai-crop-preview #ai-crop-stage{position:absolute;inset:0;cursor:default}#ai-crop.ai-crop-preview #ai-crop-image{filter:brightness(.5)}#ai-crop-preview{display:block;max-width:none;max-height:none;margin:0;touch-action:none;cursor:crosshair;outline:2px solid var(--zy-accent);box-shadow:0 0 0 1px #fff}
#ai-crop.ai-crop-preview .ai-crop-head{position:absolute;right:auto;bottom:auto;background:var(--zy-card);color:var(--zy-text);padding:10px;display:grid;gap:8px;border:1px solid var(--zy-line);border-radius:12px;box-shadow:0 8px 28px #0003}#ai-crop-tools,.ai-crop-actions{display:flex;flex-wrap:wrap;gap:6px}#ai-crop-tools[hidden]{display:none}#ai-crop-tools button,#ai-crop .ai-crop-actions button{border:1px solid var(--zy-line);border-radius:8px}#ai-crop-tools button[aria-pressed=true]{background:var(--zy-soft);border-color:var(--zy-accent)}#ai-capture-session[hidden]{display:none!important}
#settings-content,#web-settings-card,#ai-questions,#transcript{background:#fff;color:#30343B}#settings-content{padding:24px 28px}#settings-content p{line-height:1.7}#settings-content label{line-height:1.6}#ai-learning{resize:both;overflow:hidden;min-width:min(340px,calc(100vw - 28px));min-height:320px;max-height:calc(100dvh - 24px)}#ai-learning .ai-head{cursor:move;touch-action:none;flex-wrap:nowrap}#ai-learning .ai-head strong{white-space:nowrap}#ai-learning .ai-toolbar{padding:10px 14px;background:#fff}#ai-learning #ai-compose{padding:12px 14px;background:#fff}#ai-learning #ai-question{height:72px;min-height:56px;max-height:180px}#ai-learning #ai-log{background:#F6F7F9;padding:18px}#ai-status:empty{display:none}.ai-prompt-row{flex-wrap:wrap;padding:12px;border:1px solid #e4e7eb;border-radius:12px;background:#fff}.ai-prompt-row span{min-width:140px}.ai-prompt-row button{font-size:12px;padding:6px 8px}.ai-settings{gap:18px}#ai-prompt-list{display:grid;gap:10px}#settings-content .ai-settings label{justify-content:flex-start;gap:10px;margin:0}#settings-content .ai-settings label.ai-stack{align-items:stretch;justify-content:stretch}#settings-content .ai-settings input[type=text]{width:100%;max-width:none;padding:12px}#ai-prompt-dialog .ai-prompt-card label{display:grid;grid-template-columns:minmax(0,1fr);align-items:stretch;justify-content:stretch;gap:8px}#ai-prompt-dialog .ai-prompt-card input,#ai-prompt-dialog .ai-prompt-card textarea{width:100%;max-width:none;box-sizing:border-box}#ai-prompt-dialog .ai-prompt-card textarea{min-height:180px}#ai-prompt-dialog [role=status]:empty{display:none}.ai-prompt-dialog{position:fixed;inset:0;z-index:120;pointer-events:auto;background:#20293666;display:grid;place-items:center;padding:18px}.ai-prompt-dialog[hidden]{display:none!important}.ai-prompt-card{background:#fff;padding:24px;border-radius:18px;width:min(520px,100%);max-height:85dvh;overflow:auto;box-shadow:0 18px 60px #20293630}.ai-prompt-card header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.ai-prompt-card label{display:grid;gap:8px;margin-bottom:16px}.ai-prompt-card input,.ai-prompt-card textarea{width:100%;max-width:none;padding:10px;font:inherit;border:1px solid #dce1e7;border-radius:10px}.ai-prompt-card textarea{min-height:180px;resize:vertical}.ai-prompt-card button{padding:8px 14px;border-radius:10px}.social-accounts{display:grid;gap:12px;margin-top:20px}.social-accounts p{padding:16px;background:#f6f7f9;border:1px solid #e5e7eb;border-radius:12px;margin:0}.social-accounts strong{display:block;color:#30343B}
@media(max-width:600px){#settings-content{padding:16px}#ai-learning .ai-head{gap:5px}#ai-learning #ai-questions-back{font-size:12px}#settings-nav button[aria-selected=true]{box-shadow:inset 0 -3px var(--zy-accent)}}

/* Conversation layout: shared palette, clearer reading and a compact composer. */
#ai-learning{container-type:inline-size;height:min(760px,calc(100dvh - 102px));border-radius:22px;box-shadow:0 18px 64px #69391726}
#ai-learning>.ai-head,#ai-learning>.ai-toolbar,#ai-learning>#ai-status,#ai-learning>#ai-context-badge,#ai-learning>.ai-card-row,#ai-learning>#ai-compose{flex-shrink:0}
#ai-learning .ai-head{padding:12px 16px;gap:8px;border-bottom:1px solid var(--zy-line)}
#ai-learning .ai-head strong{font-size:15px;letter-spacing:.2px}
#ai-learning .ai-head button{min-height:32px;border-color:transparent;background:transparent}
#ai-learning #ai-questions-back{font-size:12px;color:var(--zy-muted);padding:5px 8px}
#ai-learning #ai-settings-open,#ai-learning #ai-close{width:32px;padding:0;font-size:18px;line-height:1}
#ai-learning button{transition:background .15s,border-color .15s,box-shadow .15s}
#ai-learning button:not(:disabled):hover{background:var(--zy-soft);border-color:var(--zy-line)}
#ai-learning .ai-toolbar{padding:10px 16px;gap:8px;align-items:center}
#ai-learning #ai-mode{min-width:0;width:0;flex:1;height:34px;padding:5px 9px;border-radius:10px;font-size:12px;background:var(--zy-bg);cursor:pointer}
#ai-learning .ai-toolbar button{height:34px;padding:5px 10px;font-size:12px}
#ai-learning .ai-thread{position:relative;display:flex;flex-direction:column;flex:1;min-height:64px;overflow:hidden;background:var(--zy-bg)}
#ai-learning #ai-log{padding:18px 16px 24px;background:linear-gradient(180deg,var(--zy-bg),var(--zy-card));min-height:0;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--zy-line) transparent;scroll-padding-bottom:50px}
#ai-learning #ai-log:empty{display:grid;place-content:center;text-align:center}
#ai-learning #ai-log:empty:before{content:'✦';color:var(--zy-accent);font-size:28px;line-height:1.6}
#ai-learning #ai-log:empty:after{content:'把不懂的，聊明白。\A直接提问，或截图圈出你的疑问';white-space:pre-line;color:var(--zy-muted);font-size:13px;line-height:2}
#ai-learning .ai-message{margin:0 0 16px;padding:13px 15px;border-radius:16px;box-shadow:0 2px 6px #69391704}
#ai-learning .ai-message[data-role=user]{margin-left:36px;background:var(--zy-soft);border-color:var(--zy-line);border-top-right-radius:5px;font-size:14px;line-height:1.75;color:var(--zy-text)}
#ai-learning .ai-message[data-role=assistant]{margin-right:16px;border-top-left-radius:5px;background:var(--zy-card);border-color:var(--zy-line);color:var(--zy-text)}
#ai-learning .ai-message>small{display:flex;align-items:center;gap:6px;margin-bottom:7px;font-size:11px;font-weight:600;color:var(--zy-muted)}
#ai-learning .ai-message[data-role=assistant]>small{color:var(--zy-accent)}
#ai-learning .ai-message[data-role=assistant]>small:before{content:'✦';display:grid;place-items:center;width:21px;height:21px;border-radius:7px;background:var(--zy-soft);font-size:13px}
#ai-learning .ai-message img{width:auto;max-width:100%;max-height:160px;margin-top:10px;border:1px solid var(--zy-line);border-radius:10px;background:var(--zy-card)}
#ai-learning .ai-markdown,#ai-learning .ai-markdown p{font-size:16px;line-height:1.85}
#ai-learning .ai-markdown>:last-child{margin-bottom:0}
#ai-learning #ai-jump-latest{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);white-space:nowrap;border-radius:24px;padding:7px 14px;font-size:12px;background:var(--zy-card);box-shadow:0 4px 18px #69391720}
#ai-learning [hidden]{display:none!important}
#ai-learning #ai-status{padding:5px 16px;min-height:0;font-size:11px;line-height:1.6;overflow-wrap:anywhere}
#ai-learning #ai-status:empty,#ai-learning #ai-context-badge:empty{display:none}
#ai-learning #ai-context-badge{padding:2px 16px 5px;font-size:11px}
#ai-learning .ai-card-row{padding:6px 16px 9px;gap:8px;flex-wrap:nowrap;align-items:center}
#ai-learning #ai-save-card{font-size:12px;padding:5px 9px;white-space:nowrap;border-radius:9px;min-height:30px}
#ai-learning #ai-card-hint{font-size:11px;line-height:1.5;min-width:0}
#ai-learning #ai-compose{margin:0 12px 12px;padding:10px;background:var(--zy-card);border:1px solid var(--zy-line);border-radius:16px;box-shadow:0 3px 14px #69391706}
#ai-learning #ai-compose:focus-within{border-color:var(--zy-accent);box-shadow:0 0 0 3px var(--zy-soft)}
#ai-learning #ai-question{height:56px;min-height:56px;max-height:120px;resize:none;border:0;outline:0;border-radius:8px;padding:6px 4px;background:transparent;font-size:14px;line-height:1.65;scrollbar-width:thin}
#ai-learning #ai-question::placeholder{color:var(--zy-muted);opacity:.85}
#ai-learning #ai-compose .ai-actions{gap:6px;margin-top:6px}
#ai-learning #ai-compose .ai-actions button{min-height:32px;padding:5px 10px;font-size:12px}
#ai-learning #ai-clear{color:var(--zy-muted);border-color:transparent;background:transparent}
#ai-learning #ai-compose .ai-hint{font-size:10px}
#ai-learning #ai-send{padding:6px 16px;font-weight:600;background:var(--zy-accent);color:#fff;border-color:var(--zy-accent);box-shadow:0 3px 8px #69391718}
#ai-learning #ai-send:not(:disabled):hover{background:var(--zy-accent-hover);border-color:var(--zy-accent-hover)}
#ai-learning #ai-stop{background:var(--zy-soft);border-color:var(--zy-line);color:var(--zy-accent)}
#ai-learning #ai-attachment{padding:6px 8px;margin-bottom:5px;border-radius:10px;background:var(--zy-bg);font-size:12px}
#ai-learning #ai-attachment img{height:40px;border-color:var(--zy-line)}
#ai-learning #ai-remove-image{margin-left:auto;border-color:transparent;padding:3px 7px}
@container(max-width:380px){#ai-learning .ai-head{padding:9px 10px;gap:4px}#ai-learning .ai-head strong{font-size:14px}#ai-learning .ai-toolbar{padding:8px 10px;gap:5px}#ai-learning .ai-toolbar button{padding:5px 7px}#ai-learning #ai-log{padding:12px 10px 20px}#ai-learning .ai-message[data-role=user]{margin-left:20px}#ai-learning .ai-message[data-role=assistant]{margin-right:0}#ai-learning #ai-compose .ai-hint{display:none}#ai-learning .ai-card-row{padding:5px 10px 8px}}
@media(max-width:600px){#ai-learning{height:calc(100dvh - 66px)}}
@media(max-height:600px){#ai-learning .ai-head{padding-top:7px;padding-bottom:7px}#ai-learning .ai-toolbar{padding-top:6px;padding-bottom:6px}#ai-learning #ai-question{min-height:40px;max-height:72px}#ai-learning #ai-compose{margin-bottom:8px;padding:7px}#ai-learning .ai-message img{max-height:120px}}
@media(prefers-reduced-motion:reduce){#ai-learning button{transition:none}}

`;
 root.ZYWarmTheme=Object.freeze({css});
})(globalThis);
