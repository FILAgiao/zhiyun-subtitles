/* Public manual channels stay closed unless a valid QR image actually loads. */
'use strict';
(() => {
  const P=window.ZYPortal,$=id=>document.getElementById(id),tab=new URLSearchParams(location.search).get('tab')==='recharge'?'recharge':'register',recharge=tab==='recharge';
  let channelGeneration=0;
  document.querySelectorAll('[data-nav="account"]').forEach(a=>a.setAttribute('aria-current','page'));
  $('tab-register').removeAttribute('aria-current');$('tab-'+tab).setAttribute('aria-current','page');
  $('channel-title').textContent=recharge?'充值 / 增加额度':'申请账号';$('channel-number').textContent=recharge?'02':'01';$('channel-eyebrow').textContent=recharge?'为接下来的学习准备':'申请自己的学习账号';
  $('channel-closed-copy').textContent=recharge?'充值渠道准备中，开放后会在这里提供办理方式。':'申请渠道准备中，开放后会在这里提供办理方式。';
  function closed(message=''){$('channel-open').hidden=true;$('channel-closed').hidden=false;$('channel-qr').removeAttribute('src');$('channel-instructions').textContent='';$('channel-contact').textContent='';$('channel-notice').textContent=message;}
  function safeImage(raw){
    try{if(typeof raw!=='string'||raw.length>2048||/[\s\u0000-\u0020\u007f]/.test(raw))return '';const url=new URL(raw),host=url.hostname.toLowerCase();if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443'))return '';
      if(!host.includes('.')||host.endsWith('.')||host==='localhost'||/\.(?:localhost|local|internal|test|invalid)$/.test(host)||host.includes(':')||/^\d+(\.\d+){3}$/.test(host))return '';
      if(!host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))return '';return url.href;
    }catch{return '';}
  }
  async function channels(){
    const own=++channelGeneration;closed('正在核对渠道开放状态…');$('channel-retry').disabled=true;
    try{
      const data=await P.api('/v1/account/access',{auth:''});if(own!==channelGeneration)return;const info=data[recharge?'recharge':'registration'],url=safeImage(info?.qr_url);
      if(info?.enabled!==true||!url){closed();return;}
      const image=$('channel-qr');image.onload=()=>{if(own!==channelGeneration)return;image.onload=image.onerror=null;$('channel-instructions').textContent=typeof info.instructions==='string'?info.instructions:'';$('channel-contact').textContent=typeof info.contact==='string'?info.contact:'';$('channel-open').hidden=false;$('channel-closed').hidden=true;$('channel-notice').textContent='';};
      image.onerror=()=>{if(own===channelGeneration)closed('暂时无法加载办理信息，请稍后刷新。');};image.src=url;
    }catch{if(own===channelGeneration)closed('暂时无法核对渠道开放状态，请稍后刷新。');}
    finally{if(own===channelGeneration)$('channel-retry').disabled=false;}
  }
  function member(){const me=P.session().profile;$('account-guest').hidden=!!me;$('account-member').hidden=!me;if(!me){$('member-name').textContent='';$('member-plan').textContent='';$('member-quota').replaceChildren();$('member-expiry').textContent='';return;}
    const names={free:'基础免费',trial:'免费体验',pro:'PRO',ultra:'Ultra',legacy:'原有授权'},plan=me.membership?.plan||me.permissions?.plan||'free';$('member-name').textContent=me.username||me.email||'我的账号';$('member-plan').textContent=names[plan]||'我的账号';$('member-quota').replaceChildren();
    const use=me.usage||{},rows=[['本月调用剩余',use.request_limit,use.requests,'次'],['本月语音剩余',use.audio_limit,use.audio_seconds,'秒']];for(const [label,limit,used,unit] of rows){const wrap=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=Number.isFinite(limit)&&limit>=0&&Number.isFinite(used)?Math.max(0,Math.floor(limit-used)).toLocaleString('zh-CN')+' '+unit:'待核对';wrap.append(dt,dd);$('member-quota').append(wrap);}
    const expires=Number(me.membership?.expires||me.permissions?.expires||0);$('member-expiry').textContent=expires>0?'有效期至 '+P.date(expires*1000)+'（北京时间）':'未设置到期时间';
  }
  $('channel-retry').addEventListener('click',channels);window.addEventListener('portal-session-change',member);P.ready.then(member);channels();
})();
