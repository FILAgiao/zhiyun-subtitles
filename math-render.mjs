import katex from 'katex';
const css=__MATH_CSS__;
export function install(shadow){
 const doc=shadow.ownerDocument;
 if(!doc.getElementById('zhiyun-math-fonts')){const fonts=doc.createElement('style');fonts.id='zhiyun-math-fonts';fonts.textContent=css.match(/@font-face\{[^}]+\}/g).join('\n');doc.head.append(fonts);}
 const style=doc.createElement('style');style.textContent=css.replace(/@font-face\{[^}]+\}/g,'')+' .ai-math-block{overflow-x:auto;overflow-y:hidden;padding:4px 0}.ai-markdown .katex{font-size:1.08em}.ai-markdown .katex-display{margin:.6em 0}';shadow.append(style);return()=>style.remove();
}
export function render(node,latex,displayMode=false){
 try{katex.render(latex,node,{displayMode,throwOnError:false,trust:false,strict:'ignore',maxExpand:1000,maxSize:20,output:'htmlAndMathml'});}catch(_){node.textContent=latex;}
}
