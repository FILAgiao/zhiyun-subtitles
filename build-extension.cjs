const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
(async()=>{
 const version = require('./package.json').version;
 const storeOnly = process.argv[2] === '--store-only';
 const validChannels = ['chrome-store', 'edge-store'];
 const channels = storeOnly ? process.argv.slice(3) : [process.env.EXTENSION_CHANNEL || 'unpacked'];
 if (!channels.length || channels.some((value) => !validChannels.includes(value) && (storeOnly || value !== 'unpacked'))) {
  throw Error('Invalid extension release channel');
 }
 const [channel] = channels;
 const dir = path.resolve(storeOnly ? `dist/extension-${channel}` : 'dist/extension');
 fs.mkdirSync(dir, {recursive: true});
 const source=fs.readFileSync('zhiyun-subtitles.user.js','utf8').replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
 fs.writeFileSync(path.join(dir,'content.js'),fs.readFileSync('extension/adapter.js','utf8')+'\nstartExtension(function(GM_xmlhttpRequest,GM_getValue,GM_setValue,GM_deleteValue,GM_registerMenuCommand){\n'+source+'\n}).catch(()=>console.error("上课爽未能初始化，请重新打开页面。"));\n');
 const backgroundSource = fs.readFileSync('extension/background.js', 'utf8');
 const releaseChannelDeclaration = "const RELEASE_CHANNEL='unpacked';";
 if (!backgroundSource.includes(releaseChannelDeclaration)) throw Error('Missing release channel declaration');
 fs.copyFileSync('extension/portal-bridge.js',path.join(dir,'portal-bridge.js'));
 const manifest={manifest_version:3,name:'浙大上课爽',version,description:"网课不硬扛，浙大上课爽！实时翻译、放课加速、重点随地摘、AI 随时问 : )",permissions:['storage','contextMenus','activeTab'],host_permissions:['<all_urls>'],background:{service_worker:'background.js'},content_scripts:[{matches:['https://47.77.182.216.sslip.io/gateway/*'],js:['portal-bridge.js'],run_at:'document_start',all_frames:false},{matches:['https://*/*','http://*/*'],js:['content.js'],run_at:'document_idle',all_frames:false}],commands:{'zy-capture-page':{suggested_key:{default:'Ctrl+Shift+Y'},description:'截图并问当前页'}},action:{default_title:'浙大上课爽 · 登录与账号',default_icon:{16:'icon16.png',32:'icon32.png'}},icons:{16:'icon16.png',32:'icon32.png',48:'icon48.png',128:'icon128.png'},homepage_url:'https://47.77.182.216.sslip.io/gateway/',content_security_policy:{extension_pages:"script-src 'self'; object-src 'self'"}};
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const {chromium}=require('playwright');const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{const page=await browser.newPage();let logo=fs.readFileSync('assets/brand-logo.png');for(const size of [16,32,48,128]){await page.setViewportSize({width:size,height:size});await page.setContent('<style>body{margin:0;background:#fff}img{width:100vw;height:100vh;object-fit:contain}</style><img src="data:image/png;base64,'+logo.toString('base64')+'">');await page.locator('img').evaluate(el=>el.decode());await page.screenshot({path:path.join(dir,'icon'+size+'.png')});}}finally{await browser.close();}
 const notices=[['katex','LICENSE'],['html2canvas','LICENSE'],['mp4box','LICENSE'],['pinyin-pro','LICENSE'],['@mermaid-js/tiny','LICENSE']].map(([name,file])=>{const p='node_modules/'+name+'/'+file;return name+'\n'+(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'License available in '+name+' package');}).join('\n\n');fs.writeFileSync(path.join(dir,'THIRD_PARTY_NOTICES.txt'),notices);
 const sharedFiles = ['content.js', 'portal-bridge.js', 'manifest.json', 'THIRD_PARTY_NOTICES.txt',
  'icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'];
 for (const releaseChannel of channels) {
  const releaseDir = releaseChannel === channel ? dir : path.resolve(`dist/extension-${releaseChannel}`);
  if (releaseDir !== dir) {
   fs.mkdirSync(releaseDir, { recursive: true });
   for (const file of sharedFiles) fs.copyFileSync(path.join(dir, file), path.join(releaseDir, file));
  }
  const background = backgroundSource.replace(releaseChannelDeclaration, 'const RELEASE_CHANNEL=' + JSON.stringify(releaseChannel) + ';');
  fs.writeFileSync(path.join(releaseDir, 'background.js'), background);
  const suffix = storeOnly ? `-${releaseChannel}` : '';
  const zip = path.resolve(`dist/zhiyun-subtitles-${version}${suffix}.zip`);
  const files = storeOnly ? [...sharedFiles, 'background.js'] : [];
  cp.execFileSync('python', ['-c', [
   'from pathlib import Path',
   'from zipfile import ZipFile, ZIP_DEFLATED',
   'import sys',
   'root, output, *names = sys.argv[1:]',
   'root = Path(root)',
   'files = [root / name for name in names] if names else [p for p in root.iterdir() if p.is_file()]',
   'with ZipFile(output, "w", ZIP_DEFLATED) as archive:',
   '    for file in sorted(files):',
   '        archive.write(file, file.name)',
  ].join('\n'), releaseDir, zip, ...files]);
  if (!storeOnly) {
   fs.copyFileSync(zip, 'backend/extension.zip');
   require('./build-public-page.cjs')();
  }
  console.log('Extension ready: ' + zip);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
