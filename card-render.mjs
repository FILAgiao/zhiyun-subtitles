import html2canvas from 'html2canvas';
// Use an isolated local document so course-page styles and remote images cannot enter an export.
export async function render(doc,build){
 const frame=doc.createElement('iframe');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;frame.style.cssText='position:fixed;left:-12000px;top:0;width:900px;height:600px;border:0;pointer-events:none';doc.body.append(frame);
 try{
  const fd=frame.contentDocument;fd.open();fd.write('<!doctype html><html><head></head><body></body></html>');fd.close();
  const style=fd.createElement('style');style.textContent=`html,body{margin:0;padding:0;background:transparent}.card-markdown{box-sizing:border-box;width:868px;color:#193654;font:30px/1.65 "Microsoft YaHei","Segoe UI",sans-serif;overflow-wrap:anywhere}.card-markdown *{box-sizing:border-box}.card-markdown p{margin:0 0 18px}.card-markdown>:last-child{margin-bottom:0}.card-markdown h2,.card-markdown h3,.card-markdown h4{color:#164e73;font-weight:700;line-height:1.4;margin:22px 0 12px}.card-markdown h2{font-size:38px}.card-markdown h3{font-size:34px}.card-markdown h4{font-size:31px}.card-markdown>:first-child{margin-top:0}.card-markdown ul,.card-markdown ol{padding-left:42px;margin:12px 0 20px}.card-markdown li{margin:8px 0}.card-markdown strong{font-weight:700}.card-markdown code{font:25px/1.6 Consolas,monospace;background:#e7eef6;padding:2px 5px;border-radius:5px}.card-markdown pre{background:#153044;color:#edf5ff;padding:20px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin:18px 0}.card-markdown pre code{background:transparent;color:inherit;padding:0}.card-markdown blockquote{border-left:5px solid #77a0be;background:#eef4fa;padding:12px 18px;margin:18px 0;color:#536f78}.card-markdown table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:25px;margin:16px 0}.card-markdown th,.card-markdown td{border:2px solid #c9d9df;padding:12px;text-align:left;overflow-wrap:anywhere}.card-markdown th{background:#dcebef}.card-markdown a{color:#1768ae}.card-markdown hr{border:0;border-top:2px solid #dce3eb;margin:20px 0}.card-markdown .ai-math-block{padding:12px;background:#f0f5fb;border-radius:12px;margin:18px 0;overflow:visible}.card-markdown .katex{font-size:1.05em}.card-markdown .katex-display{margin:.4em 0}.card-markdown .katex-html{white-space:normal}.card-markdown .katex-mathml{position:absolute;clip:rect(1px,1px,1px,1px);width:1px;height:1px;overflow:hidden}`;fd.head.append(style);
  const body=fd.createElement('div');body.className='card-markdown';fd.body.append(body);build(fd,body);
  await fd.fonts.ready;const height=Math.max(48,Math.ceil(body.getBoundingClientRect().height));
  const canvas=await html2canvas(body,{backgroundColor:null,logging:false,scale:Math.min(1,32000/height),width:868,height,windowWidth:900,windowHeight:Math.min(32000,height+20),scrollX:0,scrollY:0,allowTaint:false,useCORS:false,imageTimeout:1000});
  return {canvas,height};
 }finally{frame.remove();}
}

// Read the visible DOM locally; no continuous browser display-capture session.
export async function captureViewport(doc,{overlays=[],signal}={}){
 const win=doc.defaultView;
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const existing=new Set(doc.querySelectorAll('iframe.html2canvas-container'));
 const pending=html2canvas(doc.documentElement,{logging:false,scale:Math.min(2,win.devicePixelRatio||1),width:win.innerWidth,height:win.innerHeight,x:win.scrollX,y:win.scrollY,windowWidth:win.innerWidth,windowHeight:win.innerHeight,scrollX:win.scrollX,scrollY:win.scrollY,useCORS:true,allowTaint:false,imageTimeout:3000,ignoreElements:el=>el.id==='zy-subtitle-host',onclone:()=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');}});
 const frame=[...doc.querySelectorAll('iframe.html2canvas-container')].find(el=>!existing.has(el));
 const cleanup=()=>frame?.remove();signal?.addEventListener('abort',cleanup,{once:true});
 let canvas;try{canvas=await pending;}finally{signal?.removeEventListener('abort',cleanup);cleanup();}
 if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
 const ctx=canvas.getContext('2d'),scale=canvas.width/win.innerWidth;
 for(const image of overlays){const r=image.getBoundingClientRect();if(!r.width||!r.height||!image.naturalWidth)continue;const parent=image.parentElement.getBoundingClientRect();ctx.save();ctx.beginPath();ctx.rect(parent.left*scale,parent.top*scale,parent.width*scale,parent.height*scale);ctx.clip();let x=r.left,y=r.top,w=r.width,h=r.height;if(win.getComputedStyle(image).objectFit==='contain'){const ratio=Math.min(w/image.naturalWidth,h/image.naturalHeight);const nw=image.naturalWidth*ratio,nh=image.naturalHeight*ratio;x+=(w-nw)/2;y+=(h-nh)/2;w=nw;h=nh;}ctx.drawImage(image,x*scale,y*scale,w*scale,h*scale);ctx.restore();}
 return canvas;
}
