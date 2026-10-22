"""Same-origin website integration. Temporary accounts only; no model or mail calls."""
import json,os,tempfile,threading,unittest,urllib.error,urllib.request
from pathlib import Path
from unittest.mock import patch
from backend.server import Gateway,Fault
from backend.public_page import public_page_file
from backend.public_preview import make_preview_server,seed_preview,PreviewGateway

class PortalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.env=patch.dict(os.environ,{'ALLOWED_ORIGINS':'','PUBLIC_ORIGIN':'https://production.example.test'});self.env.start();self.addCleanup(self.env.stop)
        def blocked(*args,**kwargs):raise AssertionError('Public portal must not call a model')
        self.gateway=Gateway(self.temp.name+'/portal.sqlite3',upstream=blocked,upstream_stream=blocked)
        self.demo=seed_preview(self.gateway)
        self.server=make_preview_server(self.gateway);self.base='http://127.0.0.1:'+str(self.server.server_port)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.addCleanup(self.stop)
    def stop(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
    def request(self,path,method='GET',body=None,token='',origin=None):
        headers={'X-App-Id':'zhiyun-subtitles','Origin':origin or self.base}
        if token:headers['Authorization']='Bearer '+token
        data=None
        if body is not None:data=json.dumps(body).encode();headers['Content-Type']='application/json'
        req=urllib.request.Request(self.base+'/gateway'+path,data,headers,method=method)
        try:response=urllib.request.urlopen(req,timeout=5)
        except urllib.error.HTTPError as error:response=error
        with response:return response.status,response.headers,response.read()
    def login(self):
        status,_,raw=self.request('/v1/auth/login','POST',{'email':self.demo['username'],'password':self.demo['password']})
        self.assertEqual(status,200);return json.loads(raw)['token']
    def test_explicit_public_assets_and_document_policies(self):
        folder=Path(__file__).parent
        for path in ('/study','/study/','/study.html?login=1','/account?tab=register','/account/','/account.html?tab=recharge','/clips.css','/clips.js','/portal.css','/portal.js','/study.css','/study.js','/account.css','/account.js','/site.js'):
            status,headers,raw=self.request(path);self.assertEqual(status,200,path)
            name=public_page_file(path);self.assertEqual(raw,(folder/name).read_bytes())
            csp=headers['Content-Security-Policy'];self.assertIn("connect-src 'self'",csp);self.assertIn("script-src 'self'",csp);self.assertNotIn('unsafe-inline',csp)
            self.assertEqual("img-src 'self' data: https:" in csp,name=='account.html')
        for path in ('/server.py','/portal/../server.py','/landing/%2e%2e/server.py','/account.js/../server.py','/.env','/account/private'):
            self.assertIsNone(public_page_file(path))
            self.assertNotEqual(self.request(path)[0],200)
    def test_actual_prefixed_login_private_records_delete_logout_and_origin(self):
        token=self.login();status,_,raw=self.request('/v1/me',token=token);self.assertEqual(status,200)
        self.assertEqual(json.loads(raw)['membership']['plan'],'free')
        status,_,raw=self.request('/v1/study/conversations',token=token);self.assertEqual(status,200);self.assertEqual(len(json.loads(raw)['items']),2)
        self.assertEqual(self.request('/v1/study/conversations?id=demo-math','DELETE',token=token)[0],200)
        self.assertEqual(self.request('/v1/auth/logout','POST',{},token)[0],200)
        self.assertEqual(self.request('/v1/study/conversations',token=token)[0],401)
        self.assertEqual(self.request('/v1/auth/login','POST',{'email':self.demo['username'],'password':self.demo['password']},origin='https://unrelated.example.test')[0],403)
    def test_public_access_is_closed_without_configuration(self):
        status,_,raw=self.request('/v1/account/access');self.assertEqual(status,200)
        data=json.loads(raw)
        for key in ('registration','recharge'):
            self.assertFalse(data[key]['enabled']);self.assertFalse(data[key].get('qr_url'))

    def test_preview_only_blocks_mail_models_and_admin_writes(self):
        preview=PreviewGateway(self.temp.name+'/offline.sqlite3')
        demo=seed_preview(preview)
        self.assertEqual(demo['username'],'preview@example.test')
        for path in ('/v1/auth/register-code','/v1/ark/responses','/v1/admin/users','/v1/speech/submit'):
            with self.assertRaises(Fault) as caught:preview.handle('POST',path,{}, {},'preview')
            self.assertEqual(caught.exception.status,503)

if __name__=='__main__':unittest.main()
