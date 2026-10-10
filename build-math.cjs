const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
let css=fs.readFileSync('node_modules/katex/dist/katex.min.css','utf8');
css=css.replace(/src:[^;}]+/g,value=>{const match=value.match(/url\(([^)]+\.woff2)\)\s*format\([^)]+\)/);if(!match)throw Error('Missing woff2 font');const file=path.join('node_modules/katex/dist',match[1].replace(/["']/g,''));return 'src:url(data:font/woff2;base64,'+fs.readFileSync(file).toString('base64')+') format("woff2")';});
esbuild.buildSync({entryPoints:['math-render.mjs'],bundle:true,minify:true,format:'iife',globalName:'ZYMath',outfile:'math-render.bundle.js',define:{__MATH_CSS__:JSON.stringify(css)},legalComments:'inline'});
fs.appendFileSync('math-render.bundle.js','\nglobalThis.ZYMath=ZYMath;\n/* '+fs.readFileSync('node_modules/katex/LICENSE','utf8').replace(/\*\//g,'* /')+' */\n');
console.log('Built offline KaTeX with embedded fonts.');
