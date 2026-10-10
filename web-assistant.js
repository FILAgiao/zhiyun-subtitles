/* Lightweight assistant for ordinary webpages. Reads only explicit selections and captures. */
(function(root){
'use strict';
function mount({request,getValue,setValue}){
 globalThis.ZYAppearance?.configure(getValue,setValue);
 if(document.getElementById('zy-subtitle-host'))return;
 const host=document.createElement('div');host.id='zy-subtitle-host';host.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483646';
 const shadow=host.attachShadow({mode:'open'});
 shadow.innerHTML=`<style>:host{font:14px/1.6 'Segoe UI','Microsoft YaHei',sans-serif;color:#233954}*{box-sizing:border-box}[hidden]{display:none!important}button{cursor:pointer;padding:8px 12px;border:1px solid #d6e3f0;border-radius:10px;background:#fff;color:#215da1}#panel{pointer-events:auto;position:fixed;right:18px;bottom:18px;width:330px;background:#fff;border:1px solid #dce6f1;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px #17355325}#panel-head{display:flex;align-items:center;gap:8px;padding:12px;background:#123f73;color:#fff}#panel-head strong{font-size:15px}#ai-resume{bottom:140px!important}#panel-body{display:flex;gap:8px;padding:12px}#panel-body button{flex:1}#settings-dialog{pointer-events:auto;position:fixed;inset:0;background:#1236;display:grid;place-items:center;padding:16px;z-index:90}#web-settings-card{width:560px;max-width:100%;max-height:85vh;overflow:auto;padding:24px;background:#fff;border-radius:18px}#web-settings-card header,#web-settings-tabs{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:18px}input,textarea{font:inherit}label{display:flex;gap:10px;margin:10px 0}p{font-size:13px;color:#667b92}.capture-hint{padding:0 12px 12px;margin:0;font-size:11px}@media(max-width:400px){#panel{max-width:calc(100vw - 24px);right:12px}}</style><section id="panel"><header id="panel-head"><strong>浙大上课爽</strong><button id="web-settings-open" aria-label="设置">⚙</button></header><div id="panel-body"><button id="web-ask">提问</button><button id="transcript-open">问题列表</button></div><p class="capture-hint">截图提问：按住中键拖框，或在对话中粘贴截图。</p></section><section id="settings-dialog" hidden role="dialog" aria-modal="true" aria-label="提问设置"><div id="web-settings-card"><header><strong>浙大上课爽</strong><button id="settings-close">关闭</button></header><nav id="web-settings-tabs"><button id="settings-tab-connection">我的账号</button><button id="settings-tab-ai">AI 讲解</button><button id="settings-tab-appearance">界面外观</button><button id="settings-tab-about">关于</button></nav><section id="settings-connection"></section><section id="settings-ai" hidden></section><section id="settings-appearance" hidden></section><section id="settings-about" hidden><p>个人学习工具，非浙江大学官方产品。</p><div class="social-accounts"><p><strong>抖音 · 侃侃你的（浙大上岸版）</strong>抖音号：42249371667</p><p><strong>小红书 · 侃侃你的（浙大上岸版）</strong>小红书号：156626670</p></div></section></div></section>`;
 shadow.querySelector('style').textContent+=(globalThis.ZYWarmTheme?.css||'');document.body.append(host);const $=id=>shadow.getElementById(id);globalThis.ZYAppearance?.attach(shadow);globalThis.ZYAppearance?.mountSettings($('settings-appearance'));
 function settings(name='connection'){$('settings-dialog').hidden=false;for(const id of ['connection','ai','appearance','about']){$('settings-'+id).hidden=id!==name;$('settings-tab-'+id).setAttribute('aria-selected',String(id===name));}}
 const gateway=ZYGateway.create({request,getValue,setValue});let assistant;
 gateway.mount(shadow,()=>assistant?.resetCourse());
 assistant=ZhiyunLearning.mountLearningAssistant({shadow,request:gateway.transport,getValue,setValue,getApiKey:()=>gateway.configured()?gateway.credential():getValue('ark-api-key',''),getCourseId:()=>location.origin+location.pathname,getCourseTitle:()=>document.title,getContext:()=>'',onRequireLogin:()=>settings(),onOpenSettings:()=>settings('ai')});
 $('web-ask').onclick=()=>assistant.open();$('web-settings-open').onclick=()=>settings();$('settings-close').onclick=()=>{$('settings-dialog').hidden=true;};
 for(const id of ['connection','ai','appearance','about'])$('settings-tab-'+id).onclick=()=>settings(id);
 $('settings-dialog').addEventListener('keydown',e=>{if(e.key==='Escape')$('settings-dialog').hidden=true;});
 return assistant;
}
root.ZYWebAssistant={mount};
})(globalThis);

