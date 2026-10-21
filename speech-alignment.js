/* Match real ASR word times to subtitle boundaries, independent of sentence splitting. */
(function(root){
'use strict';
const units=text=>String(text||'').normalize('NFKC').toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]/g)||[];
const key=list=>list.slice(0,3).join('\0');
function prefixScore(heard,written){
 let previous=Array.from({length:written.length+1},(_,i)=>i);
 for(let i=1;i<=heard.length;i++){
  const next=[i];for(let j=1;j<=written.length;j++)next[j]=Math.min(previous[j]+1,next[j-1]+1,previous[j-1]+(heard[i-1]===written[j-1]?0:1));previous=next;
 }
 let best=0;for(let j=Math.max(6,Math.ceil(heard.length*.7));j<=written.length;j++)best=Math.max(best,1-previous[j]/Math.max(heard.length,j));return best;
}
function match(utterances,cues,start){
 const failure=reason=>({matched:false,reason,message:'没有找到可靠且一致的匹配，保留原偏移；请确认当前课次及已加载字幕。'});
 if(!Number.isFinite(start)||!Array.isArray(utterances)||!Array.isArray(cues))return failure('invalid_input');
 const rows=cues.filter(c=>Number.isFinite(c.start)&&c.original).map(c=>({...c,tokens:units(c.original)})).filter(c=>c.tokens.length);
 const index=new Map();rows.forEach((c,i)=>{if(c.tokens.length>=3){const k=key(c.tokens),list=index.get(k)||[];list.push(i);index.set(k,list);}});
 const hypotheses=[];let segment=0;
 for(const utterance of utterances){
  if(!Number.isFinite(utterance?.start_time))continue;
  let heard=[],times=[];
  if(Array.isArray(utterance.words))for(const word of utterance.words){const tokens=units(word.text||word.word);if(!tokens.length||!Number.isFinite(word.start_time)||word.start_time<0)continue;for(const token of tokens){heard.push(token);times.push(word.start_time);}}
  if(heard.length<6){heard=units(utterance.text);times=heard.map((_,i)=>i===0?utterance.start_time:null);}
  if(heard.length<6||new Set(heard).size<4)continue;
  const anchors=[];
  for(let at=0;at<=heard.length-6;at++){
   if(!Number.isFinite(times[at]))continue;
   const candidates=index.get(key(heard.slice(at,at+3)))||[];
   // Common fragments cannot justify a correction, and must not create unbounded work.
   if(candidates.length>80)continue;
   for(const row of candidates)anchors.push({at,row,frequency:candidates.length});
  }
  const matches=[];
  for(const {at,row} of anchors.sort((a,b)=>a.frequency-b.frequency||a.at-b.at).slice(0,500)){
   const words=heard.slice(at,at+64);if(words.length<Math.max(6,Math.min(12,Math.ceil(heard.length*.5)))||new Set(words).size<4)continue;
   const length=words.length+Math.ceil(words.length*.3)+3,transcript=[];
   for(let j=row;j<rows.length&&transcript.length<length;j++){if(rows[j].start-rows[row].start>45)break;transcript.push(...rows[j].tokens);}
   const score=prefixScore(words,transcript.slice(0,length));if(score<.8)continue;
   matches.push({offset:start+times[at]/1000-rows[row].start,score,coverage:words.length,row,segment});
  }
  // An utterance with several equally plausible locations does not cast a vote alone.
  hypotheses.push(...matches);segment++;
 }
 if(!hypotheses.length)return failure('no_similar_text');
 const groups=[];
 for(const h of hypotheses.sort((a,b)=>b.score-a.score||b.coverage-a.coverage)){
  let group=groups.find(g=>Math.abs(g.offset-h.offset)<=1.5);
  if(!group){group={offset:h.offset,items:[]};groups.push(group);}group.items.push(h);
 }
 for(const group of groups){group.score=Math.max(...group.items.map(h=>h.score));group.coverage=Math.max(...group.items.map(h=>h.coverage));group.support=new Set(group.items.map(h=>h.segment+':'+h.row)).size;}
 groups.sort((a,b)=>b.score-a.score||b.support-a.support||b.coverage-a.coverage);
 const best=groups[0],runner=groups[1];
 if(best.score<.84)return failure('low_similarity');
 if(runner&&best.score-runner.score<.08&&!(best.support>=2&&best.support>=runner.support+1&&best.coverage>=12))return failure('ambiguous');
 // Contradictory, individually unique utterances must not be ignored by majority voting.
 for(let i=0;i<segment;i++){
  const local=hypotheses.filter(h=>h.segment===i).sort((a,b)=>b.score-a.score||b.coverage-a.coverage),top=local[0];if(!top||top.score<.9)continue;
  const alternative=local.find(h=>Math.abs(h.offset-top.offset)>1.5);
  if((!alternative||top.score-alternative.score>=.08)&&Math.abs(top.offset-best.offset)>2)return failure('conflicting_offsets');
 }
 const offsets=best.items.filter(h=>h.score>=best.score-.04).map(h=>h.offset).sort((a,b)=>a-b);
 return {matched:true,offset:Math.round(offsets[Math.floor(offsets.length/2)]*100)/100};
}
root.ZYSpeechAlignment={match};
if(typeof module!=='undefined'&&module.exports)module.exports={match};
})(typeof globalThis!=='undefined'?globalThis:this);
