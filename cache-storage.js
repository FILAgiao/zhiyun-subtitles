(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ZYCacheStorage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const DB_NAME='zhiyun-video-cache',DB_VERSION=2,STORE='videos-v2',META='cache-meta',LEGACY='videos';
const DEFAULT_LOCATION=Object.freeze({kind:'opfs',path:'zhiyun-videos'});
const FOLDER_ID='.zju-course-cache-id.json';
// Chrome 153 on Windows may terminate its renderer when IndexedDB deserializes
// a FileSystemDirectoryHandle. A try/catch cannot intercept that process crash.
function unsafeLegacyHandles(ua){return /Windows/.test(ua)&&/(?:Chrome|Chromium)\/153\./.test(ua)&&!/(?:Edg|OPR)\//.test(ua);}
function create({idb=globalThis.indexedDB,storage=globalThis.navigator?.storage,userAgent=globalThis.navigator?.userAgent||'',uuid=()=>crypto.randomUUID()}={}){
 const handles=new Map();let database,readyPromise,legacyKeys=[],migrationFailures=0;
 const blockedLegacy=unsafeLegacyHandles(userAgent);
 async function open(){
  if(database)return database;
  return new Promise((resolve,reject)=>{const request=idb.open(DB_NAME,DB_VERSION);
   request.onupgradeneeded=()=>{for(const name of [STORE,META,LEGACY])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
   request.onerror=()=>reject(new Error('无法打开浏览器缓存存储'));
   request.onblocked=()=>reject(new Error('请关闭其他课堂标签页后刷新，以完成缓存兼容升级'));
   request.onsuccess=()=>{database=request.result;database.onversionchange=()=>{database.close();database=null;};resolve(database);};
  });
 }
 async function raw(store,mode,action){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let result,request;try{request=action(tx.objectStore(store));}catch(error){tx.abort();reject(error);return;}request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(new Error('缓存读写失败，可能空间不足'));});}
 async function defaultDirectory(){if(!storage?.getDirectory)throw new Error('此浏览器不支持磁盘缓存，请使用新版 Chrome / Edge');return(await storage.getDirectory()).getDirectoryHandle(DEFAULT_LOCATION.path,{create:true});}
 async function registerExternal(handle,label=handle.name){
  if(handle.queryPermission&&await handle.queryPermission({mode:'readwrite'})!=='granted')throw new Error('请重新选择原缓存文件夹授权');
  let id;
  try{id=JSON.parse(await(await(await handle.getFileHandle(FOLDER_ID)).getFile()).text()).id;}catch(error){if(error.name!=='NotFoundError')throw new Error('缓存文件夹标识无法读取，请选择其他文件夹');}
  if(typeof id!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(id||'')){id=uuid();const writer=await(await handle.getFileHandle(FOLDER_ID,{create:true})).createWritable();try{await writer.write(JSON.stringify({id,version:1}));await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}}
  handles.set(id,handle);return{kind:'external',id,label};
 }
 async function locateHandle(handle,label){const dir=await defaultDirectory();if(handle===dir||await handle.isSameEntry?.(dir))return{...DEFAULT_LOCATION};return registerExternal(handle,label);}
 async function plainRecord(value){
  if(!value||typeof value!=='object'||value instanceof Blob)return value;
  const record={...value};
  if(record.directory){record.location=await locateHandle(record.directory);delete record.directory;}
  if(record.handle){record.location=await locateHandle(record.handle,record.label);delete record.handle;}
  // Future fields must not accidentally reintroduce an opaque handle into IDB.
  const visited=new WeakSet(),inspect=value=>{if(!value||typeof value!=='object'||value instanceof Blob||visited.has(value))return;visited.add(value);if(typeof value.getFileHandle==='function'||typeof value.getFile==='function')throw new Error('缓存索引只能保存文件位置，不能保存目录句柄');for(const child of Object.values(value))inspect(child);};inspect(record);
  return record;
 }
 // Keep the old store untouched. Import markers prevent a deleted new cache
 // from reappearing from an older manifest on the next page load.
 async function initialize(){
  await open();const keys=await raw(LEGACY,'readonly',s=>s.getAllKeys()),imported=new Set(await raw(META,'readonly',s=>s.getAllKeys()));
  for(const key of keys){
   // The old course catalog contains strings/numbers, never directory handles.
   if(blockedLegacy&&!String(key).startsWith('seen:')){const marker=imported.has(key)?await raw(META,'readonly',s=>s.get(key)):null;if(!['migrated','recovered','deleted'].includes(marker))legacyKeys.push(key);continue;}
   if(imported.has(key))continue;
   try{if(await raw(STORE,'readonly',s=>s.getKey(key))===undefined){const value=await plainRecord(await raw(LEGACY,'readonly',s=>s.get(key)));await raw(STORE,'readwrite',s=>s.put(value,key));}await raw(META,'readwrite',s=>s.put('migrated',key));}
   catch{migrationFailures++;legacyKeys.push(key);}
  }
 }
 const ready=()=>readyPromise||(readyPromise=initialize());
 async function get(key){await ready();return raw(STORE,'readonly',s=>s.get(key));}
 async function mutate(value,key,remove,marker){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction([STORE,META],'readwrite');tx.oncomplete=()=>resolve(key);tx.onabort=tx.onerror=()=>reject(new Error('缓存读写失败，可能空间不足'));try{tx.objectStore(STORE)[remove?'delete':'put'](...(remove?[key]:[value,key]));tx.objectStore(META).put(marker,key);}catch(error){tx.abort();reject(error);}});}
 async function put(value,key,marker='written'){await ready();const result=await mutate(await plainRecord(value),key,false,marker);if(marker==='recovered')legacyKeys=legacyKeys.filter(k=>k!==key);return result;}
 async function remove(key){await ready();await mutate(null,key,true,'deleted');legacyKeys=legacyKeys.filter(k=>k!==key);}
 async function getAll(query){await ready();return raw(STORE,'readonly',s=>s.getAll(query));}
 async function location(){return(await get('cache-folder'))?.location||{...DEFAULT_LOCATION};}
 async function directory(record){const where=record?.location||await location();if(where.kind==='opfs')return defaultDirectory();const handle=handles.get(where.id);if(!handle)throw new Error('请在设置 → 缓存中重新选择原文件夹，以继续播放或删除其中的缓存');if(handle.queryPermission&&await handle.queryPermission({mode:'readwrite'})!=='granted')throw new Error('缓存文件夹权限已失效，请重新选择原文件夹');return handle;}
 async function selectDirectory(handle,label){const where=await registerExternal(handle,label);await put({location:where,label},'cache-folder');return where;}
 async function info(){await ready();const config=await get('cache-folder');return{blockedLegacy,legacyKeys:[...legacyKeys],migrationFailures,externalReady:!config?.location||config.location.kind==='opfs'||handles.has(config.location.id)};}
 async function recoverableVideos(){await ready();const records=await getAll(),known=new Set(records.filter(r=>r?.location?.kind==='opfs').map(r=>r.name));const videos=[];let parts=0;for await(const [name,handle]of(await defaultDirectory()).entries()){if(handle.kind!=='file')continue;if(name.endsWith('.part')){parts++;continue;}if(!name.endsWith('.video')||known.has(name))continue;const file=await handle.getFile();videos.push({name,size:file.size,modified:file.lastModified});}return{videos:videos.sort((a,b)=>b.modified-a.modified),parts};}
 async function recoverVideo(name,key){if(await get(key))throw new Error('当前课程已有完整缓存，请先删除当前缓存再关联旧视频');if(typeof name!=='string'||!name.endsWith('.video')||/[\\/]/.test(name))throw new Error('请选择一个旧缓存视频');const file=await(await(await defaultDirectory()).getFileHandle(name)).getFile();if(!file.size)throw new Error('旧缓存视频为空');const bytes=new Uint8Array(await file.slice(0,8).arrayBuffer());await put({kind:'opfs',name,size:file.size,type:bytes[0]===0x1a?'video/webm':'video/mp4',location:{...DEFAULT_LOCATION}},key,'recovered');return file;}
 return{ready,get,put,delete:remove,getAll,location,directory,selectDirectory,info,recoverableVideos,recoverVideo,defaultDirectory};
}
return{create,unsafeLegacyHandles,DB_NAME,DB_VERSION,STORE,META,LEGACY};
});
