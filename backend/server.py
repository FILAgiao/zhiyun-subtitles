import argparse, copy, base64, getpass, ipaddress, threading, hashlib, hmac, io, json, os, secrets, sqlite3, time, urllib.request, urllib.error, uuid, wave
from pathlib import Path
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ARK='https://ark.cn-beijing.volces.com/api/v3/responses'
SPEECH='https://openspeech.bytedance.com/api/v3/auc/bigmodel/'
SCHEMA='''
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,salt TEXT,password TEXT);
CREATE TABLE IF NOT EXISTS grants(user INTEGER,app TEXT,requests INTEGER,audio INTEGER,PRIMARY KEY(user,app));
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user INTEGER,expires INTEGER);
CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,user INTEGER,app TEXT,month TEXT,kind TEXT,state TEXT,input_tokens INTEGER DEFAULT 0,output_tokens INTEGER DEFAULT 0,total_tokens INTEGER DEFAULT 0,web_search INTEGER DEFAULT 0,seconds REAL DEFAULT 0,created INTEGER);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user INTEGER,app TEXT,call TEXT,created INTEGER,done INTEGER DEFAULT 0,result TEXT);
CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,start INTEGER,count INTEGER);
'''
try:
    from .admin_api import AdminMixin, Fault, migrate
except ImportError:
    from admin_api import AdminMixin, Fault, migrate

def month(): return time.strftime('%Y-%m',time.gmtime())
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def password_hash(password,salt): return hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),600000).hex()
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

def official(url,headers,body):
    request=urllib.request.Request(url,json.dumps(body).encode(),headers,method='POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=75) as r:
            raw=r.read(8000001)
            if len(raw)>8000000: raise Fault(502,'上游响应过大')
            return r.status,dict(r.headers),json.loads(raw)
    except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError):
        raise Fault(502,'官方接口请求未完成，请检查用量后重试') from None

def official_stream(url,headers,body):
    request=urllib.request.Request(url,json.dumps(body).encode(),{**headers,'Accept':'text/event-stream'},method='POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=75) as response:
            if response.status!=200: raise Fault(502,'模型服务返回异常')
            if 'text/event-stream' not in response.headers.get('Content-Type',''):
                raw=response.read(8000001)
                if len(raw)>8000000: raise Fault(502,'上游响应过大')
                yield {'type':'response.completed','response':json.loads(raw)}
                return
            size=0;parts=[];deadline=time.monotonic()+110
            while True:
                if time.monotonic()>deadline: raise Fault(504,'模型回答超时')
                line=response.readline(1000001);size+=len(line)
                if size>8000000 or len(line)>1000000: raise Fault(502,'上游响应过大')
                if not line: break
                text=line.decode('utf-8').rstrip('\r\n')
                if not text:
                    if parts:
                        data='\n'.join(parts);parts=[]
                        if data!='[DONE]': yield json.loads(data)
                elif text.startswith('data:'): parts.append(text[5:].lstrip())
    except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError):
        raise Fault(502,'官方接口请求未完成，请稍后重试') from None

class Gateway(AdminMixin):
    def __init__(self,path,upstream=official,upstream_stream=official_stream):
        self.path,self.upstream,self.upstream_stream=str(path),upstream,upstream_stream
        self.learning_jobs={};self.learning_lock=threading.Lock();self.learning_slots=threading.BoundedSemaphore(8)
        Path(self.path).parent.mkdir(parents=True,exist_ok=True)
        with self.db() as db:
            db.executescript(SCHEMA)
            migrate(db)
    @contextmanager
    def db(self):
        db=sqlite3.connect(self.path,timeout=10); db.row_factory=sqlite3.Row
        try:
            with db: yield db
        finally: db.close()
    def add_user(self,email,password,app,requests=1000,audio=3600,username=None,admin=False):
        if not 12<=len(password)<=256: raise ValueError('密码为 12–256 个字符')
        salt=secrets.token_hex(16)
        with self.db() as db:
            row=db.execute('SELECT id,username,is_admin FROM users WHERE email=?',(email.strip().lower(),)).fetchone()
            user=row['id'] if row else db.execute('INSERT INTO users(email,salt,password) VALUES(?,?,?)',(email.strip().lower(),salt,password_hash(password,salt))).lastrowid
            db.execute('INSERT INTO grants VALUES(?,?,?,?) ON CONFLICT(user,app) DO UPDATE SET requests=excluded.requests,audio=excluded.audio',(user,app,requests,audio))
            db.execute('UPDATE users SET username=?,is_admin=? WHERE id=?',(username or (row['username'] if row else email.strip().lower()),1 if admin else row['is_admin'] if row else 0,user))
        return user
    def throttle(self,key,limit,window=60):
        now=int(time.time())
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM attempts WHERE start<?',(now-86400,))
            row=db.execute('SELECT * FROM attempts WHERE key=?',(key,)).fetchone()
            recent=row and now-row['start']<window
            count=row['count']+1 if recent else 1
            db.execute('INSERT OR REPLACE INTO attempts VALUES(?,?,?)',(key,row['start'] if recent else now,count))
        if count>limit: raise Fault(429,'请求过于频繁，请稍后再试')
    def auth(self,token,app):
        with self.db() as db:
            row=db.execute('SELECT users.id,users.email,users.username,users.is_admin FROM sessions JOIN users ON users.id=sessions.user WHERE hash=? AND expires>?',(digest(token),int(time.time()))).fetchone()
            if not row: raise Fault(401,'请登录或重新登录')
            if not db.execute('SELECT 1 FROM grants WHERE user=? AND app=?',(row['id'],app)).fetchone(): raise Fault(403,'账号未开通此 APP')
            result=dict(row)
        self.touch_activity(digest(token))
        return result
    def usage(self,user,app):
        with self.db() as db:
            totals=dict(db.execute("SELECT COUNT(*) AS requests,COALESCE(SUM(total_tokens),0) AS total_tokens,COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens,COALESCE(SUM(web_search),0) AS web_search,COALESCE(SUM(seconds),0) AS audio_seconds,COALESCE(SUM(CASE WHEN state IN ('reserved','unknown') THEN 1 ELSE 0 END),0) AS uncertain FROM calls WHERE user=? AND app=? AND month=?",(user,app,month())).fetchone())
            limits=dict(db.execute('SELECT requests AS request_limit,audio AS audio_limit FROM grants WHERE user=? AND app=?',(user,app)).fetchone())
        return {'month':month(),**totals,**limits}
    def reserve(self,user,app,kind,seconds=0):
        call=str(uuid.uuid4())
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            limits=db.execute('SELECT * FROM grants WHERE user=? AND app=?',(user,app)).fetchone()
            used=db.execute('SELECT COUNT(*),COALESCE(SUM(seconds),0) FROM calls WHERE user=? AND app=? AND month=?',(user,app,month())).fetchone()
            if used[0]>=limits['requests'] or used[1]+seconds>limits['audio']: raise Fault(429,'本月额度已用完')
            active=db.execute("SELECT COUNT(*) FROM calls WHERE user=? AND state='reserved' AND created>?",(user,int(time.time())-180)).fetchone()[0]
            if active>=2: raise Fault(429,'请等待当前请求完成')
            db.execute('INSERT INTO calls(id,user,app,month,kind,state,seconds,created) VALUES(?,?,?,?,?,?,?,?)',(call,user,app,month(),kind,'reserved',seconds,int(time.time())))
        return call
    def state(self,call,state,usage=None):
        usage=usage or {}
        def number(v): return v if type(v) is int and v>=0 else 0
        with self.db() as db:
            db.execute('UPDATE calls SET state=?,input_tokens=?,output_tokens=?,total_tokens=?,web_search=?,finished=? WHERE id=?',(state,number(usage.get('input_tokens')),number(usage.get('output_tokens')),number(usage.get('total_tokens')),number((usage.get('tool_usage') or {}).get('web_search')),int(time.time()),call))
    def handle(self,method,path,headers,body,ip,stream_sink=None):
        app=headers.get('X-App-Id','')
        if method=='GET' and path=='/health': return 200,{}, {'ok':True}
        if method=='POST' and path=='/v1/auth/login':
            email,password=body.get('email',''),body.get('password','')
            if not isinstance(email,str) or not isinstance(password,str) or len(email)>254 or len(password)>256: raise Fault(400,'登录参数无效')
            self.throttle('ip:'+ip,10,900); self.throttle('email:'+digest(email.lower()),10,900)
            with self.db() as db:
                row=db.execute('SELECT * FROM users WHERE email=? OR username=?',(email.strip().lower(),email.strip())).fetchone()
                valid=hmac.compare_digest(password_hash(password,row['salt'] if row else '00'*16),row['password'] if row else '00'*32)
                if not row or not valid: raise Fault(401,'邮箱或密码错误')
                if not db.execute('SELECT 1 FROM grants WHERE user=? AND app=?',(row['id'],app)).fetchone(): raise Fault(403,'账号未开通此 APP')
                token=secrets.token_urlsafe(32)
                db.execute('DELETE FROM sessions WHERE expires<?',(int(time.time()),))
                db.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(token),row['id'],int(time.time())+604800))
            self.open_activity(digest(token),row['id'],app,headers.get('X-Client-Type','api'),int(time.time())+604800)
            return 200,{}, {'token':token,'expires_in':604800,'capabilities':{'web_search':os.environ.get('ALLOW_WEB_SEARCH')=='1'}}
        token=headers.get('Authorization','').removeprefix('Bearer ')
        if not token and app=='zhiyun-subtitles' and method=='POST' and path in ('/v1/speech/submit','/v1/speech/query'):
            # Guest speech uses an isolated, non-login identity; never a shared model credential.
            guest=-int(digest('speech-guest:'+ip)[:15],16)-1
            self.throttle('guest:'+str(guest),90)
            if path.endswith('/submit'): self.throttle('guest-submit:'+str(guest),6,900)
            with self.db() as db:
                db.execute('INSERT OR IGNORE INTO grants VALUES(?,?,?,?)',(guest,app,int(os.environ.get('GUEST_SPEECH_REQUESTS','120')),int(os.environ.get('GUEST_SPEECH_SECONDS','1440'))))
            return self.speech(guest,app,path,headers,body)
        user=self.auth(token,app)
        if method=='POST' and path in ('/v1/learning/jobs/poll','/v1/learning/jobs/cancel'):
            return self.learning_job(user['id'],app,path,body)
        self.throttle('user:'+str(user['id']),90)
        if method=='POST' and path=='/v1/auth/logout':
            with self.db() as db: db.execute('DELETE FROM sessions WHERE hash=?',(digest(token),))
            self.close_activity(digest(token))
            return 200,{}, {'ok':True}
        if method=='GET' and path=='/v1/me': return 200,{}, {**user,'app':app,'usage':self.usage(user['id'],app),'capabilities':{'web_search':os.environ.get('ALLOW_WEB_SEARCH')=='1'}}
        if method=='POST' and path=='/v1/activity': return 200,{}, {'ok':True,'server_time':int(time.time())}
        if method=='GET' and path=='/v1/history': return 200,{},self.history(user['id'])
        if path.startswith('/v1/admin/'): return self.admin_request(method,path,user,body,month())
        if method=='POST' and path=='/v1/learning/jobs/create': return self.learning_job(user['id'],app,path,body)
        if method=='POST' and path=='/v1/ark/responses': return self.ark(user['id'],app,body,stream_sink)
        if method=='POST' and path in ('/v1/speech/submit','/v1/speech/query'): return self.speech(user['id'],app,path,headers,body)
        raise Fault(404,'接口不存在')
    def learning_job(self,user,app,path,body):
        now=time.monotonic()
        with self.learning_lock:
            for key,job in list(self.learning_jobs.items()):
                if now-job['created']>300 and job['state'] not in ('pending','generating'): del self.learning_jobs[key]
            if not path.endswith('/create'):
                key=body.get('id');job=self.learning_jobs.get(key) if isinstance(key,str) else None
                if not job or job['user']!=user or job['app']!=app: raise Fault(404,'回答任务不存在或已过期')
                if path.endswith('/cancel'):
                    job['cancelled']=True
                    if job['state'] not in ('complete','error'):job['state']='cancelled'
                    return 200,{}, {'ok':True}
                self.throttle('learning-poll:'+str(user)+':'+key,180)
                snapshot={k:job[k] for k in ('id','state','text','revision')}
                if job.get('response'):snapshot['response']=job['response']
                if job.get('error'):snapshot['error']=job['error'];snapshot['error_status']=job['error_status']
                return 200,{},snapshot
            if len(self.learning_jobs)>=128: raise Fault(503,'回答任务较多，请稍后再试')
            if sum(j['user']==user and j['state'] in ('pending','generating') for j in self.learning_jobs.values())>=2: raise Fault(429,'请等待当前回答完成')
            if not self.learning_slots.acquire(blocking=False):raise Fault(503,'模型服务繁忙，请稍后再试')
            key=secrets.token_urlsafe(24)
            job={'id':key,'user':user,'app':app,'created':now,'state':'pending','text':'','revision':0,'cancelled':False}
            self.learning_jobs[key]=job
        def sink(event):
            with self.learning_lock:
                if job['cancelled']:raise Fault(409,'已停止本次回答')
                kind=event.get('type')
                if kind=='response.in_progress':job['state']='generating'
                elif kind=='response.output_text.delta':
                    delta=event.get('delta','')
                    if not isinstance(delta,str) or len(job['text'])+len(delta)>200000:raise Fault(502,'模型回复过大')
                    job['text']+=delta;job['revision']+=1
                elif kind=='response.completed':job['response']=event['response'];job['state']='complete';job['revision']+=1
        def run():
            try:self.ark(user,app,{**body,'stream':True},sink)
            except Exception as error:
                with self.learning_lock:
                    if not job['cancelled']:
                        job['state']='error';job['error']=error.message if isinstance(error,Fault) else '模型服务暂时不可用';job['error_status']=error.status if isinstance(error,Fault) else 502
            finally:self.learning_slots.release()
        try:threading.Thread(target=run,daemon=True).start()
        except Exception:
            with self.learning_lock:del self.learning_jobs[key]
            self.learning_slots.release();raise
        return 202,{}, {'id':key,'state':'pending','text':'','revision':0}

    def ark(self,user,app,body,stream_sink=None):
        key=os.environ.get('ARK_API_KEY')
        if not key: raise Fault(503,'尚未配置模型服务')
        if not body.get('model'):
            body={**body,'model':os.environ.get('ARK_LEARNING_MODEL','doubao-seed-2-1-lite-260915')}
        models=os.environ.get('ARK_MODELS','doubao-seed-translation-250915,doubao-seed-2-1-lite-260915').split(',')
        if body.get('model') not in models: raise Fault(400,'模型未开通')
        inputs=body.get('input')
        if not isinstance(inputs,list) or not 1<=len(inputs)<=12: raise Fault(400,'输入格式无效')
        text_size,images=0,0
        for item in inputs:
            if not isinstance(item,dict) or item.get('role') not in ('system','user','assistant') or set(item)-{'role','content'}: raise Fault(400,'消息格式无效')
            content=item.get('content')
            if isinstance(content,str): text_size+=len(content); continue
            if not isinstance(content,list): raise Fault(400,'消息内容无效')
            for part in content:
                if not isinstance(part,dict): raise Fault(400,'消息内容无效')
                if part.get('type')=='input_text' and isinstance(part.get('text'),str) and not set(part)-{'type','text','translation_options'}:
                    text_size+=len(part['text'])
                    if 'translation_options' in part:
                        options=part['translation_options']
                        if not isinstance(options,dict) or set(options)-{'source_language','target_language'} or any(v not in ('en','zh') for v in options.values()): raise Fault(400,'翻译语言无效')
                elif part.get('type')=='input_image' and not set(part)-{'type','image_url'}:
                    image=part.get('image_url','')
                    if not isinstance(image,str) or len(image)>2200000 or not image.startswith(('data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')): raise Fault(400,'仅接受大小受限的内嵌图片')
                    try: base64.b64decode(image.split(',',1)[1],validate=True)
                    except ValueError: raise Fault(400,'图片编码无效') from None
                    images+=1
                else: raise Fault(400,'不支持此输入类型')
        if text_size>32000 or images>3: raise Fault(400,'输入超出限制')
        output=body.get('max_output_tokens',2200)
        if type(output) is not int or not 1<=output<=4096: raise Fault(400,'输出超出限制')
        streaming=body.get('stream') is True and stream_sink is not None
        payload={'model':body['model'],'input':inputs,'max_output_tokens':output,'stream':streaming}
        if body['model'].startswith('doubao-seed-2-') and 'reasoning' not in body:
            payload['reasoning']={'effort':'minimal'}
        if 'reasoning' in body:
            reasoning=body['reasoning']
            if not isinstance(reasoning,dict) or set(reasoning)!={'effort'} or reasoning['effort'] not in ('minimal','low','medium','high'): raise Fault(400,'思考参数无效')
            payload['reasoning']=reasoning
        # The dedicated translation model rejects store, including store:false.
        if body['model']!='doubao-seed-translation-250915': payload['store']=False
        notice=''
        if body.get('tools'):
            if body['tools']!=[{'type':'web_search','max_keyword':3}]: raise Fault(400,'不支持此工具')
            if os.environ.get('ALLOW_WEB_SEARCH')=='1':payload['tools']=body['tools']
            else:notice='联网搜索未开通，本次按普通对话回答。\n\n'
        def decorate(result):
            if not notice:return result
            result=copy.deepcopy(result)
            for item in result.get('output',[]):
                if item.get('type')!='message':continue
                for content in item.get('content',[]):
                    if content.get('type')=='output_text':
                        content['text']=notice+content.get('text','');result['warnings']=[notice.strip()];return result
            return result
        call=self.reserve(user,app,'ark')
        feature='translation' if body['model']=='doubao-seed-translation-250915' else 'learning'
        if any(isinstance(i.get('content'),str) and '字幕译者' in i['content'] for i in inputs): feature='translation_context'
        self.record_call_meta(call,body['model'],feature,images)
        try:
            if streaming:
                stream_sink({'type':'response.in_progress'})
                if notice:stream_sink({'type':'response.output_text.delta','delta':notice})
                for event in self.upstream_stream(ARK,{'Authorization':'Bearer '+key,'Content-Type':'application/json'},payload):
                    if event.get('type')=='response.output_text.delta':
                        stream_sink({'type':event['type'],'delta':event.get('delta','')})
                    elif event.get('type')=='response.completed':
                        result=event.get('response',{})
                        if result.get('status') in ('failed','incomplete') or result.get('error'): raise Fault(502,'模型回答未完成，请缩短问题重试')
                        result=decorate(result)
                        self.state(call,'complete' if result.get('usage') else 'unknown',result.get('usage'))
                        stream_sink({'type':'response.completed','response':{k:result[k] for k in ('id','status','output','usage','warnings') if k in result}})
                        return 200,{},None
                    elif event.get('type') in ('error','response.failed','response.incomplete'):
                        raise Fault(502,'模型回答未完成，请稍后重试')
                raise Fault(502,'模型回复连接中断，请重试')
            status,_,result=self.upstream(ARK,{'Authorization':'Bearer '+key,'Content-Type':'application/json'},payload)
            if status!=200 or not isinstance(result,dict): raise Fault(502,'模型服务返回异常')
            result=decorate(result)
            self.state(call,'complete' if result.get('usage') else 'unknown',result.get('usage'))
            return 200,{}, {k:result[k] for k in ('id','status','output','usage','warnings') if k in result}
        except Exception: self.state(call,'unknown'); raise
    def speech(self,user,app,path,headers,body):
        with self.db() as db: db.execute('DELETE FROM jobs WHERE created<?',(int(time.time())-86400,))
        key=os.environ.get('SPEECH_API_KEY')
        if not key: raise Fault(503,'尚未配置语音服务')
        task=headers.get('X-Api-Request-Id','')
        try: uuid.UUID(task)
        except ValueError: raise Fault(400,'语音任务 ID 无效') from None
        if path.endswith('/submit'):
            try:
                data=base64.b64decode(body['audio']['data'],validate=True)
                if len(data)>1000000: raise ValueError()
                with wave.open(io.BytesIO(data)) as wav:
                    seconds=wav.getnframes()/wav.getframerate()
                    if wav.getnchannels()!=1 or wav.getsampwidth()!=2 or wav.getframerate()!=16000 or not 0<seconds<=30 or len(wav.readframes(wav.getnframes()))!=wav.getnframes()*2: raise ValueError()
            except (KeyError,TypeError,ValueError,wave.Error,EOFError): raise Fault(400,'只接受 30 秒以内的 16kHz 单声道 PCM WAV') from None
            with self.db() as db:
                if db.execute('SELECT 1 FROM jobs WHERE id=?',(task,)).fetchone(): raise Fault(409,'任务已提交，请查询原任务')
            call=self.reserve(user,app,'speech',seconds)
            self.record_call_meta(call,'volc.seedasr.auc','alignment',0)
            with self.db() as db:
                try: db.execute('INSERT INTO jobs(id,user,app,call,created) VALUES(?,?,?,?,?)',(task,user,app,call,int(time.time())))
                except sqlite3.IntegrityError:
                    db.execute('DELETE FROM calls WHERE id=?',(call,)); raise Fault(409,'任务已提交') from None
            payload={'user':{'uid':str(user)},'audio':{'data':body['audio']['data'],'format':'wav','rate':16000,'bits':16,'channel':1},'request':{'model_name':'bigmodel','show_utterances':True,'enable_itn':True,'enable_punc':True}}
        else:
            with self.db() as db: job=db.execute('SELECT * FROM jobs WHERE id=? AND user=? AND app=?',(task,user,app)).fetchone()
            if not job or int(time.time())-job['created']>86400: raise Fault(404,'未找到语音任务')
            call,payload=job['call'],{}
            if job['done']: return 200,{'X-Api-Status-Code':'20000000'},json.loads(job['result'])
        try:
            status,response_headers,result=self.upstream(SPEECH+path.rsplit('/',1)[1],{'X-Api-Key':key,'X-Api-Resource-Id':'volc.seedasr.auc','X-Api-Request-Id':task,'X-Api-Sequence':'-1','Content-Type':'application/json'},payload)
            code=next((str(v) for k,v in response_headers.items() if k.lower()=='x-api-status-code'),'')
            if status!=200 or code not in ('20000000','20000001','20000002'): raise Fault(502,'语音服务返回异常')
            clean={k:result[k] for k in ('result','audio_info') if k in result}
            if path.endswith('/query') and code=='20000000':
                with self.db() as db: db.execute('UPDATE jobs SET done=1,result=? WHERE id=?',(json.dumps(clean),task))
                self.state(call,'complete')
            return 200,{'X-Api-Status-Code':code},clean
        except Exception: self.state(call,'unknown'); raise

def make_server(gateway,host='127.0.0.1',port=8080):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def dispatch(self):
            self.streaming=False
            origin=self.headers.get('Origin'); extra={}
            self.stream_headers=extra
            try:
                self.connection.settimeout(15)
                if origin:
                    if origin not in os.environ.get('ALLOWED_ORIGINS','').split(',')+[os.environ.get('PUBLIC_ORIGIN','')]: raise Fault(403,'来源未开通')
                    extra={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Expose-Headers':'X-Api-Status-Code'}
                self.stream_headers=extra
                if self.command=='OPTIONS': status,more,result=204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,X-App-Id,X-Api-Request-Id,X-Client-Type'},None
                else:
                    if self.command=='GET' and self.path in ('/admin','/admin/','/admin.js','/admin.css','/install.user.js','/install.meta.js'):
                        if self.path=='/admin/':
                            status,more,result=302,{'Location':'../admin'},None
                        else:
                            name='admin.html' if self.path=='/admin' else self.path[1:]
                            mime='text/html; charset=utf-8' if name.endswith('.html') else 'text/javascript; charset=utf-8' if name.endswith('.js') else 'text/css; charset=utf-8'
                            result=(Path(__file__).parent/name).read_bytes();status,more=200,{'Content-Type':mime,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Frame-Options':'DENY'}
                    else:
                        status,more,result=self.api_request(gateway)
                if not self.streaming: self.respond(status,more,result,extra)
                return
            except Fault as error: status,more,result=error.status,{}, {'error':error.message}
            except (ValueError,TimeoutError): status,more,result=400,{}, {'error':'请求格式无效'}
            except Exception: status,more,result=500,{}, {'error':'服务暂时不可用'}
            if self.streaming:
                try: self.stream_event({'type':'error','message':result['error']})
                except (BrokenPipeError,ConnectionResetError): pass
            else: self.respond(status,more,result,extra)
        def stream_event(self,event):
            if not self.streaming:
                self.streaming=True; self.close_connection=True; self.connection.settimeout(120)
                self.send_response(200)
                for k,v in {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff','Connection':'close',**self.stream_headers}.items(): self.send_header(k,v)
                self.end_headers()
            self.wfile.write(('data: '+json.dumps(event,ensure_ascii=False)+'\n\n').encode());self.wfile.flush()
        def api_request(self,gateway):
            size=int(self.headers.get('Content-Length','0'))
            if self.headers.get('Transfer-Encoding') or not 0<=size<=7000000: raise Fault(413,'请求过大')
            if self.command=='POST' and self.headers.get_content_type()!='application/json': raise Fault(415,'仅接受 JSON')
            body=json.loads(self.rfile.read(size)) if size else {}
            if not isinstance(body,dict): raise Fault(400,'JSON 格式无效')
            ip=self.client_address[0]
            if (ipaddress.ip_address(ip).is_loopback or ip in os.environ.get('TRUSTED_PROXY_IPS','').split(',')) and self.headers.get('X-Real-IP'):
                ip=str(ipaddress.ip_address(self.headers['X-Real-IP']))
            return gateway.handle(self.command,self.path,self.headers,body,ip,self.stream_event)
        def respond(self,status,more,result,extra):
            raw=result if isinstance(result,bytes) else json.dumps(result,ensure_ascii=False).encode() if result is not None else b''
            self.send_response(status)
            for k,v in {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',**extra,**more,'Content-Length':str(len(raw))}.items(): self.send_header(k,v)
            self.end_headers(); self.wfile.write(raw)
        do_GET=do_POST=do_OPTIONS=dispatch
    class BoundedServer(ThreadingHTTPServer):
        daemon_threads=True
        def __init__(self,*args):
            self.slots=threading.BoundedSemaphore(32)
            super().__init__(*args)
        def process_request(self,request,address):
            if not self.slots.acquire(blocking=False):
                self.shutdown_request(request); return
            try: super().process_request(request,address)
            except Exception:
                self.slots.release(); raise
        def process_request_thread(self,request,address):
            try: super().process_request_thread(request,address)
            finally: self.slots.release()
    return BoundedServer((host,port),Handler)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Shared API gateway; Python 3.11+ stdlib')
    parser.add_argument('command',choices=['serve','add-user']); parser.add_argument('--db',default=os.environ.get('DATABASE_PATH','backend/data/gateway.sqlite3'))
    parser.add_argument('--username'); parser.add_argument('--admin',action='store_true'); parser.add_argument('--email'); parser.add_argument('--app',default='zhiyun-subtitles'); parser.add_argument('--requests',type=int,default=1000); parser.add_argument('--audio-seconds',type=int,default=3600)
    args=parser.parse_args(); gateway=Gateway(args.db)
    if args.command=='add-user':
        if not args.email or args.requests<0 or args.audio_seconds<0: parser.error('需要邮箱及非负额度')
        gateway.add_user(args.email,getpass.getpass('Password (12+ chars): '),args.app,args.requests,args.audio_seconds,username=args.username,admin=args.admin)
        print('账号及 APP 额度已配置；已有账号密码保持不变。')
    else:
        print('Listening on loopback; expose through HTTPS reverse proxy.')
        make_server(gateway,host=os.environ.get('BIND_HOST','127.0.0.1'),port=int(os.environ.get('PORT','8080'))).serve_forever()
