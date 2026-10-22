const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const version=require('./package.json').version,label=version+'-stream-prepared',root=path.resolve('.'),dist=path.resolve('dist'),fixed=path.join(dist,'speech-stream-'+version+'-prepared'),backend=path.join(fixed,'backend');
if(!fixed.startsWith(dist+path.sep))throw Error('Unexpected output directory');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function copy(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);}
function zip(directory,output,files){cp.execFileSync('python',['-c','import pathlib,zipfile,sys,json; root=pathlib.Path(sys.argv[1]).resolve(); names=json.loads(sys.argv[3]); paths=[(root/name).resolve() for name in names]; assert all(p.is_relative_to(root) and p.is_file() for p in paths); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(p,name) for p,name in sorted(zip(paths,names),key=lambda x:x[1])]; z.close()',directory,output,JSON.stringify(files)]);}
fs.mkdirSync(fixed,{recursive:true});
const extensionZip=path.join(dist,'zhiyun-subtitles-'+label+'.zip');copy('dist/zhiyun-subtitles-'+version+'.zip',extensionZip);
copy('zhiyun-subtitles.user.js',path.join(dist,'zhiyun-subtitles-'+label+'.user.js'));copy('zhiyun-subtitles.meta.js',path.join(dist,'zhiyun-subtitles-'+label+'.meta.js'));
const source=fs.readFileSync('backend/deploy_release.py','utf8'),main=source.match(/^files=\[([^\n]+)\]/m),images=source.match(/^files \+= \['landing\/'\+name for name in \[([^\n]+)\]/m);
if(!main||!images)throw Error('Deployment whitelist missing');
const quoted=value=>[...value.matchAll(/'([^']+)'/g)].map(m=>m[1]);
const files=[...quoted(main[1]),...quoted(images[1]).map(name=>'landing/'+name),'.env.example','SPEECH-STREAM.md','README.md','COMPATIBILITY.md','PROMPTS.md','WEBSITE-LOCAL.md'];
for(const name of files){if(name.startsWith('/')||name.includes('..'))throw Error('Unsafe whitelist');copy(path.join('backend',name),path.join(backend,name));}
copy('backend/SPEECH-STREAM.md',path.join(fixed,'README.md'));
const sums={};for(const name of files)sums['backend/'+name]=sha(fs.readFileSync(path.join(backend,name)));
sums['README.md']=sha(fs.readFileSync(path.join(fixed,'README.md')));fs.writeFileSync(path.join(fixed,'SHA256SUMS.json'),JSON.stringify(sums,null,2)+'\n');
const gatewayZip=path.join(dist,'zhiyun-gateway-'+label+'.zip');zip(fixed,gatewayZip,[...Object.keys(sums),'SHA256SUMS.json']);
const report={version,status:'prepared locally for user-managed deployment; NOT PUBLISHED',created:new Date().toISOString(),extension:{file:path.basename(extensionZip),sha256:sha(fs.readFileSync(extensionZip)),files:fs.readdirSync('dist/extension').sort()},backend:{file:path.basename(gatewayZip),sha256:sha(fs.readFileSync(gatewayZip)),files:files.length,checksums:'speech-stream-'+version+'-prepared/SHA256SUMS.json'},userscript:{file:'zhiyun-subtitles-'+label+'.user.js',sha256:sha(fs.readFileSync('zhiyun-subtitles.user.js'))},metadata:{file:'zhiyun-subtitles-'+label+'.meta.js',sha256:sha(fs.readFileSync('zhiyun-subtitles.meta.js'))},runtimeCredentialsIncluded:false,realClassroomFirstPassRate:'not measured; 90% target unverified'};
const sourceBody=fs.readFileSync('zhiyun-subtitles.user.js','utf8').replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/,'');if(!fs.readFileSync('dist/extension/content.js','utf8').includes(sourceBody))throw Error('Extension differs from full userscript');
for(const file of ['content.js','background.js','manifest.json']){const value=fs.readFileSync(path.join('dist/extension',file),'utf8');if(/SPEECH_STREAM_API_KEY\s*=\s*[a-z0-9-]{20,}/i.test(value))throw Error('Unexpected supplier secret');}
fs.writeFileSync(path.join(dist,'speech-stream-'+version+'-prepared.json'),JSON.stringify(report,null,2)+'\n');
console.log('Prepared locally, not published: '+extensionZip+'; '+gatewayZip+'; '+files.length+' backend files with SHA256 checksums.');
