const test=require('node:test'),assert=require('node:assert/strict');
const ai=require('./ai-learning.js'),{allowedRequest}=require('./extension/background.js');
test('remote official prompt replaces bundled text and keeps personal scope',()=>{
 const catalog=[{id:'feynman',label:'云端费曼',prompt:'服务器新发布的讲解要求',scope:'official'},{id:'user-a',label:'我的瓜',prompt:'私人八卦讲解',scope:'personal'}];
 assert.match(ai.makeBody({settings:{catalog,mode:'feynman'},question:'原理'}).input[0].content,/服务器新发布的讲解要求/);
 const s=ai.settingsOf({catalog,mode:'user-a'});assert.equal(s.mode,'user-a');assert.equal(s.prompts.length,1);
 assert.match(ai.makeBody({settings:s,question:'原理'}).input[0].content,/私人八卦讲解/);
 assert.equal(ai.settingsOf({catalog:[],mode:'user-a'}).mode,'default');
});
test('extension proxy permits only fixed prompt endpoints',()=>{
 const base='https://47.77.182.216.sslip.io/gateway/v1/';
 for(const p of ['prompts','prompts/save','prompts/delete'])assert.doesNotThrow(()=>allowedRequest({url:base+p,method:p==='prompts'?'GET':'POST',headers:{}}));
 for(const p of ['admin/prompts','prompts/export','prompts/../../admin/prompts'])assert.throws(()=>allowedRequest({url:base+p,method:'POST',headers:{}}));
});

test('gateway preserves optional-route HTTP status and only 401 clears the session',async()=>{
 const {create}=require('./gateway-client.js');
 for(const status of [404,401]){const values={'gateway-account-v1':{url:'https://api.example.test',token:'fixture'}};const api=create({getValue:(k,d)=>values[k]??d,setValue:(k,v)=>values[k]=v,request:o=>{queueMicrotask(()=>o.onload({status,responseText:JSON.stringify({error:'fixture',error_code:'fixture_code'})}));return{abort(){}};}});await assert.rejects(api.prompts.list(),e=>e.status===status&&e.code==='fixture_code');assert.equal(values['gateway-account-v1'].token,status===401?'':'fixture');}
});
