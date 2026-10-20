const fs=require('node:fs');
module.exports=function loadCardQuotes(){
 const file='assets/quotes/quotes.json';let data;
 try{data=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(error){throw Error(file+'：无法读取有效 JSON。'+error.message);}
 if(data.schemaVersion!==1||!Array.isArray(data.quotes)||!data.quotes.length)throw Error(file+'：schemaVersion 必须为 1，quotes 必须是非空数组。');
 const seen=new Set();
 for(const [i,quote] of data.quotes.entries()){
  const fail=message=>{throw Error(file+' 第 '+(i+1)+' 条：'+message);};
  for(const name of ['id','text','author','sourceTitle','source'])if(typeof quote?.[name]!=='string'||!quote[name].trim())fail(name+' 不能为空。');
  if(seen.has(quote.id))fail('id 重复：'+quote.id);seen.add(quote.id);
  let url;try{url=new URL(quote.source);}catch{fail('source 必须是有效的 HTTPS 网址。');}
  if(url.protocol!=='https:'||url.username||url.password)fail('source 必须是无凭据的 HTTPS 网址。');
  if(quote.isTranslation!==undefined&&typeof quote.isTranslation!=='boolean')fail('isTranslation 必须为 true 或 false。');
  if(quote.isTranslation&&(typeof quote.original!=='string'||!quote.original.trim()))fail('译文必须填写 original 外文原句。');
 }
 return data.quotes.map(q=>({...q,text:q.text.replace(/\s+/g,' ').trim(),author:q.author.trim()}));
};
if(require.main===module)console.log('名言库校验通过：'+module.exports().length+' 条。');
