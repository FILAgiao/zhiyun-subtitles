import concurrent.futures
import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from backend.server import Gateway, Fault, make_server

APP='zhiyun-subtitles'
class PromptTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.g=Gateway(self.tmp.name+'/db.sqlite')
        self.headers=[]
        for n in range(3):
            self.g.add_user(str(n)+'@test.example','test-long-password',APP,admin=n==0,plan='free')
            token=self.g.handle('POST','/v1/auth/login',{'X-App-Id':APP},{'email':str(n)+'@test.example','password':'test-long-password'},'test')[2]['token']
            self.headers.append({'X-App-Id':APP,'Authorization':'Bearer '+token})
    def call(self,path,body=None,who=1):
        return self.g.handle('GET' if body is None else 'POST',path,self.headers[who],body or {},'test')[2]
    def fail(self,status,fn):
        with self.assertRaises(Fault) as caught: fn()
        self.assertEqual(caught.exception.status,status)
    def test_catalog_auth_and_no_paid_usage(self):
        data=self.call('/v1/prompts');self.assertEqual({p['id'] for p in data['prompts']},{'feynman','technical','exam','gossip'})
        self.assertIn('翻译成人话',next(p for p in data['prompts'] if p['id']=='gossip')['prompt'])
        self.fail(401,lambda:self.g.handle('GET','/v1/prompts',{'X-App-Id':APP},{},'test'))
        self.assertEqual(self.g.usage(2,APP)['requests'],0)
    def test_personal_crud_isolation_and_restart(self):
        item=self.call('/v1/prompts/save',{'label':'我的','prompt':'个人秘密内容','revision':0})
        self.assertTrue(item['id'].startswith('user-'))
        self.assertNotIn('个人秘密内容',json.dumps(self.call('/v1/prompts',who=2),ensure_ascii=False))
        self.fail(409,lambda:self.call('/v1/prompts/save',{**item,'label':'偷改','prompt':'bad'},who=2))
        self.g=Gateway(self.g.path)
        self.assertEqual(next(p for p in self.call('/v1/prompts')['prompts'] if p['id']==item['id'])['prompt'],'个人秘密内容')
        changed=self.call('/v1/prompts/save',{**item,'label':'改名','prompt':'新版'})
        self.fail(409,lambda:self.call('/v1/prompts/save',{**item,'label':'旧设备','prompt':'旧文'}))
        self.call('/v1/prompts/delete',changed)
        self.assertFalse(any(p['id']==item['id'] for p in self.call('/v1/prompts')['prompts']))
    def test_app_isolation(self):
        self.call('/v1/prompts/save',{'id':'user-same','revision':0,'label':'个人','prompt':'仅本应用'})
        self.g.add_user('1@test.example','test-long-password','other-app')
        result=self.g.handle('GET','/v1/prompts',{**self.headers[1],'X-App-Id':'other-app'},{},'test')[2]
        self.assertEqual(result['prompts'],[])
        self.fail(403,lambda:self.g.handle('GET','/v1/prompts',{**self.headers[2],'X-App-Id':'other-app'},{},'test'))
    def test_official_admin_updates_disable_delete_and_seed_once(self):
        self.fail(403,lambda:self.call('/v1/admin/prompts'))
        self.fail(400,lambda:self.call('/v1/prompts/save',{'id':'feynman','revision':0,'label':'伪装官方','prompt':'bad'}))
        item=next(p for p in self.call('/v1/admin/prompts',who=0)['prompts'] if p['id']=='gossip')
        self.call('/v1/admin/prompts/save',{**item,'prompt':'管理员新内容','enabled':False},who=0)
        self.g=Gateway(self.g.path)
        self.assertFalse(any(p['id']=='gossip' for p in self.call('/v1/prompts')['prompts']))
        item=next(p for p in self.call('/v1/admin/prompts',who=0)['prompts'] if p['id']=='gossip')
        self.assertEqual(item['prompt'],'管理员新内容')
        self.call('/v1/admin/prompts/delete',item,who=0);self.g=Gateway(self.g.path)
        self.assertFalse(any(p['id']=='gossip' for p in self.call('/v1/admin/prompts',who=0)['prompts']))
        self.assertNotIn('管理员新内容',json.dumps(self.g.admin_overview('2026-10'),ensure_ascii=False))
    def test_limits_validation_and_parallel_revision(self):
        for change in [{'label':''},{'prompt':' '},{'prompt':'x'*1801},{'label':'x'*51},{'revision':True},{'enabled':'false'}]:
            self.fail(400,lambda:self.call('/v1/prompts/save',{'label':'名称','prompt':'内容','revision':0,**change}))
        for n in range(30):self.call('/v1/prompts/save',{'id':'user-'+str(n),'label':'名字','prompt':'内容','revision':0})
        self.fail(400,lambda:self.call('/v1/prompts/save',{'label':'超限','prompt':'内容','revision':0}))
        def update(n):
            try:return self.call('/v1/prompts/save',{'id':'user-0','label':'并发','prompt':str(n),'revision':1})['revision']
            except Fault as e:return e.status
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:out=list(pool.map(update,[1,2]))
        self.assertCountEqual(out,[2,409])
    def test_http_json_unicode_and_no_store(self):
        server=make_server(self.g,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            base='http://127.0.0.1:'+str(server.server_port)
            request=urllib.request.Request(base+'/v1/prompts/save',data=json.dumps({'label':'八卦✨','prompt':'姐妹你听我说！','revision':0}).encode(),headers={**self.headers[1],'Content-Type':'application/json'})
            with urllib.request.urlopen(request) as r:self.assertEqual(r.status,200)
            with urllib.request.urlopen(urllib.request.Request(base+'/v1/prompts',headers=self.headers[1])) as r:
                self.assertEqual(r.headers['Cache-Control'],'no-store');self.assertIn('姐妹你听我说',r.read().decode())
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
