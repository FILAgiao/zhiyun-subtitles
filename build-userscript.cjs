const fs=require('fs');
const releaseVersion=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const gatewaySource=fs.readFileSync('gateway-client.js','utf8');
const versionedGateway=gatewaySource.replace(/const CLIENT_VERSION='[^']+';/,"const CLIENT_VERSION='"+releaseVersion+"';");
if(versionedGateway!==gatewaySource)fs.writeFileSync('gateway-client.js',versionedGateway);
const cardQuotes=require('./load-card-quotes.cjs')();
const onboardingArtwork=require('./load-onboarding-assets.cjs')();
let s=fs.readFileSync('zhiyun-subtitles.user.js','utf8').replace(/\r\n/g,'\n');
const begin='// BEGIN BUNDLED LEARNING MODULES',end='// END BUNDLED LEARNING MODULES';
const files=['warm-theme.js','appearance-theme.js','progressive-cache.bundle.js','cache-storage.js','study-ui.js','classroom-media.js','speech-alignment.js','player-interactions.js','math-render.bundle.js','card-render.bundle.js','capture-bridge-client.js','ai-learning.js','translation-request.js','gateway-client.js','web-assistant.js'];
const configuredGateway=process.env.GATEWAY_ORIGIN??(fs.existsSync('gateway.config.json')?JSON.parse(fs.readFileSync('gateway.config.json','utf8')).url:'');
const gatewayOrigin=configuredGateway?require('./gateway-client.js').baseURL(configuredGateway):'';
const code=begin+'\n'+files.map(p=>{let value=fs.readFileSync(p,'utf8');if(p==='gateway-client.js'&&gatewayOrigin)value=value.replace("const DEFAULT_ORIGIN='';",'const DEFAULT_ORIGIN='+JSON.stringify(gatewayOrigin)+';');return value;}).join('\n')+'\nconst ZY_STUDY_MASCOT='+JSON.stringify('data:image/png;base64,'+fs.readFileSync('assets/brand-logo.png').toString('base64'))+';\nconst ZY_BRAND_EAGLE='+JSON.stringify('data:image/svg+xml;base64,'+fs.readFileSync('assets/qiushi-eagle.svg').toString('base64'))+';\nconst ZY_SHARE_QR='+JSON.stringify('data:image/png;base64,'+fs.readFileSync('assets/share-qr.png').toString('base64'))+';\nconst ZY_KNOWLEDGE_CARD_QUOTES='+JSON.stringify(cardQuotes)+';\nconst ZY_ONBOARDING_ARTWORK='+JSON.stringify(onboardingArtwork)+';\n'+end;
if(s.includes(begin))s=s.slice(0,s.indexOf(begin))+code+s.slice(s.indexOf(end)+end.length);
else {const i=s.indexOf('// ==/UserScript==')+'// ==/UserScript=='.length;s=s.slice(0,i)+'\n\n'+code+s.slice(i);}
const seenConnect=new Set();
s=s.split('\n').filter(line=>{if(line.startsWith('// @connect')){const key=line.trim();if(seenConnect.has(key))return false;seenConnect.add(key);}return !(line.startsWith('// @require')&&line.includes('progressive-cache.bundle.js'));}).join('\n');
if(gatewayOrigin){const hostname=new URL(gatewayOrigin).hostname;if(!s.includes('// @connect      '+hostname+'\n'))s=s.replace('// ==/UserScript==','// @connect      '+hostname+'\n// ==/UserScript==');}
fs.writeFileSync('zhiyun-subtitles.user.js',s);console.log('Inlined: '+files.join(', '));

const metadata=s.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);
if(!metadata)throw new Error('Userscript metadata is missing');
fs.writeFileSync('zhiyun-subtitles.meta.js',metadata[0]+'\n');

// The direct server installer uses the server's own update endpoints.
if(gatewayOrigin){
  const installed=s.replace(/^\/\/ @updateURL\s+.+$/m,'// @updateURL    '+gatewayOrigin+'/install.meta.js').replace(/^\/\/ @downloadURL\s+.+$/m,'// @downloadURL  '+gatewayOrigin+'/install.user.js');
  fs.mkdirSync('backend',{recursive:true});
  fs.writeFileSync('backend/install.user.js',installed);
  fs.writeFileSync('backend/install.meta.js',installed.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0]+'\n');
}
