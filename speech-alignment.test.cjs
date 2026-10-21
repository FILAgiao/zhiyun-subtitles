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
