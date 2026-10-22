const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {allowedRequest}=require('./extension/background.js');
test('network bridge pins backend, strips extra headers and blocks secrets to providers',()=>{
const init=allowedRequest({url:'https://47.77.182.216.sslip.io/gateway/v1/auth/login',method:'POST',data:'{}',headers:{Authorization:'Bearer user-session',Cookie:'secret-cookie','X-Client-Type':'forged'}});assert.equal(init.credentials,'omit');assert.equal(init.headers.Cookie,undefined);assert.equal(init.headers['X-Client-Type'],'chrome-extension');
for(const url of ['https://ark.cn-beijing.volces.com/api/v3/responses','https://47.77.182.216.sslip.io/gateway/v1/admin/users','https://evil.test','http://video.cmc.zju.edu.cn/a','https://user:password@video.cmc.zju.edu.cn/a'])assert.throws(()=>allowedRequest({url}));
const image=allowedRequest({url:'https://video.cmc.zju.edu.cn/a',headers:{Authorization:'Bearer session',Range:'bytes=0-1'}});assert.equal(image.headers.Authorization,undefined);assert.equal(image.headers.Range,'bytes=0-1');assert.equal(image.credentials,'include');assert.throws(()=>allowedRequest({url:'https://video.cmc.zju.edu.cn/a',method:'POST',data:'{}'}));
});
test('store package uses MV3 and persistent screenshot access with local code and no private files',()=>{const m=JSON.parse(fs.readFileSync('dist/extension/manifest.json'));assert.equal(m.manifest_version,3);assert.equal(m.version,require('./package.json').version);assert.deepEqual(m.permissions,['storage','contextMenus','activeTab']);assert.deepEqual(m.host_permissions,['<all_urls>']);assert.equal(m.action.default_title,'截图并问当前页');assert.ok(m.commands['zy-capture-page']);assert.equal(m.permissions.includes('tabs'),false,'persistent pixels do not require unrestricted tab metadata');assert.equal(m.content_scripts[0].all_frames,false);assert.deepEqual(fs.readdirSync('dist/extension').sort(),['THIRD_PARTY_NOTICES.txt','background.js','content.js','icon128.png','icon16.png','icon32.png','icon48.png','manifest.json'].sort());assert.match(fs.readFileSync('dist/extension/content.js','utf8'),/const DEFAULT_ORIGIN="https:\/\/47\.77\.182\.216\.sslip\.io\/gateway"/);});
const {captureSenderTab}=require('./extension/background.js');
test('native screenshot validates sender and active tab before and after capture',async()=>{
 let captureCount=0,changed=false;const sender={id:'fixture-id',frameId:0,url:'https://example.test/',tab:{id:42,windowId:901}};
 const api={runtime:{id:'fixture-id'},windows:{get:async windowId=>{assert.equal(windowId,901);return {focused:true};}},tabs:{get:async()=>({id:42,windowId:901,active:!changed,url:'https://example.test/'}),captureVisibleTab:async(windowId,options)=>{assert.equal(windowId,901);assert.deepEqual(options,{format:'png'});captureCount++;return 'data:image/png;base64,fixture';}}};
 assert.equal(await captureSenderTab(api,sender),'data:image/png;base64,fixture');assert.equal(captureCount,1);
 for(const bad of [{...sender,id:'other'},{...sender,frameId:1},{...sender,url:'chrome://settings/'},{...sender,tab:{}},{...sender,tab:{id:42}}])await assert.rejects(captureSenderTab(api,bad));assert.equal(captureCount,1);
 const get=api.tabs.get;api.tabs.get=async()=>({id:42,windowId:901,active:true,url:'https://new-origin.test/'});await assert.rejects(captureSenderTab(api,sender),/跳转/);assert.equal(captureCount,1,'persistent access cannot send a newly navigated origin back to the old page');api.tabs.get=get;
 changed=true;await assert.rejects(captureSenderTab(api,sender),/标签页/);assert.equal(captureCount,1);
 changed=false;api.tabs.captureVisibleTab=async()=>{changed=true;captureCount++;return 'data:image/png;base64,fixture';};await assert.rejects(captureSenderTab(api,sender),/切换/);
 changed=false;api.windows.get=async()=>({focused:false});const before=captureCount;await assert.rejects(captureSenderTab(api,sender),/浏览器窗口/);assert.equal(captureCount,before,'Unfocused browser windows must not capture');
 let windowFocused=true;api.windows.get=async()=>({focused:windowFocused});api.tabs.captureVisibleTab=async()=>{windowFocused=false;captureCount++;return 'data:image/png;base64,fixture';};await assert.rejects(captureSenderTab(api,sender),/切换了浏览器窗口/);
});


test('background owns client version and channel metadata; school requests cannot receive it',()=>{
 const runtime={getManifest:()=>({version:require('./package.json').version})};
 const gateway=allowedRequest({url:'https://47.77.182.216.sslip.io/gateway/v1/me',headers:{'X-Client-Version':'99.99.99','X-Client-Channel':'edge-store'}},runtime);
 assert.equal(gateway.headers['X-Client-Version'],require('./package.json').version);
 assert.equal(gateway.headers['X-Client-Channel'],'unpacked');
 const school=allowedRequest({url:'https://video.cmc.zju.edu.cn/a',headers:{'X-Client-Version':'99.99.99','X-Client-Channel':'edge-store'}},runtime);
 assert.equal(school.headers['X-Client-Version'],undefined);assert.equal(school.headers['X-Client-Channel'],undefined);
});

test('study save remains pinned to its exact gateway endpoint',()=>{const r=allowedRequest({url:'https://47.77.182.216.sslip.io/gateway/v1/study/conversations',method:'POST',data:'{}',headers:{Authorization:'Bearer current-session',Cookie:'not-forwarded'}});assert.equal(r.method,'POST');assert.equal(r.headers.Cookie,undefined);assert.equal(r.headers.Authorization,'Bearer current-session');for(const url of ['https://elsewhere.test/gateway/v1/study/conversations','https://47.77.182.216.sslip.io/gateway/v1/study/export-all','https://47.77.182.216.sslip.io/gateway/v1/study/conversations?user=someone'])assert.throws(()=>allowedRequest({url,method:'POST',data:'{}'}));});

test('speech streaming pins all five bridge actions and rejects provider sockets and arbitrary actions',()=>{for(const action of ['create','push','poll','finish','cancel'])assert.equal(allowedRequest({url:'https://47.77.182.216.sslip.io/gateway/v1/speech/stream/'+action,method:'POST',data:'{}'}).method,'POST');for(const url of ['wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async','https://47.77.182.216.sslip.io/gateway/v1/speech/stream/admin','https://47.77.182.216.sslip.io/gateway/v1/speech/stream/push?token=secret'])assert.throws(()=>allowedRequest({url,method:'POST'}));});
