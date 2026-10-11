import time, sqlite3, unittest
from backend import test_server as fixture
from contextlib import closing

class AccountTests(unittest.TestCase):
    setUp=fixture.Tests.setUp
    upstream=fixture.Tests.upstream
    call=fixture.Tests.call
    fails=fixture.Tests.fails
    # Reuse the same fixture without collecting inherited regressions twice.
    def owner(self):
        self.gateway.add_user('owner@example.test','long-admin-password','zhiyun-subtitles',admin=True,username='owner')
        token=self.call('/v1/auth/login',{'email':'owner','password':'long-admin-password'})[2]['token']
        return {**self.headers,'Authorization':'Bearer '+token}
    def grant(self,headers,**changes):
        return self.call('/v1/admin/grants',{'user_id':1,'request_limit':10,'audio_limit':20,**changes},headers)
    def test_feature_switches_and_no_prompt_bypass(self):
        owner=self.owner();self.grant(owner,learning=False,translation=True,speech=False)
        self.call('/v1/ark/responses',self.body)
        for body in ({'input':[{'role':'user','content':'hello'}]}, {'input':[{'role':'system','content':'字幕译者'}, {'role':'user','content':'hello'}]}):
            self.fails(403,lambda:self.call('/v1/ark/responses',body))
        self.grant(owner,translation=False)
        self.fails(403,lambda:self.call('/v1/ark/responses',self.body))
        self.fails(403,lambda:self.gateway.reserve(1,'zhiyun-subtitles','speech',1,feature='speech'))
        profile=self.call('/v1/me',method='GET')[2]
        self.assertFalse(profile['permissions']['learning']);self.assertFalse(profile['permissions']['speech'])
        self.assertEqual(len(self.events),1)
        self.grant(owner) # Older clients must not re-enable features.
        self.assertFalse(self.call('/v1/me',method='GET')[2]['permissions']['translation'])
    def test_expiry_disable_reenable_and_password_reset(self):
        owner=self.owner();self.grant(owner,expires=int(time.time())-1)
        self.fails(403,lambda:self.call('/v1/me',method='GET'))
        self.fails(403,lambda:self.call('/v1/auth/login',{'email':'a@example.test','password':'long-test-password'}))
        self.grant(owner,expires=None)
        self.call('/v1/admin/accounts',{'user_id':1,'action':'disable'},owner)
        self.fails(401,lambda:self.call('/v1/me',method='GET'))
        self.call('/v1/admin/accounts',{'user_id':1,'action':'enable'},owner)
        # Restoration does not revive a revoked session.
        self.fails(401,lambda:self.call('/v1/me',method='GET'))
        new=self.call('/v1/auth/login',{'email':'a@example.test','password':'long-test-password'})[2]['token']
        self.call('/v1/admin/accounts',{'user_id':1,'action':'reset_password','password':'replacement-password'},owner)
        self.fails(401,lambda:self.call('/v1/me',headers={**self.headers,'Authorization':'Bearer '+new},method='GET'))
        self.fails(401,lambda:self.call('/v1/auth/login',{'email':'a@example.test','password':'long-test-password'}))
        self.assertTrue(self.call('/v1/auth/login',{'email':'a@example.test','password':'replacement-password'})[2]['token'])
        actions=self.call('/v1/admin/overview',headers=owner,method='GET')[2]['actions']
        self.assertEqual(actions[0]['action'],'reset_password');self.assertNotIn('replacement-password',str(actions))
    def test_admin_protection_and_validation(self):
        owner=self.owner()
        self.fails(403,lambda:self.call('/v1/admin/accounts',{'user_id':1,'action':'disable'}))
        self.fails(400,lambda:self.call('/v1/admin/accounts',{'user_id':2,'action':'disable'},owner))
        self.fails(400,lambda:self.grant(owner,learning='false'))
        self.fails(400,lambda:self.call('/v1/admin/grants',{'user_id':2,'enabled':False},owner))
        self.grant(owner,enabled=False)
        self.fails(403,lambda:self.call('/v1/me',method='GET'))
        self.grant(owner,enabled=True)
        self.assertTrue(self.call('/v1/me',method='GET')[2]['permissions'])
    def test_existing_database_migration_is_idempotent(self):
        from backend.server import Gateway
        from backend.admin_api import migrate
        path=self.tmp.name+'/old.sqlite'
        with closing(sqlite3.connect(path)) as db:
            db.executescript('CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,salt TEXT,password TEXT);CREATE TABLE grants(user INTEGER,app TEXT,requests INTEGER,audio INTEGER,PRIMARY KEY(user,app));')
            db.execute('INSERT INTO grants VALUES(1,?,7,8)',('zhiyun-subtitles',));db.commit()
        Gateway(path)
        with closing(sqlite3.connect(path)) as db:
            migrate(db);db.commit();row=db.execute('SELECT requests,audio,learning,translation,speech,enabled,expires FROM grants').fetchone()
        self.assertEqual(row,(7,8,1,1,1,1,None))
