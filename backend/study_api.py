"""Email-verified free accounts and private, text-only study conversations.

No SMTP secret, verification code, prompt or conversation is printed to logs.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage
from urllib.parse import parse_qs, urlsplit, urlunsplit

try:
    from .admin_api import Fault
    from .clips_api import ClipsMixin, migrate_clips
except ImportError:
    from admin_api import Fault
    from clips_api import ClipsMixin, migrate_clips

STUDY_APP = 'zhiyun-subtitles'
CODE_TTL = 600
CODE_ATTEMPTS = 5
MAX_CONVERSATIONS = 500
MAX_CONVERSATION_BYTES = 200000
MAX_HISTORY = 100
PAGE_SIZE = 50


def migrate_study(db):
    migrate_clips(db)
    db.executescript("""
CREATE TABLE IF NOT EXISTS registration_codes(
    app TEXT NOT NULL,email TEXT NOT NULL,salt TEXT NOT NULL,code_hash TEXT NOT NULL,
    expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,
    PRIMARY KEY(app,email));
CREATE TABLE IF NOT EXISTS study_conversations(
    user INTEGER NOT NULL,app TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,
    course TEXT NOT NULL,source TEXT NOT NULL,origin TEXT NOT NULL,history TEXT NOT NULL,
    created INTEGER NOT NULL,updated INTEGER NOT NULL,
    PRIMARY KEY(user,app,id));
CREATE INDEX IF NOT EXISTS study_conversations_user_updated
    ON study_conversations(user,app,updated DESC,id);
""")


def _digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _code_hash(email, code, salt):
    return hashlib.pbkdf2_hmac('sha256', (STUDY_APP + ':' + email + ':' + code).encode(),
                               bytes.fromhex(salt), 100000).hex()


def _email(value):
    if not isinstance(value, str):
        raise Fault(400, '请填写有效邮箱', 'invalid_email')
    value = value.strip().lower()
    if not 3 <= len(value) <= 254 or not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}", value):
        raise Fault(400, '请填写有效邮箱', 'invalid_email')
    return value


def _smtp_settings():
    host = os.environ.get('SMTP_HOST', '').strip()
    sender = os.environ.get('SMTP_FROM', '').strip()
    username = os.environ.get('SMTP_USERNAME', '')
    password = os.environ.get('SMTP_PASSWORD', '')
    mode = os.environ.get('SMTP_TLS', 'starttls').strip().lower()
    try:
        port = int(os.environ.get('SMTP_PORT', '465' if mode == 'ssl' else '587'))
        sender = _email(sender)
    except (ValueError, Fault):
        raise Fault(503, '邮箱验证服务尚未配置，请稍后重试或联系管理员', 'email_not_configured') from None
    if (not host or any(ch.isspace() for ch in host) or not 1 <= port <= 65535
            or mode not in ('starttls', 'ssl') or bool(username) != bool(password)
            or any(ch in sender for ch in '\r\n')):
        raise Fault(503, '邮箱验证服务尚未配置，请稍后重试或联系管理员', 'email_not_configured')
    return host, port, sender, username, password, mode


def smtp_mailer():
    host, port, sender, username, password, mode = _smtp_settings()

    def send(recipient, code):
        message = EmailMessage()
        message['From'] = sender
        message['To'] = recipient
        message['Subject'] = '上课爽 · 邮箱注册验证码'
        message.set_content('你的邮箱验证码是：' + code + '\n\n验证码 10 分钟内有效，仅用于注册。请勿转发。若非本人操作，请忽略本邮件。')
        transport = smtplib.SMTP_SSL if mode == 'ssl' else smtplib.SMTP
        with transport(host, port, timeout=10, **({'context': ssl.create_default_context()} if mode == 'ssl' else {})) as client:
            if mode == 'starttls':
                client.ehlo()
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            if username:
                client.login(username, password)
            client.send_message(message)
    return send


def _text(value, name, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or any(ord(ch) < 32 and ch not in '\n\t' for ch in value):
        raise Fault(400, name + '格式无效或内容过长', 'invalid_conversation')
    if required and not value.strip():
        raise Fault(400, name + '不能为空', 'invalid_conversation')
    # Reject media and common credential headers; unknown structured fields are also rejected.
    if re.search(r'data:[^\s,]{0,100};base64,|(?:^|\n)\s*(?:cookie|authorization|set-cookie)\s*:', value, re.I):
        raise Fault(400, '学习记录只接受文字，请移除截图或登录凭据', 'text_only')
    return value.strip()


def _record(body):
    if set(body) - {'id', 'title', 'course', 'source', 'origin', 'history'}:
        raise Fault(400, '学习记录只接受文字问答和课程来源', 'text_only')
    identifier = body.get('id', '')
    if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier):
        raise Fault(400, '记录编号无效', 'invalid_conversation')
    history = body.get('history')
    if not isinstance(history, list) or not 1 <= len(history) <= MAX_HISTORY:
        raise Fault(400, '每条记录需要 1–100 条文字消息', 'invalid_conversation')
    turns = []
    for turn in history:
        if not isinstance(turn, dict) or set(turn) != {'role', 'text'} or turn.get('role') not in ('user', 'assistant'):
            raise Fault(400, '学习记录只接受文字问答', 'text_only')
        turns.append({'role': turn['role'], 'text': _text(turn['text'], '消息', 50000, True)})
    if not any(turn['role'] == 'user' for turn in turns):
        raise Fault(400, '记录中至少需要一个问题', 'invalid_conversation')
    origin = _text(body.get('origin', ''), '来源', 2000)
    if origin.lower().startswith(('http:', 'https:')):
        parsed = urlsplit(origin)
        if not parsed.hostname or parsed.username or parsed.password:
            raise Fault(400, '来源地址无效', 'invalid_conversation')
        origin = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', ''))
    elif '://' in origin or re.match(r'^[a-z][a-z0-9+.-]*:', origin, re.I):
        raise Fault(400, '来源地址仅支持网页或课程编号', 'invalid_conversation')
    record = {'id': identifier, 'title': _text(body.get('title', ''), '标题', 200),
              'course': _text(body.get('course', ''), '课程', 200),
              'source': _text(body.get('source', ''), '类型', 40), 'origin': origin,
              'history': turns}
    if not record['title']:
        record['title'] = next(turn['text'] for turn in turns if turn['role'] == 'user')[:80]
    if len(json.dumps(record, ensure_ascii=False).encode()) > MAX_CONVERSATION_BYTES:
        raise Fault(413, '单条文字记录过大，请拆分后保存', 'conversation_too_large')
    return record


def _serialize(row, detail=False):
    result = {key: row[key] for key in ('id', 'title', 'course', 'source', 'origin', 'created', 'updated')}
    history = json.loads(row['history'])
    result['questionCount'] = sum(turn['role'] == 'user' for turn in history)
    if detail:
        result['history'] = history
    return result


class StudyMixin(ClipsMixin):
    def study_capabilities(self):
        ready = bool(getattr(self, 'study_mailer', None))
        if not ready:
            try:
                _smtp_settings()
                ready = True
            except Fault:
                pass
        return {'enabled': True, 'registration': True, 'mail_configured': ready}

    def study_public(self, method, path, headers, body, ip):
        route = urlsplit(path).path
        if route == '/v1/study/capabilities' and method == 'GET':
            return 200, {}, self.study_capabilities()
        if route not in ('/v1/auth/register-code', '/v1/auth/register'):
            return None
        if method != 'POST':
            raise Fault(405, '请使用 POST 请求', 'method_not_allowed')
        if headers.get('X-App-Id', STUDY_APP) != STUDY_APP:
            raise Fault(400, '注册应用无效', 'invalid_app')
        if route.endswith('register-code'):
            return self._register_code(body, ip)
        return self._register_account(body, ip)

    def _register_code(self, body, ip):
        email = _email(body.get('email'))
        # Check configuration before persisting any code or claiming delivery.
        mailer = getattr(self, 'study_mailer', None) or smtp_mailer()
        self.throttle('registration:send:ip:' + _digest(ip), 6, 3600)
        self.throttle('registration:send:email:' + _digest(email), 3, 3600)
        now = int(time.time())
        code = ''.join(secrets.choice('0123456789') for _ in range(6))
        salt = secrets.token_hex(16)
        hashed = _code_hash(email, code, salt)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT created FROM registration_codes WHERE app=? AND email=?', (STUDY_APP, email)).fetchone()
            if previous and now - previous['created'] < 60:
                raise Fault(429, '请稍后再获取验证码', 'rate_limit', 60 - (now - previous['created']))
            db.execute('DELETE FROM registration_codes WHERE expires<=?', (now,))
            db.execute('INSERT OR REPLACE INTO registration_codes VALUES(?,?,?,?,?,0,?)', (STUDY_APP, email, salt, hashed, now + CODE_TTL, now))
        try:
            mailer(email, code)
        except Exception:
            with self.db() as db:
                db.execute('DELETE FROM registration_codes WHERE app=? AND email=? AND code_hash=?', (STUDY_APP, email, hashed))
            raise Fault(503, '验证码邮件暂时无法发送，请稍后重试', 'email_unavailable') from None
        return 200, {}, {'ok': True, 'message': '如果邮箱可接收邮件，验证码将发送至该邮箱。请检查收件箱和垃圾邮件。', 'expires_in': CODE_TTL, 'retry_after': 60}

    def _register_account(self, body, ip):
        email = _email(body.get('email'))
        code = body.get('code', '')
        password = body.get('password', '')
        username = body.get('username', '')
        if not isinstance(code, str) or not re.fullmatch(r'[0-9]{6}', code):
            raise Fault(400, '请填写六位邮箱验证码', 'invalid_code')
        if not isinstance(password, str) or not 12 <= len(password) <= 256:
            raise Fault(400, '密码需要 12–256 个字符', 'invalid_password')
        if not isinstance(username, str) or len(username.strip()) > 40 or any(ord(ch) < 32 for ch in username):
            raise Fault(400, '昵称最多 40 个字符', 'invalid_username')
        self.throttle('registration:verify:ip:' + _digest(ip), 20, 900)
        self.throttle('registration:verify:email:' + _digest(email), 10, 900)
        now = int(time.time())
        failure = False
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM registration_codes WHERE app=? AND email=?', (STUDY_APP, email)).fetchone()
            valid = (row and row['expires'] > now and row['attempts'] < CODE_ATTEMPTS
                     and hmac.compare_digest(_code_hash(email, code, row['salt']), row['code_hash']))
            if not valid:
                failure = True
                if row:
                    if row['expires'] <= now or row['attempts'] + 1 >= CODE_ATTEMPTS:
                        db.execute('DELETE FROM registration_codes WHERE app=? AND email=?', (STUDY_APP, email))
                    else:
                        db.execute('UPDATE registration_codes SET attempts=attempts+1 WHERE app=? AND email=?', (STUDY_APP, email))
            else:
                # Consumed and account inserted in one write transaction; concurrent replays fail.
                db.execute('DELETE FROM registration_codes WHERE app=? AND email=?', (STUDY_APP, email))
                existing = db.execute('SELECT id FROM users WHERE email=?', (email,)).fetchone()
                if not existing:
                    name = username.strip() or email
                    if db.execute('SELECT 1 FROM users WHERE username=?', (name,)).fetchone():
                        name = name[:30] + '-' + secrets.token_hex(4)
                    salt = secrets.token_hex(16)
                    user = db.execute('INSERT INTO users(email,salt,password,username,is_admin,enabled) VALUES(?,?,?,?,0,1)',
                                      (email, salt, self.hash_password(password, salt), name)).lastrowid
                    db.execute("INSERT INTO grants(user,app,requests,audio,enabled,learning,translation,speech,expires,plan) VALUES(?,?,0,0,1,0,0,0,NULL,'free')", (user, STUDY_APP))
        if failure:
            raise Fault(400, '验证码无效或已过期，请重新获取', 'invalid_code')
        # Existing addresses get exactly the same response and are never reset or granted quota.
        return 200, {}, {'ok': True, 'next': 'login', 'message': '邮箱验证完成，请使用邮箱和密码登录。'}

    def study_private(self, method, path, headers, body, user, app):
        clips = self.clips_private(method, path, body, user, app)
        if clips is not None:
            return clips
        parsed = urlsplit(path)
        if parsed.path != '/v1/study/conversations':
            return None
        if app != STUDY_APP:
            raise Fault(403, '此应用未开放学习记录', 'invalid_app')
        if method not in ('GET', 'POST', 'DELETE'):
            raise Fault(405, '请求方式无效', 'method_not_allowed')
        query = parse_qs(parsed.query, keep_blank_values=True)
        identifier = query.get('id', [''])[0]
        if identifier and not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier):
            raise Fault(400, '记录编号无效', 'invalid_conversation')
        if method == 'POST':
            record = _record(body)
            now = int(time.time() * 1000)
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                existing = db.execute('SELECT created FROM study_conversations WHERE user=? AND app=? AND id=?', (user['id'], app, record['id'])).fetchone()
                if not existing and db.execute('SELECT COUNT(*) FROM study_conversations WHERE user=? AND app=?', (user['id'], app)).fetchone()[0] >= MAX_CONVERSATIONS:
                    raise Fault(409, '已保存 500 条记录，请先删除不再需要的记录', 'conversation_limit')
                db.execute('INSERT INTO study_conversations VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user,app,id) DO UPDATE SET title=excluded.title,course=excluded.course,source=excluded.source,origin=excluded.origin,history=excluded.history,updated=excluded.updated',
                           (user['id'], app, record['id'], record['title'], record['course'], record['source'], record['origin'], json.dumps(record['history'], ensure_ascii=False), existing['created'] if existing else now, now))
                result = _serialize(db.execute('SELECT * FROM study_conversations WHERE user=? AND app=? AND id=?', (user['id'], app, record['id'])).fetchone(), True)
            return 200, {}, {'ok': True, 'conversation': result}
        if method == 'DELETE':
            if not identifier:
                raise Fault(400, '请指定要删除的记录', 'invalid_conversation')
            with self.db() as db:
                db.execute('DELETE FROM study_conversations WHERE user=? AND app=? AND id=?', (user['id'], app, identifier))
            return 200, {}, {'ok': True}
        with self.db() as db:
            if identifier:
                row = db.execute('SELECT * FROM study_conversations WHERE user=? AND app=? AND id=?', (user['id'], app, identifier)).fetchone()
                if not row:
                    raise Fault(404, '记录不存在', 'conversation_not_found')
                return 200, {}, {'conversation': _serialize(row, True)}
            try:
                offset = int(query.get('offset', ['0'])[0])
                limit = int(query.get('limit', [str(PAGE_SIZE)])[0])
                if offset < 0 or offset > MAX_CONVERSATIONS or not 1 <= limit <= PAGE_SIZE:
                    raise ValueError()
            except ValueError:
                raise Fault(400, '分页参数无效', 'invalid_pagination') from None
            rows = db.execute('SELECT * FROM study_conversations WHERE user=? AND app=? ORDER BY updated DESC,id LIMIT ? OFFSET ?', (user['id'], app, limit + 1, offset)).fetchall()
        return 200, {}, {'items': [_serialize(row) for row in rows[:limit]], 'next_offset': offset + limit if len(rows) > limit else None}
