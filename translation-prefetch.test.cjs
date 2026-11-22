const {test}=require('node:test');
const assert=require('node:assert/strict');
const {seedBatchTranslationBody,seedBatchTranslationResult,usableTranslation,translationJobs,createTranslator}=require('./zhiyun-subtitles.user.js');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const jobs=Array.from({length:20},(_,i)=>({id:String(i),text:'English sentence '+i}));
function requests(){const calls=[];function make(entries){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});const c={entries,resolve,reject,aborted:false};calls.push(c);return {promise,abort(){c.aborted=true}};}const request=(text)=>make([{text}]);request.batch=entries=>make(entries);return {request,calls};}
test('translation validation rejects missing or untranslated content',()=>{
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
test('Seed Translation sends one indexed text and rejects unmatched, reordered or merged lines',()=>{
 const entries=jobs.slice(0,2);
 const body=seedBatchTranslationBody(entries,'auto','zh');
 assert.equal(body.model,'doubao-seed-translation-250915');
 assert.equal(Object.hasOwn(body,'seed_batch'),false);
 assert.deepEqual(body.input[0].content,[{type:'input_text',text:'[01] English sentence 0\n[02] English sentence 1',translation_options:{target_language:'zh'}}]);
 const parse=text=>seedBatchTranslationResult(text,entries,'zh');
 assert.deepEqual(parse('［01］第一条译文\n[02] 第二条译文'),['第一条译文','第二条译文']);
 assert.deepEqual(parse('[01] 第一条译文\n[02] English sentence 1'),['第一条译文',null]);
 for(const text of ['没有分行的译文','[02] 第二条译文\n[01] 第一条译文','[01] 一条译文\n[01] 另一条译文']){
  assert.deepEqual(parse(text),[null,null]);
 }
});
test('Seed prefetch sends current cue immediately, batches 12 following and falls back on demand',async()=>{
 const d=requests(),t=createTranslator(d.request,()=>{},1,{},()=>12);
 const cues=Array.from({length:20},(_,index)=>({start:index*3,original:jobs[index].text}));
 t.start('auto','zh');
 t.schedule(translationJobs(cues,0,1,13));
 assert.deepEqual(d.calls.map(c=>c.entries.length),[1]);
 d.calls[0].resolve('当前字幕译文');await flush();
 assert.deepEqual(d.calls.map(c=>c.entries.length),[1,12]);
 d.calls[1].resolve(Array(12).fill(null));await flush();
 assert.equal(d.calls.length,2,'a mismatched prefetch does not immediately resubmit all of its text');
 t.schedule(translationJobs(cues,1,1,13));
 assert.deepEqual(d.calls.map(c=>c.entries.length),[1,12,1]);
 assert.equal(d.calls[2].entries[0].text,cues[1].original);
 t.stop();
});
test('Seed prefetch respects configured counts and UTF-8 request size',async()=>{
 const cues=Array.from({length:25},(_,index)=>({start:index?index+2:0,original:'Explain step '+index}));
 for(const cap of [1,5,24]){
  const d=requests(),t=createTranslator(d.request,()=>{},1,{},()=>cap);
  t.start('en','zh');t.schedule(translationJobs(cues,0,1,25));
  d.calls[0].resolve('单条');await flush();
  assert.equal(d.calls[1].entries.length,cap);
  t.stop();
 }
 const d=requests(),t=createTranslator(d.request,()=>{},1,{},()=>24);
 t.start('zh','en');t.schedule(translationJobs(cues.map(cue=>({...cue,original:'专业字幕句子'.repeat(20)+cue.original})),0,1,25));
 d.calls[0].resolve('One translation');await flush();
 const sent=d.calls[1].entries;
 assert.ok(sent.length>=2 && sent.length<24);
 assert.ok(Buffer.byteLength(seedBatchTranslationBody(sent,'zh','en').input[0].content[0].text)<=900);
 t.stop();
});
