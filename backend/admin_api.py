"""Admin metadata and session activity; never persists prompts, images or tokens."""
import re, sqlite3, time, json, secrets

class Fault(Exception):
    def __init__(self,status,message,code='request_failed',retry_after=None):
        self.status,self.message,self.code,self.retry_after=status,message,code,retry_after

def migrate(db):
    db.execute("CREATE TABLE IF NOT EXISTS admin_actions(id INTEGER PRIMARY KEY,actor INTEGER,target INTEGER,app TEXT,action TEXT,created INTEGER)")
    db.execute('CREATE TABLE IF NOT EXISTS activity_sessions(hash TEXT PRIMARY KEY,user INTEGER,app TEXT,client TEXT,started INTEGER,last_seen INTEGER,ended INTEGER,expires INTEGER)')
    db.execute("CREATE TABLE IF NOT EXISTS activity_client_metadata(hash TEXT PRIMARY KEY,client_version TEXT NOT NULL DEFAULT '',client_channel TEXT NOT NULL DEFAULT 'unknown')")
    columns={
        'users': {'username': "TEXT NOT NULL DEFAULT ''", 'is_admin': 'INTEGER NOT NULL DEFAULT 0', 'enabled': 'INTEGER NOT NULL DEFAULT 1'},
        'grants': {'enabled': 'INTEGER NOT NULL DEFAULT 1', 'learning': 'INTEGER NOT NULL DEFAULT 1', 'translation': 'INTEGER NOT NULL DEFAULT 1', 'speech': 'INTEGER NOT NULL DEFAULT 1', 'expires': 'INTEGER', 'plan': "TEXT NOT NULL DEFAULT 'legacy'"},
        'admin_actions': {'details': "TEXT NOT NULL DEFAULT '{}'"},
        'calls': {'model': "TEXT NOT NULL DEFAULT ''", 'feature': "TEXT NOT NULL DEFAULT ''", 'image_count': 'INTEGER NOT NULL DEFAULT 0', 'finished': 'INTEGER'},
    }
    for table, fields in columns.items():
        existing={row[1] for row in db.execute('PRAGMA table_info('+table+')')}
        for column,definition in fields.items():
            if column not in existing: db.execute('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition)
    db.execute("UPDATE users SET username=email WHERE username=''")
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS unique_username ON users(username)')
    db.executescript('''
CREATE TABLE IF NOT EXISTS activity_sessions(hash TEXT PRIMARY KEY,user INTEGER,app TEXT,client TEXT,started INTEGER,last_seen INTEGER,ended INTEGER,expires INTEGER);
CREATE INDEX IF NOT EXISTS activity_user_time ON activity_sessions(user,started);
CREATE TABLE IF NOT EXISTS admin_actions(id INTEGER PRIMARY KEY,actor INTEGER,target INTEGER,app TEXT,action TEXT,created INTEGER);
''')

class AdminMixin:
    def open_activity(self,hashed,user,app,client,expires,client_version='',client_channel='unknown'):
        now=int(time.time());client=client if client in ('userscript','chrome-extension','admin-web') else 'api'
        with self.db() as db:
            # Keep the original 8-column table compatible with rollback to old code.
            db.execute('INSERT INTO activity_sessions(hash,user,app,client,started,last_seen,ended,expires) VALUES(?,?,?,?,?,?,NULL,?)',(hashed,user,app,client,now,now,expires))
            db.execute('INSERT INTO activity_client_metadata VALUES(?,?,?)',(hashed,client_version,client_channel))
    def touch_activity(self,hashed,client_version='',client_channel='unknown'):
        with self.db() as db:
            db.execute('UPDATE activity_sessions SET last_seen=? WHERE hash=? AND ended IS NULL',(int(time.time()),hashed))
            if client_version or client_channel!='unknown':
                db.execute("INSERT INTO activity_client_metadata VALUES(?,?,?) ON CONFLICT(hash) DO UPDATE SET client_version=CASE WHEN excluded.client_version<>'' THEN excluded.client_version ELSE client_version END,client_channel=CASE WHEN excluded.client_channel<>'unknown' THEN excluded.client_channel ELSE client_channel END",(hashed,client_version,client_channel))
    def close_activity(self,hashed):
        with self.db() as db:
            db.execute('UPDATE activity_sessions SET ended=?,last_seen=? WHERE hash=? AND ended IS NULL',(int(time.time()),int(time.time()),hashed))
    def record_call_meta(self,call,model,feature,images):
        with self.db() as db:
            db.execute('UPDATE calls SET model=?,feature=?,image_count=? WHERE id=?',(model,feature,images,call))
    def history(self,user=None):
        with self.db() as db:
            where='WHERE c.user=?' if user is not None else ''
            params=(user,) if user is not None else ()
            calls=[dict(r) for r in db.execute('SELECT c.id,u.username,u.email,c.user,c.app,c.kind,c.feature,c.model,c.state,c.input_tokens,c.output_tokens,c.total_tokens,c.web_search,c.seconds AS audio_seconds,c.image_count,c.created,c.finished FROM calls c JOIN users u ON u.id=c.user '+where+' ORDER BY c.created DESC,c.rowid DESC LIMIT 100',params)]
            where='WHERE s.user=?' if user is not None else ''
            sessions=[dict(r) for r in db.execute('SELECT u.username,u.email,s.app,s.client,COALESCE(m.client_version,\'\') AS client_version,COALESCE(m.client_channel,\'unknown\') AS client_channel,s.started,s.last_seen,s.ended,s.expires FROM activity_sessions s JOIN users u ON u.id=s.user LEFT JOIN activity_client_metadata m ON m.hash=s.hash '+where+' ORDER BY s.started DESC,s.rowid DESC LIMIT 100',params)]
        return {'calls':calls,'sessions':sessions}
    def admin_overview(self,period):
        with self.db() as db:
            people=[dict(r) for r in db.execute('SELECT id,username,email,is_admin,enabled FROM users ORDER BY id DESC LIMIT 200')]
            for person in people:
                grants=[dict(r) for r in db.execute('SELECT app,requests AS request_limit,audio AS audio_limit,enabled,learning,translation,speech,expires,plan FROM grants WHERE user=?',(person['id'],))]
                person['grants']=[{**grant,'usage':self.usage(person['id'],grant['app'])} for grant in grants]
            total=dict(db.execute('SELECT COUNT(*) AS requests,COALESCE(SUM(total_tokens),0) AS total_tokens,COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens,COALESCE(SUM(seconds),0) AS audio_seconds,COALESCE(SUM(image_count),0) AS images,COALESCE(SUM(web_search),0) AS web_search FROM calls WHERE month=?',(period,)).fetchone())
        with self.db() as db:
            actions=[dict(r) for r in db.execute('SELECT a.actor,a.target,a.app,a.action,a.details,a.created,u.username AS actor_name,t.username AS target_name FROM admin_actions a LEFT JOIN users u ON u.id=a.actor LEFT JOIN users t ON t.id=a.target ORDER BY a.id DESC LIMIT 100')]
        return {'month':period,'users':people,'totals':total,'actions':actions,**self.history()}
    def admin_request(self,method,path,user,body,period):
        if not user['is_admin']: raise Fault(403,'仅管理员可访问')
        if method=='GET' and path=='/v1/admin/overview': return 200,{},self.admin_overview(period)
        if method=='POST' and path=='/v1/admin/accounts': return self.manage_account(user,body)
        if method=='POST' and path in ('/v1/admin/users','/v1/admin/grants'):
            # Older admin pages explicitly grant a positive quota but do not send plan.
            legacy_create='plan' not in body and type(body.get('request_limit')) is int and body['request_limit']>0
            grant_body={'plan':'legacy' if legacy_create else 'free',**body} if path.endswith('/users') else body
            if path.endswith('/grants'):
                target=body.get('user_id');app=body.get('app','zhiyun-subtitles')
                if type(target) is not int or not isinstance(app,str): raise Fault(400,'用户或 APP 无效')
                with self.db() as db:
                    previous=db.execute('SELECT enabled,learning,translation,speech,expires,plan FROM grants WHERE user=? AND app=?',(target,app)).fetchone()
                if previous: grant_body={**{k:bool(previous[k]) for k in ('enabled','learning','translation','speech')},'expires':previous['expires'],'plan':previous['plan'],**body}
            options=self.grant_options(grant_body)
            if path.endswith('/grants') and body.get('user_id')==user['id'] and (not options['enabled'] or options['expires'] is not None): raise Fault(400,'不能停用或限制自己的管理账号有效期')
            app=body.get('app','zhiyun-subtitles');requests=body.get('request_limit',0 if options['plan']=='free' else 1000);audio=body.get('audio_limit',0 if options['plan']=='free' else 3600)
            if not isinstance(app,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',app) or type(requests) is not int or not 0<=requests<=1000000 or type(audio) is not int or not 0<=audio<=36000000: raise Fault(400,'APP 或额度参数无效')
            if path.endswith('/users'):
                email=body.get('email','');password=body.get('password','');name=body.get('username','')
                if not isinstance(email,str) or not 3<=len(email)<=254 or '@' not in email or any(ch.isspace() for ch in email) or not isinstance(password,str) or not 12<=len(password)<=256 or not isinstance(name,str) or not 1<=len(name.strip())<=40 or any(ord(ch)<32 for ch in name): raise Fault(400,'请填写用户名、邮箱和至少 12 字符的密码')
                with self.db() as db:
                    if db.execute('SELECT 1 FROM users WHERE email=? OR username=?',(email.strip().lower(),name.strip())).fetchone(): raise Fault(409,'邮箱或用户名已存在')
                try: target=self.add_user(email,password,app,requests,audio,username=name.strip(),permissions=options)
                except sqlite3.IntegrityError: raise Fault(409,'邮箱或用户名已存在') from None
                action='create_user'
            else:
                target=body.get('user_id')
                if type(target) is not int: raise Fault(400,'用户 ID 无效')
                with self.db() as db:
                    if not db.execute('SELECT 1 FROM users WHERE id=?',(target,)).fetchone(): raise Fault(404,'用户不存在')
                    db.execute('INSERT INTO grants(user,app,requests,audio,enabled,learning,translation,speech,expires,plan) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user,app) DO UPDATE SET requests=excluded.requests,audio=excluded.audio,enabled=excluded.enabled,learning=excluded.learning,translation=excluded.translation,speech=excluded.speech,expires=excluded.expires,plan=excluded.plan',(target,app,requests,audio,*(options[k] for k in ('enabled','learning','translation','speech','expires','plan'))))
                action='set_quota'
            with self.db() as db:
                db.execute('INSERT INTO admin_actions(actor,target,app,action,created,details) VALUES(?,?,?,?,?,?)',(user['id'],target,app,action,int(time.time()),json.dumps({**options,'request_limit':requests,'audio_limit':audio})))
            return 200,{}, {'ok':True,'user_id':target}
        raise Fault(404,'接口不存在')

    def grant_options(self,body):
        options={}
        plan=body.get('plan','legacy')
        if plan not in ('free','trial','pro','ultra','legacy'): raise Fault(400,'套餐必须为基础免费、免费体验、PRO 或 Ultra')
        options['plan']=plan
        for key in ('enabled','learning','translation','speech'):
            value=body.get(key,True)
            if type(value) is not bool: raise Fault(400,'权限参数无效')
            if key!='enabled' and plan!='legacy': value=plan in ('trial','pro','ultra')
            options[key]=value
        expires=body.get('expires')
        if expires is not None and (type(expires) is not int or not 0<expires<=253402300799): raise Fault(400,'有效期参数无效')
        options['expires']=expires
        return options
    def check_grant(self,db,user,app,feature=None):
        grant=db.execute('SELECT * FROM grants WHERE user=? AND app=?',(user,app)).fetchone()
        if not grant or not grant['enabled']: raise Fault(403,'账号未开通此应用或已暂停')
        if user>0:
            row=db.execute('SELECT enabled FROM users WHERE id=?',(user,)).fetchone()
            if not row or not row['enabled']: raise Fault(401,'账号已停用，请联系管理员')
        if feature:
            if grant['expires'] is not None and grant['expires']<=int(time.time()): raise Fault(403,'套餐已到期，基础功能仍可使用','payment_required')
            if grant['plan']=='free': raise Fault(403,'请申请体验或开通 PRO / Ultra 后使用此功能','payment_required')
            if grant['plan']=='legacy' and not grant[feature]: raise Fault(403,{'learning':'AI 问答未开通','translation':'字幕翻译未开通','speech':'语音智能校准未开通'}[feature])
        return grant
    def manage_account(self,actor,body):
        target=body.get('user_id');action=body.get('action')
        if type(target) is not int or action not in ('enable','disable','reset_password'): raise Fault(400,'账号操作无效')
        if target==actor['id']: raise Fault(400,'请使用其他管理员账号修改自己的账号')
        salt=hashed=None
        if action=='reset_password':
            password=body.get('password')
            if not isinstance(password,str) or not 12<=len(password)<=256: raise Fault(400,'密码至少 12 字符')
            salt=secrets.token_hex(16);hashed=self.hash_password(password,salt)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT is_admin,enabled FROM users WHERE id=?',(target,)).fetchone()
            if not row: raise Fault(404,'用户不存在')
            if row['is_admin'] and action=='disable' and db.execute('SELECT COUNT(*) FROM users WHERE is_admin=1 AND enabled=1').fetchone()[0]<=1: raise Fault(400,'至少保留一个可用管理员')
            if action=='reset_password': db.execute('UPDATE users SET salt=?,password=? WHERE id=?',(salt,hashed,target))
            else: db.execute('UPDATE users SET enabled=? WHERE id=?',(int(action=='enable'),target))
            if action!='enable':
                db.execute('DELETE FROM sessions WHERE user=?',(target,))
                db.execute('UPDATE activity_sessions SET ended=? WHERE user=? AND ended IS NULL',(int(time.time()),target))
            db.execute('INSERT INTO admin_actions(actor,target,app,action,created) VALUES(?,?,?,?,?)',(actor['id'],target,'',action,int(time.time())))
        return 200,{}, {'ok':True}

    def permissions(self,user,app):
        with self.db() as db:
            grant=self.check_grant(db,user,app)
            active=grant['plan']!='free' and (grant['expires'] is None or grant['expires']>int(time.time())) and (grant['plan']!='legacy' or grant['requests']>0)
            result={key:active and (grant['plan'] in ('trial','pro','ultra') or bool(grant[key])) for key in ('learning','translation','speech')}
            return result | {'learning_records':result['learning'],'card_export':result['learning'],'expires':grant['expires']}

    def membership(self,user,app):
        with self.db() as db:
            grant=self.check_grant(db,user,app)
            expired=grant['expires'] is not None and grant['expires']<=int(time.time())
            active=not expired and grant['plan']!='free' and (grant['plan']!='legacy' or (grant['requests']>0 and any(grant[k] for k in ('learning','translation','speech'))))
            return {'plan':grant['plan'],'active':active,'state':'expired' if expired else 'trial' if active and grant['plan']=='trial' else 'paid' if active else 'free','expires':grant['expires']}
