const {test}=require('node:test'),assert=require('node:assert/strict');const {match}=require('./speech-alignment.js');
const english='the financial market uses several different trading strategies for managing risk and measuring expected returns';
test('matches a recorded fragment at the start of a much longer subtitle without penalizing its unspoken tail',()=>{
 const long=english+' while the professor continues discussing many other unrelated details about investment institutions and their organizational structure in another market';
 assert.deepEqual(match([{text:english,start_time:500}],[{start:100,original:long}],103),{matched:true,offset:3.5});
});
test('uses actual word timestamps to find the next subtitle boundary when recording begins mid sentence',()=>{
 const text='partial opening then we study visual inspection and image processing for detecting defects in industrial products';const words=text.split(' ').map((text,i)=>({text,start_time:i*250,end_time:(i+1)*250}));
 assert.deepEqual(match([{text,start_time:0,words}],[{start:90,original:'some previous statement with a partial opening then'},{start:105,original:'we study visual inspection and image processing for detecting defects in industrial products'}],102),{matched:true,offset:-2.25});
});
test('aligns Chinese recognition across more than three subtitle rows with different sentence boundaries',()=>{
 const parts=['工业相机采集图像','然后算法检测边缘','接着计算目标位置','再用特征识别缺陷','最后输出检测结果','我们继续分析误差'];const cues=parts.map((original,i)=>({start:40+i*2,original}));
 assert.deepEqual(match([{text:parts.join('，'),start_time:1000}],cues,45),{matched:true,offset:6});
});
test('tolerates a limited recognition substitution without weakening short or duplicate rejection',()=>{
 assert.equal(match([{text:english.replace('different','distinct'),start_time:0}],[{start:100,original:english}],105).matched,true);
 assert.equal(match([{text:'yes yes yes',start_time:0}],[{start:100,original:'yes yes yes'}],105).matched,false);
 assert.equal(match([{text:english,start_time:0}],[{start:100,original:english},{start:200,original:english}],105).matched,false);
});
test('rejects conflicting uniquely matched utterances and missing ASR timestamps',()=>{
 const other='students should carefully study the database chapter and understand relationships';
 assert.equal(match([{text:english,start_time:0},{text:other,start_time:5000}],[{start:100,original:english},{start:200,original:other}],100).matched,false);
 assert.equal(match([{text:english}],[{start:100,original:english}],100).matched,false);
});
test('ignores punctuation word records with invalid timestamps and handles mixed Chinese/English',()=>{
 const text='我们使用 Transformer attention mechanism 处理图像序列并检测不同类别的缺陷';const tokens=text.match(/[a-zA-Z]+|[\u3400-\u9fff]/g);const words=tokens.flatMap((text,i)=>[{text,start_time:i*100,end_time:i*100+100},{text:' ',start_time:-1,end_time:-1}]);
 assert.deepEqual(match([{text,start_time:0,words}],[{start:20,original:text}],23),{matched:true,offset:3});
});
test('does not force a match for unrelated text or many repeated common subtitle prefixes',()=>{
 assert.equal(match([{text:english,start_time:0}],[{start:20,original:'计算机视觉中的照明设计决定图像质量和算法检测稳定性'}],23).matched,false);
 const cues=Array.from({length:200},(_,i)=>({start:i*10,original:'我们现在开始分析这个原理并继续讨论下一页'}));assert.equal(match([{text:cues[0].original,start_time:0}],cues,10).matched,false);
});
test('indexes a course of 1502 subtitle rows and finds the unique long caption fragment',()=>{
 const cues=Array.from({length:1502},(_,i)=>({start:i*5,original:'sample '+i+' discusses an unrelated numbered course segment with other details'}));cues[765]={start:3825,original:english+' and additional details beyond this recorded audio sample'};
 assert.deepEqual(match([{text:english,start_time:0}],cues,3828),{matched:true,offset:3});
});

test('a short matching tail cannot override a mostly unrelated recognition result',()=>{
 const text='many entirely unrelated words describe a separate topic about astronomy geology chemistry biology weather oceans mountains planets galaxies stars and nebulae then we study visual inspection algorithms';const words=text.split(' ').map((text,i)=>({text,start_time:i*100}));
 assert.equal(match([{text,start_time:0,words}],[{start:20,original:'then we study visual inspection algorithms'}],22).matched,false);
});

test('matches the first recognition when its opening contains substitutions',()=>{
 assert.deepEqual(match([{text:english.replace('the financial','a finance'),start_time:700}],[{start:100,original:english}],103),{matched:true,offset:3.7});
 const written='好那最关心的可能是成绩成绩评价我们成绩没有考试所以说可能就八次课里面每次四节';
 assert.deepEqual(match([{text:written.replace('好那最','那么最'),start_time:0}],[{start:50,original:written}],54),{matched:true,offset:4});
});

test('uses evidence beyond token 64 to distinguish otherwise identical long captions',()=>{
 const opening=Array.from({length:70},(_,i)=>'term'+i).join(' ');
 const ending='students examine manufacturing defects using industrial cameras and compare detection accuracy across several different production environments';
 const text=opening+' '+ending;
 assert.deepEqual(match([{text,start_time:0}],[{start:100,original:text},{start:200,original:opening+' a discussion of accounting policies taxation regulations monetary systems budget planning historical economies and public finance'}],103),{matched:true,offset:3});
});

test('reports missing word times when only a later subtitle boundary can be located',()=>{
 const later='we study visual inspection and image processing for detecting defects in industrial products';
 const result=match([{text:'the recording starts in the middle of an earlier sentence then '+later,start_time:0}],[{start:90,original:'a previous caption that began well before the recorded audio'},{start:105,original:later}],102);
 assert.equal(result.matched,false);assert.equal(result.reason,'missing_word_timestamps');
});

test('does not invent a timestamp inside one multi token ASR word record',()=>{
 const later='we study visual inspection and image processing for detecting defects in industrial products';
 const text='a partial earlier sentence then '+later;
 const result=match([{text,start_time:0,words:[{text,start_time:0}]}],[{start:105,original:later}],102);
 assert.equal(result.matched,false);assert.equal(result.reason,'missing_word_timestamps');
});

test('matches the real first word after a leading spoken filler',()=>{
 const text='well '+english;const words=text.split(' ').map((text,i)=>({text,start_time:100+i*200}));
 assert.deepEqual(match([{text,start_time:100,words}],[{start:100,original:english}],103),{matched:true,offset:3.3});
});

// The screenshot contains text and one subtitle time only. Every ASR word time
// below is synthetic; this fixture verifies alignment arithmetic, not classroom
// recognition accuracy or the timestamp quality returned by a live provider.
const screenshotRecognition='光信号变成了一些电荷信号。那电荷信号再根据后面的这个 A D 物理信号，就是因为它';
const screenshotSubtitle='那电荷信号再根据后面的这个ADC也就是模拟信号，就是为他的电气化。';
function screenshotUtterance(){
 const tokens=screenshotRecognition.match(/[a-zA-Z]+|[\u3400-\u9fff]/g);
 return {text:screenshotRecognition,start_time:0,words:tokens.map((text,index)=>({text,start_time:index<12?index*160:3000+(index-12)*150}))};
}
test('screenshot text retrieves its middle phrase and applies the first sample using synthetic actual boundary times',()=>{
 const cues=Array.from({length:1502},(_,index)=>({start:index*4,original:'课程编号'+index+'讨论其他章节里的学习内容和实验步骤'}));
 cues[936]={start:3744,original:screenshotSubtitle};
 assert.deepEqual(match([screenshotUtterance()],cues,3743),{matched:true,offset:2});
});
test('screenshot text is located without pretending an utterance start times its later subtitle boundary',()=>{
 const result=match([{text:screenshotRecognition,start_time:0}],[{start:3744,original:screenshotSubtitle}],3743);
 assert.equal(result.matched,false);assert.equal(result.reason,'missing_word_timestamps');
 assert.equal(result.candidate.start,3744);assert.equal(result.candidate.text,screenshotSubtitle);assert.ok(result.candidate.score>=.8);
});
test('a phrase inside a subtitle is retrieval evidence but cannot fabricate the missing subtitle boundary',()=>{
 const text='电荷信号再根据后面的这个ADC也就是模拟信号';
 const words=text.match(/[a-zA-Z]+|[\u3400-\u9fff]/g).map((text,index)=>({text,start_time:index*180}));
 const result=match([{text,start_time:0,words}],[{start:3744,original:screenshotSubtitle}],3743);
 assert.equal(result.matched,false);assert.equal(result.reason,'missing_word_timestamps');assert.equal(result.candidate.start,3744);
});
test('local screenshot matches do not turn one long multi character ASR word into invented character times',()=>{
 const result=match([{text:screenshotRecognition,start_time:0,words:[{text:screenshotRecognition,start_time:0}]}],[{start:3744,original:screenshotSubtitle}],3743);
 assert.equal(result.matched,false);assert.equal(result.reason,'missing_word_timestamps');assert.equal(result.candidate.start,3744);
});
test('Chinese homophones have a lower substitution cost while substantial literal evidence remains required',()=>{
 const original='工业相机采集图像算法检测边缘并计算目标位置';
 const text='工业相机采集图像算法检测边园并计算木标位置';
 assert.deepEqual(match([{text,start_time:500}],[{start:20,original}],23),{matched:true,offset:3.5});
 const alternating='电河信浩再跟据候面德这歌电路木标处礼方试';
 const written='电荷信号再根据后面的这个电路目标处理方式';
 assert.deepEqual(match([{text:alternating,start_time:0}],[{start:20,original:written}],23),{matched:true,offset:3});
 assert.equal(match([{text:'店合心浩寨跟据候面德者歌',start_time:0}],[{start:20,original:'电荷信号再根据后面的这个'}],23).matched,false);
});
test('polyphonic Chinese readings participate in weighted alignment',()=>{
 const original='工业相机检测银行信号然后计算目标位置';
 const text='工业相机检测银航信号然后计算目标位置';
 assert.deepEqual(match([{text,start_time:0}],[{start:20,original}],23),{matched:true,offset:3});
});
test('spelled English acronyms normalize without discarding the first actual ASR word start',()=>{
 const text='A D C converts the analog signal into digital values for the processor';
 const words=text.split(' ').map((text,index)=>({text,start_time:700+index*200}));
 assert.deepEqual(match([{text,start_time:700,words}],[{start:20,original:'ADC converts the analog signal into digital values for the processor'}],23),{matched:true,offset:3.7});
});
test('a unique generic short Chinese phrase is not enough to change the offset',()=>{
 const text='那么这个我们可以看到';
 assert.equal(match([{text,start_time:0}],[{start:20,original:text}],23).matched,false);
});
test('overlapping screenshot fragments cannot vote away an equally plausible repeated caption',()=>{
 const result=match([screenshotUtterance()],[{start:100,original:screenshotSubtitle},{start:3744,original:screenshotSubtitle}],3743);
 assert.equal(result.matched,false);assert.equal(result.reason,'ambiguous');
 const missing=match([{text:screenshotRecognition,start_time:0}],[{start:100,original:screenshotSubtitle},{start:3744,original:screenshotSubtitle}],3743);
 assert.equal(missing.matched,false);assert.equal(missing.reason,'ambiguous');assert.equal(missing.candidate,undefined);
});
test('an equally plausible homophone caption remains ambiguous instead of selecting its word spelling',()=>{
 const text='工业相机采集图像算法检测边原并计算目标位置';
 const result=match([{text,start_time:0}],[{start:20,original:'工业相机采集图像算法检测边缘并计算目标位置'},{start:120,original:'工业相机采集图像算法检测边园并计算目标位置'}],23);
 assert.equal(result.matched,false);assert.equal(result.reason,'ambiguous');
});
test('a later independent local phrase with a contradictory offset cannot be ignored',()=>{
 const other='工业相机采集图像算法检测边缘并计算目标位置';
 const result=match([screenshotUtterance(),{text:other,start_time:10000}],[{start:100,original:other},{start:3744,original:screenshotSubtitle}],3743);
 assert.equal(result.matched,false);assert.equal(result.reason,'conflicting_offsets');
});

test('verified punctuation windows retain real absolute word indexes inside a long ASR utterance',()=>{
 const unrelated='astronomy geology chemistry biology weather oceans mountains planets galaxies stars nebulae volcanoes rivers forests';
 const prefix=Array(4).fill(unrelated).join(' '),suffix=Array(4).fill(unrelated).join(' ');
 const text=prefix+'. '+english+'. '+suffix;
 const tokens=text.match(/[a-zA-Z]+/g),words=tokens.map((text,index)=>({text,start_time:100+index*200}));
 const middleIndex=prefix.split(' ').length;
 assert.deepEqual(match([{text,start_time:100,words}],[{start:20,original:english}],23),{matched:true,offset:Math.round((3+.1+middleIndex*.2)*100)/100});
 // If sentence text and timed words disagree, do not guess a punctuation index.
 const differingWords=words.map(word=>({...word}));differingWords[0].text='another';
 assert.equal(match([{text,start_time:100,words:differingWords}],[{start:20,original:english}],23).matched,false);
});
test('a stronger untimed subtitle location cannot be displaced by a weaker location with a timestamp',()=>{
 const stronger='students examine manufacturing defects using industrial cameras and compare detection accuracy across several different production environments while analyzing the measured results of repeated physical experiments';
 const text='unrelated partial opening then '+stronger;
 const result=match([{text:english,start_time:0},{text,start_time:5000}],[{start:20,original:english},{start:200,original:stronger}],23);
 assert.equal(result.matched,false);assert.equal(result.reason,'missing_word_timestamps');assert.equal(result.candidate.start,200);
});
test('equally strong untimed and timed locations remain ambiguous',()=>{
 const other='careful students inspect industrial components using several specialized cameras while documenting the observed surface defects';
 assert.equal(other.split(' ').length,english.split(' ').length);
 const result=match([{text:english,start_time:0},{text:'unrelated partial opening then '+other,start_time:5000}],[{start:20,original:english},{start:200,original:other}],23);
 assert.equal(result.matched,false);assert.equal(result.reason,'ambiguous');
});
test('independently clear subtitle boundaries in one utterance must also have consistent real times',()=>{
 const next='students should carefully study the database chapter and understand relationships';
 const text=english+'. '+next,words=text.match(/[a-zA-Z]+/g).map((text,index)=>({text,start_time:index*200}));
 const result=match([{text,start_time:0,words}],[{start:20,original:english},{start:40,original:next}],23);
 assert.equal(result.matched,false);assert.equal(result.reason,'conflicting_offsets');
});

test('a repeated subtitle prefix does not time an interior occurrence as the missing beginning',()=>{
 const original='我们今天我们今天介绍工业相机采集图像算法检测边缘并计算目标位置';
 const text='我们今天介绍工业相机采集图像算法检测边缘并计算目标位置';
 const words=[...text].map((text,index)=>({text,start_time:index*200}));
 const result=match([{text,start_time:0,words}],[{start:100,original}],103);
 assert.equal(result.matched,false);assert.equal(result.reason,'missing_word_timestamps');assert.equal(result.candidate.start,100);
});
test('a fully spoken repeated subtitle prefix retains its real beginning timestamp',()=>{
 const text='我们今天我们今天介绍工业相机采集图像算法检测边缘并计算目标位置';
 const words=[...text].map((text,index)=>({text,start_time:500+index*200}));
 assert.deepEqual(match([{text,start_time:500,words}],[{start:100,original:text}],103),{matched:true,offset:3.5});
});

test('single character repeated openings also preserve text evidence without inventing the missing boundary',()=>{
 for(const prefix of ['看','对']){
  const text=prefix+'工业相机采集图像算法检测边缘并计算目标位置',original=prefix+text;
  const words=[...text].map((text,index)=>({text,start_time:index*200}));
  const result=match([{text,start_time:0,words}],[{start:100,original}],103);
  assert.equal(result.matched,false);assert.equal(result.reason,'missing_word_timestamps');assert.equal(result.candidate.start,100);
 }
});

test('a six character Chinese fragment cannot change the offset even at a subtitle opening',()=>{
 const result=match([{text:'这个地方比较',start_time:0}],[{start:100,original:'这个地方比较复杂然后我们继续讨论后面的内容'}],103);
 assert.equal(result.matched,false);assert.equal(result.reason,'no_similar_text');
});
test('ten character Chinese discourse alone remains insufficient evidence',()=>{
 for(const text of ['我们先来分析一下问题','这个地方比较复杂然后我们继续讨论后面的内容','同学们今天我们继续讨论这个问题']){
  assert.equal(match([{text,start_time:0}],[{start:100,original:text}],103).matched,false);
 }
});
test('sufficient Chinese technical evidence survives complete discourse phrase filtering',()=>{
 for(const text of ['我们先来分析工业相机采集图像算法检测边缘','图像分辨率决定微分方程计算精度与目标位置检测效果']){
  assert.deepEqual(match([{text,start_time:500}],[{start:100,original:text}],103),{matched:true,offset:3.5});
 }
});


// All following word times are synthetic. These regressions exercise a single
// accumulating audio clock, not multiple newly recorded attempts.
function timedCharacters(text,from=0,step=180){
 return [...text].map((text,index)=>({text,start_time:from+index*step,end_time:from+(index+1)*step}));
}
test('a located mid-caption reports the next real boundary needed within the same listening session',()=>{
 const original='比如说大家现在现在现在可能除非比较专业玩单反专业搞车对啊还会看看光学影像摄像头工业也是差不多是这样一个情况那呢这个发展历程呢可能给大家的';
 const text='工业也是差不多是这样一个情况那呢这个发展历程呢可能给大家的';
 const next='传感器制造技术决定了工业相机的成像质量和动态范围';
 const cues=[{start:4390,original},{start:4403,original:next}];
 const first={text,start_time:0,end_time:9000,words:timedCharacters(text,0,200)};
 const located=match([first],cues,4396);
 assert.equal(located.matched,false);assert.equal(located.located,true);
 assert.equal(located.candidate.start,4390);assert.deepEqual(located.requiredNextBoundary,{start:4403,text:next});
 assert.equal(located.reason,'missing_word_timestamps');
 // The next final utterance supplies an actual timed boundary in this same
 // session. Nothing requires two further independent recordings.
 const final={text:next,start_time:10000,end_time:16000,words:timedCharacters(next,10000)};
 assert.deepEqual(match([first,final],cues,4396),{matched:true,offset:3});
});
test('streamed short final utterances accumulate enough evidence without throwing away their true word times',()=>{
 const text='高精度工业相机采集图像再由算法检测边缘并计算目标位置';
 const pieces=['高精度工','业相机采','集图像再','由算法检测边缘并计算目标位置'];
 let cursor=500;
 const utterances=pieces.map(text=>{const words=timedCharacters(text,cursor);const item={text,start_time:cursor,end_time:cursor+text.length*180,words};cursor=item.end_time;return item;});
 assert.deepEqual(match(utterances,[{start:100,original:text}],103),{matched:true,offset:3.5});
});
test('a real utterance start times a next-caption opening even when interior word times are unavailable',()=>{
 const opening='高精度工业相机';
 const ending='采集图像再由算法检测边缘并计算目标位置';
 const utterances=[{text:'这里先说明相机内部传感器如何工作',start_time:0,end_time:4000},{text:opening,start_time:5000,end_time:6200},{text:ending,start_time:6200,end_time:11000}];
 assert.deepEqual(match(utterances,[{start:100,original:opening+ending}],98),{matched:true,offset:3});
});
test('missing internal times stay missing after adjacent streamed utterances are combined',()=>{
 const original='我们现在详细解释高精度工业相机采集图像算法检测边缘并计算目标位置';
 const text='高精度工业相机采集图像算法检测边缘并计算目标位置';
 const split=8;
 const result=match([{text:text.slice(0,split),start_time:500,end_time:2000},{text:text.slice(split),start_time:2000,end_time:6000}],[{start:100,original}],103);
 assert.equal(result.matched,false);assert.equal(result.located,true);assert.equal(result.reason,'missing_word_timestamps');
});
test('overlapping streaming hypotheses cannot be concatenated into evidence not present in either hypothesis',()=>{
 const text='高精度工业相机采集图像算法检测边缘并计算目标位置';
 const first=text.slice(0,9),second=text.slice(9);
 const result=match([{text:first,start_time:500,end_time:2500,words:timedCharacters(first,500)},{text:second,start_time:1500,end_time:6500,words:timedCharacters(second,1500)}],[{start:100,original:text}],103);
 assert.equal(result.matched,false);
});
test('a long unobservable mid-caption remains located without estimating offset from character count or cue duration',()=>{
 const prefix='我们先详细介绍复杂电子传感器的制造过程以及它的工作原理';
 const text='工业相机采集图像算法检测边缘并计算目标位置';
 const result=match([{text,start_time:0,end_time:12000,words:timedCharacters(text,0,400)}],[{start:100,end:160,original:prefix+text}],130);
 assert.equal(result.matched,false);assert.equal(result.located,true);assert.equal(result.candidate.start,100);assert.equal(result.offset,undefined);
});

test('a repeated mid-caption is resolved by its unique adjacent next boundary in the same session',()=>{
 const tail='工业相机采集图像算法检测边缘并计算目标位置同时校验传感器参数';
 const prefix='前面介绍有关电子元件的制造过程';
 const next='高分辨率显微镜观察薄膜材料结构以及各种表面缺陷';
 const other='气体色谱仪分析混合样品的化学组成和分子结构';
 const cues=[{start:100,original:prefix+tail},{start:112,original:next},{start:200,original:prefix+tail},{start:212,original:other}];
 assert.deepEqual(match([{text:tail,start_time:0,end_time:4000,words:timedCharacters(tail,0,100)},{text:next,start_time:5000,end_time:10000,words:timedCharacters(next,5000,150)}],cues,110),{matched:true,offset:3});
});
test('equally repeated adjacent two-sided context remains ambiguous',()=>{
 const tail='工业相机采集图像算法检测边缘并计算目标位置同时校验传感器参数';
 const prefix='前面介绍有关电子元件的制造过程';
 const next='高分辨率显微镜观察薄膜材料结构以及各种表面缺陷';
 const cues=[{start:100,original:prefix+tail},{start:112,original:next},{start:200,original:prefix+tail},{start:212,original:next}];
 const result=match([{text:tail,start_time:0,end_time:4000,words:timedCharacters(tail,0,100)},{text:next,start_time:5000,end_time:10000,words:timedCharacters(next,5000,150)}],cues,110);
 assert.equal(result.matched,false);assert.equal(result.reason,'ambiguous');
});
test('two-sided context cannot outvote a later independent inconsistent subtitle boundary',()=>{
 const tail='工业相机采集图像算法检测边缘并计算目标位置同时校验传感器参数';
 const next='高分辨率显微镜观察薄膜材料结构以及各种表面缺陷';
 const other='气体色谱仪分析混合样品的化学组成和分子结构';
 const cues=[{start:100,original:'前面介绍有关电子元件的制造过程'+tail},{start:112,original:next},{start:200,original:other}];
 const result=match([{text:tail,start_time:0,end_time:4000,words:timedCharacters(tail,0,100)},{text:next,start_time:5000,end_time:10000,words:timedCharacters(next,5000,150)},{text:other,start_time:12000,end_time:17000,words:timedCharacters(other,12000,150)}],cues,110);
 assert.equal(result.matched,false);assert.equal(result.reason,'conflicting_offsets');
});

// Captured response shape from the real Doubao WebSocket verification using
// generated English speech (.test-media/stream-provider-verification.json).
// This is a provider-format regression, not a classroom accuracy measurement.
test('real provider stable words align without an utterance start_time and ignore negative-time space records',()=>{
 const text=' This is a speech alignment test.';
 const timings=[['This',1892,2132],['is',2132,2292],['a',2292,2532],['speech',2652,2772],['alignment',3212,3492],['test',3732,3932]];
 const words=timings.flatMap(([text,start_time,end_time])=>[{text:' ',start_time:-1,end_time:-1},{text,start_time,end_time}]);
 const utterance={definite:true,end_time:4932,text,words};
 const greeting={definite:true,end_time:1852,text:'Hello World.',words:[{text:'Hello',start_time:200,end_time:400},{text:' ',start_time:-1,end_time:-1},{text:'World',start_time:640,end_time:840}]};
 assert.deepEqual(match([greeting,utterance],[{start:100,original:text}],103),{matched:true,offset:4.89});
 assert.deepEqual(match([utterance],[{start:100,original:text}],103),{matched:true,offset:4.89});
 assert.equal(match([greeting],[{start:100,original:'Hello World.'}],103).matched,false);
});

test('real stream coordinator keeps a located mid-caption open until a later timed boundary in the same audio session',async()=>{
 const {createSession}=require('./speech-stream.js');
 const tail='工业相机采集图像算法检测边缘并计算目标位置同时校验传感器参数';
 const next='高分辨率显微镜观察薄膜材料结构以及各种表面缺陷';
 const cues=[{start:100,original:'前面介绍有关电子元件的制造过程'+tail},{start:112,original:next}];
 const first={text:tail,definite:true,end_time:4000,words:timedCharacters(tail,0,100)};
 const second={text:next,definite:true,end_time:8000,words:timedCharacters(next,5000,100)};
 const actions=[],matches=[];let pushes=0,stops=0;
 const audioSource={prepare(){},start(handlers){for(let i=0;i<8;i++)handlers.onChunk({pcm:new Uint8Array(32000),videoStart:110,playbackRate:1});},stop(){stops++;}};
 const snapshot=(utterances=[])=>({id:'alignment-integration',state:'listening',revision:pushes,result:{text:utterances.map(item=>item.text).join('。'),utterances}});
 const session=createSession({requestId:'alignment-integration',audioSource,maxSeconds:10,pollMs:1,sessionTimeoutMs:2000,
  transport:async action=>{actions.push(action);if(action==='push'){pushes++;return snapshot(pushes>=8?[first,second]:pushes>=4?[first]:[]);}return snapshot();},
  match:(utterances,start)=>{const result=match(utterances,cues,start);matches.push(result);return result;}});
 const result=await session.run();
 assert.equal(result.matched,true);assert.equal(result.alignment.offset,3);assert.equal(pushes,8);assert.equal(stops,1);
 assert.equal(actions.filter(action=>action==='create').length,1);assert.equal(actions.at(-1),'cancel');
 assert.equal(matches[0].matched,false);assert.equal(matches[0].located,true);assert.equal(matches.at(-1).matched,true);
});
