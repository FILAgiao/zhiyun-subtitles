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


test('target language detection skips Chinese, English and neutral text but retains mixed sentences',()=>{
 const {isTargetLanguage}=require('./zhiyun-subtitles.user.js');
 assert.equal(isTargetLanguage('我们现在开始讨论这个问题。','zh'),true);
 assert.equal(isTargetLanguage('对','zh'),true);
 assert.equal(isTargetLanguage('我们用 Python 来分析这些数据','zh'),true);
 assert.equal(isTargetLanguage('This is the next example.','zh'),false);
 assert.equal(isTargetLanguage('这里我们说 the market is very efficient today','zh'),false);
 assert.equal(isTargetLanguage('This is the next example.','en'),true);
 assert.equal(isTargetLanguage('我们现在开始讨论','en'),false);
 assert.equal(isTargetLanguage('2026 / 09 / 19 …','zh'),true);
 assert.equal(isTargetLanguage('これはテストです','zh'),false);
});
test('mixed-language queues send only subtitles needing translation without disabling translation',async()=>{
 const {calls,request}=mockRequests();const t=createTranslator(request);
 t.start('en','zh');t.schedule(['我们继续讲下一页','The first example','我们用 API 来处理这些数据','The second example']);
 assert.equal(calls.length,1);assert.equal(calls[0].text,'The first example');
 calls[0].resolve('第一个例子');await flush();
 assert.equal(calls.length,2);assert.equal(calls[1].text,'The second example');
 calls[1].resolve('第二个例子');await flush();
 t.schedule(['现在都是中文','好的']);assert.equal(calls.length,2);assert.equal(t.enabled,true);
 t.start('zh','en');t.schedule(['This is already English','现在换成中文']);
 assert.equal(calls.length,3);assert.equal(calls[2].text,'现在换成中文');
 t.stop();
});
