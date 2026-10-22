/* Local text retrieval and phonetic alignment. Only actual ASR word/utterance
 * starts time a subtitle boundary; a located interior never invents its time. */
(function(root){
'use strict';
if(!root.ZYPinyin&&typeof require==='function'){try{require('./speech-phonetics.bundle.js');}catch(_){}}
const isChinese=token=>/^[\u3400-\u9fff]$/.test(token);
const readingCache=new Map();
function readings(token){
 if(!isChinese(token)||!root.ZYPinyin)return [];
 if(!readingCache.has(token))readingCache.set(token,new Set(root.ZYPinyin.readings(token)||[]));
 return readingCache.get(token);
}
function sameSound(a,b){
 if(a===b||!isChinese(a)||!isChinese(b))return false;
 const left=readings(a),right=readings(b);return left.size&&right.size&&[...left].some(value=>right.has(value));
}
function normalizeTokens(tokens,times){
 const result=[],starts=[];
 for(let at=0;at<tokens.length;at++){
  let token=tokens[at],end=at;
  // ASR commonly returns A / D / C as separate words. Retain the first real word time.
  if(/^[a-z]$/.test(token)){while(end+1<tokens.length&&/^[a-z]$/.test(tokens[end+1]))token+=tokens[++end];}
  result.push(token);starts.push(times?times[at]:null);at=end;
 }
 return {tokens:result,times:starts};
}
function units(text){return normalizeTokens(String(text||'').normalize('NFKC').toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]/g)||[]).tokens;}
function recognitionTokens(utterance){
 let heard=[],times=[];
 if(Array.isArray(utterance.words))for(const word of utterance.words){
  const tokens=String(word.text||word.word||'').normalize('NFKC').toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]/g)||[];
  // A multi-character word record times its beginning, not its interior characters.
  for(let i=0;i<tokens.length;i++){heard.push(tokens[i]);times.push(i===0&&Number.isFinite(word.start_time)&&word.start_time>=0?word.start_time:null);}
 }
 const normalized=normalizeTokens(heard,times);heard=normalized.tokens;times=normalized.times;
 const text=units(utterance.text);
 if(!heard.length||heard.length<text.length*.7){heard=text;times=heard.map(()=>null);}
 if(heard.length&&times[0]===null&&Number.isFinite(utterance.start_time)&&utterance.start_time>=0)times[0]=utterance.start_time;
 return {heard,times};
}
// Streaming ASR often finalizes short utterances before a useful subtitle
// phrase is complete. Join adjacent, non-overlapping records from the same
// audio clock so a boundary and its following evidence can succeed on the
// first listening session. Keep every original record for conflict checks.
// This is not proportional interpolation: unknown word times remain null.
function recognitionWindows(utterances){
 const result=[],groups=[];let current=null;
 for(const utterance of utterances){
  if(!utterance)continue;
  const tokens=recognitionTokens(utterance),known=tokens.times.filter(Number.isFinite);
  const from=known[0],last=known[known.length-1];
  const ends=[utterance.end_time,...(Array.isArray(utterance.words)?utterance.words.map(word=>word.end_time):[])].filter(value=>Number.isFinite(value)&&value>=last);
  const to=ends.length?Math.max(...ends):last;
  result.push({utterance,...tokens});
  if(!Number.isFinite(from)||!Number.isFinite(to)){current=null;continue;}
  if(!current||from<current.to-50||from-current.to>6000||to-current.from>20000){current={from,to,items:[]};groups.push(current);}
  current.items.push({utterance,...tokens});current.to=to;
 }
 for(const group of groups)if(group.items.length>1){
  const heard=group.items.flatMap(item=>item.heard),times=group.items.flatMap(item=>item.times);
  // Join with sentence punctuation so verified sentence windows can still
  // isolate an accurate phrase from an unrelated tail.
  const text=group.items.map(item=>item.utterance.text||item.heard.join(' ')).join('。');
  result.push({utterance:{text},heard,times,combined:true});
 }
 return result;
}
function soundKey(tokens,at){
 const part=tokens.slice(at,at+3);if(part.length!==3||!part.every(isChinese)||!root.ZYPinyin)return null;
 return part.map(token=>[...readings(token)][0]||token).join('\0');
}
function sentenceWindows(text,heard){
 const minimum=heard.filter(isChinese).length>heard.length*.5?10:6;
 const whole={from:0,to:heard.length,minLength:Math.max(minimum,Math.ceil(heard.length*.32))},windows=[whole];
 const parts=String(text||'').split(/[。！？!?；;\n]+|[.](?=\s|$)/).map(units).filter(part=>part.length);
 // ASR word records can differ from the provider's sentence text. Splitting
 // is safe only when every normalized token maps exactly to the timed stream.
 if(parts.length<2||parts.flat().length!==heard.length||parts.flat().some((token,index)=>token!==heard[index]))return windows;
 let from=0;for(const part of parts){
  const minimum=part.filter(isChinese).length>part.length*.5?10:8;
  if(part.length>=minimum)windows.push({from,to:from+part.length,minLength:Math.max(minimum,Math.ceil(part.length*.32))});
  from+=part.length;
 }
 return windows;
}
function informative(tokens){
 if(!tokens.every(isChinese))return true;
 // Strip complete discourse phrases, not their individual characters: e.g.
 // removing generic '分析' must not suppress '分辨率' or '微分方程'.
 const meaningful=tokens.join('').replace(/同学们|后面的内容|这个地方|接下来|继续讨论|可以看到|我们先来|后面|继续|分析|讨论|问题|内容|地方|比较|复杂|一下|今天/g,'');
 const content=[...meaningful].filter(token=>!'的一是在有和就了这那个人我们你他们来去看说要会能到对再也都把让个下上然后现接着么可已以因所嗯啊哦好吧大家先'.includes(token));
 return new Set(content).size>=3;
}
/* Each recalled start creates an overlapping local segment. The best endpoint
 * splits an ASR sentence before an inaccurate tail instead of requiring the
 * entire sentence to match. Gaps are allowed after the opening evidence. */
function alignPrefix(heard,at,written,minLength,end=heard.length){
 const source=heard.slice(at,Math.min(end,at+512)),n=source.length,m=Math.min(written.length,Math.ceil(n*1.35)+3);
 if(n<minLength||m<minLength)return null;
 let previous=Array.from({length:m+1},()=>null);previous[0]={raw:0,cost:0,literal:0,phonetic:0};
 let best=null;
 for(let i=1;i<=n;i++){
  const next=Array.from({length:m+1},()=>null);
  for(let j=1;j<=m;j++){
   const exact=source[i-1]===written[j-1],phonetic=!exact&&sameSound(source[i-1],written[j-1]);
   const cost=exact?0:phonetic?.35:1,reward=exact?1:phonetic?.55:-.9;
   let cell=null,endingMatch=false;
   const diagonal=previous[j-1];
   if(diagonal&&(diagonal.literal||i<=5&&j<=5&&diagonal.cost+cost<=2.25)){
    cell={raw:diagonal.raw+reward,cost:diagonal.cost+cost,literal:diagonal.literal+Number(exact),phonetic:diagonal.phonetic+Number(phonetic)};endingMatch=exact||phonetic;
   }
   // No leading insertion/deletion: a phrase found inside a subtitle must not
   // be mistaken for the subtitle's timed beginning.
   for(const gap of [previous[j],next[j-1]])if(gap&&gap.literal){
    const raw=gap.raw-1.1;if(!cell||raw>cell.raw+.00001){cell={raw,cost:gap.cost+1,literal:gap.literal,phonetic:gap.phonetic};endingMatch=false;}
   }
   next[j]=cell;if(!cell||!endingMatch||i<minLength||j<6)continue;
   const span=Math.max(i,j),score=1-cell.cost/span;
   if(score<.78||cell.literal<Math.max(6,Math.ceil(minLength*.6))||cell.literal/span<.55||i>j*1.35+2||j>i*1.35+2)continue;
   if(!informative(source.slice(0,i)))continue;
   if(!best||cell.raw>best.raw+.00001||Math.abs(cell.raw-best.raw)<.00001&&score>best.score)best={...cell,score,coverage:i,writtenLength:j};
  }
  previous=next;
 }
 return best;
}
function stronger(a,b){return b.raw-a.raw||b.score-a.score||b.coverage-a.coverage;}
function distinctWinner(best,runner){
 if(!runner)return true;
 return best.raw-runner.raw>=Math.max(3,best.raw*.08)||best.score-runner.score>=.08&&best.raw>=runner.raw-1;
}
function match(utterances,cues,start){
 const failure=(reason,candidate)=>{
  const next=candidate&&rows[candidate.row+1];
  return {matched:false,reason,message:reason==='missing_word_timestamps'?(next?'文字位置已找到，正在同一次识别中等待下一条字幕的真实语音边界。':'文字位置已找到，但本段未包含可计时的字幕起点，继续听取后续语句。'):'没有找到可靠且一致的匹配，保留原偏移；请确认当前课次及已加载字幕。',...(candidate?{located:true,candidate:{start:candidate.start,text:candidate.original,score:Math.round(candidate.score*1000)/1000},...(next?{requiredNextBoundary:{start:next.start,text:next.original}}:{})}:{})};
 };
 let rows=[];
 if(!Number.isFinite(start)||!Array.isArray(utterances)||!Array.isArray(cues))return failure('invalid_input');
 rows=cues.filter(c=>Number.isFinite(c.start)&&c.original).map(c=>({...c,tokens:units(c.original)})).filter(c=>c.tokens.length).sort((a,b)=>a.start-b.start);
 const exactIndex=new Map(),soundIndex=new Map();
 const add=(index,key,value)=>{if(!key)return;const list=index.get(key)||[];list.push(value);index.set(key,list);};
 rows.forEach((row,index)=>{for(let at=0;at<Math.min(512,row.tokens.length)-2;at++){
  add(exactIndex,row.tokens.slice(at,at+3).join('\0'),{row:index,column:at});add(soundIndex,soundKey(row.tokens,at),{row:index,column:at});
 }});
 const hypotheses=[],located=[];let segment=0;
 for(const recognition of recognitionWindows(utterances)){
  const {utterance,heard,times}=recognition;if(heard.length<6||new Set(heard).size<4||!informative(heard)){segment++;continue;}
  const windows=sentenceWindows(utterance.text,heard),minLength=Math.min(...windows.map(window=>window.minLength)),anchors=new Map(),passages=new Map();
  for(let at=0;at<Math.min(512,heard.length)-2;at++){
   for(const [index,key,weight] of [[exactIndex,heard.slice(at,at+3).join('\0'),1],[soundIndex,soundKey(heard,at),.45]]){
    const list=key&&index.get(key);if(!list||list.length>80)continue;
    for(const item of list){
     const expected=at-item.column;
     for(let shift=-1;shift<=1;shift++)if(expected+shift>=0&&heard.length-expected-shift>=minLength){
      const id=item.row+':'+(expected+shift),anchor=anchors.get(id)||{row:item.row,at:expected+shift,votes:0};anchor.votes+=weight/list.length/(Math.abs(shift)+1);anchors.set(id,anchor);
     }
     // Interior phrases are useful retrieval evidence, even when there is no
     // recorded word corresponding to the beginning of this subtitle.
     const id=item.row+':'+at+':'+item.column;if(!passages.has(id))passages.set(id,{row:item.row,at,column:item.column,votes:weight/list.length});
    }
   }
  }
  const transcripts=new Map(),boundary=[];
  for(const anchor of [...anchors.values()].sort((a,b)=>b.votes-a.votes||a.at-b.at).slice(0,100)){
   if(!transcripts.has(anchor.row)){
    const transcript=[],limit=heard.length+Math.ceil(heard.length*.35)+4;
    for(let row=anchor.row;row<rows.length&&transcript.length<limit;row++){if(rows[row].start-rows[anchor.row].start>45)break;transcript.push(...rows[row].tokens);}
    transcripts.set(anchor.row,transcript);
   }
   const results=windows.filter(window=>anchor.at>=window.from&&window.to-anchor.at>=window.minLength).map(window=>alignPrefix(heard,anchor.at,transcripts.get(anchor.row),window.minLength,window.to)).filter(Boolean).sort(stronger);
   const result=results[0];if(!result)continue;
   const item={...result,row:anchor.row,segment,at:anchor.at,start:rows[anchor.row].start,original:rows[anchor.row].original};boundary.push(item);
   if(Number.isFinite(times[anchor.at]))hypotheses.push({...item,offset:start+times[anchor.at]/1000-rows[anchor.row].start});
  }
  // Keep only the strongest local segment for each subtitle, so overlapping
  // windows do not masquerade as independent confirmations.
  const interiorMatches=[],localRows=new Map();for(const item of boundary){const old=localRows.get(item.row);if(!old||stronger(item,old)<0)localRows.set(item.row,item);}
  for(const item of [...passages.values()].sort((a,b)=>b.votes-a.votes||a.at-b.at).slice(0,100)){
   const results=windows.filter(window=>item.at>=window.from&&window.to-item.at>=window.minLength).map(window=>alignPrefix(heard,item.at,rows[item.row].tokens.slice(item.column),window.minLength,window.to)).filter(Boolean).sort(stronger);
   const result=results[0];if(!result)continue;
   const candidate={...result,row:item.row,segment,at:item.at,column:item.column,start:rows[item.row].start,original:rows[item.row].original};
   if(item.column>0)interiorMatches.push(candidate);
   const old=localRows.get(item.row);if(!old||stronger(candidate,old)<0)localRows.set(item.row,candidate);
  }
  // A repeated subtitle opening may let edit alignment delete an earlier copy
  // and incorrectly time its second occurrence as the subtitle beginning. If
  // the same spoken opening fits an interior position at least as well, its
  // real word time is useful for retrieval but cannot time the missing prefix.
  for(let index=hypotheses.length-1;index>=0;index--){
   const item=hypotheses[index];if(item.segment!==segment)continue;
   const interior=interiorMatches.find(other=>other.row===item.row&&other.at>=item.at&&other.at<=item.at+4&&other.column-(other.at-item.at)>0&&other.raw>=item.raw-.00001);
   if(interior)hypotheses.splice(index,1);
  }
  located.push(...localRows.values());segment++;
 }
 if(!hypotheses.length){
  const locations=new Map();for(const item of located){const old=locations.get(item.row);if(!old||stronger(item,old)<0)locations.set(item.row,item);}
  const ranked=[...locations.values()].sort(stronger),best=ranked[0];
  return best&&distinctWinner(best,ranked[1])?failure('missing_word_timestamps',best):failure(ranked.length?'ambiguous':'no_similar_text');
 }
 const groups=[];
 for(const h of hypotheses.sort(stronger)){
  let group=groups.find(g=>Math.abs(g.offset-h.offset)<=1.5);if(!group){group={offset:h.offset,items:[]};groups.push(group);}
  const prior=group.items.findIndex(item=>item.segment===h.segment&&item.row===h.row);
  if(prior===-1)group.items.push(h);else if(stronger(h,group.items[prior])<0)group.items[prior]=h;
 }
 for(const group of groups){
  group.items.sort(stronger);const best=group.items[0];
  Object.assign(group,{raw:best.raw,score:best.score,coverage:best.coverage,support:new Set(group.items.map(h=>h.segment)).size,contextRows:new Set()});
  // A uniquely recognizable tail immediately followed by a real timed next
  // caption boundary is one continuous two-sided text alignment. Its longer
  // untimed tail must not veto that very boundary as an unrelated candidate.
  // Award only non-overlapping evidence from the adjacent caption; do not use
  // character counts, subtitle duration, or a guessed interior speech time.
  for(const timed of group.items){
   const predecessors=located.filter(item=>item.segment===timed.segment&&item.row+1===timed.row&&item.score>=.86&&timed.score>=.86&&
    (item.column||0)+item.writtenLength>=rows[item.row].tokens.length-1&&Math.abs(item.at+item.coverage-timed.at)<=1).sort(stronger);
   if(!predecessors.length)continue;
   const previous=predecessors[0],raw=timed.raw+previous.raw,coverage=timed.coverage+previous.coverage;
   if(raw>group.raw){group.raw=raw;group.score=(timed.score*timed.coverage+previous.score*previous.coverage)/coverage;group.coverage=coverage;group.contextRows=new Set([previous.row]);}
  }
 }
 groups.sort((a,b)=>stronger(a,b)||b.support-a.support);
 const best=groups[0],runner=groups[1];
 if(!distinctWinner(best,runner))return failure('ambiguous');
 // A strong location without a timed boundary competes with weaker timed
 // locations too. Having a timestamp must not make an inferior text match win.
 const timedRows=new Set([...best.items.map(item=>item.row),...best.contextRows]),untimedRows=new Map();
 for(const item of located)if(!timedRows.has(item.row)){const old=untimedRows.get(item.row);if(!old||stronger(item,old)<0)untimedRows.set(item.row,item);}
 const untimed=[...untimedRows.values()].sort(stronger)[0];
 if(untimed&&!distinctWinner(best,untimed))return distinctWinner(untimed,best)?failure('missing_word_timestamps',untimed):failure('ambiguous');
 // Every independently unique utterance must agree; an inconsistent later
 // sample cannot be outvoted by several overlapping pieces from an earlier one.
 for(let index=0;index<segment;index++){
  const local=hypotheses.filter(h=>h.segment===index).sort(stronger),top=local[0];if(!top||top.score<.86)continue;
  const alternative=local.find(h=>Math.abs(h.offset-top.offset)>1.5);
  if(distinctWinner(top,alternative)&&Math.abs(top.offset-best.offset)>2)return failure('conflicting_offsets');
 }
 // Distinct subtitle boundaries inside one ASR utterance provide independent
 // clock checks too. A longer opening must not hide a contradictory later row.
 for(let index=0;index<segment;index++){
  const local=hypotheses.filter(h=>h.segment===index).sort(stronger),perRow=new Map();
  for(const item of local)if(!perRow.has(item.row))perRow.set(item.row,item);
  for(const item of perRow.values()){
   if(item.score<.86||Math.abs(item.offset-best.offset)<=2)continue;
   const alternative=local.find(other=>other.row!==item.row&&Math.abs(other.at-item.at)<=2&&Math.abs(other.offset-item.offset)>1.5);
   if(distinctWinner(item,alternative))return failure('conflicting_offsets');
  }
 }
 const timedRaw=best.items[0].raw,offsets=best.items.filter(h=>h.raw>=timedRaw-Math.max(2,timedRaw*.05)).map(h=>h.offset).sort((a,b)=>a-b);
 return {matched:true,offset:Math.round(offsets[Math.floor(offsets.length/2)]*100)/100};
}
root.ZYSpeechAlignment={match};
if(typeof module!=='undefined'&&module.exports)module.exports={match};
})(typeof globalThis!=='undefined'?globalThis:this);
