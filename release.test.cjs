const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('zhiyun-subtitles.user.js','utf8');
const metadata=source.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0]+'\n';
assert.equal(fs.readFileSync('zhiyun-subtitles.meta.js','utf8'),metadata,'Published update metadata must match the installable script');
const field=name=>metadata.match(new RegExp('^// @'+name+'\\s+(.+)$','m'))?.[1].trim();
assert.equal(field('name'),'浙大上课爽');
assert.equal(field('version'),JSON.parse(fs.readFileSync('package.json','utf8')).version);
assert.equal(field('namespace'),'zhiyunzimu.local');
assert.equal(field('updateURL'),'https://raw.githubusercontent.com/FILAgiao/zhiyun-subtitles/main/zhiyun-subtitles.meta.js');
assert.equal(field('downloadURL'),'https://raw.githubusercontent.com/FILAgiao/zhiyun-subtitles/main/zhiyun-subtitles.user.js');
assert.match(field('description'),/网课不硬扛，浙大上课爽！/);
assert.ok(!/^\/\/ @require\s/m.test(metadata),'Release must include its modules without remote code dependencies');
for(const file of ['progressive-cache.bundle.js','cache-storage.js','study-ui.js','player-interactions.js','math-render.bundle.js','ai-learning.js'])assert.ok(source.includes(fs.readFileSync(file,'utf8')),file+' needs rebuilding');
assert.equal(source.split('// BEGIN BUNDLED LEARNING MODULES').length,2);
assert.equal(source.split('// END BUNDLED LEARNING MODULES').length,2);
console.log('PASS: release name, version, update/download URLs, metadata and bundled modules agree.');

const gatewayLiteral=source.match(/const DEFAULT_ORIGIN=([^;]+);/)?.[1];assert.ok(gatewayLiteral,'Gateway adapter must be bundled');const gatewayModule=fs.readFileSync('gateway-client.js','utf8').replace("const DEFAULT_ORIGIN='';",'const DEFAULT_ORIGIN='+gatewayLiteral+';');assert.ok(source.includes(gatewayModule),'Gateway adapter needs rebuilding');

if(fs.existsSync('backend/install.user.js')){
 const direct=fs.readFileSync('backend/install.user.js','utf8');const directMeta=fs.readFileSync('backend/install.meta.js','utf8');
 assert.equal(directMeta,direct.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0]+'\n');
 assert.match(directMeta,/\/\/ @updateURL\s+https:\/\/[^\n]+\/gateway\/install.meta.js/);
 assert.match(directMeta,/\/\/ @downloadURL\s+https:\/\/[^\n]+\/gateway\/install.user.js/);
 assert.match(directMeta,new RegExp('@version\\s+'+JSON.parse(fs.readFileSync('package.json','utf8')).version.replaceAll('.','\\.')));
 console.log('PASS: direct server installer has matching version and self-hosted update metadata.');
}
