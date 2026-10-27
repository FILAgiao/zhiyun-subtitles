const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
function buildPublicPage(){
 const settings=JSON.parse(fs.readFileSync('backend/public-page.json','utf8').replace(/^\uFEFF/,''));
 const version=settings.pageVersion||require('./package.json').version;
 if(!/^[0-9]+\.[0-9]+\.[0-9]+(?:-r[0-9]+)?$/.test(version))throw Error('无效的页面版本。');
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function storeUrl(value,host){let url;try{url=new URL(value);}catch{throw Error('商店链接不是有效网址。');}if(url.protocol!=='https:'||url.hostname!==host||url.username||url.password)throw Error('商店链接必须是 '+host+' 的 HTTPS 网址。');return value;}
 const chrome=storeUrl(settings.chromeStoreUrl,'chromewebstore.google.com');
 const edge=settings.edgeStoreUrl?storeUrl(settings.edgeStoreUrl,'microsoftedge.microsoft.com'):'';
 const chromeIcon='<svg class="browser-icon" viewBox="0 0 32 32" aria-hidden="true"><path fill="#ea4335" d="M16 2a14 14 0 0 1 12.1 7H16a7 7 0 0 0-6.1 3.5L5.3 4.9A14 14 0 0 1 16 2Z"/><path fill="#fbbc05" d="M28.1 9A14 14 0 0 1 16 30l6-10.5A7 7 0 0 0 16 9Z"/><path fill="#34a853" d="M16 30A14 14 0 0 1 5.3 4.9l6.1 10.6A7 7 0 0 0 22 19.5Z"/><circle cx="16" cy="16" r="6" fill="#4285f4" stroke="#fff" stroke-width="1.5"/></svg>';
 const edgeIcon='<svg class="browser-icon" viewBox="0 0 32 32" aria-hidden="true"><path fill="#0a91d2" d="M30 18c0 8-8 13-16 12C4 29 0 20 3 12c3-8 13-12 21-7 5 3 7 8 6 13Z"/><path fill="#15c5a1" d="M3 14C6 3 21-1 28 9c3 5 2 10-2 12 2-5-1-9-6-10-7-2-12 2-17 3Z"/><path fill="#0870b4" d="M4 20c6 5 17 6 24-1-3 10-17 13-23 4Z"/><path fill="#e8fffc" d="M9 16c2-6 12-6 15 0-4-2-9-1-12 2Z"/></svg>';
 const badge=(kind,url,icon,label,enabled)=>enabled?'<a class="store-button '+kind+'" href="'+escape(url)+'" target="_blank" rel="noopener noreferrer" aria-label="'+label+'">'+icon+'<span class="store-copy"><small>从商店获取</small><strong>'+label+'</strong></span><span class="badge-arrow" aria-hidden="true">↗</span></a>':'<button class="store-button '+kind+'" type="button" disabled aria-label="'+label+' · 即将上线 · 审核中">'+icon+'<span class="store-copy"><small>即将上线 · 审核中</small><strong>'+label+'</strong></span></button>';
 const chromeButton=badge('chrome',chrome,chromeIcon,'Chrome 插件商店',true);
 const edgeButton=badge('edge',edge,edgeIcon,'Edge 插件商店',Boolean(edge));
 const html=fs.readFileSync('backend/download.template.html','utf8').replace(/^\uFEFF/,'').replaceAll('{{VERSION}}',escape(version)).replaceAll('{{CHROME_BUTTON}}',chromeButton).replaceAll('{{EDGE_BUTTON}}',edgeButton);
 if(/\{\{[A-Z_]+\}\}/.test(html))throw Error('介绍页还有未替换的模板字段。');
 fs.writeFileSync('backend/download.html',html);
 fs.mkdirSync('backend/landing',{recursive:true});
 for(const id of ['02','01','03','04','05','06'])fs.copyFileSync('assets/onboarding/image-'+id+'.webp','backend/landing/image-'+id+'.webp');
 fs.copyFileSync('assets/brand-logo.png','backend/landing/brand-logo.png');
 fs.copyFileSync('assets/share-qr.png','backend/landing/plugin-qr.png');
 const preview=path.resolve('dist/public-page-'+version);fs.mkdirSync(path.join(preview,'landing'),{recursive:true});
 const offline=html.replaceAll('/gateway/landing/','./landing/').replaceAll('/gateway/download.css','./download.css').replaceAll('/gateway/site.js','./site.js').replaceAll('href="/gateway/study','href="https://47.77.182.216.sslip.io/gateway/study').replaceAll('href="/gateway/account','href="https://47.77.182.216.sslip.io/gateway/account').replaceAll('href="/gateway/"','href="./index.html"').replaceAll('href="/gateway/extension.zip"','href="https://47.77.182.216.sslip.io/gateway/extension.zip"').replaceAll('href="/gateway/privacy"','href="https://47.77.182.216.sslip.io/gateway/privacy"');
 fs.writeFileSync(path.join(preview,'index.html'),offline);fs.copyFileSync('backend/download.css',path.join(preview,'download.css'));fs.copyFileSync('backend/site.js',path.join(preview,'site.js'));
 for(const file of fs.readdirSync('backend/landing'))fs.copyFileSync(path.join('backend/landing',file),path.join(preview,'landing',file));
 fs.writeFileSync(path.join(preview,'README.txt'),'浙大上课爽 · 本地介绍页 '+version+'\n\n解压后双击 index.html 查看。六张介绍图和样式已包含，无需登录或启动服务器。\nChrome 按钮打开已提供的商店链接，需要联网；Edge 正在审核，按钮暂不可点击。\n这是本地介绍页预览包，尚未部署到公网；不会改变现有扫码地址。账号与问答需通过同域 HTTP 预览（见完整官网验收包）；此离线文件内的账号链接指向原官网，功能待部署。\n部署源文件见仓库 backend/download.template.html、download.css、public-page.json。\n');
 const zip=path.resolve('dist/public-page-'+version+'.zip');
 cp.execFileSync('python',['-c','import pathlib,zipfile,sys; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(p,p.relative_to(root).as_posix()) for p in sorted(root.rglob("*")) if p.is_file()]; z.close()',preview,zip]);
 console.log('Public introduction page ready: v'+version+'; six images; Edge '+(edge?'store linked':'under review')+'.');
}
module.exports=buildPublicPage;
if(require.main===module)buildPublicPage();
