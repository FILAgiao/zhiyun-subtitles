import tempfile,time,unittest
from unittest.mock import patch
from backend.server import Gateway,Fault,digest

APP='zhiyun-subtitles'
class WebSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.gateway=Gateway(self.tmp.name+'/sessions.sqlite3')
        self.user=self.gateway.add_user('handoff@example.test','long-session-password',APP)
        self.parent=self.call('/v1/auth/login',{'email':'handoff@example.test','password':'long-session-password'},token='')[2]['token']
    def call(self,path,body=None,token=None,method='POST'):
        headers={'X-App-Id':APP,'X-Client-Type':'chrome-extension'}
        if token is None:token=self.parent
        if token:headers['Authorization']='Bearer '+token
        return self.gateway.handle(method,path,headers,body or {},'local')
    def fails(self,status,path,token,method='GET'):
        with self.assertRaises(Fault) as caught:self.call(path,token=token,method=method)
        self.assertEqual(caught.exception.status,status)
    def child(self):return self.call('/v1/auth/web-session')[2]['token']
    def test_independent_scoped_session_and_website_logout(self):
        result=self.call('/v1/auth/web-session')[2];child=result['token']
        self.assertNotEqual(child,self.parent);self.assertIsNone(result['expires_in']);self.assertTrue(result['persistent'])
        self.assertEqual(self.call('/v1/me',token=child,method='GET')[2]['id'],self.user)
        self.assertEqual(self.call('/v1/study/clips?limit=50&offset=0',token=child,method='GET')[0],200)
        self.fails(403,'/v1/admin/users',child)
        self.fails(403,'/v1/ark/responses',child,method='POST')
        self.fails(403,'/v1/auth/web-session',child,method='POST')
        self.assertEqual(self.call('/v1/auth/logout',{},token=child)[0],200)
        self.fails(401,'/v1/me',child)
        self.assertEqual(self.call('/v1/me',method='GET')[0],200,'website logout must preserve extension login')
    def test_parent_logout_or_expiry_revokes_all_children(self):
        children=[self.child(),self.child()]
        self.call('/v1/auth/logout',{})
        for child in children:self.fails(401,'/v1/me',child)
    def test_short_parent_expiry_caps_child_and_orphan_cleanup_keeps_scope(self):
        with self.gateway.db() as db:db.execute('UPDATE sessions SET expires=? WHERE hash=?',(int(time.time())+600,digest(self.parent)))
        result=self.call('/v1/auth/web-session')[2];self.assertLessEqual(result['expires_in'],600)
        orphan=result['token']
        with self.gateway.db() as db:db.execute('DELETE FROM sessions WHERE hash=?',(digest(self.parent),))
        self.fails(401,'/v1/me',orphan)
        replacement=self.call('/v1/auth/login',{'email':'handoff@example.test','password':'long-session-password'},token='')[2]['token']
        self.call('/v1/auth/web-session',token=replacement)
        self.fails(401,'/v1/me',orphan)
        with self.gateway.db() as db:self.assertIsNone(db.execute('SELECT 1 FROM sessions WHERE hash=?',(digest(orphan),)).fetchone())
    def test_parent_expiry_invalidates_child(self):
        child=self.child()
        with self.gateway.db() as db:db.execute('UPDATE sessions SET expires=? WHERE hash=?',(int(time.time())-1,digest(self.parent)))
        self.fails(401,'/v1/me',child)
    def test_logins_and_child_sessions_survive_years_and_server_restart(self):
        result=self.call('/v1/auth/login',{'email':'handoff@example.test','password':'long-session-password'},token='')[2]
        self.assertIsNone(result['expires_in']);self.assertTrue(result['persistent'])
        child=self.child();future=int(time.time())+20*365*86400
        self.gateway=Gateway(self.gateway.path)
        with patch('backend.server.time.time',return_value=future):
            self.assertEqual(self.call('/v1/me',method='GET')[0],200)
            self.assertEqual(self.call('/v1/me',token=child,method='GET')[0],200)
            self.call('/v1/auth/logout',token=child)
            self.fails(401,'/v1/me',child)
            self.assertEqual(self.call('/v1/me',method='GET')[0],200)

    def test_migration_preserves_only_live_sessions_once(self):
        child=self.child();now=int(time.time())
        with self.gateway.db() as db:
            db.execute('DELETE FROM session_migrations')
            db.execute('UPDATE sessions SET expires=?',(now+600,))
            db.execute('INSERT INTO sessions VALUES(?,?,?)',(digest('expired'),self.user,now-1))
            db.execute('INSERT INTO sessions VALUES(?,?,?)',(digest('orphan'),self.user,now+600))
            db.execute('INSERT INTO web_sessions VALUES(?,?,?)',(digest('orphan'),digest('revoked-parent'),APP))
        self.gateway=Gateway(self.gateway.path)
        with self.gateway.db() as db:
            rows=db.execute('SELECT hash,expires FROM sessions').fetchall()
            self.assertEqual({r['hash'] for r in rows},{digest(self.parent),digest(child)})
            self.assertTrue(all(r['expires'] is None for r in rows))
            db.execute('UPDATE sessions SET expires=? WHERE hash=?',(now-1,digest(self.parent)))
        self.gateway=Gateway(self.gateway.path)
        self.fails(401,'/v1/me',self.parent);self.fails(401,'/v1/me',child)

    def test_missing_and_invalid_parent_are_rejected(self):
        self.fails(401,'/v1/auth/web-session','',method='POST')
        self.fails(401,'/v1/auth/web-session','invalid-session',method='POST')

if __name__=='__main__':unittest.main()
