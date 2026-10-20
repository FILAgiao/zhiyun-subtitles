"""Regression coverage for protocol-1 clients during store review and deployment."""
import threading,time,unittest
from . import test_server as fixture
from .server import Gateway,Fault,digest

class CompatibilityTests(unittest.TestCase):
    setUp=fixture.Tests.setUp
    upstream=fixture.Tests.upstream
    call=fixture.Tests.call
    fails=fixture.Tests.fails

    def test_headerless_048_session_and_quota_survive_reload(self):
        self.call('/v1/ark/responses',self.body)
        before=self.call('/v1/me',method='GET')[2]
        self.gateway=Gateway(self.gateway.path,self.upstream)
        after=self.call('/v1/me',method='GET')[2]
        self.assertEqual(after['usage'],before['usage'])
        self.assertEqual(after['permissions'],before['permissions'])
        self.assertEqual(after['membership']['plan'],'legacy')
        self.assertFalse(after['capabilities']['compatibility']['version_header_required'])
        self.assertTrue(after['capabilities']['learning_jobs'])
        self.assertEqual(self.gateway.history(1)['sessions'][0]['client_version'],'')

    def test_optional_version_metadata_never_grants_permissions(self):
        headers={**self.headers,'X-Client-Version':'0.20.61','X-Client-Channel':'edge-store'}
        self.call('/v1/me',headers=headers,method='GET')
        session=self.gateway.history(1)['sessions'][0]
        self.assertEqual((session['client_version'],session['client_channel']),('0.20.61','edge-store'))
        self.call('/v1/me',method='GET')
        self.assertEqual(self.gateway.history(1)['sessions'][0]['client_version'],'0.20.61')
        self.call('/v1/me',headers={**headers,'X-Client-Version':'not-a-version','X-Client-Channel':'pretend-paid'},method='GET')
        self.assertEqual(self.gateway.history(1)['sessions'][0]['client_channel'],'edge-store')
        with self.gateway.db() as db:db.execute("UPDATE grants SET plan='free' WHERE user=1")
        self.fails(403,lambda:self.call('/v1/ark/responses',self.body,headers))

    def test_old_admin_positive_quota_retains_legacy_and_explicit_free_stays_free(self):
        self.gateway.add_user('owner@example.test','long-admin-password','zhiyun-subtitles',admin=True)
        token=self.call('/v1/auth/login',{'email':'owner@example.test','password':'long-admin-password'})[2]['token']
        owner={**self.headers,'Authorization':'Bearer '+token}
        base={'username':'old-admin-user','email':'old-admin-user@example.test','password':'long-admin-password','request_limit':20,'audio_limit':30,'learning':False,'translation':True,'speech':False}
        user=self.call('/v1/admin/users',base,owner)[2]['user_id']
        p=self.gateway.permissions(user,'zhiyun-subtitles')
        self.assertFalse(p['learning']);self.assertTrue(p['translation']);self.assertFalse(p['speech'])
        self.assertEqual(self.gateway.membership(user,'zhiyun-subtitles')['plan'],'legacy')
        created=self.call('/v1/admin/users',{**base,'username':'explicit-free','email':'free2@example.test','plan':'free'},owner)[2]
        self.assertFalse(self.gateway.membership(created['user_id'],'zhiyun-subtitles')['active'])
        self.call('/v1/admin/grants',{'user_id':created['user_id'],'request_limit':100,'audio_limit':100},owner)
        self.assertEqual(self.gateway.membership(created['user_id'],'zhiyun-subtitles')['plan'],'free')

    def test_guest_speech_has_actionable_auth_error_without_charge(self):
        with self.assertRaises(Fault) as error:self.call('/v1/speech/submit',{}, {'X-App-Id':'zhiyun-subtitles','X-Client-Version':'0.20.48'})
        self.assertEqual(error.exception.status,401)
        self.assertEqual(error.exception.code,'authentication_required')
        self.assertIn('登录',error.exception.message)
        self.assertEqual(self.events,[])

    def test_interrupted_job_receipt_preserves_owner_without_replaying_model(self):
        finished=threading.Event()
        def stream(*args):
            try:yield {'type':'response.completed','response':{'status':'completed','output':[],'usage':{'total_tokens':1}}}
            finally:finished.set()
        self.gateway.upstream_stream=stream
        key=self.call('/v1/learning/jobs/create',self.body)[2]['id']
        self.assertTrue(finished.wait(5))
        calls=self.gateway.usage(1,'zhiyun-subtitles')['requests']
        replacement=Gateway(self.gateway.path,self.upstream)
        result=replacement.handle('POST','/v1/learning/jobs/poll',self.headers,{'id':key},'local')[2]
        self.assertEqual(result['state'],'error');self.assertEqual(result['error_code'],'task_interrupted')
        self.assertEqual(replacement.usage(1,'zhiyun-subtitles')['requests'],calls)
        self.assertEqual(self.events,[])
        self.assertEqual(replacement.handle('POST','/v1/learning/jobs/cancel',self.headers,{'id':key},'local')[0],200)
        replacement.add_user('other@example.test','long-admin-password','zhiyun-subtitles')
        token=replacement.handle('POST','/v1/auth/login',{'X-App-Id':'zhiyun-subtitles'},{'email':'other@example.test','password':'long-admin-password'},'other')[2]['token']
        self.fails(404,lambda:replacement.handle('POST','/v1/learning/jobs/poll',{**self.headers,'Authorization':'Bearer '+token},{'id':key},'other'))
        with replacement.db() as db:
            self.assertEqual({r[1] for r in db.execute('PRAGMA table_info(learning_job_receipts)')},{'id','user','app','created'})
            db.execute('UPDATE learning_job_receipts SET created=?',(int(time.time())-301,))
        self.fails(404,lambda:replacement.handle('POST','/v1/learning/jobs/poll',self.headers,{'id':key},'local'))

    def test_drain_waits_for_completion_and_client_delivery(self):
        entered=threading.Event();release=threading.Event();finished=threading.Event()
        def stream(*args):
            entered.set();release.wait(5)
            try:yield {'type':'response.completed','response':{'status':'completed','output':[],'usage':{'total_tokens':1}}}
            finally:finished.set()
        self.gateway.upstream_stream=stream
        key=self.call('/v1/learning/jobs/create',self.body)[2]['id']
        self.assertTrue(entered.wait(5));self.gateway.begin_drain()
        try:
            with self.assertRaises(Fault) as error:self.call('/v1/ark/responses',self.body)
            self.assertEqual(error.exception.code,'server_updating')
            self.assertEqual(self.call('/v1/me',method='GET')[0],200)
            self.assertFalse(self.gateway.wait_for_drain(.01))
            release.set();self.assertTrue(finished.wait(5))
            self.assertFalse(self.gateway.wait_for_drain(.01),'completed answer must be polled before shutdown')
            self.assertEqual(self.call('/v1/learning/jobs/poll',{'id':key})[2]['state'],'complete')
            self.assertTrue(self.gateway.wait_for_drain(.1))
            self.assertEqual(self.gateway.usage(1,'zhiyun-subtitles')['requests'],1)
        finally:release.set()

    def test_drain_cancelled_job_does_not_wait_for_an_extra_poll(self):
        self.gateway.upstream_stream=lambda *args:iter([])
        key=self.call('/v1/learning/jobs/create',self.body)[2]['id']
        self.call('/v1/learning/jobs/cancel',{'id':key})
        self.gateway.begin_drain()
        self.assertTrue(self.gateway.wait_for_drain(2))

    def test_metadata_migration_keeps_original_activity_insert_rollback_safe(self):
        with self.gateway.db() as db:
            self.assertEqual(len(list(db.execute('PRAGMA table_info(activity_sessions)'))),8)
            db.execute('INSERT INTO activity_sessions VALUES(?,?,?,?,?,?,NULL,?)',('old-code-session',1,'zhiyun-subtitles','chrome-extension',int(time.time()),int(time.time()),int(time.time())+100))
        sessions=self.gateway.history(1)['sessions']
        self.assertTrue(any(s['client_version']=='' and s['client_channel']=='unknown' for s in sessions))

    def test_service_signal_handler_drains_before_closing(self):
        import signal
        from unittest.mock import patch
        from . import server as module
        handlers={};closed=threading.Event()
        class Server:
            def serve_forever(inner):
                handlers[signal.SIGTERM](signal.SIGTERM,None)
                self.assertTrue(self.gateway.draining)
                self.assertTrue(closed.wait(5))
            def shutdown(inner):closed.set()
            def server_close(inner):inner.closed=True
        server=Server()
        with patch.object(module,'make_server',return_value=server),patch.object(module.signal,'signal',side_effect=lambda key,value:handlers.__setitem__(key,value)):
            module.serve_gateway(self.gateway)
        self.assertTrue(server.closed)
