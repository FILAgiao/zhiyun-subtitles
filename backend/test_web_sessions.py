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
        return caught.exception
    def child(self):return self.call('/v1/auth/web-session')[2]['token']
    def test_independent_scoped_session_and_website_logout(self):
        result=self.call('/v1/auth/web-session')[2];child=result['token']
        self.assertNotEqual(child,self.parent);self.assertIsNone(result['expires_in']);self.assertTrue(result['persistent'])
        self.assertEqual(self.call('/v1/me',token=child,method='GET')[2]['id'],self.user)
        self.assertEqual(self.call('/v1/study/clips?limit=50&offset=0',token=child,method='GET')[0],200)
        self.fails(401,'/v1/admin/users',child)
        self.fails(403,'/v1/ark/responses',child,method='POST')
        self.fails(403,'/v1/auth/web-session',child,method='POST')
        self.assertEqual(self.call('/v1/auth/logout',{},token=child)[0],200)
        self.fails(401,'/v1/me',child)
        self.assertEqual(self.call('/v1/me',method='GET')[0],200,'website logout must preserve extension login')
    def test_website_can_issue_distinct_extension_session_without_admin_or_handoff(self):
        with self.gateway.db() as db:
            db.execute('UPDATE users SET is_admin=1 WHERE id=?',(self.user,))
        child=self.call('/v1/auth/extension-session')[2]['token']
        self.assertNotEqual(child,self.parent)
        result=self.call('/v1/me',token=child,method='GET')[2]
        self.assertEqual(result['id'],self.user)
        self.assertFalse(result['is_admin'])
        self.fails(401,'/v1/admin/users',child)
        self.fails(403,'/v1/auth/web-session',child,method='POST')
        self.fails(403,'/v1/auth/extension-session',child,method='POST')
        self.fails(403,'/v1/auth/extension-session',self.child(),method='POST')
        self.call('/v1/auth/logout',token=child)
        self.fails(401,'/v1/me',child)
        self.assertEqual(self.call('/v1/me',method='GET')[0],200)
        child=self.call('/v1/auth/extension-session')[2]['token']
        self.call('/v1/auth/logout')
        self.fails(401,'/v1/me',child)
    def test_admin_login_and_logout_are_independent_from_regular_sessions(self):
        self.gateway.add_user('owner@example.test','fixture-admin-password',APP,admin=True)
        credentials={'email':'owner@example.test','password':'fixture-admin-password'}
        ordinary_admin=self.call('/v1/auth/login',credentials,token='')[2]['token']
        with self.assertRaises(Fault) as rejected:
            self.call('/v1/admin/login',{'email':'handoff@example.test','password':'long-session-password'},token='')
        self.assertEqual((403,'admin_role_required'),(rejected.exception.status,rejected.exception.code))
        admin=self.call('/v1/admin/login',credentials,token='')[2]
        self.assertEqual(admin['expires_in'],12*60*60)
        self.assertNotEqual(admin['token'],ordinary_admin)
        for token in (self.parent,ordinary_admin,self.child()):
            self.assertEqual('admin_session_invalid',self.fails(401,'/v1/admin/overview',token).code)
        self.assertFalse(self.call('/v1/me',token=ordinary_admin,method='GET')[2]['is_admin'])
        owner=admin['token']
        for path,method in (('/v1/me','GET'),('/v1/auth/web-session','POST'),('/v1/auth/extension-session','POST'),('/v1/auth/logout','POST')):
            self.fails(401,path,owner,method)
        view=self.call('/v1/admin/overview',token=owner,method='GET')[2]
        self.assertEqual(view['account']['email'],credentials['email'])
        self.call('/v1/auth/logout',token=ordinary_admin)
        self.assertEqual(self.call('/v1/admin/overview',token=owner,method='GET')[0],200)
        self.call('/v1/admin/logout',token=owner)
        self.fails(401,'/v1/admin/overview',owner)
        self.assertEqual(self.call('/v1/me',method='GET')[0],200)

    def test_admin_session_expires_and_reset_or_disable_revokes_it(self):
        password='fixture-admin-password'
        target=self.gateway.add_user('target@example.test',password,APP,admin=True)
        self.gateway.add_user('owner@example.test',password,APP,admin=True)
        def login(email,password=password):
            return self.call('/v1/admin/login',{'email':email,'password':password},token='')[2]['token']
        owner=login('owner@example.test')
        expiring=login('target@example.test')
        with self.gateway.db() as db:
            db.execute('UPDATE admin_sessions SET expires=? WHERE hash=?',(int(time.time())-1,digest(expiring)))
        self.fails(401,'/v1/admin/overview',expiring)
        target_token=login('target@example.test')
        replacement='secondAdminPassword2026'
        self.call('/v1/admin/accounts',{'user_id':target,'action':'reset_password','password':replacement},token=owner)
        self.fails(401,'/v1/admin/overview',target_token)
        target_token=login('target@example.test',replacement)
        self.call('/v1/admin/accounts',{'user_id':target,'action':'disable'},token=owner)
        self.fails(401,'/v1/admin/overview',target_token)
        self.call('/v1/admin/accounts',{'user_id':target,'action':'enable'},token=owner)
        self.fails(401,'/v1/admin/overview',target_token)

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
        self.assertEqual('session_invalid',self.fails(401,'/v1/auth/web-session','',method='POST').code)
        self.assertEqual('session_invalid',self.fails(401,'/v1/auth/web-session','invalid-session',method='POST').code)

    def test_disabled_account_is_a_definitive_auth_failure(self):
        with self.gateway.db() as db:db.execute('UPDATE users SET enabled=0 WHERE id=?',(self.user,))
        self.assertEqual('account_disabled',self.fails(401,'/v1/me',self.parent).code)

if __name__=='__main__':unittest.main()
