const fs=require('node:fs'),esbuild=require('esbuild');
const dependency=JSON.parse(fs.readFileSync('node_modules/pinyin-pro/package.json','utf8'));
if(dependency.version!=='3.29.5')throw Error('Review the phonetic dictionary before updating its pinned version');
esbuild.buildSync({entryPoints:['speech-phonetics.mjs'],bundle:true,minify:true,format:'iife',globalName:'ZYPinyin',outfile:'speech-phonetics.bundle.js',legalComments:'eof',target:'es2020'});
const license=fs.readFileSync('node_modules/pinyin-pro/LICENSE','utf8');
fs.appendFileSync('speech-phonetics.bundle.js','\nglobalThis.ZYPinyin=Object.freeze(ZYPinyin);\n/* pinyin-pro '+dependency.version+'\n'+license.replace(/\*\//g,'* /')+'\n*/\n');
console.log('Built offline phonetic dictionary: pinyin-pro '+dependency.version);
