import base64, concurrent.futures, io, json, os, tempfile, threading, unittest, urllib.request, urllib.error, uuid, wave
from unittest.mock import patch
from backend.server import Gateway, Fault, make_server

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.events=[]
        self.env=patch.dict(os.environ,{'ARK_API_KEY':'test-server-only','SPEECH_API_KEY':'test-speech-only','ALLOW_WEB_SEARCH':'0','ALLOWED_ORIGINS':'chrome-extension://test'})
        self.env.start(); self.addCleanup(self.env.stop); self.addCleanup(self.tmp.cleanup)
        self.gateway=Gateway(self.tmp.name+'/test.sqlite',self.upstream)
        self.gateway.add_user('a@example.test','long-test-password','zhiyun-subtitles',10,20)
        self.headers={'X-App-Id':'zhiyun-subtitles'}
        self.token=self.gateway.handle('POST','/v1/auth/login',self.headers,{'email':'a@example.test','password':'long-test-password'},'local')[2]['token']
        self.headers['Authorization']='Bearer '+self.token
        self.body={'model':'doubao-seed-translation-250915','input':[{'role':'user','content':[{'type':'input_text','text':'hello','translation_options':{'source_language':'en','target_language':'zh'}}]}]}
    def upstream(self,url,headers,body):
        self.events.append((url,headers,body))
        if url.endswith('/responses'):
            return 200,{}, {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'answer'}]}],'usage':{'input_tokens':7,'output_tokens':3,'total_tokens':10,'tool_usage':{'web_search':0}}}
        return 200,{'X-Api-Status-Code':'20000000'},{'result':{'utterances':[{'text':'hello','start_time':0,'end_time':1000}]}}
    def call(self,path,body=None,headers=None,method='POST'):
        return self.gateway.handle(method,path,headers or self.headers,body or {},'local')
    def fails(self,status,fn):
        with self.assertRaises(Fault) as ctx: fn()
        self.assertEqual(status,ctx.exception.status)
    def test_learning_defaults_to_server_model(self):
        body={'input':[{'role':'user','content':'hello'}]}
        self.call('/v1/ark/responses',body)
        self.assertEqual(self.events[-1][2]['model'],'doubao-seed-2-1-lite-260915')
        self.assertNotIn('model',body)
    def test_auth_and_app_grant_and_logout(self):
        self.fails(401,lambda:self.call('/v1/me',headers={'X-App-Id':'zhiyun-subtitles'},method='GET'))
        self.fails(403,lambda:self.call('/v1/me',headers={**self.headers,'X-App-Id':'other'},method='GET'))
        self.call('/v1/auth/logout'); self.fails(401,lambda:self.call('/v1/me',method='GET'))
    def test_keys_are_server_only_and_usage_persists(self):
        result=self.call('/v1/ark/responses',self.body)
        self.assertNotIn('test-server-only',json.dumps(result))
        self.assertEqual(self.events[0][1]['Authorization'],'Bearer test-server-only')
        self.assertNotIn('store',self.events[0][2]); self.assertFalse(self.events[0][2]['stream'])
        new=Gateway(self.gateway.path,self.upstream)
        self.assertEqual(new.usage(1,'zhiyun-subtitles')['total_tokens'],10)
        with new.db() as db:
            self.assertIsNone(db.execute('SELECT 1 FROM sessions WHERE hash=?',(self.token,)).fetchone())
            self.assertNotIn('long-test-password',db.execute('SELECT password FROM users').fetchone()[0])
    def test_old_learning_clients_also_get_minimal_reasoning(self):
        self.call('/v1/ark/responses',{**self.body,'model':'doubao-seed-2-1-lite-260915'})
        self.assertEqual(self.events[-1][2]['reasoning'],{'effort':'minimal'})

    def test_learning_reasoning_is_validated_and_forwarded(self):
        body={**self.body,'model':'doubao-seed-2-1-lite-260915','reasoning':{'effort':'minimal'}}
        self.call('/v1/ark/responses',body)
        self.assertEqual(self.events[-1][2]['reasoning'],{'effort':'minimal'})
        self.fails(400,lambda:self.call('/v1/ark/responses',{**body,'reasoning':{'effort':'invalid'}}))

    def test_learning_model_keeps_store_disabled(self):
        self.call('/v1/ark/responses',{'model':'doubao-seed-2-1-lite-260915','input':[{'role':'user','content':'hello'}]})
        self.assertFalse(self.events[0][2]['store'])
    def test_provider_validation_prevents_remote_fetch_and_tools(self):
        bad=[{**self.body,'model':'arbitrary'}, {**self.body,'max_output_tokens':9999}, {**self.body,'tools':[{'type':'unsupported_tool'}]}, {**self.body,'input':[{'role':'user','content':[{'type':'input_image','image_url':'http://127.0.0.1/private'}]}]}]
        for body in bad: self.fails(400,lambda:self.call('/v1/ark/responses',body))
        self.assertEqual(self.events,[])
    def test_disabled_web_search_does_not_block_old_client_chat(self):
        body={**self.body,'model':'doubao-seed-2-1-lite-260915','tools':[{'type':'web_search','max_keyword':3}]}
        result=self.call('/v1/ark/responses',body)[2]
        self.assertNotIn('tools',self.events[-1][2]);self.assertIn('联网搜索未开通',result['output'][0]['content'][0]['text'])
        self.assertFalse(self.call('/v1/me',method='GET')[2]['capabilities']['web_search'])
        def upstream(*args):
            self.assertNotIn('tools',args[2])
            yield {'type':'response.output_text.delta','delta':'hello'}
            yield {'type':'response.completed','response':{'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'hello'}]}],'usage':{'total_tokens':5}}}
        self.gateway.upstream_stream=upstream;events=[]
        self.gateway.handle('POST','/v1/ark/responses',self.headers,{**body,'stream':True},'local',events.append)
        partial=''.join(e.get('delta','') for e in events)
        completed=events[-1]['response']['output'][0]['content'][0]['text']
        self.assertEqual(partial,completed);self.assertTrue(completed.endswith('hello'))
        self.assertEqual(self.gateway.usage(1,'zhiyun-subtitles')['requests'],2)

    def test_quota_atomic_under_concurrency(self):
        self.gateway.add_user('a@example.test','long-test-password','zhiyun-subtitles',1,20)
        def invoke(_):
            try: return self.call('/v1/ark/responses',self.body)[0]
            except Fault as e: return e.status
        with concurrent.futures.ThreadPoolExecutor(2) as pool: results=list(pool.map(invoke,range(2)))
        self.assertEqual(sorted(results),[200,429]); self.assertEqual(len(self.events),1)
    def test_uncertain_upstream_remains_charged(self):
        self.gateway.upstream=lambda *args: (_ for _ in ()).throw(Fault(502,'timeout'))
        self.fails(502,lambda:self.call('/v1/ark/responses',self.body))
        u=self.gateway.usage(1,'zhiyun-subtitles'); self.assertEqual(u['requests'],1); self.assertEqual(u['uncertain'],1)
    def wav_body(self,seconds=1):
        out=io.BytesIO()
        with wave.open(out,'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(b'\0\0'*16000*seconds)
        return {'audio':{'data':base64.b64encode(out.getvalue()).decode()}}
    def test_audio_owned_deduplicated_and_metered(self):
        headers={**self.headers,'X-Api-Request-Id':str(uuid.uuid4())}
        self.call('/v1/speech/submit',self.wav_body(),headers)
        self.fails(409,lambda:self.call('/v1/speech/submit',self.wav_body(),headers))
        self.call('/v1/speech/query',headers=headers); self.call('/v1/speech/query',headers=headers)
        self.assertEqual(len(self.events),2); self.assertEqual(self.gateway.usage(1,'zhiyun-subtitles')['audio_seconds'],1)
        self.gateway.add_user('b@example.test','long-test-password','zhiyun-subtitles')
        token=self.call('/v1/auth/login',{'email':'b@example.test','password':'long-test-password'})[2]['token']
        self.fails(404,lambda:self.call('/v1/speech/query',headers={**headers,'Authorization':'Bearer '+token}))
    def test_audio_quota_and_malformed_input(self):
        self.gateway.add_user('a@example.test','long-test-password','zhiyun-subtitles',10,0)
        headers={**self.headers,'X-Api-Request-Id':str(uuid.uuid4())}
        self.fails(429,lambda:self.call('/v1/speech/submit',self.wav_body(),headers))
        self.fails(400,lambda:self.call('/v1/speech/submit',{'audio':{'url':'http://private'}},headers))
        self.assertEqual(self.events,[])
    def test_http_cors_and_errors_do_not_echo_payload(self):
        server=make_server(self.gateway,port=0); thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            base='http://127.0.0.1:'+str(server.server_port)
            with urllib.request.urlopen(base+'/health') as response: self.assertTrue(json.load(response)['ok'])
            req=urllib.request.Request(base+'/v1/me',headers={**self.headers,'Origin':'https://evil.test'})
            with self.assertRaises(urllib.error.HTTPError) as ctx: urllib.request.urlopen(req)
            self.assertEqual(ctx.exception.code,403); ctx.exception.close()
            req=urllib.request.Request(base+'/v1/me',headers={**self.headers,'Origin':'chrome-extension://test'})
            with urllib.request.urlopen(req) as response: self.assertEqual(response.headers['Access-Control-Allow-Origin'],'chrome-extension://test')
            req=urllib.request.Request(base+'/v1/auth/login',b'"secret"',{'Content-Type':'application/json'},method='POST')
            with self.assertRaises(urllib.error.HTTPError) as ctx: urllib.request.urlopen(req)
            self.assertNotIn('secret',ctx.exception.read().decode()); ctx.exception.close()
        finally: server.shutdown(); server.server_close(); thread.join()
    def test_admin_role_creation_quota_and_private_history(self):
        self.fails(403,lambda:self.call('/v1/admin/overview',method='GET'))
        self.gateway.add_user('owner@example.test','long-admin-password','zhiyun-subtitles',admin=True,username='owner')
        token=self.call('/v1/auth/login',{'email':'owner','password':'long-admin-password'},headers={'X-App-Id':'zhiyun-subtitles','X-Client-Type':'admin-web'})[2]['token']
        headers={**self.headers,'Authorization':'Bearer '+token}
        created=self.call('/v1/admin/users',{'email':'new@example.test','username':'新同学','password':'long-new-password','request_limit':1,'audio_limit':0,'is_admin':True},headers)[2]
        new_token=self.call('/v1/auth/login',{'email':'新同学','password':'long-new-password'})[2]['token']
        new_headers={**self.headers,'Authorization':'Bearer '+new_token}
        self.assertFalse(self.call('/v1/me',headers=new_headers,method='GET')[2]['is_admin'])
        self.call('/v1/ark/responses',self.body,new_headers)
        self.fails(429,lambda:self.call('/v1/ark/responses',self.body,new_headers))
        self.call('/v1/admin/grants',{'user_id':created['user_id'],'request_limit':2,'audio_limit':0},headers)
        self.call('/v1/ark/responses',self.body,new_headers)
        data=self.call('/v1/admin/overview',headers=headers,method='GET')[2]
        self.assertEqual(data['totals']['total_tokens'],20)
        self.assertEqual(len(data['users']),3)
        self.assertEqual(self.call('/v1/history',method='GET')[2]['calls'],[])
        self.assertNotIn('hash',json.dumps(data));self.assertNotIn(new_token,json.dumps(data))
        self.assertEqual(data['calls'][0]['feature'],'translation')
        self.assertIsNotNone(data['calls'][0]['finished'])
        self.fails(403,lambda:self.call('/v1/admin/users',{},new_headers))
    def test_activity_and_migration_preserve_auth_and_usage(self):
        self.call('/v1/activity');self.assertEqual(self.gateway.usage(1,'zhiyun-subtitles')['requests'],0)
        reloaded=Gateway(self.gateway.path,self.upstream)
        self.assertEqual(reloaded.handle('GET','/v1/me',self.headers,{},'local')[2]['username'],'a@example.test')
        self.call('/v1/auth/logout')
        activity=self.gateway.history(1)['sessions'][0]
        self.assertIsNotNone(activity['ended'])
        self.assertNotIn('hash',activity)

    def test_login_rate_limit(self):
        for _ in range(9): self.fails(401,lambda:self.call('/v1/auth/login',{'email':'a@example.test','password':'wrong'}))
        self.fails(429,lambda:self.call('/v1/auth/login',{'email':'a@example.test','password':'long-test-password'}))

    def test_guest_speech_without_login_and_job_isolation(self):
        headers={'X-App-Id':'zhiyun-subtitles','X-Api-Request-Id':str(uuid.uuid4())}
        self.gateway.handle('POST','/v1/speech/submit',headers,self.wav_body(12),'guest-a')
        self.gateway.handle('POST','/v1/speech/query',headers,{},'guest-a')
        self.fails(404,lambda:self.gateway.handle('POST','/v1/speech/query',headers,{},'guest-b'))
        self.fails(401,lambda:self.gateway.handle('POST','/v1/ark/responses',headers,self.body,'guest-a'))
        self.fails(401,lambda:self.gateway.handle('POST','/v1/speech/submit',{**headers,'X-App-Id':'other'},self.wav_body(),'guest-a'))
        self.assertEqual(len(self.events),2)
        self.assertNotIn('test-server-only',json.dumps(self.gateway.handle('POST','/v1/speech/query',headers,{},'guest-a')))

    def test_incremental_job_returns_partial_before_completion_and_calls_model_once(self):
        ready=threading.Event();release=threading.Event();done=threading.Event();count=[]
        def upstream(*args):
            count.append(1)
            yield {'type':'response.output_text.delta','delta':'partial'};ready.set()
            if not release.wait(5):raise Fault(504,'test timeout')
            yield {'type':'response.output_text.delta','delta':' answer'}
            yield {'type':'response.completed','response':{'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'partial answer'}]}],'usage':{'total_tokens':10}}};done.set()
        self.gateway.upstream_stream=upstream
        created=self.call('/v1/learning/jobs/create',{**self.body,'stream':True});self.assertEqual(created[0],202);key=created[2]['id']
        try:
            self.assertTrue(ready.wait(5));snapshot=self.call('/v1/learning/jobs/poll',{'id':key})[2]
            self.assertEqual(snapshot['text'],'partial');self.assertEqual(snapshot['state'],'generating')
            self.call('/v1/learning/jobs/poll',{'id':key});self.assertEqual(len(count),1)
        finally:release.set()
        # Completion is committed before the worker closes its generator.
        for _ in range(100):
            snapshot=self.call('/v1/learning/jobs/poll',{'id':key})[2]
            if snapshot['state']=='complete':break
            threading.Event().wait(.01)
        self.assertEqual(snapshot['text'],'partial answer');self.assertEqual(snapshot['state'],'complete')
        self.assertEqual(self.gateway.usage(1,'zhiyun-subtitles')['requests'],1);self.assertEqual(self.gateway.usage(1,'zhiyun-subtitles')['total_tokens'],10)

    def test_incremental_jobs_enforce_auth_owner_cancel_and_error(self):
        entered=threading.Event();release=threading.Event();finished=threading.Event()
        def upstream(*args):
            try:
                entered.set();release.wait(5);yield {'type':'response.output_text.delta','delta':'should not appear'}
            finally:finished.set()
        self.gateway.upstream_stream=upstream
        key=self.call('/v1/learning/jobs/create',self.body)[2]['id'];self.assertTrue(entered.wait(5))
        try:
            self.fails(401,lambda:self.call('/v1/learning/jobs/poll',{'id':key},{'X-App-Id':'zhiyun-subtitles'}))
            self.gateway.add_user('b@example.test','long-test-password','zhiyun-subtitles')
            token=self.call('/v1/auth/login',{'email':'b@example.test','password':'long-test-password'})[2]['token'];other={**self.headers,'Authorization':'Bearer '+token}
            self.fails(404,lambda:self.call('/v1/learning/jobs/poll',{'id':key},other));self.fails(404,lambda:self.call('/v1/learning/jobs/cancel',{'id':key},other))
            self.call('/v1/learning/jobs/cancel',{'id':key});self.assertEqual(self.call('/v1/learning/jobs/poll',{'id':key})[2]['state'],'cancelled')
        finally:release.set();finished.wait(5)
        self.assertEqual(self.call('/v1/learning/jobs/poll',{'id':key})[2]['text'],'')
        self.gateway.upstream_stream=lambda *args:iter([])
        key=self.call('/v1/learning/jobs/create',self.body)[2]['id']
        for _ in range(100):
            result=self.call('/v1/learning/jobs/poll',{'id':key})[2]
            if result['state']=='error':break
            threading.Event().wait(.01)
        self.assertEqual(result['state'],'error');self.assertIn('中断',result['error'])

    def test_streamed_reply_and_metering(self):
        def upstream(url,headers,body):
            self.assertTrue(body['stream'])
            yield {'type':'response.output_text.delta','delta':'answer'}
            yield {'type':'response.completed','response':{'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'answer'}]}],'usage':{'total_tokens':10}}}
        self.gateway.upstream_stream=upstream
        events=[]
        self.gateway.handle('POST','/v1/ark/responses',self.headers,{**self.body,'stream':True},'local',events.append)
        self.assertEqual([e['type'] for e in events],['response.in_progress','response.output_text.delta','response.completed'])
        self.assertEqual(self.gateway.usage(1,'zhiyun-subtitles')['total_tokens'],10)

    def test_stream_failure_preserves_uncertain_usage(self):
        self.gateway.upstream_stream=lambda *args:iter([{'type':'response.output_text.delta','delta':'partial'}])
        events=[]
        self.fails(502,lambda:self.gateway.handle('POST','/v1/ark/responses',self.headers,{**self.body,'stream':True},'local',events.append))
        self.assertEqual(self.gateway.usage(1,'zhiyun-subtitles')['uncertain'],1)
        self.assertEqual(events[-1]['delta'],'partial')

    def test_http_stream_flushes_delta_before_model_completion(self):
        completed=threading.Event()
        def upstream(*args):
            yield {'type':'response.output_text.delta','delta':'实时文字'}
            if not completed.wait(5): raise Fault(504,'test did not receive delta')
            yield {'type':'response.completed','response':{'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'实时文字'}]}],'usage':{'total_tokens':5}}}
        self.gateway.upstream_stream=upstream
        server=make_server(self.gateway,port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            req=urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+'/v1/ark/responses',json.dumps({**self.body,'stream':True}).encode(),{**self.headers,'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=5) as response:
                self.assertIn('text/event-stream',response.headers['Content-Type'])
                self.assertEqual(response.headers['X-Accel-Buffering'],'no')
                response.readline();response.readline()
                delta=json.loads(response.readline().decode()[6:]);self.assertEqual(delta['delta'],'实时文字')
                completed.set();self.assertIn(b'response.completed',response.read())
        finally:
            completed.set();server.shutdown();server.server_close();thread.join()

if __name__=='__main__': unittest.main()
