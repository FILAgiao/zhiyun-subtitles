"""Admin-only monthly operations, configured-rate estimates and manual quota credits.

No supplier prices, payment processing or registration provisioning are implied.
"""
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import parse_qs, urlsplit
import hashlib
import ipaddress
import json
import re
import sqlite3
import time

try:
    from .admin_api import Fault
except ImportError:
    from admin_api import Fault

COST_NOTE = '按配置的输入/输出/音频/工具单价估算，未含缓存折扣/阶梯与供应商优惠，实际以账单为准。实际账单尚未接入；图片已计入输入 Token，不重复计费。'
RATE_FIELDS = ('input_per_million', 'output_per_million', 'audio_per_minute', 'web_search_per_call')
METRICS = ('requests', 'input_tokens', 'output_tokens', 'total_tokens', 'audio_seconds', 'images', 'web_search', 'uncertain')


def migrate_operations(db):
    db.executescript("""
CREATE TABLE IF NOT EXISTS operation_cost_rates(
    id INTEGER PRIMARY KEY,model TEXT NOT NULL,effective_from INTEGER NOT NULL,
    input_per_million TEXT,output_per_million TEXT,audio_per_minute TEXT,web_search_per_call TEXT,
    currency TEXT NOT NULL DEFAULT 'CNY',actor INTEGER NOT NULL,created INTEGER NOT NULL,
    UNIQUE(model,effective_from));
CREATE INDEX IF NOT EXISTS operations_rate_lookup ON operation_cost_rates(model,effective_from);
CREATE TABLE IF NOT EXISTS operation_credits(
    id INTEGER PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,payload_hash TEXT NOT NULL,
    user INTEGER NOT NULL,app TEXT NOT NULL,month TEXT NOT NULL,
    request_credit INTEGER NOT NULL,audio_credit_seconds INTEGER NOT NULL,
    amount_cny TEXT,kind TEXT NOT NULL,note TEXT NOT NULL,actor INTEGER NOT NULL,created INTEGER NOT NULL,
    before_request_limit INTEGER NOT NULL,after_request_limit INTEGER NOT NULL,
    before_audio_limit INTEGER NOT NULL,after_audio_limit INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS operations_credit_month ON operation_credits(user,app,month);
CREATE TABLE IF NOT EXISTS operation_access_settings(
    channel TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,qr_url TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',contact TEXT NOT NULL DEFAULT '',
    actor INTEGER NOT NULL,updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS operations_calls_month ON calls(month,user,app);
""")


def utc_month(now=None):
    return time.strftime('%Y-%m', time.gmtime(time.time() if now is None else now))


def valid_month(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-(?:0[1-9]|1[0-2])', value) or not 1970 <= int(value[:4]) <= 9999:
        raise Fault(400, '月份格式须为 YYYY-MM')
    return value


def decimal_value(value, label, nullable=True, money=False):
    if value is None and nullable:
        return None
    # Accept JSON integer/float for old hand-written clients, but normalize to exact decimal text.
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise Fault(400, label + '须为非负十进制数')
    raw = str(value)
    if not re.fullmatch(r'(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,' + ('2' if money else '8') + r'})?', raw):
        raise Fault(400, label + ('最多保留 2 位小数' if money else '最多保留 8 位小数'))
    try:
        result = Decimal(raw)
    except InvalidOperation:
        raise Fault(400, label + '无效') from None
    if not result.is_finite() or not 0 <= result <= Decimal('1000000000'):
        raise Fault(400, label + '超出允许范围')
    return format(result, 'f')


def qr_url(value):
    if not isinstance(value, str) or len(value) > 2048 or any(ord(c) <= 32 or ord(c) == 127 for c in value):
        raise Fault(400, '二维码须为有效 HTTPS 图片网址')
    if not value:
        return ''
    try:
        url = urlsplit(value)
        host = url.hostname
        if url.scheme != 'https' or not host or url.username is not None or url.password is not None or url.fragment or url.port not in (None, 443):
            raise ValueError()
        if host.lower() == 'localhost' or host.lower().endswith(('.localhost', '.local', '.internal')) or '.' not in host:
            raise ValueError()
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address is not None and not address.is_global:
            raise ValueError()
        host.encode('idna')
    except (ValueError, UnicodeError):
        raise Fault(400, '二维码须为公开 HTTPS 图片网址，不支持内网或本机地址') from None
    return value


def text_value(value, label, limit):
    if not isinstance(value, str) or len(value.strip()) > limit or any(ord(c) < 32 and c not in '\n\t' for c in value):
        raise Fault(400, label + '无效或过长')
    return value.strip()


def empty_metrics():
    return {**{key: 0 for key in METRICS}, '_known': Decimal(0), 'priced_calls': 0, 'unpriced_calls': 0}


def add_call(target, call, cost):
    target['requests'] += 1
    for key in ('input_tokens', 'output_tokens', 'total_tokens', 'web_search'):
        target[key] += call[key] or 0
    target['audio_seconds'] += call['seconds'] or 0
    target['images'] += call['image_count'] or 0
    target['uncertain'] += int(call['state'] in ('reserved', 'unknown'))
    if cost is None:
        target['unpriced_calls'] += 1
    else:
        target['priced_calls'] += 1
        target['_known'] += cost


def finish_metrics(value):
    known = format(value.pop('_known').quantize(Decimal('.000001'), rounding=ROUND_HALF_UP), 'f')
    return {**value, 'known_cost_cny': known,
            'estimated_cost_cny': known if value['unpriced_calls'] == 0 else None,
            'pricing_coverage': value['priced_calls'] / value['requests'] if value['requests'] else 1,
            'pricing_complete': value['unpriced_calls'] == 0, 'currency': 'CNY'}


def call_cost(call, rates):
    if call['state'] != 'complete' or not call['model']:
        return None
    rate = next((rate for rate in reversed(rates.get(call['model'], [])) if rate['effective_from'] <= call['created']), None)
    if rate is None:
        return None
    units = (Decimal(call['input_tokens'] or 0) / 1000000,
             Decimal(call['output_tokens'] or 0) / 1000000,
             Decimal(str(call['seconds'] or 0)) / 60,
             Decimal(call['web_search'] or 0))
    result = Decimal(0)
    for field, unit in zip(RATE_FIELDS, units):
        if unit and rate[field] is None:
            return None
        if unit:
            result += unit * Decimal(rate[field])
    return result


class OperationsMixin:
    def monthly_credits(self, db, user, app, period=None):
        row = db.execute('SELECT COALESCE(SUM(request_credit),0),COALESCE(SUM(audio_credit_seconds),0) FROM operation_credits WHERE user=? AND app=? AND month=?', (user, app, period or utc_month())).fetchone()
        return {'requests': row[0], 'audio': row[1]}

    def access_settings(self, public=False):
        with self.db() as db:
            saved = {r['channel']: dict(r) for r in db.execute('SELECT * FROM operation_access_settings')}
        result = {}
        for channel in ('registration', 'recharge'):
            row = saved.get(channel, {})
            valid_url = ''
            try:
                valid_url = qr_url(row.get('qr_url', ''))
            except Fault:
                pass
            enabled = bool(row.get('enabled') and valid_url)
            result[channel] = {'enabled': enabled if public else bool(row.get('enabled')), 'qr_url': valid_url if not public or enabled else '', 'instructions': row.get('instructions', ''), 'contact': row.get('contact', ''), 'status': '联系管理员办理' if enabled else '暂未开放'}
        if public:
            result.update(manual=True, email_registration=False)
        return result

    def operations_public(self, method, path):
        if method == 'GET' and path == '/v1/account/access':
            return 200, {}, self.access_settings(public=True)
        return None

    def operations_request(self, method, path, user, body):
        parsed = urlsplit(path)
        if parsed.path not in ('/v1/admin/operations', '/v1/admin/cost-rates', '/v1/admin/credits', '/v1/admin/access-settings'):
            return None
        if not user['is_admin']:
            raise Fault(403, '仅管理员可访问')
        if method == 'GET' and parsed.path == '/v1/admin/operations':
            query = parse_qs(parsed.query, keep_blank_values=True)
            if set(query) - {'month'} or len(query.get('month', [])) > 1:
                raise Fault(400, '查询参数无效')
            return 200, {}, self.operations_overview(valid_month(query.get('month', [utc_month()])[0]))
        if parsed.query:
            raise Fault(400, '操作参数须放在 JSON 正文')
        if method == 'POST' and parsed.path == '/v1/admin/cost-rates':
            return self.create_cost_rate(user, body)
        if method == 'POST' and parsed.path == '/v1/admin/credits':
            return self.create_credit(user, body)
        if method == 'POST' and parsed.path == '/v1/admin/access-settings':
            return self.save_access_settings(user, body)
        raise Fault(404, '接口不存在')

    def create_cost_rate(self, actor, body):
        model = body.get('model')
        if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9_.:/-]{1,160}', model):
            raise Fault(400, '模型标识无效')
        if body.get('currency', 'CNY') != 'CNY':
            raise Fault(400, '当前仅支持人民币 CNY')
        now = int(time.time())
        effective = body.get('effective_from', now)
        if type(effective) is not int or not now <= effective <= 253402300799:
            raise Fault(400, '费率只能从现在或未来生效，不能改写过去费用')
        rates = {key: decimal_value(body.get(key), key) for key in RATE_FIELDS}
        if all(value is None for value in rates.values()):
            raise Fault(400, '至少填写一项费率；未填项目保持未知')
        with self.db() as db:
            try:
                key = db.execute('INSERT INTO operation_cost_rates(model,effective_from,input_per_million,output_per_million,audio_per_minute,web_search_per_call,currency,actor,created) VALUES(?,?,?,?,?,?,?,?,?)', (model, effective, *(rates[k] for k in RATE_FIELDS), 'CNY', actor['id'], now)).lastrowid
            except sqlite3.IntegrityError:
                raise Fault(409, '相同模型和生效时间的费率已存在，请使用新的生效时间') from None
            db.execute('INSERT INTO admin_actions(actor,target,app,action,created,details) VALUES(?,?,?,?,?,?)', (actor['id'], None, '', 'configure_cost_rate', now, json.dumps({'rate_id': key, 'model': model, 'effective_from': effective, **rates}, ensure_ascii=False)))
            rate = dict(db.execute('SELECT * FROM operation_cost_rates WHERE id=?', (key,)).fetchone())
        return 200, {}, {'ok': True, 'rate': rate}

    def create_credit(self, actor, body):
        target = body.get('user_id')
        app = body.get('app', 'zhiyun-subtitles')
        requests, audio = body.get('request_credit', 0), body.get('audio_credit_seconds', 0)
        if type(target) is not int or target <= 0 or not isinstance(app, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', app):
            raise Fault(400, '用户或 APP 无效')
        if type(requests) is not int or type(audio) is not int or not 0 <= requests <= 1000000 or not 0 <= audio <= 36000000 or not (requests or audio):
            raise Fault(400, '请增加有效的请求或音频额度')
        amount = decimal_value(body.get('amount_cny'), '收款金额', money=True)
        kind = body.get('kind', 'gift')
        if kind not in ('gift', 'manual_payment') or (kind == 'gift' and amount not in (None, '0', '0.0', '0.00')):
            raise Fault(400, '赠送不能填写非零收款金额')
        note = text_value(body.get('note', ''), '备注', 500)
        idem = body.get('idempotency_key')
        if not isinstance(idem, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', idem):
            raise Fault(400, '请提供 16 至 128 字符的不重复操作标识')
        payload = {'user_id': target, 'app': app, 'request_credit': requests, 'audio_credit_seconds': audio, 'amount_cny': amount, 'kind': kind, 'note': note, 'actor': actor['id']}
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        now = int(time.time()); period = utc_month(now)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            prior = db.execute('SELECT * FROM operation_credits WHERE idempotency_key=?', (idem,)).fetchone()
            if prior:
                if prior['payload_hash'] != fingerprint:
                    raise Fault(409, '此操作标识已用于其他充值，请刷新后重试')
                return 200, {}, {'ok': True, 'credit': dict(prior), 'replayed': True}
            grant = db.execute('SELECT g.requests,g.audio FROM grants g JOIN users u ON u.id=g.user WHERE g.user=? AND g.app=?', (target, app)).fetchone()
            if grant is None:
                raise Fault(404, '用户未开通此应用，请先在用户管理中设置套餐')
            added = self.monthly_credits(db, target, app, period)
            before_requests, before_audio = grant['requests'] + added['requests'], grant['audio'] + added['audio']
            if before_requests + requests > 1000000 or before_audio + audio > 36000000:
                raise Fault(400, '本月总额度超过允许范围')
            key = db.execute('INSERT INTO operation_credits(idempotency_key,payload_hash,user,app,month,request_credit,audio_credit_seconds,amount_cny,kind,note,actor,created,before_request_limit,after_request_limit,before_audio_limit,after_audio_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (idem, fingerprint, target, app, period, requests, audio, amount, kind, note, actor['id'], now, before_requests, before_requests + requests, before_audio, before_audio + audio)).lastrowid
            db.execute('INSERT INTO admin_actions(actor,target,app,action,created,details) VALUES(?,?,?,?,?,?)', (actor['id'], target, app, 'manual_credit', now, json.dumps({'credit_id': key, 'month': period, **{k: v for k, v in payload.items() if k != 'actor'}}, ensure_ascii=False)))
            credit = dict(db.execute('SELECT * FROM operation_credits WHERE id=?', (key,)).fetchone())
        return 200, {}, {'ok': True, 'credit': credit, 'replayed': False}

    def save_access_settings(self, actor, body):
        if not body or set(body) - {'registration', 'recharge'}:
            raise Fault(400, '仅支持注册和充值渠道设置')
        validated = {}
        for channel, config in body.items():
            if not isinstance(config, dict) or set(config) - {'enabled', 'qr_url', 'instructions', 'contact'} or type(config.get('enabled', False)) is not bool:
                raise Fault(400, '渠道参数无效')
            validated[channel] = {'enabled': config.get('enabled', False), 'qr_url': qr_url(config.get('qr_url', '')), 'instructions': text_value(config.get('instructions', ''), '渠道说明', 1000), 'contact': text_value(config.get('contact', ''), '联系文字', 200)}
        now = int(time.time())
        with self.db() as db:
            for channel, config in validated.items():
                db.execute('INSERT INTO operation_access_settings(channel,enabled,qr_url,instructions,contact,actor,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(channel) DO UPDATE SET enabled=excluded.enabled,qr_url=excluded.qr_url,instructions=excluded.instructions,contact=excluded.contact,actor=excluded.actor,updated=excluded.updated', (channel, int(config['enabled']), config['qr_url'], config['instructions'], config['contact'], actor['id'], now))
            db.execute('INSERT INTO admin_actions(actor,target,app,action,created,details) VALUES(?,?,?,?,?,?)', (actor['id'], None, '', 'configure_access_channels', now, json.dumps({'channels': list(validated)}, ensure_ascii=False)))
        return 200, {}, {'ok': True, 'access_settings': self.access_settings()}

    def operations_overview(self, period):
        period = valid_month(period)
        now = int(time.time())
        summary = empty_metrics(); by_user = defaultdict(empty_metrics); by_model = defaultdict(empty_metrics)
        with self.db() as db:
            rates = [dict(r) for r in db.execute('SELECT * FROM operation_cost_rates ORDER BY effective_from,id')]
            rates_by_model = defaultdict(list)
            for rate in rates:
                rates_by_model[rate['model']].append(rate)
            # Scan the full selected month. This deliberately does not reuse the 100-call history preview.
            for raw in db.execute('SELECT * FROM calls WHERE month=?', (period,)):
                call = dict(raw)
                cost = call_cost(call, rates_by_model)
                for target in (summary, by_user[(call['user'], call['app'])], by_model[call['model'] or '(未记录模型)']):
                    add_call(target, call, cost)
            grants = [dict(r) for r in db.execute('SELECT u.id AS user_id,u.username,u.email,u.enabled,g.app,g.plan,g.enabled AS grant_enabled,g.requests AS request_limit,g.audio AS audio_limit,g.expires FROM users u JOIN grants g ON u.id=g.user')]
            credits = [dict(r) for r in db.execute('SELECT c.*,u.username,a.username AS actor_name FROM operation_credits c LEFT JOIN users u ON u.id=c.user LEFT JOIN users a ON a.id=c.actor WHERE c.month=? ORDER BY c.id DESC', (period,))]
            monthly = {(r['user'], r['app']): dict(r) for r in db.execute('SELECT user,app,SUM(request_credit) AS requests,SUM(audio_credit_seconds) AS audio FROM operation_credits WHERE month=? GROUP BY user,app', (period,))}
        people = []; alerts = []
        for grant in grants:
            key = (grant['user_id'], grant['app'])
            added = monthly.get(key, {'requests': 0, 'audio': 0})
            stats = finish_metrics(by_user.pop(key, empty_metrics()))
            grant['base_request_limit'] = grant['request_limit']; grant['base_audio_limit'] = grant['audio_limit']
            grant['request_limit'] += added['requests']; grant['audio_limit'] += added['audio']
            grant['request_ratio'] = stats['requests'] / grant['request_limit'] if grant['request_limit'] else None
            grant['audio_ratio'] = stats['audio_seconds'] / grant['audio_limit'] if grant['audio_limit'] else None
            grant['status'] = 'paused' if not grant['enabled'] or not grant['grant_enabled'] else 'expired' if grant['expires'] is not None and grant['expires'] <= now else 'active'
            person = {**grant, **stats}; people.append(person)
            def alert(kind, message):
                alerts.append({'user_id': grant['user_id'], 'username': grant['username'], 'app': grant['app'], 'type': kind, 'message': message})
            if grant['status'] == 'paused': alert('paused', '账号或应用已暂停')
            elif grant['status'] == 'expired': alert('expired', '套餐已到期，基础功能保留')
            elif grant['expires'] is not None and grant['expires'] <= now + 7 * 86400: alert('expiring', '套餐将在 7 天内到期')
            if grant['request_ratio'] is not None and grant['request_ratio'] >= .8: alert('request_quota', '本月请求额度已使用 80% 以上')
            if grant['audio_ratio'] is not None and grant['audio_ratio'] >= .8: alert('audio_quota', '本月音频额度已使用 80% 以上')
            if stats['uncertain']: alert('uncertain', '存在待核对的上游调用')
        # Keep usage even if a grant was removed directly from a legacy database.
        for (user_id, app), stats in by_user.items():
            people.append({'user_id': user_id, 'username': '(历史账号)', 'email': '', 'app': app, 'plan': 'unknown', 'status': 'missing_grant', 'enabled': False, 'grant_enabled': False, 'expires': None, 'request_limit': None, 'audio_limit': None, 'request_ratio': None, 'audio_ratio': None, **finish_metrics(stats)})
        people.sort(key=lambda row: (Decimal(row['known_cost_cny']), row['total_tokens'], row['requests']), reverse=True)
        models = [{'model': model, **finish_metrics(stats)} for model, stats in by_model.items()]
        models.sort(key=lambda row: row['total_tokens'], reverse=True)
        for entry in credits:
            entry.pop('payload_hash', None); entry.pop('idempotency_key', None)
        total = finish_metrics(summary)
        total.update(users=len({r['user_id'] for r in people}), active_users=len({r['user_id'] for r in people if r['requests']}), received_amount_cny=format(sum((Decimal(r['amount_cny']) for r in credits if r['kind'] == 'manual_payment' and r['amount_cny'] is not None), Decimal(0)), 'f'), received_unknown_count=sum(1 for r in credits if r['kind'] == 'manual_payment' and r['amount_cny'] is None), gifted_requests=sum(r['request_credit'] for r in credits if r['kind'] == 'gift'))
        return {'month': period, 'timezone': 'UTC', 'server_time': now, 'summary': total, 'users': people, 'models': models, 'alerts': alerts, 'cost_rates': rates, 'access_settings': self.access_settings(), 'credits': credits, 'cost_note': COST_NOTE, 'actual_billing_connected': False, 'quota_note': '使用量按所选 UTC 月统计；额度和权限使用当前基础配置加该月人工增额，历史基础额度变更尚未重建。'}
