const {test}=require('node:test');
const assert=require('node:assert/strict');
const ai=require('./ai-learning.js');
const image='data:image/png;base64,aGVsbG8=';
test('Responses input is bounded, follows chosen mode and sends data images only',()=>{
 const b=ai.makeBody({question:'解释变量',context:'老师正在讲编译器',images:[image,image,image,image,'https://bad.test/x?token=secret'],settings:{mode:'technical'}});
 assert.equal(b.model,'doubao-seed-2-1-lite-260915');assert.equal(b.stream,false);assert.equal(b.store,false);assert.match(b.input[0].content,/术语/);
 assert.match(b.input.at(-1).content[0].text,/编译器/);assert.equal(b.input.at(-1).content.filter(c=>c.type==='input_image').length,3);
 assert.equal(JSON.stringify(b).includes('secret'),false);assert.equal(b.tools,undefined);
});
test('Custom mode, model fallback, web search and character limits',()=>{
 const b=ai.makeBody({settings:{mode:'custom',customPrompt:'先举 Python 例子',webSearch:true},question:'x'.repeat(8000),context:'y'.repeat(20000)});
 assert.match(b.input[0].content,/Python/);assert.deepEqual(b.tools,[{type:'web_search',max_keyword:3}]);assert.ok(b.input.at(-1).content[0].text.length<13100);
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
 let calls=0;await assert.rejects(ai.requestResponse(()=>calls++,{},'key',c.signal),e=>e.name==='AbortError');await assert.rejects(ai.requestResponse(()=>calls++,{},''),/API Key/);assert.equal(calls,0);
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
