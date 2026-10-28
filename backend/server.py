import signal, sys, argparse, re, copy, base64, getpass, ipaddress, threading, hashlib, hmac, io, json, os, secrets, sqlite3, time, urllib.request, urllib.error, uuid, wave
from pathlib import Path
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.client import HTTPException
ARK='https://ark.cn-beijing.volces.com/api/v3/responses'
SPEECH='https://openspeech.bytedance.com/api/v3/auc/bigmodel/'
SCHEMA='''
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,salt TEXT,password TEXT);
CREATE TABLE IF NOT EXISTS grants(user INTEGER,app TEXT,requests INTEGER,audio INTEGER,PRIMARY KEY(user,app));
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user INTEGER,expires INTEGER);
CREATE TABLE IF NOT EXISTS web_sessions(hash TEXT PRIMARY KEY,parent TEXT NOT NULL,app TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,user INTEGER,app TEXT,month TEXT,kind TEXT,state TEXT,input_tokens INTEGER DEFAULT 0,output_tokens INTEGER DEFAULT 0,total_tokens INTEGER DEFAULT 0,web_search INTEGER DEFAULT 0,seconds REAL DEFAULT 0,created INTEGER);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user INTEGER,app TEXT,call TEXT,created INTEGER,done INTEGER DEFAULT 0,result TEXT);
CREATE TABLE IF NOT EXISTS learning_job_receipts(id TEXT PRIMARY KEY,user INTEGER,app TEXT,created INTEGER);
CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,start INTEGER,count INTEGER);
'''
try:
    from .admin_api import AdminMixin, Fault, migrate
    from .prompt_api import PromptMixin, migrate_prompts
    from .study_api import StudyMixin, migrate_study
    from .operations_api import OperationsMixin, migrate_operations
    from .speech_stream import SpeechStreams
except ImportError:
    from admin_api import AdminMixin, Fault, migrate
    from prompt_api import PromptMixin, migrate_prompts
    from study_api import StudyMixin, migrate_study
    from operations_api import OperationsMixin, migrate_operations
    from speech_stream import SpeechStreams

def month(): return time.strftime('%Y-%m',time.gmtime())
def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def password_hash(password,salt): return hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),600000).hex()
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

def database_fault(error):
    # SQLite messages can include file paths, SQL and user data. Only its
    # documented numeric code and constant name belong in diagnostics.
    code=getattr(error,'sqlite_errorcode',None)
    name=getattr(error,'sqlite_errorname',None)
    diagnostic={'event':'gateway_database_error','error_code':'database_unavailable'}
    if type(code) is int: diagnostic['sqlite_errorcode']=code
    if isinstance(name,str) and re.fullmatch(r'SQLITE_[A-Z0-9_]{1,64}',name) and type(getattr(sqlite3,name,None)) is int:
        diagnostic['sqlite_errorname']=name
    print(json.dumps(diagnostic),file=sys.stderr,flush=True)
    return Fault(503,'服务数据库暂时不可用，请稍后重试。','database_unavailable',5)

def speech_status_code(headers):
    # Only this numeric supplier field may cross the gateway boundary. Never
    # copy diagnostic messages, arbitrary response headers or error bodies.
    values=[str(value) for name,value in headers.items() if name.lower()=='x-api-status-code']
    return values[0] if len(values)==1 and re.fullmatch(r'[0-9]{8}',values[0]) else ''

def speech_fault(status,message,code,upstream_code='',retry_after=None):
    error=Fault(status,message,code,retry_after)
    error.speech_status_code=upstream_code if re.fullmatch(r'[0-9]{8}',upstream_code) else ''
    return error

def speech_response_fault(status,code):
    if status in (401,403):
        return speech_fault(503,'语音服务授权失败，请联系管理员检查服务权限。','speech_upstream_auth',code)
    if status==429 or code in ('45000131','55000031'):
        return speech_fault(503,'语音服务繁忙，请稍后重试。','speech_upstream_busy',code,3)
    if code in ('20000003','45000002'):
        return speech_fault(422,'未检测到可识别的人声，请播放有讲课声音的片段后重试。','speech_audio_empty',code)
    if code in ('45000132','45000151'):
        return speech_fault(422,'语音服务无法处理本次音频，请重新播放课程后重试。','speech_audio_invalid',code)
    if code=='45000001' or 400<=status<500:
        return speech_fault(502,'语音服务未接受本次识别请求，请联系管理员检查请求参数。','speech_upstream_rejected',code)
    if status>=500 or code.startswith('550'):
        return speech_fault(503,'语音服务暂时不可用，请稍后重试。','speech_upstream_unavailable',code,3)
    return speech_fault(502,'语音服务返回了无法确认的任务状态，请稍后重试。','speech_upstream_response',code)

def official_speech(request):
    # Standard ASR submit intentionally returns an empty success body. Status
    # lives in X-Api-Status-Code; only completed queries carry result JSON.
    # Keeping this separate preserves the ARK response contract.
    try:
        try:
            response=urllib.request.build_opener(NoRedirect()).open(request,timeout=75)
        except urllib.error.HTTPError as error:
            with error:
                code=speech_status_code(error.headers)
                return error.code,{'X-Api-Status-Code':code} if code else {},{}
        with response:
            code=speech_status_code(response.headers)
            headers={'X-Api-Status-Code':code} if code else {}
            if response.status!=200 or code!='20000000' or request.full_url==SPEECH+'submit':
                return response.status,headers,{}
            raw=response.read(8000001)
            if len(raw)>8000000:
                raise speech_fault(502,'语音服务响应过大，请联系管理员。','speech_upstream_response',code)
            try:
                result=json.loads(raw)
                if not isinstance(result,dict): raise ValueError()
            except (ValueError,UnicodeError):
                raise speech_fault(502,'语音服务返回了无效的识别结果，请稍后重试。','speech_upstream_response',code) from None
            return response.status,headers,{k:result[k] for k in ('result','audio_info') if k in result}
    except (TimeoutError,urllib.error.URLError) as error:
        if isinstance(error,TimeoutError) or isinstance(getattr(error,'reason',None),TimeoutError):
            raise speech_fault(504,'连接语音服务超时，请稍后重试；已提交的任务会继续查询。','speech_upstream_timeout') from None
        raise speech_fault(502,'暂时无法连接语音服务，请稍后重试。','speech_upstream_network') from None
    except (OSError,HTTPException):
        raise speech_fault(502,'语音服务连接中断，请稍后重试；已提交的任务会继续查询。','speech_upstream_network') from None

def official(url,headers,body):
    request=urllib.request.Request(url,json.dumps(body).encode(),headers,method='POST')
    if url in (SPEECH+'submit',SPEECH+'query'): return official_speech(request)
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

class Gateway(AdminMixin, PromptMixin, StudyMixin, OperationsMixin):
    hash_password=staticmethod(password_hash)
    def __init__(self,path,upstream=official,upstream_stream=official_stream):
        self.path,self.upstream,self.upstream_stream=str(path),upstream,upstream_stream
        self.draining=False;self.active_requests=0;self.lifecycle=threading.Condition()
        self.learning_jobs={};self.learning_lock=threading.Lock();self.learning_slots=threading.BoundedSemaphore(8)
        Path(self.path).parent.mkdir(parents=True,exist_ok=True)
        with self.db() as db:
            db.executescript(SCHEMA)
            migrate(db)
            migrate_prompts(db)
            migrate_study(db)
            migrate_operations(db)
        self.speech_streams=SpeechStreams(self)
    def capabilities(self):
        return {'web_search':os.environ.get('ALLOW_WEB_SEARCH')=='1',
                'api_versions':[1],'learning_jobs':True,'speech_requires_login':True,
                'prompt_catalog':True,'membership':True,'guest_speech':False,'graceful_shutdown':True,
                'speech_stream':self.speech_streams.configured(),'speech_stream_pcm':True,
                'study_clips':True,'study_clip_limits':self.clip_limits(),'study_sync':True,'email_registration':True,'mail_configured':self.study_capabilities()['mail_configured'],
                'compatibility':{'baseline':'0.20.48','version_header_required':False}}
    def client_metadata(self,headers):
        version=headers.get('X-Client-Version','')
        if not isinstance(version,str) or not re.fullmatch(r'[0-9]{1,5}(?:\.[0-9]{1,5}){2,3}',version):version=''
        channel=headers.get('X-Client-Channel','unknown')
        if channel not in ('chrome-store','edge-store','unpacked','userscript'):channel='unknown'
        return version,channel
    def begin_drain(self):
        with self.lifecycle:self.draining=True;self.lifecycle.notify_all()
    def wait_for_drain(self,timeout=120):
        deadline=time.monotonic()+timeout
        while True:
            with self.learning_lock:
                pending=any(not j.get('worker_done') or j['state'] in ('pending','generating') or (not j.get('delivered') and time.monotonic()-j['created']<300) for j in self.learning_jobs.values())
            speech_pending=self.speech_streams.active()
            with self.lifecycle:
                if not pending and not speech_pending and self.active_requests==0:return True
                remaining=deadline-time.monotonic()
                if remaining<=0:return False
                self.lifecycle.wait(min(.1,remaining))
    @contextmanager
    def db(self,readonly=False,timeout=10):
        try:
            target=Path(self.path).resolve().as_uri()+'?mode=ro' if readonly else self.path
            db=sqlite3.connect(target,timeout=timeout,uri=readonly); db.row_factory=sqlite3.Row
            try:
                with db: yield db
            finally: db.close()
        # Callers already translate expected uniqueness conflicts into 409s.
        except sqlite3.IntegrityError: raise
        except sqlite3.DatabaseError as error: raise database_fault(error) from None
    def check_database(self):
        # Bounded readiness reads cover the shared authentication/accounting
        # paths. A fresh read-only connection detects a missing/replaced file
        # without recreating it; full integrity scans belong in maintenance.
        with self.db(readonly=True,timeout=1) as db:
            for table,column in (('users','id'),('sessions','hash'),('grants','user'),
                                 ('calls','id'),('jobs','id'),('attempts','key'),
                                 ('activity_sessions','hash'),('activity_client_metadata','hash'),
                                 ('learning_job_receipts','id'),('speech_stream_receipts','id')):
                db.execute('SELECT '+column+' FROM '+table+' LIMIT 1').fetchone()
    def add_user(self,email,password,app,requests=1000,audio=3600,username=None,admin=False,permissions=None,plan=None):
        if not 12<=len(password)<=256: raise ValueError('密码为 12–256 个字符')
        salt=secrets.token_hex(16)
        with self.db() as db:
            row=db.execute('SELECT id,username,is_admin FROM users WHERE email=?',(email.strip().lower(),)).fetchone()
            user=row['id'] if row else db.execute('INSERT INTO users(email,salt,password) VALUES(?,?,?)',(email.strip().lower(),salt,password_hash(password,salt))).lastrowid
            db.execute('INSERT INTO grants(user,app,requests,audio) VALUES(?,?,?,?) ON CONFLICT(user,app) DO UPDATE SET requests=excluded.requests,audio=excluded.audio',(user,app,requests,audio))
            db.execute('UPDATE users SET username=?,is_admin=? WHERE id=?',(username or (row['username'] if row else email.strip().lower()),1 if admin else row['is_admin'] if row else 0,user))
            if permissions is not None:
                db.execute('UPDATE grants SET enabled=?,learning=?,translation=?,speech=?,expires=?,plan=? WHERE user=? AND app=?',(*(permissions[k] for k in ('enabled','learning','translation','speech','expires')),permissions.get('plan','legacy'),user,app))
            elif plan is not None:
                options=self.grant_options({'plan':plan})
                db.execute('UPDATE grants SET learning=?,translation=?,speech=?,plan=? WHERE user=? AND app=?',(*(options[k] for k in ('learning','translation','speech','plan')),user,app))
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
        if count>limit: raise Fault(429,'请求过于频繁，请稍后再试','rate_limit',max(1,window-(now-(row['start'] if recent else now))))
    def auth(self,token,app,headers=None,path=None):
        with self.db() as db:
            row=db.execute('SELECT users.id,users.email,users.username,users.is_admin FROM sessions JOIN users ON users.id=sessions.user WHERE hash=? AND expires>?',(digest(token),int(time.time()))).fetchone()
            if not row: raise Fault(401,'请登录或重新登录')
            web=db.execute('SELECT parent,app FROM web_sessions WHERE hash=?',(digest(token),)).fetchone()
            if web:
                parent=db.execute('SELECT 1 FROM sessions WHERE hash=? AND user=? AND expires>?',(web['parent'],row['id'],int(time.time()))).fetchone()
                if not parent or web['app']!=app: raise Fault(401,'请登录或重新登录')
                if path not in ('/v1/me','/v1/auth/logout','/v1/study/conversations','/v1/study/clips','/v1/study/clip-image','/v1/study/capabilities'):
                    raise Fault(403,'网页会话仅用于查看和整理个人学习记录','web_session_scope')
            self.check_grant(db,row['id'],app)
            result=dict(row)
        self.touch_activity(digest(token),*self.client_metadata(headers or {}))
        return result
    def usage(self,user,app):
        with self.db() as db:
            totals=dict(db.execute("SELECT COUNT(*) AS requests,COALESCE(SUM(total_tokens),0) AS total_tokens,COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens,COALESCE(SUM(web_search),0) AS web_search,COALESCE(SUM(seconds),0) AS audio_seconds,COALESCE(SUM(CASE WHEN state IN ('reserved','unknown') THEN 1 ELSE 0 END),0) AS uncertain FROM calls WHERE user=? AND app=? AND month=?",(user,app,month())).fetchone())
            limits=dict(db.execute('SELECT requests AS request_limit,audio AS audio_limit FROM grants WHERE user=? AND app=?',(user,app)).fetchone())
            credit=self.monthly_credits(db,user,app)
            limits['request_limit']+=credit['requests'];limits['audio_limit']+=credit['audio']
        return {'month':month(),**totals,**limits}
    def reserve(self,user,app,kind,seconds=0,feature=None):
        call=str(uuid.uuid4())
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            limits=self.check_grant(db,user,app,feature)
            used=db.execute('SELECT COUNT(*),COALESCE(SUM(seconds),0) FROM calls WHERE user=? AND app=? AND month=?',(user,app,month())).fetchone()
            credit=self.monthly_credits(db,user,app)
            if used[0]>=limits['requests']+credit['requests'] or used[1]+seconds>limits['audio']+credit['audio']: raise Fault(429,'本月额度已用完','quota_exhausted')
            active=db.execute("SELECT COUNT(*) FROM calls WHERE user=? AND state='reserved' AND created>?",(user,int(time.time())-180)).fetchone()[0]
            if active>=2: raise Fault(429,'请等待当前请求完成','concurrency_limit',5)
            db.execute('INSERT INTO calls(id,user,app,month,kind,state,seconds,created) VALUES(?,?,?,?,?,?,?,?)',(call,user,app,month(),kind,'reserved',seconds,int(time.time())))
        return call
    def state(self,call,state,usage=None):
        usage=usage or {}
        def number(v): return v if type(v) is int and v>=0 else 0
        with self.db() as db:
            db.execute('UPDATE calls SET state=?,input_tokens=?,output_tokens=?,total_tokens=?,web_search=?,finished=? WHERE id=?',(state,number(usage.get('input_tokens')),number(usage.get('output_tokens')),number(usage.get('total_tokens')),number((usage.get('tool_usage') or {}).get('web_search')),int(time.time()),call))
    def handle(self,method,path,headers,body,ip,stream_sink=None):
        # Gate only new paid work; login, account reads and task polling stay available.
        paid=method=='POST' and path in ('/v1/ark/responses','/v1/learning/jobs/create','/v1/speech/submit','/v1/speech/stream/create')
        with self.lifecycle:
            if paid and self.draining:raise Fault(503,'服务正在更新，请稍后重试；本次请求未扣额度。','server_updating',5)
            self.active_requests+=1
        try:return self._handle(method,path,headers,body,ip,stream_sink)
        except sqlite3.DatabaseError as error:raise database_fault(error) from None
        finally:
            with self.lifecycle:self.active_requests-=1;self.lifecycle.notify_all()
    def _handle(self,method,path,headers,body,ip,stream_sink=None):
        app=headers.get('X-App-Id','')
        access_public=self.operations_public(method,path)
        if access_public is not None:return access_public
        study_public=self.study_public(method,path,headers,body,ip)
        if study_public is not None:return study_public
        if method=='GET' and path=='/health':
            self.check_database()
            return 200,{}, {'ok':True,'api_version':1,'capabilities':self.capabilities(),'draining':self.draining}
        if method=='POST' and path=='/v1/auth/login':
            email,password=body.get('email',''),body.get('password','')
            if not isinstance(email,str) or not isinstance(password,str) or len(email)>254 or len(password)>256: raise Fault(400,'登录参数无效')
            self.throttle('ip:'+ip,10,900); self.throttle('email:'+digest(email.lower()),10,900)
            with self.db() as db:
                row=db.execute('SELECT * FROM users WHERE email=? OR username=?',(email.strip().lower(),email.strip())).fetchone()
                valid=hmac.compare_digest(password_hash(password,row['salt'] if row else '00'*16),row['password'] if row else '00'*32)
                if not row or not valid: raise Fault(401,'邮箱或密码错误')
                self.check_grant(db,row['id'],app)
                token=secrets.token_urlsafe(32)
                db.execute('DELETE FROM sessions WHERE expires<?',(int(time.time()),))
                db.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(token),row['id'],int(time.time())+604800))
            self.open_activity(digest(token),row['id'],app,headers.get('X-Client-Type','api'),int(time.time())+604800,*self.client_metadata(headers))
            return 200,{}, {'token':token,'expires_in':604800,'server_time':int(time.time()),'permissions':self.permissions(row['id'],app),'membership':self.membership(row['id'],app),'capabilities':self.capabilities()}
        token=headers.get('Authorization','').removeprefix('Bearer ')
        if not token and method=='POST' and (path in ('/v1/speech/submit','/v1/speech/query') or path.startswith('/v1/speech/stream/')):
            raise Fault(401,'语音识别现需登录并开通有效体验或套餐；请在设置的“我的账号”中登录。','authentication_required')
        user=self.auth(token,app,headers,path.split('?',1)[0])
        if method=='POST' and path in ('/v1/learning/jobs/poll','/v1/learning/jobs/cancel'):
            return self.learning_job(user['id'],app,path,body)
        if method=='POST' and path.startswith('/v1/speech/stream/'):
            action=path.rsplit('/',1)[1]
            # Expiry blocks new paid audio, never cleanup of an owned session.
            if action in ('create','push'):
                with self.db() as db: self.check_grant(db,user['id'],app,'speech')
            return self.speech_streams.handle(user['id'],app,action,body,headers)
        self.throttle('user:'+str(user['id']),90)
        if method=='POST' and path=='/v1/auth/web-session':
            # Issue a separate website session; never expose the extension token
            # to page JavaScript, and keep website logout independent.
            now=int(time.time());web_token=secrets.token_urlsafe(32)
            with self.db() as db:
                parent=db.execute('SELECT expires FROM sessions WHERE hash=?',(digest(token),)).fetchone()
                if not parent or parent['expires']<=now: raise Fault(401,'请登录或重新登录')
                expires=min(parent['expires'],now+86400)
                db.execute('DELETE FROM sessions WHERE expires<=? OR hash IN (SELECT web_sessions.hash FROM web_sessions LEFT JOIN sessions parent ON parent.hash=web_sessions.parent WHERE parent.hash IS NULL OR parent.expires<=?)',(now,now))
                db.execute('DELETE FROM web_sessions WHERE hash NOT IN (SELECT hash FROM sessions)')
                db.execute('INSERT INTO sessions VALUES(?,?,?)',(digest(web_token),user['id'],expires))
                db.execute('INSERT INTO web_sessions VALUES(?,?,?)',(digest(web_token),digest(token),app))
            self.open_activity(digest(web_token),user['id'],app,'study-web',expires,*self.client_metadata(headers))
            return 200,{}, {'token':web_token,'expires_in':expires-now,'server_time':now}
        if method=='POST' and path=='/v1/auth/logout':
            with self.db() as db:
                db.execute('DELETE FROM sessions WHERE hash=? OR hash IN (SELECT hash FROM web_sessions WHERE parent=?)',(digest(token),digest(token)))
                db.execute('DELETE FROM web_sessions WHERE hash=? OR parent=?',(digest(token),digest(token)))
            self.close_activity(digest(token))
            return 200,{}, {'ok':True}
        if method=='GET' and path=='/v1/me': return 200,{}, {**user,'app':app,'server_time':int(time.time()),'usage':self.usage(user['id'],app),'capabilities':self.capabilities(),'permissions':self.permissions(user['id'],app),'membership':self.membership(user['id'],app)}
        if method=='POST' and path=='/v1/activity': return 200,{}, {'ok':True,'server_time':int(time.time())}
        if method=='GET' and path=='/v1/history': return 200,{},self.history(user['id'])
        study_private=self.study_private(method,path,headers,body,user,app)
        if study_private is not None:return study_private
        if path in ('/v1/prompts','/v1/prompts/save','/v1/prompts/delete','/v1/admin/prompts','/v1/admin/prompts/save','/v1/admin/prompts/delete'):
            return self.prompt_request(method,path,user,app,body)
        operations=self.operations_request(method,path,user,body)
        if operations is not None:return operations
        if path.startswith('/v1/admin/'): return self.admin_request(method,path,user,body,month())
        if method=='POST' and path=='/v1/learning/jobs/create':
            with self.db() as db: self.check_grant(db,user['id'],app,'learning')
            return self.learning_job(user['id'],app,path,body)
        if method=='POST' and path=='/v1/ark/responses': return self.ark(user['id'],app,body,stream_sink)
        if method=='POST' and path in ('/v1/speech/submit','/v1/speech/query'):
            with self.db() as db: self.check_grant(db,user['id'],app,'speech')
            return self.speech(user['id'],app,path,headers,body)
        raise Fault(404,'接口不存在')
    def learning_job(self,user,app,path,body):
        now=time.monotonic()
        with self.learning_lock:
            for key,job in list(self.learning_jobs.items()):
                if now-job['created']>300 and job['state'] not in ('pending','generating'): del self.learning_jobs[key]
            if not path.endswith('/create'):
                key=body.get('id');job=self.learning_jobs.get(key) if isinstance(key,str) else None
                if not job:
                    with self.db() as db:receipt=db.execute('SELECT 1 FROM learning_job_receipts WHERE id=? AND user=? AND app=? AND created>?',(key,user,app,int(time.time())-300)).fetchone() if isinstance(key,str) else None
                    if not receipt:raise Fault(404,'回答任务不存在或已过期')
                    if path.endswith('/cancel'):return 200,{}, {'ok':True}
                    return 200,{}, {'id':key,'state':'error','text':'','revision':0,'error':'服务已更新，本次回答未能恢复。请查看账号调用记录，确认后再手动提问；系统不会自动重复调用或重复扣费。','error_status':503,'error_code':'task_interrupted'}
                if job['user']!=user or job['app']!=app:raise Fault(404,'回答任务不存在或已过期')
                if path.endswith('/cancel'):
                    job['cancelled']=True;job['delivered']=True
                    if job['state'] not in ('complete','error'):job['state']='cancelled'
                    return 200,{}, {'ok':True}
                self.throttle('learning-poll:'+str(user)+':'+key,180)
                if job['state'] not in ('pending','generating'):job['delivered']=True
                snapshot={k:job[k] for k in ('id','state','text','revision')}
                if job.get('response'):snapshot['response']=job['response']
                if job.get('error'):snapshot['error']=job['error'];snapshot['error_status']=job['error_status']
                return 200,{},snapshot
            if len(self.learning_jobs)>=128: raise Fault(503,'回答任务较多，请稍后再试')
            if sum(j['user']==user and j['state'] in ('pending','generating') for j in self.learning_jobs.values())>=2: raise Fault(429,'请等待当前回答完成','concurrency_limit',5)
            if not self.learning_slots.acquire(blocking=False):raise Fault(503,'模型服务繁忙，请稍后再试')
            key=secrets.token_urlsafe(24)
            job={'id':key,'user':user,'app':app,'created':now,'state':'pending','text':'','revision':0,'cancelled':False}
            try:
                with self.db() as db:
                    db.execute('DELETE FROM learning_job_receipts WHERE created<?',(int(time.time())-300,))
                    db.execute('INSERT INTO learning_job_receipts VALUES(?,?,?,?)',(key,user,app,int(time.time())))
            except Exception:self.learning_slots.release();raise
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
            finally:
                with self.learning_lock:job['worker_done']=True
                self.learning_slots.release()
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
        feature='translation' if body['model']=='doubao-seed-translation-250915' else 'learning'
        if any(isinstance(i.get('content'),str) and '字幕译者' in i['content'] for i in inputs): feature='translation_context'
        call=self.reserve(user,app,'ark',feature='translation' if body['model']=='doubao-seed-translation-250915' else 'learning')
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
        if not key: raise Fault(503,'语音服务尚未配置，请联系管理员。','speech_not_configured')
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
            call=self.reserve(user,app,'speech',seconds,feature='speech')
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
            code=speech_status_code(response_headers)
            if status!=200 or code not in ('20000000','20000001','20000002'): raise speech_response_fault(status,code)
            clean={k:result[k] for k in ('result','audio_info') if k in result}
            if path.endswith('/query') and code=='20000000':
                with self.db() as db: db.execute('UPDATE jobs SET done=1,result=? WHERE id=?',(json.dumps(clean),task))
                self.state(call,'complete')
            return 200,{'X-Api-Status-Code':code},clean
        except Exception: self.state(call,'unknown'); raise

# Public introduction page routing
try:
    from .public_page import public_page_file
except ImportError:
    from public_page import public_page_file


def make_server(gateway,host='127.0.0.1',port=8080,allowed_web_origins=()):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def dispatch(self):
            self.streaming=False
            began=time.monotonic();request_id=str(uuid.uuid4())
            origin=self.headers.get('Origin'); extra={'X-Request-Id':request_id}
            self.stream_headers=extra
            try:
                self.connection.settimeout(15)
                if origin:
                    if not (os.environ.get('ALLOW_EXTENSION_ORIGINS')=='1' and re.fullmatch(r'chrome-extension://[a-p]{32}',origin)) and origin not in list(allowed_web_origins)+os.environ.get('ALLOWED_ORIGINS','').split(',')+[os.environ.get('PUBLIC_ORIGIN','')]: raise Fault(403,'来源未开通')
                    extra={**extra,'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Expose-Headers':'X-Api-Status-Code, Retry-After, X-Request-Id'}
                self.stream_headers=extra
                if self.command=='OPTIONS': status,more,result=204,{'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,X-App-Id,X-Api-Request-Id,X-Client-Type,X-Client-Version,X-Client-Channel'},None
                else:
                    public_file=public_page_file(self.path)
                    if self.command=='GET' and (public_file is not None or self.path in ('/admin','/admin/','/admin.js','/admin.css','/install.user.js','/install.meta.js','/privacy','/privacy.html','/extension.zip','/download','/download/','/download.html','/download.css','/chrome.zip','/edge.zip')):
                        if self.path=='/admin/':
                            status,more,result=302,{'Location':'../admin'},None
                        else:
                            name=public_file or ('admin.html' if self.path=='/admin' else 'privacy.html' if self.path=='/privacy' else 'download.html' if self.path in ('/download','/download/') else 'extension.zip' if self.path in ('/chrome.zip','/edge.zip') else self.path[1:])
                            mime='image/webp' if name.endswith('.webp') else 'image/png' if name.endswith('.png') else 'text/html; charset=utf-8' if name.endswith('.html') else 'text/javascript; charset=utf-8' if name.endswith('.js') else 'application/zip' if name.endswith('.zip') else 'text/css; charset=utf-8'
                            image_sources="'self' data: https:" if name=='account.html' else "'self' data:"
                            result=(Path(__file__).parent/name).read_bytes();status,more=200,{'Content-Type':mime,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src "+image_sources+"; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Frame-Options':'DENY'}
                            if self.path in ('/chrome.zip','/edge.zip'):
                                more['Content-Disposition']='attachment; filename="zhiyun-subtitles-'+self.path[1:-4]+'.zip"'
                    else:
                        status,more,result=self.api_request(gateway)
                if not self.streaming: self.respond(status,more,result,extra)
                return
            except (Fault,sqlite3.DatabaseError) as error:
                if isinstance(error,sqlite3.DatabaseError):error=database_fault(error)
                status=error.status
                more={'Retry-After':str(error.retry_after)} if error.retry_after is not None else {}
                speech_code=getattr(error,'speech_status_code','')
                if re.fullmatch(r'[0-9]{8}',speech_code): more['X-Api-Status-Code']=speech_code
                result={'error':error.message,'error_code':error.code,'request_id':request_id}
                if self.path=='/health':result['ok']=False
                # Diagnostics contain no credentials, IP, account name, prompts or media.
                route=self.path if self.path in ('/health','/v1/ark/responses','/v1/learning/jobs/create','/v1/speech/submit','/v1/speech/query') else 'other'
                print(json.dumps({'event':'gateway_rejection','request_id':request_id,'route':route,'status':status,'error_code':error.code,'elapsed_ms':round((time.monotonic()-began)*1000)}),file=sys.stderr,flush=True)
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
            if (self.command=='POST' or self.command=='DELETE' and size) and self.headers.get_content_type()!='application/json': raise Fault(415,'仅接受 JSON')
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
        do_GET=do_POST=do_DELETE=do_OPTIONS=dispatch
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

def serve_gateway(gateway,host='127.0.0.1',port=8080):
    server=make_server(gateway,host,port)
    def shutdown(signum,frame):
        if gateway.draining:return
        gateway.begin_drain()
        def finish():
            gateway.wait_for_drain(120)
            # Allow the last poll/JSON response to leave the handler before exit.
            time.sleep(1)
            server.shutdown()
        threading.Thread(target=finish,daemon=True).start()
    signal.signal(signal.SIGTERM,shutdown)
    signal.signal(signal.SIGINT,shutdown)
    try:server.serve_forever()
    finally:server.server_close()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Shared API gateway; Python 3.11+ stdlib')
    parser.add_argument('command',choices=['serve','add-user']); parser.add_argument('--db',default=os.environ.get('DATABASE_PATH','backend/data/gateway.sqlite3'))
    parser.add_argument('--plan',choices=['free','trial','pro','ultra']); parser.add_argument('--username'); parser.add_argument('--admin',action='store_true'); parser.add_argument('--email'); parser.add_argument('--app',default='zhiyun-subtitles'); parser.add_argument('--requests',type=int,default=1000); parser.add_argument('--audio-seconds',type=int,default=3600)
    args=parser.parse_args(); gateway=Gateway(args.db)
    if args.command=='add-user':
        if not args.email or args.requests<0 or args.audio_seconds<0: parser.error('需要邮箱及非负额度')
        gateway.add_user(args.email,getpass.getpass('Password (12+ chars): '),args.app,args.requests,args.audio_seconds,username=args.username,admin=args.admin,plan=args.plan)
        print('账号及 APP 额度已配置；已有账号密码保持不变。')
    else:
        print('Listening on loopback; expose through HTTPS reverse proxy.')
        serve_gateway(gateway,host=os.environ.get('BIND_HOST','127.0.0.1'),port=int(os.environ.get('PORT','8080')))
