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
        profile=self.call('/v1/me',method='GET')[2]
        self.assertEqual(profile['membership']['state'],'expired');self.assertFalse(profile['permissions']['learning'])
        self.assertTrue(self.call('/v1/auth/login',{'email':'a@example.test','password':'long-test-password'})[2]['token'])
        self.fails(403,lambda:self.call('/v1/ark/responses',self.body))
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

    def test_free_account_cannot_bypass_paid_endpoints_with_positive_quota(self):
        owner=self.owner()
        created=self.call('/v1/admin/users',{'plan':'free','username':'free-user','email':'free@example.test','password':'long-free-password','request_limit':100,'audio_limit':300,'learning':True,'translation':True,'speech':True},owner)[2]
        login=self.call('/v1/auth/login',{'email':'free-user','password':'long-free-password'})[2]
        headers={**self.headers,'Authorization':'Bearer '+login['token']}
        profile=self.call('/v1/me',headers=headers,method='GET')[2]
        self.assertEqual(profile['membership']['plan'],'free');self.assertFalse(profile['membership']['active'])
        self.assertTrue(all(profile['permissions'][key] is False for key in ['learning','translation','speech','learning_records','card_export']))
        for endpoint,body in [('/v1/ark/responses',self.body),('/v1/learning/jobs/create',{'input':[{'role':'user','content':'hello'}]}),('/v1/speech/submit',{}),('/v1/speech/query',{})]:
            self.fails(403,lambda:self.call(endpoint,body,headers))
        self.assertEqual(self.events,[]);self.assertEqual(self.gateway.usage(created['user_id'],'zhiyun-subtitles')['requests'],0)
        self.assertEqual(self.gateway.learning_jobs,{})
        self.call('/v1/history',headers=headers,method='GET')
        self.call('/v1/auth/logout',headers=headers)

    def test_pro_ultra_same_features_different_quota_and_downgrade(self):
        owner=self.owner();features=[]
        for plan,limit in [('pro',1),('ultra',3)]:
            self.grant(owner,plan=plan,request_limit=limit,audio_limit=30,learning=False,translation=False,speech=False)
            profile=self.call('/v1/me',method='GET')[2]
            self.assertEqual(profile['membership']['plan'],plan)
            features.append(profile['permissions'])
            self.assertTrue(all(profile['permissions'][key] for key in ['learning','translation','speech','learning_records','card_export']))
            self.call('/v1/ark/responses',self.body)
            if plan=='pro': self.fails(429,lambda:self.call('/v1/ark/responses',self.body))
        self.assertEqual(features[0],features[1])
        self.grant(owner,plan='free',request_limit=500,audio_limit=500)
        self.fails(403,lambda:self.call('/v1/ark/responses',self.body))
        self.assertEqual(self.gateway.usage(1,'zhiyun-subtitles')['requests'],2)
        # Updating an existing free account with an older admin client cannot upgrade it.
        self.grant(owner)
        self.assertEqual(self.call('/v1/me',method='GET')[2]['membership']['plan'],'free')

    def test_old_grants_keep_permissions_and_receive_legacy_plan(self):
        owner=self.owner();self.grant(owner,learning=False,translation=True,speech=False)
        from backend.server import Gateway
        reloaded=Gateway(self.gateway.path,self.upstream)
        profile=reloaded.handle('GET','/v1/me',self.headers,{},'local')[2]
        self.assertEqual(profile['membership']['plan'],'legacy')
        self.assertFalse(profile['permissions']['learning']);self.assertTrue(profile['permissions']['translation'])
        self.assertFalse(profile['permissions']['card_export'])
        self.fails(400,lambda:self.grant(owner,plan='invented'))

    def test_individual_trial_accounts_have_separate_quota_and_expire_without_logout(self):
        owner=self.owner()
        profiles=[]
        for name in ['trial-a','trial-b']:
            created=self.call('/v1/admin/users',{'username':name,'email':name+'@example.test','password':'long-trial-password','plan':'trial','request_limit':1,'audio_limit':24,'expires':int(time.time())+3600},owner)[2]
            login=self.call('/v1/auth/login',{'email':name,'password':'long-trial-password'})[2]
            headers={**self.headers,'Authorization':'Bearer '+login['token']}
            me=self.call('/v1/me',headers=headers,method='GET')[2]
            self.assertEqual(me['membership']['state'],'trial');self.assertTrue(me['permissions']['learning'])
            self.assertGreater(me['server_time'],0)
            profiles.append((created['user_id'],headers))
        self.call('/v1/ark/responses',self.body,profiles[0][1])
        self.fails(429,lambda:self.call('/v1/ark/responses',self.body,profiles[0][1]))
        self.assertEqual(self.gateway.usage(profiles[1][0],'zhiyun-subtitles')['requests'],0)
        self.call('/v1/ark/responses',self.body,profiles[1][1])
        self.call('/v1/admin/grants',{'user_id':profiles[0][0],'plan':'trial','request_limit':100,'audio_limit':100,'expires':int(time.time())-1},owner)
        me=self.call('/v1/me',headers=profiles[0][1],method='GET')[2]
        self.assertFalse(me['permissions']['learning']);self.assertEqual(me['membership']['state'],'expired')
        self.fails(403,lambda:self.call('/v1/ark/responses',self.body,profiles[0][1]))
        self.assertEqual(len(self.events),2)
