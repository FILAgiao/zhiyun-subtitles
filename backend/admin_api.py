"""Admin metadata and session activity; never persists prompts, images or tokens."""
import re, sqlite3, time, json, secrets
from calendar import monthrange
from datetime import datetime, timedelta, timezone

PASSWORD_REQUIREMENTS = '密码为 7–256 位，仅使用英文字母或数字'
PLANS = ('free', 'trial', 'pro', 'ultra')
FEATURES = ('learning', 'translation', 'speech')
GRANT_FIELDS = ('enabled', *FEATURES, 'expires', 'plan', 'template_applied')
BEIJING = timezone(timedelta(hours=8))
DEFAULT_TRANSLATION_LIMIT = 1_000_000
MAX_TRANSLATION_LIMIT = 100_000_000

def default_plan_template(plan):
    advanced = plan != 'free'
    return {'request_limit': 1000 if advanced else 0, 'audio_limit': 3600 if advanced else 0,
            'translation_limit': DEFAULT_TRANSLATION_LIMIT if advanced else 0,
            **dict.fromkeys(FEATURES, advanced)}

def months_from_now(months, *, started_at=None):
    if type(months) is not int or not 1 <= months <= 36:
        raise Fault(400, '有效期请选择 1 至 36 个月或长期有效')
    start = datetime.fromtimestamp(time.time() if started_at is None else started_at, BEIJING)
    year, month = divmod(start.year * 12 + start.month - 1 + months, 12)
    day = min(start.day, monthrange(year, month + 1)[1])
    return int(start.replace(year=year, month=month + 1, day=day).timestamp())

def grant_allows_feature(grant, feature):
    if grant['template_applied'] or grant['plan'] == 'legacy':
        return bool(grant[feature])
    return grant['plan'] != 'free'

def translation_limit(grant):
    if not grant_allows_feature(grant, 'translation'):
        return 0
    if grant['translation_limit'] is not None:
        return grant['translation_limit']
    if grant['plan'] == 'legacy' and not grant['requests']:
        return 0
    return DEFAULT_TRANSLATION_LIMIT

def valid_translation_limit(value):
    return type(value) is int and 0 <= value <= MAX_TRANSLATION_LIMIT

def valid_new_password(password):
    return isinstance(password, str) and re.fullmatch(r'[A-Za-z0-9]{7,256}', password) is not None

def valid_grant_limits(requests, audio):
    return type(requests) is int and 0 <= requests <= 1000000 and type(audio) is int and 0 <= audio <= 36000000

class Fault(Exception):
    def __init__(self,status,message,code='request_failed',retry_after=None):
        self.status,self.message,self.code,self.retry_after=status,message,code,retry_after

def migrate(db):
    db.execute("CREATE TABLE IF NOT EXISTS admin_actions(id INTEGER PRIMARY KEY,actor INTEGER,target INTEGER,app TEXT,action TEXT,created INTEGER)")
    db.execute('CREATE TABLE IF NOT EXISTS activity_sessions(hash TEXT PRIMARY KEY,user INTEGER,app TEXT,client TEXT,started INTEGER,last_seen INTEGER,ended INTEGER,expires INTEGER)')
    db.execute("CREATE TABLE IF NOT EXISTS activity_client_metadata(hash TEXT PRIMARY KEY,client_version TEXT NOT NULL DEFAULT '',client_channel TEXT NOT NULL DEFAULT 'unknown')")
    columns={
        'users': {'username': "TEXT NOT NULL DEFAULT ''", 'is_admin': 'INTEGER NOT NULL DEFAULT 0', 'enabled': 'INTEGER NOT NULL DEFAULT 1'},
        'grants': {'enabled': 'INTEGER NOT NULL DEFAULT 1', 'learning': 'INTEGER NOT NULL DEFAULT 1', 'translation': 'INTEGER NOT NULL DEFAULT 1', 'speech': 'INTEGER NOT NULL DEFAULT 1', 'expires': 'INTEGER', 'plan': "TEXT NOT NULL DEFAULT 'legacy'", 'template_applied': 'INTEGER NOT NULL DEFAULT 0'},
        'admin_actions': {'details': "TEXT NOT NULL DEFAULT '{}'"},
        'calls': {'model': "TEXT NOT NULL DEFAULT ''", 'feature': "TEXT NOT NULL DEFAULT ''", 'image_count': 'INTEGER NOT NULL DEFAULT 0', 'finished': 'INTEGER'},
    }
    columns['grants']['translation_limit'] = 'INTEGER'
    columns['calls']['translation_chars'] = 'INTEGER NOT NULL DEFAULT 0'
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
CREATE TABLE IF NOT EXISTS registration_plan(id INTEGER PRIMARY KEY CHECK(id=1),plan TEXT NOT NULL,request_limit INTEGER NOT NULL,audio_limit INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plan_templates(plan TEXT PRIMARY KEY,request_limit INTEGER NOT NULL,audio_limit INTEGER NOT NULL,learning INTEGER NOT NULL,translation INTEGER NOT NULL,speech INTEGER NOT NULL);
INSERT OR IGNORE INTO plan_templates(plan,request_limit,audio_limit,learning,translation,speech)
SELECT plan,request_limit,audio_limit,plan<>'free',plan<>'free',plan<>'free' FROM registration_plan WHERE id=1;
''')
    if 'translation_limit' not in {row[1] for row in db.execute('PRAGMA table_info(plan_templates)')}:
        db.execute('ALTER TABLE plan_templates ADD COLUMN translation_limit INTEGER')

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
            templates = self.plan_templates(db)
            registration_plan = self.registration_plan(db, templates)
            people=[dict(r) for r in db.execute('SELECT id,username,email,is_admin,enabled FROM users ORDER BY id DESC LIMIT 200')]
            for person in people:
                grants=[dict(r) for r in db.execute('SELECT app,requests,requests AS request_limit,audio AS audio_limit,enabled,learning,translation,speech,expires,plan,template_applied,translation_limit FROM grants WHERE user=?',(person['id'],))]
                for grant in grants:
                    grant['translation_limit'] = translation_limit(grant)
                    grant.pop('requests')
                person['grants']=[{**grant,'usage':self.usage(person['id'],grant['app'])} for grant in grants]
            total=dict(db.execute('SELECT COUNT(*) AS requests,COALESCE(SUM(total_tokens),0) AS total_tokens,COALESCE(SUM(input_tokens),0) AS input_tokens,COALESCE(SUM(output_tokens),0) AS output_tokens,COALESCE(SUM(seconds),0) AS audio_seconds,COALESCE(SUM(image_count),0) AS images,COALESCE(SUM(web_search),0) AS web_search FROM calls WHERE month=?',(period,)).fetchone())
        with self.db() as db:
            actions=[dict(r) for r in db.execute('SELECT a.actor,a.target,a.app,a.action,a.details,a.created,u.username AS actor_name,t.username AS target_name FROM admin_actions a LEFT JOIN users u ON u.id=a.actor LEFT JOIN users t ON t.id=a.target ORDER BY a.id DESC LIMIT 100')]
        return {'month':period,'users':people,'totals':total,'actions':actions,
                'registration_plan':registration_plan,'plan_templates':templates,**self.history()}

    def plan_templates(self, db):
        templates = {plan: default_plan_template(plan) for plan in PLANS}
        for row in db.execute('SELECT * FROM plan_templates'):
            if row['plan'] in templates:
                templates[row['plan']] = {'request_limit': row['request_limit'], 'audio_limit': row['audio_limit'],
                                          'translation_limit': row['translation_limit'] if row['translation_limit'] is not None else DEFAULT_TRANSLATION_LIMIT if row['translation'] else 0,
                                          **{key: bool(row[key]) for key in FEATURES}}
        return templates

    def registration_plan(self, db, templates):
        row = db.execute('SELECT plan FROM registration_plan WHERE id=1').fetchone()
        plan = row['plan'] if row else 'free'
        return {'plan': plan, **{key: templates[plan][key] for key in ('request_limit', 'audio_limit')}}

    def write_plan_template(self, db, plan, template):
        values = (template['request_limit'], template['audio_limit'], *(template[key] for key in FEATURES), template['translation_limit'])
        db.execute('''INSERT INTO plan_templates(plan,request_limit,audio_limit,learning,translation,speech,translation_limit)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(plan) DO UPDATE SET
          request_limit=excluded.request_limit,audio_limit=excluded.audio_limit,
          learning=excluded.learning,translation=excluded.translation,speech=excluded.speech,translation_limit=excluded.translation_limit''', (plan, *values))
        db.execute('UPDATE registration_plan SET request_limit=?,audio_limit=? WHERE id=1 AND plan=?',
                   (*values[:2], plan))

    def save_plan_template(self, actor, body):
        plan = body.get('plan')
        requests, audio = body.get('request_limit'), body.get('audio_limit')
        if plan not in PLANS or not valid_grant_limits(requests, audio):
            raise Fault(400, '套餐或额度参数无效')
        features = {key: body.get(key) for key in FEATURES}
        if any(type(value) is not bool for value in features.values()):
            raise Fault(400, '权限参数无效')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            templates = self.plan_templates(db)
            chars = body.get('translation_limit', templates[plan]['translation_limit'])
            if not valid_translation_limit(chars):
                raise Fault(400, '字幕翻译字符额度无效')
            template = {'request_limit': requests, 'audio_limit': audio, 'translation_limit': chars, **features}
            if templates[plan] != template:
                self.write_plan_template(db, plan, template)
                db.execute('INSERT INTO admin_actions(actor,target,app,action,created,details) VALUES(?,NULL,?,?,?,?)',
                           (actor['id'], 'zhiyun-subtitles', 'plan_template', int(time.time()), json.dumps({'plan': plan, **template})))
                templates[plan] = template
            registration = self.registration_plan(db, templates)
        return 200, {}, {'ok': True, 'plan_templates': templates, 'registration_plan': registration}

    def save_registration_plan(self, actor, body):
        plan = body.get('plan')
        if plan not in PLANS:
            raise Fault(400, '请选择自助注册的默认套餐')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            templates = self.plan_templates(db)
            previous = self.registration_plan(db, templates)
            template = templates[plan]
            requests, audio = template['request_limit'], template['audio_limit']
            # Older admin pages sent edited limits with the registration plan.
            if 'request_limit' in body or 'audio_limit' in body:
                requests, audio = body.get('request_limit'), body.get('audio_limit')
                if not valid_grant_limits(requests, audio):
                    raise Fault(400, '额度参数无效')
                if plan == 'free' and (requests or audio):
                    raise Fault(400, '请在套餐配置中设置基础免费套餐的额度')
                templates[plan] = {**template, 'request_limit': requests, 'audio_limit': audio}
                if templates[plan] != template:
                    self.write_plan_template(db, plan, templates[plan])
            settings = {'plan': plan, 'request_limit': requests, 'audio_limit': audio}
            if settings != previous:
                db.execute('INSERT INTO registration_plan VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET plan=excluded.plan,request_limit=excluded.request_limit,audio_limit=excluded.audio_limit', (plan, requests, audio))
                db.execute('INSERT INTO admin_actions(actor,target,app,action,created,details) VALUES(?,NULL,?,?,?,?)', (actor['id'], 'zhiyun-subtitles', 'registration_plan', int(time.time()), json.dumps(settings)))
        return 200, {}, {'ok': True, 'registration_plan': settings, 'plan_templates': templates}

    def admin_request(self,method,path,user,body,period):
        if not user['is_admin']: raise Fault(403,'仅管理员可访问')
        if method=='GET' and path=='/v1/admin/overview': return 200,{},self.admin_overview(period)
        if method=='POST' and path=='/v1/admin/plan-templates': return self.save_plan_template(user, body)
        if method=='POST' and path=='/v1/admin/registration-plan': return self.save_registration_plan(user, body)
        if method=='POST' and path=='/v1/admin/accounts': return self.manage_account(user,body)
        if method=='POST' and path in ('/v1/admin/users','/v1/admin/grants'):
            return self.save_user_grant(user, body, create=path.endswith('/users'))
        raise Fault(404,'接口不存在')

    def save_user_grant(self, actor, body, *, create):
        app = body.get('app', 'zhiyun-subtitles')
        if not isinstance(app, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', app):
            raise Fault(400, 'APP 参数无效')

        def audit(db, target, action):
            db.execute('INSERT INTO admin_actions(actor,target,app,action,created,details) VALUES(?,?,?,?,?,?)',
                       (actor['id'],target,app,action,int(time.time()),
                        json.dumps({**{key: options[key] for key in GRANT_FIELDS if key != 'template_applied'},
                                    'request_limit':requests,'audio_limit':audio,'translation_limit':chars})))

        if create:
            email=body.get('email','');password=body.get('password','');name=body.get('username','')
            if not isinstance(email,str) or not 3<=len(email)<=254 or '@' not in email or any(ch.isspace() for ch in email) or not isinstance(name,str) or not 1<=len(name.strip())<=40 or any(ord(ch)<32 for ch in name):
                raise Fault(400,'请填写有效的用户名和邮箱')
            if not valid_new_password(password):
                raise Fault(400,PASSWORD_REQUIREMENTS,'invalid_password')
            with self.db() as db:
                options, requests, audio, chars = self.resolve_grant(db, body, create=True)
            try:
                target=self.add_user(email,password,app,requests,audio,username=name.strip(),permissions=options,translation_chars=chars,create_only=True)
            except sqlite3.IntegrityError:
                raise Fault(409,'邮箱或用户名已存在') from None
            with self.db() as db:
                audit(db, target, 'create_user')
        else:
            target = body.get('user_id')
            if type(target) is not int:
                raise Fault(400,'用户 ID 无效')
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                if not db.execute('SELECT 1 FROM users WHERE id=?',(target,)).fetchone():
                    raise Fault(404,'用户不存在')
                previous = db.execute('SELECT * FROM grants WHERE user=? AND app=?', (target, app)).fetchone()
                options, requests, audio, chars = self.resolve_grant(db, body, previous=previous)
                if target == actor['id'] and (not options['enabled'] or options['expires'] is not None):
                    raise Fault(400,'不能停用或限制自己的管理账号有效期')
                db.execute('''INSERT INTO grants(user,app,requests,audio,enabled,learning,translation,speech,expires,plan,template_applied,translation_limit)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user,app) DO UPDATE SET requests=excluded.requests,
                   audio=excluded.audio,enabled=excluded.enabled,learning=excluded.learning,translation=excluded.translation,
                   speech=excluded.speech,expires=excluded.expires,plan=excluded.plan,template_applied=excluded.template_applied,translation_limit=excluded.translation_limit''',
                   (target, app, requests, audio, *(options[key] for key in GRANT_FIELDS), chars))
                audit(db, target, 'set_quota')
        return 200, {}, {'ok':True, 'user_id':target, 'expires':options['expires']}

    def resolve_grant(self, db, body, *, previous=None, create=False):
        legacy_create = create and type(body.get('request_limit')) is int and body['request_limit'] > 0
        default_plan = previous['plan'] if previous else 'free' if create and not legacy_create else 'legacy'
        snapshot = {key: bool(previous[key]) for key in (*FEATURES, 'enabled')} if previous else {}
        grant = {**snapshot, 'expires': previous['expires'] if previous else None, 'plan': default_plan, **body}
        plan = grant['plan']
        use_template = body.get('use_template', 'plan' in body and plan in PLANS
                                and 'request_limit' not in body and 'audio_limit' not in body and 'translation_limit' not in body)
        if type(use_template) is not bool or (use_template and plan not in PLANS):
            raise Fault(400, '请选择有效套餐')
        if use_template:
            template = self.plan_templates(db)[plan]
            requests, audio = template['request_limit'], template['audio_limit']
            chars = template['translation_limit']
        else:
            template = snapshot if previous and previous['plan'] == plan and previous['template_applied'] else None
            defaults = (previous['requests'], previous['audio']) if previous else (0, 0) if plan == 'free' else (1000, 3600)
            requests, audio = body.get('request_limit', defaults[0]), body.get('audio_limit', defaults[1])
            chars = body.get('translation_limit', previous['translation_limit'] if previous else None)
            if 'translation_limit' in body and not valid_translation_limit(chars):
                raise Fault(400, '字幕翻译字符额度无效')
        if not valid_grant_limits(requests, audio):
            raise Fault(400, '额度参数无效')
        return self.grant_options(grant, template=template), requests, audio, chars

    def grant_options(self,body,*,template=None):
        options={}
        plan=body.get('plan','legacy')
        if plan not in (*PLANS, 'legacy'): raise Fault(400,'套餐必须为基础免费、免费体验、PRO 或 Ultra')
        options['plan']=plan
        options['template_applied'] = template is not None
        for key in ('enabled', *FEATURES):
            value=body.get(key,True)
            if type(value) is not bool: raise Fault(400,'权限参数无效')
            if key != 'enabled' and plan != 'legacy':
                value = template[key] if template is not None else plan != 'free'
            options[key]=value
        expires=body.get('expires')
        if 'duration_months' in body:
            duration = body['duration_months']
            expires = None if duration is None else months_from_now(duration)
        if expires is not None and (type(expires) is not int or not 0<expires<=253402300799): raise Fault(400,'有效期参数无效')
        options['expires']=expires
        return options
    def check_grant(self,db,user,app,feature=None):
        grant=db.execute('SELECT * FROM grants WHERE user=? AND app=?',(user,app)).fetchone()
        if not grant or not grant['enabled']: raise Fault(403,'账号未开通此应用或已暂停')
        if user>0:
            row=db.execute('SELECT enabled FROM users WHERE id=?',(user,)).fetchone()
            if not row or not row['enabled']: raise Fault(401,'账号已停用，请联系管理员','account_disabled')
        if feature:
            if grant['expires'] is not None and grant['expires']<=int(time.time()): raise Fault(403,'套餐已到期，基础功能仍可使用','payment_required')
            if not grant_allows_feature(grant, feature):
                if grant['plan']=='free': raise Fault(403,'请申请体验或开通 PRO / Ultra 后使用此功能','payment_required')
                raise Fault(403,{'learning':'AI 问答未开通','translation':'字幕翻译未开通','speech':'语音智能校准未开通'}[feature])
        return grant
    def manage_account(self,actor,body):
        target=body.get('user_id');action=body.get('action')
        if type(target) is not int or action not in ('enable','disable','reset_password'): raise Fault(400,'账号操作无效')
        if target==actor['id']: raise Fault(400,'请使用其他管理员账号修改自己的账号')
        salt=hashed=None
        if action=='reset_password':
            password=body.get('password')
            if not valid_new_password(password): raise Fault(400,PASSWORD_REQUIREMENTS,'invalid_password')
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
        valid = grant['expires'] is None or grant['expires']>int(time.time())
        active = valid and (grant['plan']!='legacy' or grant['requests']>0)
        result={key:active and grant_allows_feature(grant, key) for key in FEATURES}
        result['translation'] = result['translation'] or (valid and translation_limit(grant)>0)
        return result | {'learning_records':result['learning'],'card_export':result['learning'],'expires':grant['expires']}

    def membership(self,user,app):
        with self.db() as db:
            grant=self.check_grant(db,user,app)
            expired=grant['expires'] is not None and grant['expires']<=int(time.time())
        plan = grant['plan']
        advanced = any(grant_allows_feature(grant, key) for key in FEATURES)
        active = not expired and (plan in ('trial', 'pro', 'ultra') or advanced and (plan == 'free' or grant['requests'] > 0 or translation_limit(grant)>0))
        state = 'expired' if expired else 'trial' if active and plan == 'trial' else 'paid' if active and plan != 'free' else 'free'
        return {'plan':plan,'active':active,'state':state,'expires':grant['expires']}
