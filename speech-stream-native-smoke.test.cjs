/* Real browser audio graph; local synthesized tone only, no service or network. */
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
function toneWav(){
 const rate=48000,samples=rate*6,buffer=Buffer.alloc(44+samples*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.round(Math.sin(2*Math.PI*440*i/rate)*12000),44+i*2);return buffer.toString('base64');
}
(async()=>{
 const source=fs.readFileSync('speech-stream.js','utf8'),reports=[];
 for(const [name,executablePath] of [['chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],['edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]){
  const browser=await chromium.launch({headless:true,executablePath,args:['--autoplay-policy=no-user-gesture-required']});
  try{
   const page=await browser.newPage();await page.goto('about:blank');await page.setContent('<video id="v" src="data:audio/wav;base64,'+toneWav()+'"></video>');await page.evaluate(async()=>{await document.querySelector('video').play();});
   const cdp=await page.context().newCDPSession(page),frame=(await cdp.send('Page.getFrameTree')).frameTree.frame.id,world=await cdp.send('Page.createIsolatedWorld',{frameId:frame,worldName:'speech-native-smoke'});
   const expression=source+'\n(async()=>{const video=document.querySelector("video"),chunks=[],errors=[];const source=ZYSpeechStream.createPCMSource(video);await source.start({onChunk:value=>chunks.push(value),onError:error=>errors.push(error.message)});await new Promise(resolve=>setTimeout(resolve,1100));source.stop();let energy=0,count=0;for(const chunk of chunks){const view=new DataView(chunk.pcm.buffer);for(let i=0;i<chunk.pcm.length;i+=2){energy+=view.getInt16(i,true)**2;count++;}}return {chunks:chunks.length,samples:count,rms:Math.sqrt(energy/Math.max(1,count)),videoStart:chunks[0]?.videoStart,currentTime:video.currentTime,errors};})()';
   const evaluation=await cdp.send('Runtime.evaluate',{contextId:world.executionContextId,expression,awaitPromise:true,returnByValue:true});
   if(evaluation.exceptionDetails)throw new Error(JSON.stringify(evaluation.exceptionDetails));
   const report={browser:name,...evaluation.result.value};assert.ok(report.chunks>=3,'native graph produces 200 ms PCM chunks');assert.equal(report.samples,report.chunks*3200);assert.ok(report.rms>1000,'captured PCM contains the real synthesized tone');assert.equal(report.errors.length,0);assert.ok(report.videoStart<report.currentTime);reports.push(report);console.log(name+' isolated native PCM '+JSON.stringify(report));
  }finally{await browser.close();}
 }
 fs.writeFileSync('.test-media/speech-stream-native-smoke.json',JSON.stringify({kind:'local_synthetic_tone_no_upload',reports},null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;});
