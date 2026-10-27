const {test}=require('node:test');
const assert=require('node:assert/strict');
const {batchTranslationBody,batchTranslationResult,usableTranslation,translationJobs,createTranslator}=require('./zhiyun-subtitles.user.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const jobs=Array.from({length:20},(_,i)=>({id:String(i),text:'English sentence '+i,context:{course:'Architecture',before:[],after:[]}}));
function requests(){const calls=[];function make(entries){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});const c={entries,resolve,reject,aborted:false};calls.push(c);return {promise,abort(){c.aborted=true}};}const request=(text)=>make([{text}]);request.batch=entries=>make(entries);return {request,calls};}
test('batch prompt preserves target IDs and bounds reference while keeping each subtitle separate',()=>{
 const body=batchTranslationBody(jobs.slice(0,6),'auto','zh',{before:['context'],glossary:'register = 寄存器'});
 const payload=JSON.parse(body.input[1].content[0].text);assert.equal(payload.target_subtitle,undefined);
 assert.deepEqual(payload.target_subtitles,jobs.slice(0,6).map((row,i)=>({id:String(i),text:row.text})));
 assert.match(body.input[0].content,/JSON/);assert.deepEqual(body.reasoning,{effort:'minimal'});assert.equal(payload.reference.terminology,'register = 寄存器');
});
test('batch parser maps by ID, isolates missing/duplicate/English answers, and rejects malformed IDs',()=>{
 const entries=jobs.slice(0,3);const parse=rows=>batchTranslationResult(JSON.stringify({translations:rows}),entries,'zh');
 assert.deepEqual(parse([{id:'2',text:'第三句'},{id:'0',text:'第一句'}]),['第一句',null,'第三句']);
 assert.deepEqual(parse([{id:'0',text:'First sentence'},{id:'1',text:'第二句'},{id:'1',text:'重复句'},{id:'2',text:'第三句'}]),[null,null,'第三句']);
 for(const raw of ['null','oops','{"translations":{}}','{"translations":[null]}','{"translations":[{"id":"99","text":"错位"}]}'])assert.deepEqual(batchTranslationResult(raw,entries,'zh'),[null,null,null]);
 assert.equal(usableTranslation('This is English','This is English','zh'),false);assert.equal(usableTranslation('中文','English output','en'),true);
 assert.equal(usableTranslation('We explain the parameter','译文：We explain the parameter','zh'),false);
 assert.equal(usableTranslation('This is fine','译文：This is fine','zh'),false);
 assert.equal(usableTranslation('The model controls parameters','翻译结果如下：The model controls parameters','zh'),false);
 assert.equal(usableTranslation('我们 know that the parameter controls the whole model','我们 know that the parameter controls the whole model。','zh'),false);
});
test('twelve prefetched cues need two serial batches, never twelve requests or duplicate ticks',async()=>{
 const d=requests(),t=createTranslator(d.request);t.start('auto','zh');
 for(let i=0;i<20;i++)t.schedule(jobs.slice(0,12));
 assert.equal(d.calls.length,1);assert.equal(d.calls[0].entries.length,6);
 d.calls[0].resolve(Array(6).fill('已预译'));await flush();assert.equal(d.calls.length,2);assert.equal(d.calls[1].entries.length,6);
 d.calls[1].resolve(Array(6).fill('未来译文'));await flush();t.schedule(jobs.slice(0,12));assert.equal(d.calls.length,2);assert.equal(t.get(jobs[10]),'未来译文');t.stop();
});
test('missing batch output does not stop later cues or loop; manual retry preserves successful cache',async()=>{
 const d=requests(),states=[],t=createTranslator(d.request,(text,state)=>states.push(state));t.start('auto','zh');t.schedule(jobs.slice(0,8));
 d.calls[0].resolve(['第一句',null,'第三句','第四句','第五句','第六句']);await flush();assert.equal(t.enabled,true);assert.equal(states.at(-1).state,'partial');assert.equal(d.calls.length,2);
 d.calls[1].resolve(['第七句','第八句']);await flush();for(let i=0;i<20;i++)t.schedule(jobs.slice(0,8));assert.equal(d.calls.length,2);
 t.start('auto','zh');t.schedule(jobs.slice(0,8));assert.equal(d.calls.length,3);assert.equal(d.calls[2].entries[0].text,jobs[1].text);d.calls[2].resolve('补回第二句');await flush();assert.equal(t.get(jobs[1]),'补回第二句');t.stop();
});
test('seeking replaces unsent batches, late completion can only fill its original cue IDs',async()=>{
 const d=requests(),t=createTranslator(d.request);t.start('auto','zh');t.schedule(jobs.slice(0,12));t.schedule(jobs.slice(14,20));
 d.calls[0].resolve(Array(6).fill('旧位置'));await flush();assert.equal(d.calls.length,2);assert.equal(d.calls[1].entries[0].id,'14');assert.equal(t.get(jobs[14]),'');
 t.reset();assert.equal(d.calls[1].aborted,true);d.calls[1].resolve(Array(6).fill('旧课'));await flush();assert.equal(t.get(jobs[14]),'');
});
test('existing valid school translation and short mixed Chinese consume no paid slot',()=>{
 const d=requests(),t=createTranslator(d.request);t.start('auto','zh');
 t.schedule([{id:'1',text:'English sentence',translation:'学校中文译文'},{id:'2',text:'这里令 x 等于 y',translation:'Let x equal y'},{id:'3',text:'Still English',translation:'Still English'}]);
 assert.equal(d.calls.length,1);assert.equal(d.calls[0].entries[0].text,'Still English');t.stop();
});
test('batch body size is bounded and explicit Chinese to English remains supported',async()=>{
 const d=requests(),t=createTranslator(d.request);t.start('zh','en');t.schedule(jobs.slice(0,4).map((j,i)=>({...j,text:'中文'.repeat(650)+i})));
 assert.equal(d.calls[0].entries.length,1);d.calls[0].resolve('English output');await flush();assert.equal(d.calls[1].entries.length,1);t.stop();
});
