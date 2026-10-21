/* User-scoped saved text questions. No background uploading or model calls. */
'use strict';
(() => {
  const P=window.ZYPortal,$=id=>document.getElementById(id);
  document.querySelectorAll('[data-nav="study"]').forEach(a=>a.setAttribute('aria-current','page'));
  let records=[],selected='',loadGeneration=0,detailGeneration=0,deleteBusy=false,initialized=false;
  const node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(cls)item.className=cls;return item;};
  function notice(text,error=false){$('study-notice').textContent=text;$('study-notice').classList.toggle('error',error);}
  function valid(own,auth){return own===loadGeneration&&auth===P.session().token&&!!P.session().profile;}
  function reset(){loadGeneration++;detailGeneration++;records=[];selected='';$('conversation-list').replaceChildren();$('reader-messages').replaceChildren();$('reader-title').textContent='';$('reader-course').textContent='';$('reader-date').textContent='';$('reader-content').hidden=true;$('reader-placeholder').hidden=false;$('study-columns').classList.remove('reading');$('study-search').value='';$('study-course').replaceChildren(new Option('全部课程',''));$('delete-dialog').close();$('delete-status').textContent='';$('study-count').textContent='';$('study-empty').hidden=true;}
  function render(){
    const query=$('study-search').value.trim().toLocaleLowerCase(),course=$('study-course').value;
    const filtered=records.filter(item=>(!course||item.course===course)&&(!query||(item.title+' '+item.course).toLocaleLowerCase().includes(query)));
    $('study-count').textContent=(query||course?'找到 '+filtered.length+' 条':'已保存 '+records.length+' 条问答');
    $('conversation-list').replaceChildren();$('study-empty').hidden=!!filtered.length;
    $('study-columns').hidden=!filtered.length;
    $('empty-title').textContent=records.length?'没有找到相关问答':'还没有保存的问答';
    $('empty-copy').textContent=records.length?'试试其他关键词，或切换到全部课程。':'回到插件，打开一段对话并选择「保存到账号」。保存后，手机也能查看。';
    for(const item of filtered){
      const row=node('div',undefined,'conversation-item'),button=node('button');button.type='button';button.dataset.id=item.id;
      button.setAttribute('aria-current',String(selected===item.id));
      button.append(node('span',item.course||'未分类课程','conversation-course'),node('strong',item.title||'未命名问答'),node('small',(Number(item.questionCount)||0)+' 个问题 · '+P.date(item.updated)));
      button.addEventListener('click',()=>open(item.id));row.append(button);$('conversation-list').append(row);
    }
  }
  async function load(){
    if(!P.session().profile)return;const own=++loadGeneration,auth=P.session().token;detailGeneration++;selected='';$('reader-messages').replaceChildren();$('reader-content').hidden=true;$('reader-placeholder').hidden=false;$('study-columns').classList.remove('reading');
    $('study-refresh').disabled=true;notice('正在读取自己的问答…');records=[];$('conversation-list').replaceChildren();$('study-empty').hidden=true;
    try{
      let offset=0,next,all=[];
      do{const data=await P.api('/v1/study/conversations?limit=50&offset='+offset,{auth});if(!valid(own,auth))return;
        if(!Array.isArray(data.items))throw Error('问答列表返回异常，请稍后再试。');
        all.push(...data.items);next=data.next_offset;if(next!==null&&next!==undefined){if(!Number.isSafeInteger(next)||next<=offset||all.length>=500)break;offset=next;}
      }while(next!==null&&next!==undefined);
      if(!valid(own,auth))return;records=all.slice(0,500);const old=$('study-course').value;
      $('study-course').replaceChildren(new Option('全部课程',''));for(const course of [...new Set(records.map(item=>item.course).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')))$('study-course').append(new Option(course,course));
      if([...$('study-course').options].some(option=>option.value===old))$('study-course').value=old;render();notice('');
    }catch(error){if(error.name!=='AbortError'&&valid(own,auth)){notice(error.message,true);$('study-count').textContent='读取失败，可点击刷新重试。';}}
    finally{if(own===loadGeneration)$('study-refresh').disabled=false;}
  }
  async function open(id){
    const own=++detailGeneration,auth=P.session().token,listGeneration=loadGeneration;selected=id;render();$('reader-content').hidden=true;$('reader-placeholder').hidden=true;$('reader-messages').replaceChildren();notice('正在打开问答…');
    try{
      const data=await P.api('/v1/study/conversations?id='+encodeURIComponent(id),{auth});if(own!==detailGeneration||!valid(listGeneration,auth))return;
      const item=data.conversation;if(!item||!Array.isArray(item.history))throw Error('问答内容返回异常，请稍后再试。');
      $('reader-title').textContent=item.title||'未命名问答';$('reader-course').textContent=item.course||'未分类课程';$('reader-date').textContent='更新于 '+P.date(item.updated);
      for(const turn of item.history){if(!['user','assistant'].includes(turn.role)||typeof turn.text!=='string')continue;const section=node('section',undefined,'message '+(turn.role==='user'?'question':'answer'));section.append(node('p',turn.role==='user'?'我的问题':'AI 回答','message-label'),node('p',turn.text,'message-body'));$('reader-messages').append(section);}
      $('reader-content').hidden=false;$('study-columns').classList.add('reading');notice('');if(matchMedia('(max-width:700px)').matches)$('conversation-reader').focus({preventScroll:false});
    }catch(error){if(error.name!=='AbortError'&&own===detailGeneration&&valid(listGeneration,auth)){notice(error.message,true);$('reader-placeholder').hidden=false;}}
  }
  $('reader-back').addEventListener('click',()=>{$('study-columns').classList.remove('reading');$('conversation-list').querySelector('[aria-current="true"]')?.focus();});
  $('study-search').addEventListener('input',render);$('study-course').addEventListener('change',render);$('study-refresh').addEventListener('click',load);
  $('conversation-delete').addEventListener('click',()=>{if(!selected)return;$('delete-status').textContent='';$('delete-dialog').showModal();$('delete-cancel').focus();});
  $('delete-cancel').addEventListener('click',()=>$('delete-dialog').close());
  $('delete-confirm').addEventListener('click',async()=>{
    if(deleteBusy||!selected)return;deleteBusy=true;$('delete-confirm').disabled=true;const id=selected,auth=P.session().token,own=loadGeneration;
    try{await P.api('/v1/study/conversations?id='+encodeURIComponent(id),{method:'DELETE',auth});if(!valid(own,auth))return;records=records.filter(item=>item.id!==id);selected='';detailGeneration++;$('reader-content').hidden=true;$('reader-messages').replaceChildren();$('reader-placeholder').hidden=false;$('study-columns').classList.remove('reading');$('delete-dialog').close();render();notice('已删除网页保存的问答。');}
    catch(error){if(error.name!=='AbortError'&&valid(own,auth)){$('delete-status').textContent=error.message;$('delete-status').classList.add('error');}}
    finally{deleteBusy=false;$('delete-confirm').disabled=false;}
  });
  function sessionChanged(){initialized=true;reset();notice(P.session().notice||'',!!P.session().notice);const signed=!!P.session().profile;$('study-guest').hidden=signed;$('study-workspace').hidden=!signed;if(signed)load();}
  window.addEventListener('portal-session-change',sessionChanged);P.ready.then(()=>{if(!initialized)sessionChanged();});
})();
