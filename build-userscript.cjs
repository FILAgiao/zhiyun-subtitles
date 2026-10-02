const fs=require('fs');
let s=fs.readFileSync('zhiyun-subtitles.user.js','utf8');
const begin='// BEGIN BUNDLED LEARNING MODULES',end='// END BUNDLED LEARNING MODULES';
const files=['progressive-cache.bundle.js','cache-storage.js','study-ui.js','player-interactions.js','ai-learning.js'];
const code=begin+'\n'+files.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\nconst ZY_STUDY_MASCOT='+JSON.stringify('data:image/png;base64,'+fs.readFileSync('assets/study-eagle.png').toString('base64'))+';\n'+end;
if(s.includes(begin))s=s.slice(0,s.indexOf(begin))+code+s.slice(s.indexOf(end)+end.length);
else {const i=s.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length;s=s.slice(0,i)+'\n\n'+code+s.slice(i);}
s=s.split('\n').filter(line=>!(line.startsWith('// @require')&&line.includes('progressive-cache.bundle.js'))).join('\n');
fs.writeFileSync('zhiyun-subtitles.user.js',s);console.log('Inlined: '+files.join(', '));

const metadata=s.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
if(!metadata)throw new Error('Userscript metadata is missing');
fs.writeFileSync('zhiyun-subtitles.meta.js',metadata[0]+'\n');
