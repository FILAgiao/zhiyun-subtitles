const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseTime, timeline, activeCue, srt } = require('./zhiyun-subtitles.user.js');
const { translationBody, translationResult, createTranslator } = require('./zhiyun-subtitles.user.js');
const { subtitleTime, captionLayout } = require('./zhiyun-subtitles.user.js');
const { wavBytes, matchSpeech, speechResult } = require('./zhiyun-subtitles.user.js');
test('browser WAV encoding is mono PCM16 with correct sizes and clipping', () => {
  const bytes=wavBytes(new Float32Array([-2,-1,0,1,2]));
  const view=new DataView(bytes.buffer);
  assert.equal(Buffer.from(bytes.subarray(0,4)).toString(),'RIFF');
  assert.equal(view.getUint32(4,true),46);
  assert.equal(view.getUint32(24,true),16000);
  assert.equal(view.getUint16(22,true),1);
  assert.equal(view.getUint32(40,true),10);
  assert.deepEqual([0,1,2,3,4].map(i=>view.getInt16(44+i*2,true)),[-32768,-32768,0,32767,32767]);
});
test('speech match calculates offsets locally for English and Chinese', () => {
  const english='the financial market uses several different trading strategies';
  assert.deepEqual(matchSpeech([{text:english,start_time:2000}],[{original:english,start:100}],105),{matched:true,offset:7});
  const chinese='我们现在开始介绍不同的数据存储结构';
  assert.equal(matchSpeech([{text:chinese,start_time:1000}],[{original:chinese,start:100}],96).offset,-3);
});
test('speech matching rejects repeated, short, missing-time and conflicting results', () => {
  const a='the financial market uses several different trading strategies';
  const b='students should carefully study the database chapter';
  assert.equal(matchSpeech([{text:a,start_time:0}],[{original:a,start:10},{original:a,start:100}],10).matched,false);
  assert.equal(matchSpeech([{text:'yes yes',start_time:0}],[{original:'yes yes',start:10}],10).matched,false);
  assert.equal(matchSpeech([{text:a}],[{original:a,start:10}],10).matched,false);
  assert.equal(matchSpeech([{text:a,start_time:0},{text:b,start_time:5000}],[{original:a,start:100},{original:b,start:200}],100).matched,false);
});
test('speech response checks business status even when HTTP is successful', () => {
  const response={status:200,responseHeaders:'X-Api-Status-Code: 20000000\r\n',responseText:JSON.stringify({result:{utterances:[{text:'hello',start_time:0}]}})};
  assert.equal(speechResult(response)[0].text,'hello');
  assert.throws(()=>speechResult({...response,responseHeaders:'X-Api-Status-Code: 45000000'}),/volc.seedasr.auc/);
  assert.throws(()=>speechResult({...response,responseHeaders:''}),/未知/);
  assert.throws(()=>speechResult({...response,responseText:'{}'}),/没有返回/);
});
test('positive offset delays cues, negative offset advances them including large corrections', () => {
  const sample = timeline([{start:100, original:'test'}]);
  assert.equal(activeCue(sample, subtitleTime(100, 3)), null);
  assert.equal(activeCue(sample, subtitleTime(103, 3)).original, 'test');
  assert.equal(activeCue(sample, subtitleTime(97, -3)).original, 'test');
  assert.equal(subtitleTime(1200, 1100), 100);
  assert.match(srt(sample, -3), /00:01:37,000/);
});
test('below-video caption stays inside reserved band and leaves player controls room', () => {
  const rect = {left:100,right:1100,top:100,bottom:800,height:700};
  const below = captionLayout(rect, 1400, true);
  assert.equal(below.band, 160);
  assert.ok(below.top > rect.bottom - below.band);
  assert.ok(below.top + below.maxHeight <= rect.bottom - 32);
  assert.equal(below.left + below.width / 2, 600);
  assert.equal(captionLayout(rect,1400,false,60).top,740);
  const small = captionLayout({left:0,right:400,top:0,bottom:200,height:200},400,true);
  assert.equal(small.band,80);
  assert.ok(small.top + small.maxHeight < 200);
});
const flush = () => new Promise(resolve => setImmediate(resolve));
function mockRequests() {
  const calls = [];
  const request = (text, source, target) => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const call = { text, source, target, resolve, reject, aborted: false };
    calls.push(call);
    return { promise, abort() { call.aborted = true; } };
  };
  return { calls, request };
}
test('Ark payload matches Responses translation contract and chosen direction', () => {
  const body = translationBody('Hello');
  assert.equal(body.model, 'doubao-seed-translation-250915');
  assert.deepEqual(body.input, [{role:'user', content:[{type:'input_text',text:'Hello',translation_options:{source_language:'en',target_language:'zh'}}]}]);
  assert.equal(translationBody('你好','zh','en').input[0].content[0].translation_options.target_language, 'en');
});
test('Ark output parser only accepts final translated message text', () => {
  assert.equal(translationResult({status:'completed',output:[{type:'reasoning',content:[]},{type:'message',content:[{type:'output_text',text:'你好'}]}]}), '你好');
  assert.throws(() => translationResult({status:'incomplete',output:[]}), /未完成/);
  assert.throws(() => translationResult({output:[]}), /未返回译文/);
  assert.throws(() => translationResult({error:{message:'secret'}}), /未完成/);
});
test('no requests before explicit start, serial queue, repeat cache', async () => {
  const {calls,request} = mockRequests();
  const t = createTranslator(request);
  t.schedule(['a']); assert.equal(calls.length, 0);
  t.start('en','zh'); t.schedule(['a','a','b']);
  assert.equal(calls.length, 1);
  calls[0].resolve('甲'); await flush();
  assert.equal(calls.length, 2); assert.equal(calls[1].text, 'b');
  calls[1].resolve('乙'); await flush();
  t.schedule(['a','b']); assert.equal(calls.length, 2);
  assert.equal(t.get('a'), '甲');
});
test('stop aborts in-flight work and ignores late response', async () => {
  const {calls,request} = mockRequests(); const t = createTranslator(request);
  t.start('en','zh'); t.schedule(['a','b']); t.stop();
  assert.equal(calls[0].aborted, true);
  calls[0].resolve('late'); await flush();
  assert.equal(t.get('a'), ''); assert.equal(calls.length, 1);
  assert.equal(t.enabled, false);
});
test('seek replaces queued work; reset isolates courses and directions', async () => {
  const {calls,request} = mockRequests(); const t = createTranslator(request);
  t.start('en','zh'); t.schedule(['a','b']); t.schedule(['z']);
  calls[0].resolve('甲'); await flush();
  assert.equal(calls[1].text, 'z');
  t.reset(); t.start('zh','en'); t.schedule(['a']);
  calls[1].resolve('旧课'); calls[2].resolve('new'); await flush();
  assert.equal(t.get('z'), ''); assert.equal(t.get('a'), 'new');
  assert.equal(calls[2].source, 'zh');
});
test('failure stops queue with no automatic repeated charges', async () => {
  const {calls,request} = mockRequests(); const messages = [];
  const t = createTranslator(request, msg => messages.push(msg));
  t.start('en','zh'); t.schedule(['a','b']);
  calls[0].reject(new Error('API Key 无效')); await flush();
  t.schedule(['a']); assert.equal(calls.length, 1); assert.equal(t.enabled, false);
  assert.equal(messages.at(-1), 'API Key 无效');
});
test('timestamps and invalid recognition rows', () => {
  assert.equal(parseTime(' 03:45:54\n'), 13554);
  assert.ok(Number.isNaN(parseTime('00:99:01')));
  assert.ok(Number.isNaN(parseTime('发起翻译')));
});
const cues = timeline([
  {start: 20, original: 'second', translation: '第二句'},
  {start: 5, original: 'first', translation: ''},
  {start: 60, original: 'last', translation: ''}
], 10);
test('seeking backward, exact boundaries and silent gaps', () => {
  assert.equal(activeCue(cues, 4), null);
  assert.equal(activeCue(cues, 5).original, 'first');
  assert.equal(activeCue(cues, 15), null);
  assert.equal(activeCue(cues, 20).original, 'second');
  assert.equal(activeCue(cues, 65).original, 'last');
  assert.equal(activeCue(cues, 6).original, 'first');
  assert.equal(activeCue(cues, 70), null);
});
test('next cue shortens estimated end and equal timestamps retain both lines', () => {
  const result = timeline([{ start: 0, original: 'a' }, { start: 0, original: 'b' }, { start: 2, original: 'c' }]);
  assert.equal(result[0].end, 2);
  assert.equal(result[0].original, 'a\nb');
  assert.equal(activeCue(result, 2).original, 'c');
});
test('SRT uses bilingual text and shifts timestamps without negative times', () => {
  assert.match(srt(cues, 0.5), /00:00:20,500 --> 00:00:30,500\nsecond\n第二句/);
  assert.match(srt(cues, -10), /^1\n00:00:00,000 --> 00:00:05,000/);
});

const { recognizeStandard } = require('./zhiyun-subtitles.user.js');
const asrResponse = (code, utterances = []) => ({status:200,responseHeaders:`X-Api-Status-Code: ${code}`,responseText:JSON.stringify({result:{utterances}})});
test('standard ASR submits once then polls same request ID until timestamped result', async () => {
  const calls=[], responses=[asrResponse(20000000),asrResponse(20000002),asrResponse(20000001),asrResponse(20000000,[{text:'test',start_time:500}])];
  const result=await recognizeStandard(async (...args)=>{calls.push(args);return responses.shift();},async()=>{},'audio','test-key','test-uuid');
  assert.equal(result[0].start_time,500);
  assert.deepEqual(calls.map(c=>c[0]),['submit','query','query','query']);
  assert.ok(calls.every(c=>c[1]['X-Api-Request-Id']==='test-uuid' && c[1]['x-api-key']==='test-key' && c[1]['X-Api-Resource-Id']==='volc.seedasr.auc'));
  assert.equal(calls[0][2].request.show_utterances,true);
  assert.equal(calls[0][2].audio.data,'audio');
  assert.deepEqual(calls[1][2],{});
});
test('standard ASR fails without resubmission on rejected input, HTTP error or missing status', async()=>{
  for(const response of [asrResponse(45000000),{...asrResponse(20000000),status:401},{...asrResponse(20000000),responseHeaders:''}]) {
    let count=0;
    await assert.rejects(recognizeStandard(async()=>{count++;return response;},async()=>{},'audio','test-key','id'),/标准版识别失败/);
    assert.equal(count,1);
  }
});
test('standard ASR cancellation during polling never queries or applies a late result',async()=>{
  let cancelled=false,count=0;
  await assert.rejects(recognizeStandard(async()=>{count++;return asrResponse(20000000);},async()=>{cancelled=true;},'audio','key','id',()=>cancelled),/取消/);
  assert.equal(count,1);
  await assert.rejects(recognizeStandard(async()=>{cancelled=true;return asrResponse(20000000);},async()=>{},'audio','key','id',()=>cancelled),/取消/);
});
test('standard ASR caps polling and does not submit another job on timeout',async()=>{
  const calls=[];
  await assert.rejects(recognizeStandard(async action=>{calls.push(action);return asrResponse(action==='submit'?20000000:20000001);},async()=>{},'audio','key','id'),/超时/);
  assert.equal(calls.filter(c=>c==='submit').length,1);
  assert.equal(calls.filter(c=>c==='query').length,60);
});

test('presentation hash changes preserve course identity; actual course changes reset it',()=>{
 const {courseIdentity}=require('./zhiyun-subtitles.user.js');
 assert.equal(courseIdentity('#/replay?course_id=1&sub_id=2&tenant_code=3'),courseIdentity('#/replay?layout=ppt&tenant_code=3&sub_id=2&course_id=1'));
 assert.notEqual(courseIdentity('#/replay?course_id=1&sub_id=2'),courseIdentity('#/replay?course_id=1&sub_id=4'));
});

test('PPT timestamp matching handles offsets, seeks, missing times and repeated images',()=>{
 const {slideTime,slideAt}=require('./zhiyun-subtitles.user.js');
 assert.equal(slideTime('01:02:03'),3723);assert.equal(slideTime('02:03'),123);
 assert.ok(Number.isNaN(slideTime('未加载')));
 const slides=[{time:0,url:'same'},{time:20,url:'other'},{time:40,url:'same'}];
 assert.equal(slideAt(slides,25),1);assert.equal(slideAt(slides,subtitleTime(25,10)),0);
 assert.equal(slideAt(slides,40),2);assert.equal(slideAt(slides,2),0);
 assert.equal(slideAt(slides,-1),-1);assert.equal(slideAt([{time:NaN}],10),-1);
});


test('target language detection preserves Chinese with short terms while retaining foreign passages',()=>{
 const {isTargetLanguage}=require('./zhiyun-subtitles.user.js');
 assert.equal(isTargetLanguage('我们现在开始讨论这个问题。','zh'),true);
 assert.equal(isTargetLanguage('对','zh'),true);
 assert.equal(isTargetLanguage('我们用 Python 来分析这些数据','zh'),true);
 assert.equal(isTargetLanguage('我们使用 Transformer attention mechanism 来处理输入序列并输出结果','zh'),false);
 assert.equal(isTargetLanguage('这里使用 CPU GPU API 共同完成计算','zh'),true);
 assert.equal(isTargetLanguage('使用 Python','zh'),true);
 assert.equal(isTargetLanguage('This is the next example.','zh'),false);
 assert.equal(isTargetLanguage('这里我们说 the market is very efficient today','zh'),false);
 assert.equal(isTargetLanguage('This is the next example.','en'),true);
 assert.equal(isTargetLanguage('我们现在开始讨论','en'),false);
 assert.equal(isTargetLanguage('2026 / 09 / 19 …','zh'),true);
 assert.equal(isTargetLanguage('これはテストです','zh'),false);
});
test('Chinese with variables and short phrases never requests translation; foreign passages still do',async()=>{
 const {calls,request}=mockRequests();const t=createTranslator(request);
 const skipped=['我们继续讲下一页','我们用 API 来处理这些数据','令 x 等于 y','x 轴','这里调用 foo bar 处理输入','这是 a_i 与 b2 的关系'];
 const mixed='这里使用 Transformer attention mechanism 来分析这个序列';
 t.start('auto','zh');t.schedule([...skipped,mixed,'The second example']);
 assert.equal(calls.length,1);assert.equal(calls[0].text,mixed);
 calls[0].resolve('这里使用注意力机制来分析这个序列');await flush();
 assert.equal(calls.length,2);assert.equal(calls[1].text,'The second example');
 calls[1].resolve('第二个例子');await flush();
 t.schedule(skipped);assert.equal(calls.length,2);assert.equal(t.enabled,true);t.stop();
});

test('video downloader uses privileged transport, validates bytes and rejects unsafe domains',async()=>{
 const {downloadVideo}=require('./zhiyun-subtitles.user.js');
 const blob=new Blob([new Uint8Array([0,0,0,16,102,116,121,112,105,115,111,109])]);
 let options;
 const result=await downloadVideo(o=>{options=o;queueMicrotask(()=>o.onload({status:200,response:blob}));return{abort(){}};},'https://video.cmc.zju.edu.cn/test.mp4',{limit:100});
 assert.equal(result,blob);assert.equal(options.responseType,'blob');assert.equal(options.headers,undefined);
 await assert.rejects(downloadVideo(()=>{throw new Error('must not request');},'https://untrusted.example/test.mp4',{limit:100}),/尚未授权/);
 for(const [status,response,pattern] of [[403,blob,/访问被拒绝/],[200,new Blob(['<html>login</html>']),/不是 MP4/],[200,new Blob([]),/有效视频/]]) {
  await assert.rejects(downloadVideo(o=>{queueMicrotask(()=>o.onload({status,response}));return{abort(){}};},'https://video.cmc.zju.edu.cn/test.mp4',{limit:100}),pattern);
 }
});
test('video downloader aborts on cancellation and size overflow without saving late responses',async()=>{
 const {downloadVideo}=require('./zhiyun-subtitles.user.js');let opts,aborted=0;
 const request=o=>{opts=o;return{abort(){aborted++;o.onabort();}};};
 const controller=new AbortController();const pending=downloadVideo(request,'https://video.cmc.zju.edu.cn/a.mp4',{limit:100,signal:controller.signal});
 controller.abort();await assert.rejects(pending,/取消/);assert.equal(aborted,1);
 const tooLarge=downloadVideo(request,'https://video.cmc.zju.edu.cn/a.mp4',{limit:100});
 opts.onprogress({loaded:1,total:101,lengthComputable:true});await assert.rejects(tooLarge,/上限/);assert.equal(aborted,2);
 opts.onload({status:200,response:new Blob(['late'])});
});


test('user confirmed VOD host is authorized without broadening to other subdomains',async()=>{
 const {downloadVideo}=require('./zhiyun-subtitles.user.js');let called=false;
 const blob=new Blob([new Uint8Array([0,0,0,16,102,116,121,112])]);
 await downloadVideo(o=>{called=true;queueMicrotask(()=>o.onload({status:200,response:blob}));return{abort(){}};},'https://vod.cmc.zju.edu.cn/lesson.mp4',{limit:100});
 assert.equal(called,true);
 await assert.rejects(downloadVideo(()=>{throw new Error('must not call');},'https://unknown.cmc.zju.edu.cn/lesson.mp4',{limit:100}),/尚未授权/);
});


test('range cache handles a 640 MB video one 8 MB block at a time without whole-file buffering',async()=>{
 const {downloadInChunks}=require('./zhiyun-subtitles.user.js');const chunk=8*1024*1024,total=640*1024*1024;
 const header=new Blob([new Uint8Array([0,0,0,16,102,116,121,112])]);let calls=0,writes=0,bytes=0,checked=0;
 const request=o=>{const range=o.headers.Range.match(/bytes=(\d+)-(\d+)/);const start=Number(range[1]),end=Math.min(Number(range[2]),total-1);calls++;
  assert.equal(start,bytes);if(start)assert.equal(o.headers['If-Range'],'"v1"');
  queueMicrotask(()=>o.onload({status:206,responseHeaders:`Content-Range: bytes ${start}-${end}/${total}\r\nETag: "v1"`,response:{size:end-start+1,slice:()=>header}}));return{abort(){}};};
 const size=await downloadInChunks(request,'https://vod.cmc.zju.edu.cn/big.mp4',{write:async blob=>{assert.ok(blob.size<=chunk);bytes+=blob.size;writes++;},checkSpace:async n=>{assert.equal(n,total);checked++;}});
 assert.equal(size,total);assert.equal(calls,80);assert.equal(writes,80);assert.equal(checked,1);
});
test('range cache rejects mismatched ranges, changed totals and insufficient quota before writing',async()=>{
 const {downloadInChunks}=require('./zhiyun-subtitles.user.js');const header=new Blob([new Uint8Array([0,0,0,16,102,116,121,112])]);
 for(const [range,quota,pattern] of [['bytes 1-8/16',false,/范围/],['bytes 0-7/16',true,/空间不足/]]) {
  let writes=0;
  await assert.rejects(downloadInChunks(o=>{queueMicrotask(()=>o.onload({status:206,responseHeaders:'Content-Range: '+range,response:header}));return{abort(){}};},'https://vod.cmc.zju.edu.cn/a.mp4',{chunkSize:8,write:async()=>{writes++;},checkSpace:async()=>{if(quota)throw new Error('空间不足');}}),pattern);
  assert.equal(writes,0);
 }
 let calls=0;
 await assert.rejects(downloadInChunks(o=>{const start=calls++*8;queueMicrotask(()=>o.onload({status:206,responseHeaders:`Content-Range: bytes ${start}-${start+7}/${calls===1?16:24}`,response:header}));return{abort(){}};},'https://vod.cmc.zju.edu.cn/a.mp4',{chunkSize:8,write:async()=>{}}),/总大小/);
});
test('range cache cancellation between chunks stops before another request',async()=>{
 const {downloadInChunks}=require('./zhiyun-subtitles.user.js');const controller=new AbortController();let calls=0;
 await assert.rejects(downloadInChunks(o=>{calls++;queueMicrotask(()=>o.onload({status:206,responseHeaders:'Content-Range: bytes 0-7/16',response:new Blob([new Uint8Array([0,0,0,16,102,116,121,112])])}));return{abort(){}};},'https://vod.cmc.zju.edu.cn/a.mp4',{chunkSize:8,signal:controller.signal,write:async()=>controller.abort()}),/取消/);
 assert.equal(calls,1);
});

// Automatic source language works in both contextual and economical profiles.
test('foreign subtitles use automatic source detection rather than a fixed English language',async()=>{
 const {contextualTranslationBody,translationBody}=require('./zhiyun-subtitles.user.js');
 for(const text of ['これは勾配降下法です。','Der Gradient zeigt nach oben.','La descente de gradient réduit la perte.']){
  const body=contextualTranslationBody(text,'auto','zh');assert.match(body.input[0].content,/自动识别目标字幕的语言/);assert.ok(body.input[1].content[0].text.includes(text));
  const economy=translationBody(text,'auto','zh');assert.equal(economy.model,body.model);assert.match(economy.input[0].content,/翻译为 zh/);
 }
 const {calls,request}=mockRequests();const translator=createTranslator(request);translator.start('auto','zh');translator.schedule(['已经是中文','これは勾配降下法です。']);assert.equal(calls.length,1);assert.equal(calls[0].text,'これは勾配降下法です。');translator.stop();
});


test('PPT independent clock and page calibration do not inherit speech anchors or playback rate',()=>{
 const {pptPlaybackTime,pptOffsetForPage,slideAt,syncedSubtitleTime}=require('./zhiyun-subtitles.user.js');
 const anchors=[{videoTime:0,offset:13.5},{videoTime:100,offset:13.5}];
 assert.equal(syncedSubtitleTime(34,0,anchors),20.5);assert.equal(pptPlaybackTime(34),34);
 assert.equal(pptPlaybackTime(34,30),4);assert.equal(pptPlaybackTime(34,-30),64);
 assert.equal(slideAt([{time:0},{time:20},{time:40},{time:60}],pptPlaybackTime(34,-30)),3);
 assert.equal(pptOffsetForPage(30,60),-30);assert.equal(pptOffsetForPage(90,60),30);
 assert.equal(pptOffsetForPage(30,NaN),null);assert.equal(pptOffsetForPage(Infinity,60),null);assert.equal(pptOffsetForPage(4000,0),null);
});

test('standard ASR uses a completed submit result immediately without querying again',async()=>{
 const calls=[],events=[],utterances=[{text:'recognized immediately',start_time:250}];
 const result=await recognizeStandard(async action=>{calls.push(action);return asrResponse(20000000,utterances);},async()=>assert.fail('must not wait'),'audio','key','same',()=>false,e=>events.push(e.stage));
 assert.deepEqual(result,utterances);assert.deepEqual(calls,['submit']);assert.deepEqual(events,['submit','recognized']);
});

test('a lost submit acknowledgement recovers by querying the same task without a second submit',async()=>{
 const calls=[],events=[];
 const result=await recognizeStandard(async(action,headers,body,options)=>{calls.push({action,id:headers['X-Api-Request-Id'],timeout:options.timeout});if(action==='submit')throw Object.assign(Error('submit timeout'),{code:'speech_timeout'});return asrResponse(20000000,[{text:'recovered',start_time:0}]);},async()=>{},'audio','key','recover-id',()=>false,e=>events.push(e.stage));
 assert.equal(result[0].text,'recovered');assert.deepEqual(calls.map(c=>c.action),['submit','query']);assert.ok(calls.every(c=>c.id==='recover-id'));assert.equal(calls[0].timeout,45000);assert.ok(calls[1].timeout<=30000);assert.ok(events.includes('recover'));
});

test('transient query failures retry only the existing UUID and stop after three consecutive failures',async()=>{
 for(const recover of [true,false]){
  const calls=[],events=[];let queries=0;
  const run=()=>recognizeStandard(async(action,headers)=>{calls.push([action,headers['X-Api-Request-Id']]);if(action==='submit')return asrResponse(20000000);if(++queries<3||!recover)throw Object.assign(Error('query timeout'),{code:'speech_timeout'});return asrResponse(20000000,[{text:'ready',start_time:0}]);},async()=>{},'audio','key','query-id',()=>false,e=>events.push(e.stage));
  if(recover)assert.equal((await run())[0].text,'ready');else await assert.rejects(run(),/query timeout/);
  assert.equal(calls.filter(c=>c[0]==='submit').length,1);assert.equal(queries,3);assert.ok(calls.every(c=>c[1]==='query-id'));assert.equal(events.filter(s=>s==='retry').length,2);
 }
});

test('HTTP rejection after submit never retries or creates another paid speech job',async()=>{
 const calls=[];
 await assert.rejects(recognizeStandard(async action=>{calls.push(action);return action==='submit'?asrResponse(20000000):{...asrResponse(45000000),status:401};},async()=>{},'audio','key','id'),/HTTP 401/);
 assert.deepEqual(calls,['submit','query']);
});

test('cancellation during submit recovery prevents querying or displaying a late transcript',async()=>{
 let cancelled=false;const calls=[],events=[];
 await assert.rejects(recognizeStandard(async action=>{calls.push(action);throw Object.assign(Error('timeout'),{code:'speech_timeout'});},async()=>{cancelled=true;},'audio','key','id',()=>cancelled,e=>events.push(e.stage)),/取消/);
 assert.deepEqual(calls,['submit']);assert.ok(!events.includes('recognized'));
});


test('standard ASR preserves safe gateway authorization errors and does not query a rejected submit',async()=>{
 const calls=[],response={status:502,responseHeaders:'',responseText:'{}',gatewaySpeechError:{code:'speech_upstream_auth',message:'语音服务授权失败，请联系管理员检查服务权限。'}};
 await assert.rejects(recognizeStandard(async action=>{calls.push(action);return response;},async()=>{},'audio','key','same'),{code:'speech_upstream_auth',message:response.gatewaySpeechError.message});assert.deepEqual(calls,['submit']);
 assert.throws(()=>speechResult(response),{code:'speech_upstream_auth',message:response.gatewaySpeechError.message});
});

test('standard ASR recovers safe gateway network errors only by querying the original task',async()=>{
 const calls=[],response={status:502,responseHeaders:'',responseText:'{}',gatewaySpeechError:{code:'speech_upstream_network',message:'语音服务连接中断'}};
 const result=await recognizeStandard(async(action,headers)=>{calls.push([action,headers['X-Api-Request-Id']]);return action==='submit'?response:asrResponse(20000000,[{text:'recovered',start_time:0}]);},async()=>{},'audio','key','original-task');
 assert.equal(result[0].text,'recovered');assert.deepEqual(calls,[['submit','original-task'],['query','original-task']]);
});
