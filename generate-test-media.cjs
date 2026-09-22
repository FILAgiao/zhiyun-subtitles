const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const ffmpeg=process.env.FFMPEG_PATH || 'ffmpeg';fs.mkdirSync('.test-media',{recursive:true});
const run=args=>{const p=spawnSync(ffmpeg,['-hide_banner','-loglevel','error',...args],{stdio:'inherit'});if(p.status!==0)throw new Error('FFmpeg failed; install FFmpeg or set FFMPEG_PATH');};
const inputs=['-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000'];
run([...inputs,'-t','45','-c:v','libx264','-preset','ultrafast','-g','48','-bf','0','-c:a','aac','-movflags','+faststart','-y','.test-media/lecture.mp4']);
run(['-i','.test-media/lecture.mp4','-c','copy','-y','.test-media/tail.mp4']);
run(['-f','lavfi','-i','testsrc2=size=160x90:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1500','-c:v','libx264','-preset','ultrafast','-b:v','96k','-maxrate','96k','-bufsize','192k','-g','20','-bf','2','-c:a','aac','-b:a','32k','-movflags','+faststart','-y','.test-media/long-lecture.mp4']);
