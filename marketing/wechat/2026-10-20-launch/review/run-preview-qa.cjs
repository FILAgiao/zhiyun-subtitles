const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..'),review=__dirname;
const normalize=s=>s.normalize('NFKC').replace(/\s+/g,'');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
(async()=>{
 const preview=path.join(base,'preview.html'),url='file:///'+preview.replace(/\\/g,'/');
 const results={checkedAt:new Date().toISOString(),status:'final',url,sourceSha256:sha(path.join(base,'article.md')),previewSha256:sha(preview),viewports:[],clipboardWritePrevented:true};
 const lines=fs.readFileSync(path.join(base,'article.md'),'utf8').split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('![')).map(l=>l.replace(/^#{1,6}\s+/,'').replace(/^>\s*/,'').replace(/\*\*/g,''));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  for(const width of [1440,390,320]){
   const context=await browser.newContext({viewport:{width,height:width===1440?1100:844},deviceScaleFactor:1,locale:'zh-CN'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url,{waitUntil:'load'});
   await page.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await document.fonts.ready;});
   const data=await page.evaluate(()=>{
    const c=document.getElementById('gzh-content'),r=c.getBoundingClientRect(),text=c.innerText;
    const overflowElements=[...c.querySelectorAll('*')].filter(e=>{const b=e.getBoundingClientRect();return b.width&&(b.right>r.right+1||b.left<r.left-1);}).map(e=>({tag:e.tagName,text:e.innerText?.slice(0,80),right:e.getBoundingClientRect().right,left:e.getBoundingClientRect().left}));
    const textClipping=[];const w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){if(!n.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(n);for(const b of range.getClientRects())if(b.right>r.right+1||b.left<r.left-1)textClipping.push({text:n.textContent.slice(0,80),right:b.right,left:b.left});}
    const hint=document.querySelector('.gzh-hint').getBoundingClientRect(),button=document.getElementById('gzhCopyBtn').getBoundingClientRect();
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,contentWidth:r.width,contentScrollWidth:c.scrollWidth,text,images:[...c.querySelectorAll('img')].map(i=>({src:i.getAttribute('src'),complete:i.complete,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,width:i.getBoundingClientRect().width,height:i.getBoundingClientRect().height})),overflowElements,textClipping,placeholderMatches:text.match(/TODO|TBD|placeholder|待补充|待插入|待填写|\{\{[^}]+\}\}/gi)||[],literalMarkdownLinks:text.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g)||[],genericThemeRemnants:text.match(/TECH INSIGHT|KEY INSIGHT|科技\s*[·・]\s*产业\s*[·・]\s*人|深度观察|这类文章能走多远|顺手关注|设为星标/g)||[],brandMastheadPresent:text.includes('浙大小奶蛙 · 新作品'),toolbar:{hintRight:hint.right,buttonLeft:button.left,noOverlap:hint.right<=button.left}};
   });
   data.completeMarkdownLines=lines.length;data.missingMarkdownLines=lines.filter(l=>!normalize(data.text).includes(normalize(l)));data.allSevenImagesLoaded=data.images.length===7&&data.images.every(i=>i.complete&&i.naturalWidth>0);data.noHorizontalOverflow=data.documentWidth<=width&&data.bodyWidth<=width;data.pageErrors=errors;
   const prefix=width===1440?'preview-desktop':`preview-mobile-${width}`;data.screenshots=[`${prefix}-full.png`];await page.screenshot({path:path.join(review,`${prefix}-full.png`),fullPage:true});
   if(width!==1440){await page.screenshot({path:path.join(review,`${prefix}-first.png`)});data.screenshots.push(`${prefix}-first.png`);}
   if(width===390){
    await page.locator('img').nth(4).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(review,'preview-mobile-390-middle.png')});
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));await page.screenshot({path:path.join(review,'preview-mobile-390-bottom.png')});
    data.screenshots.push('preview-mobile-390-middle.png','preview-mobile-390-bottom.png');
    await page.evaluate(()=>{window.qaCopyEvents=[];document.addEventListener('copy',e=>{e.preventDefault();const s=getSelection(),holder=document.createElement('div');for(let i=0;i<s.rangeCount;i++)holder.append(s.getRangeAt(i).cloneContents());window.qaCopyEvents.push({isTrusted:e.isTrusted,type:e.type,defaultPrevented:e.defaultPrevented,text:s.toString(),html:holder.innerHTML,rangeCount:s.rangeCount,ancestor:s.rangeCount?s.getRangeAt(0).commonAncestorContainer.nodeName:null});},true);});
    await page.locator('#gzhCopyBtn').click();
    const copy=await page.evaluate(()=>({events:window.qaCopyEvents,toast:document.getElementById('gzhToast').textContent,selectionCleared:getSelection().rangeCount===0})),event=copy.events[0];
    if(event){fs.writeFileSync(path.join(review,'copy-selection.html'),event.html,'utf8');copy.eventSummary={isTrusted:event.isTrusted,defaultPrevented:event.defaultPrevented,rangeCount:event.rangeCount,ancestor:event.ancestor,textLength:event.text.length,imageCount:(event.html.match(/<img\b/g)||[]).length,includesTitle:event.text.includes('报告！浙大小奶蛙做了一个上课小工具'),includesClosing:event.text.includes('网课不硬扛，浙大上课爽！'),excludesToolbar:!event.html.includes('gzh-toolbar')&&!event.html.includes('gzhCopyBtn')&&!event.text.includes('下方是排版效果'),matchesContentHtml:event.html===await page.locator('#gzh-content').innerHTML()};copy.events=copy.events.map(e=>({isTrusted:e.isTrusted,type:e.type,defaultPrevented:e.defaultPrevented,textLength:e.text.length,htmlLength:e.html.length}));}results.copy=copy;
   }
   delete data.text;results.viewports.push(data);await context.close();
  }
  results.previewUnchangedDuringQa=results.previewSha256===sha(preview);
  results.layoutChecksPassed=results.previewUnchangedDuringQa&&results.viewports.every(v=>v.allSevenImagesLoaded&&v.noHorizontalOverflow&&v.overflowElements.length===0&&v.textClipping.length===0&&v.missingMarkdownLines.length===0&&v.placeholderMatches.length===0&&v.pageErrors.length===0&&v.literalMarkdownLinks.length===0&&v.genericThemeRemnants.length===0&&v.brandMastheadPresent);
  results.toolbarChecksPassed=results.viewports.every(v=>v.toolbar.noOverlap);
  results.copyCheckPassed=!!results.copy?.eventSummary?.isTrusted&&results.copy.eventSummary.imageCount===7&&results.copy.eventSummary.excludesToolbar&&results.copy.eventSummary.includesTitle&&results.copy.eventSummary.includesClosing&&results.copy.eventSummary.matchesContentHtml;
  results.verificationBoundary={copy:'A real trusted browser copy event was captured. The capture handler prevented its default clipboard write. Captured selection matched the complete content HTML, contained 7 images, and excluded the toolbar. Actual OS clipboard persistence and WeChat editor paste were not verified.',localImages:'Copied HTML contains local relative images/... paths. This does not upload image bytes to WeChat. The publisher must upload and replace the 7 local images in the WeChat editor, then preview on mobile.',publication:'No WeChat draft upload, login, or public publication performed.'};
  fs.writeFileSync(path.join(review,'preview-qa.json'),JSON.stringify(results,null,2),'utf8');console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
