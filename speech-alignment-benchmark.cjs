'use strict';
/*
 * Deterministic SYNTHETIC ASR alignment benchmark. No audio or live ASR calls.
 * The train and holdout topic banks are fixed and disjoint. Do not tune on the
 * holdout bank. These results cannot establish a real classroom 90% ASR rate.
 *
 * First listening session: one uninterrupted audio clock, at most 20 seconds.
 * Success: correct caption position and offset error <= 1.5 seconds.
 * A located interior with no observed timed boundary is a justified abstention,
 * included in all-positive recall and reported separately from observable recall.
 */
const {match}=require('./speech-alignment.js');
const TRAIN_TOPICS=Object.freeze([
 '工业相机采集金属表面图像','网络交换机转发数据报文','温度控制器调节炉膛功率','数据库索引加速条件查询',
 '电荷信号经过模拟数字转换','机械手臂跟踪运动轨迹','磁场传感器测量转子速度','数字滤波器抑制高频噪声'
]);
const HOLDOUT_TOPICS=Object.freeze([
 '无人车辆融合激光雷达地图','锂电池电极材料传输离子','光纤通信接收远端调制信号','液压伺服机构驱动精密平台',
 '晶圆光刻设备校正曝光误差','卫星遥感装置观测海洋温度','超声检测仪测量复合材料裂纹','太阳能逆变器调整输出频率',
 '气体色谱仪分离混合样品','红外测温设备分析热场分布','生物反应器维持细胞培养环境','数控机床补偿主轴热变形',
 '高压输电线路监测绝缘状态','深度神经网络提取空间特征','惯性导航装置估计飞行姿态','燃气轮机叶片承受高温载荷',
 '半导体存储单元保持电荷状态','毫米波天线阵列形成定向波束','流体实验平台记录管道压差','高分辨率显微镜观察薄膜结构'
]);
const STRATA=Object.freeze(['exact','substitution','homophone','sentence_split','midcue_boundary','midcue_unobservable','repeated_ambiguous','silence','conflict']);
const tokens=text=>text.match(/[a-z0-9]+|[\u3400-\u9fff]/gi)||[];
const words=(text,from=500,step=120)=>tokens(text).map((text,index)=>({text,start_time:from+index*step,end_time:from+(index+1)*step}));
function utterance(text,from=500,step=120){
 const list=words(text,from,step);return {text,start_time:from,end_time:list.at(-1)?.end_time??from,words:list};
}
function phrase(topic){return topic+'系统需要检测边缘并计算目标位置同时校验传感器参数';}
function distractors(index){
 return [
  {start:20,original:'课程首先介绍古代农业生产方式以及不同地区的粮食运输情况'+index},
  {start:280,original:'下面通过建筑史材料解释古代城市的街道布局以及人口变化'+index},
  {start:470,original:'这段文学作品通过人物之间的对话描写家庭关系和生活方式'+index}
 ];
}
function makeCases(split){
 const topics=split==='train'?TRAIN_TOPICS:HOLDOUT_TOPICS;
 return topics.flatMap((topic,index)=>{
  const text=phrase(topic),next=phrase(topics[(index+1)%topics.length]),base=distractors(index);
  const common={split,id:split+'-'+String(index).padStart(2,'0'),synthetic:true,maxSessionMs:20000};
  const item=(stratum,utterances,cues,extra)=>({...common,id:common.id+'-'+stratum,stratum,utterances,cues,start:103,...extra});
  const observed={expectedMatched:true,observable:true,expectedOffset:3.5,boundaryTime:500,expectedCueStart:100};
  const negative={expectedMatched:false,observable:false};
  let cursor=500;const pieces=[];
  for(let from=0;from<text.length;from+=4){const part=utterance(text.slice(from,from+4),cursor);pieces.push(part);cursor=part.end_time;}
  const currentCue='前面解释实验装置的准备方法以及有关元件的制造过程'+text;
  const midCues=[...base,{start:100,original:currentCue},{start:112,original:next}];
  return [
   item('exact',[utterance(text)],[...base,{start:100,original:text}],observed),
   item('substitution',[utterance(text.replace('系统需要','系统采用'))],[...base,{start:100,original:text}],observed),
   item('homophone',[utterance(text.replace('边缘','边园').replace('目标','木标'))],[...base,{start:100,original:text}],observed),
   item('sentence_split',pieces,[...base,{start:100,original:text}],observed),
   item('midcue_boundary',[utterance(text,500,80),utterance(next,5000,120)],midCues,
    {expectedMatched:true,observable:true,start:110,expectedOffset:3,boundaryTime:5000,expectedCueStart:112}),
   item('midcue_unobservable',[utterance(text,500)],midCues,
    {expectedMatched:true,observable:false,start:110,expectedOffset:3,boundaryTime:null,expectedCueStart:100}),
   item('repeated_ambiguous',[utterance(text)],[...base,{start:100,original:text},{start:200,original:text}],negative),
   item('silence',[],[...base,{start:100,original:text}],negative),
   item('conflict',[utterance(text),utterance(next,7000,120)],[...base,{start:100,original:text},{start:200,original:next}],negative)
  ];
 });
}
function evaluate(cases,{incremental=true}={}){
 const report={synthetic:true,definition:{session:'one uninterrupted audio clock <= 20 seconds',position:'actual boundary maps to expected caption within 1.5 seconds',offsetToleranceSeconds:1.5,providerRecognitionAccuracy:'not measured'},total:cases.length,positive:0,observablePositive:0,firstSessionSuccess:0,unobservablePositive:0,negative:0,falseAcceptance:0,wrongPositive:0,locatedUnobservable:0,byStratum:{},failures:[],latencyMs:[]};
 for(const sample of cases){
  const result=match(sample.utterances,sample.cues,sample.start);
  const elapsed=Math.max(0,...sample.utterances.map(item=>item.end_time||0));
  const position=Number.isFinite(sample.boundaryTime)&&Number.isFinite(result.offset)?sample.start+sample.boundaryTime/1000-result.offset:null;
  const correct=result.matched&&elapsed<=sample.maxSessionMs&&Math.abs(result.offset-sample.expectedOffset)<=1.5&&Math.abs(position-sample.expectedCueStart)<=1.5;
  const row=report.byStratum[sample.stratum]??={total:0,expectedPositive:0,correct:0,abstained:0,falseAcceptance:0};
  row.total++;
  if(sample.expectedMatched){
   report.positive++;row.expectedPositive++;
   if(sample.observable)report.observablePositive++;else {report.unobservablePositive++;if(result.located)report.locatedUnobservable++;}
   if(correct){
    report.firstSessionSuccess++;row.correct++;
    let firstMs=elapsed;
    if(incremental)for(let count=1;count<=sample.utterances.length;count++){
     const partial=match(sample.utterances.slice(0,count),sample.cues,sample.start);
     if(partial.matched&&Math.abs(partial.offset-sample.expectedOffset)<=1.5){firstMs=sample.utterances[count-1].end_time;break;}
    }
    report.latencyMs.push(firstMs);
   }else{
    if(result.matched)report.wrongPositive++;else row.abstained++;
    report.failures.push({id:sample.id,observable:sample.observable,reason:result.reason||'wrong_position_or_offset',located:result.located===true});
   }
  }else{
   report.negative++;
   if(result.matched){report.falseAcceptance++;row.falseAcceptance++;report.failures.push({id:sample.id,reason:'false_acceptance'});}
   else row.abstained++;
  }
 }
 report.observableFirstSessionRate=report.observablePositive?report.firstSessionSuccess/report.observablePositive:null;
 report.allPositiveFirstSessionRate=report.positive?report.firstSessionSuccess/report.positive:null;
 report.negativeFalseAcceptanceRate=report.negative?report.falseAcceptance/report.negative:null;
 report.latencyMs.sort((a,b)=>a-b);
 report.latency={medianMs:report.latencyMs[Math.floor(report.latencyMs.length*.5)]??null,p90Ms:report.latencyMs[Math.floor(report.latencyMs.length*.9)]??null,unit:'synthetic audio timeline; not network or provider wall latency'};
 delete report.latencyMs;
 return report;
}
if(require.main===module){
 const reports=['train','holdout'].map(split=>({split,...evaluate(makeCases(split))}));
 if(process.argv.includes('--json'))console.log(JSON.stringify({notice:'SYNTHETIC TEXT/TIMESTAMPS ONLY; REAL ASR SUCCESS RATE NOT MEASURED',reports},null,2));
 else for(const r of reports){
  console.log(r.split+': '+r.total+' synthetic cases; observable first-session '+r.firstSessionSuccess+'/'+r.observablePositive+' ('+(r.observableFirstSessionRate*100).toFixed(1)+'%); all positives '+r.firstSessionSuccess+'/'+r.positive+' ('+(r.allPositiveFirstSessionRate*100).toFixed(1)+'%); false acceptances '+r.falseAcceptance+'/'+r.negative+'; unobservable located '+r.locatedUnobservable+'/'+r.unobservablePositive);
  console.log('  '+JSON.stringify(r.latency));
  for(const [stratum,row]of Object.entries(r.byStratum))console.log('  '+stratum+': '+JSON.stringify(row));
 }
 if(reports.some(r=>r.falseAcceptance||r.wrongPositive||r.observableFirstSessionRate<.9))process.exitCode=1;
}
module.exports={makeCases,evaluate,STRATA};
