const {test}=require('node:test');
const assert=require('node:assert/strict');
const ai=require('./ai-learning.js');
const image='data:image/png;base64,aGVsbG8=';
test('Responses input is bounded, follows chosen mode and sends data images only',()=>{
 const b=ai.makeBody({question:'解释变量',context:'老师正在讲编译器',images:[image,image,image,image,'https://bad.test/x?token=secret'],settings:{mode:'technical'}});
 assert.equal(b.model,'doubao-seed-2-1-lite-260915');assert.equal(b.stream,true);assert.equal(b.store,false);assert.match(b.input[0].content,/术语/);
 assert.match(b.input.at(-1).content[0].text,/编译器/);assert.equal(b.input.at(-1).content.filter(c=>c.type==='input_image').length,3);
 assert.equal(JSON.stringify(b).includes('secret'),false);assert.equal(b.tools,undefined);
});
test('Custom mode, model fallback, hidden web search and character limits',()=>{
 const b=ai.makeBody({settings:{mode:'custom',customPrompt:'先举 Python 例子',webSearch:true},question:'x'.repeat(8000),context:'y'.repeat(20000)});
 assert.match(b.input[0].content,/Python/);assert.equal(b.tools,undefined);assert.ok(b.input.at(-1).content[0].text.length<13100);
 assert.equal(ai.settingsOf({mode:'__proto__'}).mode,'feynman');assert.equal(ai.settingsOf({model:'   '}).model,ai.DEFAULTS.model);
});
test('History is bounded and starts with a question',()=>{
 const h=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',text:'x'.repeat(10000)}));
 const t=ai.trimHistory(h);assert.ok(t.length<=8);assert.equal(t[0].role,'user');assert.ok(t.reduce((n,i)=>n+i.content.length,0)<=14000);
});
test('Parser ignores reasoning and rejects empty/incomplete answers',()=>{
 assert.equal(ai.textOfResponse({output:[{type:'reasoning',summary:[{text:'hidden'}]},{type:'message',content:[{type:'output_text',text:'解释成功'}]}]}),'解释成功');
 assert.throws(()=>ai.textOfResponse({status:'incomplete',output:[]}),/未完成/);assert.throws(()=>ai.textOfResponse({output:[]}),/没有返回文字/);
});
test('Key goes only in auth header; documented responses endpoint',async()=>{
 let options;const answer=await ai.requestResponse(o=>{options=o;queueMicrotask(()=>o.onload({status:200,responseText:JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'done'}]}]})}));return{abort(){}};},ai.makeBody({question:'hi'}),'test-secret',new AbortController().signal);
 assert.equal(answer,'done');assert.equal(options.url,'https://ark.cn-beijing.volces.com/api/v3/responses');assert.equal(options.headers.Authorization,'Bearer test-secret');assert.equal(options.data.includes('test-secret'),false);
});
test('Errors never echo server body or credentials',async()=>{
 await assert.rejects(ai.requestResponse(o=>{queueMicrotask(()=>o.onload({status:403,responseText:'test-secret <script>oops</script>'}));return{};},{},'test-secret'),e=>!e.message.includes('test-secret')&&e.message.includes('无权'));
});
test('Abort request, ignore late callback; precancelled and missing key make no request',async()=>{
 const c=new AbortController();let options,aborted=0;const result=ai.requestResponse(o=>{options=o;return{abort(){aborted++;}};},{},'key',c.signal);
 c.abort();options.onload({status:200,responseText:'{}'});await assert.rejects(result,e=>e.name==='AbortError');assert.equal(aborted,1);
 let calls=0;await assert.rejects(ai.requestResponse(()=>calls++,{},'key',c.signal),e=>e.name==='AbortError');await assert.rejects(ai.requestResponse(()=>calls++,{},''),/登录/);assert.equal(calls,0);
});
test('Middle-click word extraction does not capture blank space',()=>{assert.equal(ai.wordAt('hello polymorphism world',11),'polymorphism');assert.equal(ai.wordAt('a b',1),'');assert.equal(ai.wordAt('value_type',4),'value_type');});

test('Knowledge card strips known credentials and URLs while keeping readable text',()=>{
 const text=ai.cardText('**知识点**\nAPI demo-secret https://example.test/ppt?token=abc Bearer abcdef','demo-secret');
 assert.match(text,/知识点/);assert.equal(text.includes('demo-secret'),false);assert.equal(text.includes('example.test'),false);assert.equal(text.includes('abcdef'),false);assert.equal(text.includes('**'),false);
});
test('Knowledge card wraps text within available width and truncates long answers',()=>{
 const ctx={measureText:text=>({width:Array.from(text).length*10})};
 const result=ai.wrapCardText(ctx,'大学课堂知识点'.repeat(60),100,4);
 assert.equal(result.lines.length,4);assert.equal(result.truncated,true);assert.ok(result.lines.every(s=>ctx.measureText(s).width<=100));assert.match(result.lines.at(-1),/…$/);
});

function event(data){return 'data: '+JSON.stringify(data)+'\n\n';}
test('SSE displays partial text before completion and ignores reasoning',async()=>{
 let o;const seen=[];const c=new AbortController();const p=ai.requestResponse(opts=>{o=opts;return{abort(){}};},{},'secret',c.signal,t=>seen.push(t));
 const first=event({type:'response.reasoning_summary_text.delta',delta:'hidden'})+event({type:'response.output_text.delta',delta:'你'});
 o.onprogress({responseText:first.slice(0,-1)});assert.deepEqual(seen,[]);
 o.onprogress({responseText:first});assert.deepEqual(seen,['你']);o.onprogress({responseText:first});assert.deepEqual(seen,['你']);
 const raw=first+event({type:'response.output_text.delta',delta:'好'})+event({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'你好'}]}]}});
 o.onprogress({responseText:raw});assert.deepEqual(seen,['你','你好']);o.onload({status:200,responseText:raw});assert.equal(await p,'你好');
});
test('SSE disconnect and explicit errors terminate with useful feedback',async()=>{
 for(const suffix of ['',event({type:'error',message:'服务暂时不可用'})]){
  await assert.rejects(ai.requestResponse(o=>{queueMicrotask(()=>o.onload({status:200,responseText:event({type:'response.output_text.delta',delta:'partial'})+suffix}));return{};},{},'key'),/中断|不可用/);
 }
});

test('readable stream transport renders a delta before final callback',async()=>{
 let o,controller;const seen=[];const stream=new ReadableStream({start(c){controller=c;}});const encode=x=>new TextEncoder().encode(event(x));
 const p=ai.requestResponse(opts=>{o=opts;return{abort(){}};},{},'key',new AbortController().signal,t=>seen.push(t));assert.equal(o.responseType,'stream');o.onloadstart({status:200,response:stream});
 controller.enqueue(encode({type:'response.output_text.delta',delta:'实时'}));await new Promise(r=>setImmediate(r));assert.deepEqual(seen,['实时']);
 o.onload({status:200,response:stream});controller.enqueue(encode({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'实时'}]}]}}));controller.close();assert.equal(await p,'实时');
});
test('readable stream handles JSON errors and abort without waiting for onload',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"error":"模型未开通"}'));c.close();}});
 await assert.rejects(ai.requestResponse(o=>{queueMicrotask(()=>o.onloadstart({status:400,response:stream}));return{abort(){}};},{},'key'),/模型未开通/);
 let o,cancelled=false;const c=new AbortController(),pending=new ReadableStream({cancel(){cancelled=true;}});const p=ai.requestResponse(opts=>{o=opts;return{abort(){}};},{},'key',c.signal);o.onloadstart({status:200,response:pending});c.abort();await assert.rejects(p,e=>e.name==='AbortError');assert.equal(cancelled,true);
});

test('Interactive Seed 2 learning avoids spending the answer budget on hidden reasoning',()=>{assert.deepEqual(ai.makeBody({question:'hello'}).reasoning,{effort:'minimal'});assert.equal(ai.makeBody({settings:{model:'custom-model'},question:'hello'}).model,ai.DEFAULTS.model);});

test('Completion resolves without waiting for the HTTP connection to close',async()=>{
 let opts,controller;const stream=new ReadableStream({start(c){controller=c;}});
 const p=ai.requestResponse(o=>{opts=o;return{abort(){}};},{},'key');opts.onloadstart({status:200,response:stream});
 controller.enqueue(new TextEncoder().encode(event({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'done'}]}]}})));
 assert.equal(await p,'done');controller.close();
});
test('Stream can arrive through progress and buffers decode into text',async()=>{
 let opts,controller;const seen=[];const stream=new ReadableStream({start(c){controller=c;}});
 const p=ai.requestResponse(o=>{opts=o;return{abort(){}};},{},'key',null,t=>seen.push(t));assert.equal(opts.fetch,true);
 opts.onloadstart({status:0});opts.onprogress({status:200,response:stream});
 controller.enqueue(new TextEncoder().encode(event({type:'response.output_text.delta',delta:'hi'})+event({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'hi'}]}]}})).buffer);
 assert.equal(await p,'hi');assert.deepEqual(seen,['hi']);controller.close();
});
test('Unsupported stream transport reports a useful error instead of waiting silently',async()=>{
 await assert.rejects(ai.requestResponse(o=>{queueMicrotask(()=>o.onload({status:200}));return{};},{},'key'),/读取回复流/);
});

test('First-text deadline terminates a silent transport and aborts exactly once',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let aborted=0;
 const p=ai.requestResponse(()=>({abort(){aborted++;}}),{},'key');
 const check=assert.rejects(p,/45 秒/);t.mock.timers.tick(45000);await check;assert.equal(aborted,1);
});

test('A rejected stream reader terminates with feedback instead of an unhandled rejection',async()=>{
 const stream=new ReadableStream();const reader=stream.getReader();
 await assert.rejects(ai.requestResponse(o=>{queueMicrotask(()=>o.onloadstart({status:200,response:stream}));return{abort(){}};},{},'key'),/locked|reader|锁/i);reader.releaseLock();
});

test('Feynman mode starts with one clear sentence and defers detail until requested',()=>{const b=ai.makeBody({question:'什么是多态？'});assert.match(b.input[0].content,/一句大白话直接回答/);assert.match(b.input[0].content,/不超过150字/);assert.match(b.input[0].content,/不主动出自测题/);});

test('Sentence sharing keeps decimal values and structured Markdown blocks intact',()=>{
 assert.deepEqual(ai.selectionSentences('第一句。第二句！'),['第一句。','第二句！']);
 assert.deepEqual(ai.selectionSentences('The value is 3.14. Next sentence.'),['The value is 3.14.','Next sentence.']);
 const code='```python\nprint("a. b.")\n```',formula='$$\n\\frac{1}{2}\n$$',brackets='\\[\nx = 1\n\\]',table='| A | B |\n| --- | --- |\n| a | b |';
 for(const block of [code,formula,brackets,table])assert.deepEqual(ai.selectionSentences(block),[block]);
});
test('Markdown card sanitization preserves formatting while hiding credentials',()=>{
 const text=ai.cardText('# 标题\n**核心** `code`\nBearer hidden https://example.test/private secret-key','secret-key',true);
 assert.match(text,/# 标题/);assert.match(text,/\*\*核心\*\*/);assert.match(text,/`code`/);assert.doesNotMatch(text,/hidden|example\.test|secret-key/);
});
