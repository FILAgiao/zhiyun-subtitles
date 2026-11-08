"""Account-scoped, idempotent product analytics. No page content or credentials."""
import datetime as dt
import hashlib
import json
import math
import re
import time
from collections import defaultdict
from urllib.parse import parse_qs, urlsplit

try:
    from .admin_api import Fault
except ImportError:
    from admin_api import Fault

DAY = 86400
OFFSET = 28800
FEATURES = ('subtitle', 'translation', 'screenshot', 'ai')
SCHEMA = '''
CREATE TABLE IF NOT EXISTS analytics_meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS analytics_receipts(user INTEGER,app TEXT,id TEXT,payload TEXT NOT NULL,created REAL NOT NULL,PRIMARY KEY(user,app,id));
CREATE INDEX IF NOT EXISTS analytics_receipts_expiry ON analytics_receipts(created);
CREATE TABLE IF NOT EXISTS analytics_feature_sessions(user INTEGER,app TEXT,session TEXT,feature TEXT,created REAL NOT NULL,PRIMARY KEY(user,app,session,feature));
CREATE TABLE IF NOT EXISTS analytics_days(user INTEGER,app TEXT,day TEXT,effective TEXT NOT NULL DEFAULT '[]',watch TEXT NOT NULL DEFAULT '[]',seconds REAL NOT NULL DEFAULT 0,watch_seconds REAL NOT NULL DEFAULT 0,features INTEGER NOT NULL DEFAULT 0,last_seen REAL NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user,app,day));
CREATE INDEX IF NOT EXISTS analytics_day_range ON analytics_days(app,day,user);
CREATE TABLE IF NOT EXISTS analytics_features(user INTEGER,app TEXT,day TEXT,feature TEXT,uses INTEGER NOT NULL,last_seen REAL NOT NULL,PRIMARY KEY(user,app,day,feature));
CREATE INDEX IF NOT EXISTS analytics_feature_range ON analytics_features(app,day,user);
CREATE TABLE IF NOT EXISTS analytics_courses(user INTEGER,app TEXT,day TEXT,course_id TEXT,title TEXT NOT NULL,watch TEXT NOT NULL,seconds REAL NOT NULL,PRIMARY KEY(user,app,day,course_id));
CREATE INDEX IF NOT EXISTS analytics_course_range ON analytics_courses(app,day,user);
CREATE TABLE IF NOT EXISTS analytics_first(user INTEGER,app TEXT,day TEXT NOT NULL,PRIMARY KEY(user,app));
CREATE INDEX IF NOT EXISTS analytics_first_range ON analytics_first(app,day,user);
CREATE INDEX IF NOT EXISTS analytics_call_range ON calls(app,created,user);
'''


def migrate_analytics(db):
    db.executescript(SCHEMA)
    if 'created' not in {r[1] for r in db.execute('PRAGMA table_info(analytics_feature_sessions)')}:
        db.execute('ALTER TABLE analytics_feature_sessions ADD COLUMN created REAL NOT NULL DEFAULT 0')
    db.execute('CREATE INDEX IF NOT EXISTS analytics_feature_session_expiry ON analytics_feature_sessions(created)')
    db.execute("INSERT OR IGNORE INTO analytics_meta VALUES('enabled_at',?)", (int(time.time()),))
    if 'cached_input_tokens' not in {r[1] for r in db.execute('PRAGMA table_info(calls)')}:
        db.execute('ALTER TABLE calls ADD COLUMN cached_input_tokens INTEGER')


def day_of(value):
    return dt.datetime.fromtimestamp(value + OFFSET, dt.timezone.utc).date().isoformat()


def day_start(value):
    try:
        parsed = dt.date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError()
        return int(dt.datetime.combine(parsed, dt.time(), dt.timezone.utc).timestamp()) - OFFSET
    except (ValueError, TypeError, OverflowError):
        raise Fault(400, '日期须为 YYYY-MM-DD') from None


def shifted_day(value, offset):
    return (dt.date.fromisoformat(value) + dt.timedelta(days=offset)).isoformat()


def union(intervals, added):
    result = []
    for start, end in sorted([*intervals, *added]):
        if result and start <= result[-1][1]:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([start, end])
    return result


def duration(intervals):
    return round(sum(end - start for start, end in intervals), 3)


def split_days(start, end):
    while start < end:
        day = day_of(start)
        stop = min(end, day_start(day) + DAY)
        yield day, [start, stop]
        start = stop


def valid_event(raw, now):
    common = {'id', 'kind', 'at', 'session', 'course_id', 'course_title'}
    if not isinstance(raw, dict) or raw.get('kind') not in ('feature', 'activity'):
        raise Fault(400, '统计事件类型无效')
    allowed = common | ({'feature'} if raw['kind'] == 'feature' else {'start', 'end', 'watch'})
    if set(raw) - allowed:
        raise Fault(400, '统计事件包含未知字段')
    result = dict(raw)
    for key in ('id', 'session'):
        if not isinstance(raw.get(key), str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', raw[key]):
            raise Fault(400, '统计事件标识无效')
    def stamp(key):
        value = raw.get(key)
        if type(value) not in (int, float) or not math.isfinite(value):
            raise Fault(400, '统计事件时间无效')
        if not now - 7 * DAY <= value <= now + 120:
            raise Fault(400, '统计事件时间超出允许范围', 'analytics_time_out_of_range')
        result[key] = round(value, 3)
        return result[key]
    at = stamp('at')
    course = raw.get('course_id', '')
    title = raw.get('course_title', '')
    if not isinstance(course, str) or (course and not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', course)):
        raise Fault(400, '课程标识须为摘要，不能提交网址')
    if not isinstance(title, str) or len(title) > 200 or re.search(r'https?://|[\x00-\x1f]', title, re.I) or (title and not course):
        raise Fault(400, '课程标题无效')
    result['course_id'], result['course_title'] = course, title
    if raw['kind'] == 'feature':
        if raw.get('feature') not in FEATURES:
            raise Fault(400, '未知统计功能')
    else:
        start, end = stamp('start'), stamp('end')
        if not 0 < end - start <= 90 or not end <= at <= end + 120 or type(raw.get('watch')) is not bool or (raw['watch'] and not course):
            raise Fault(400, '有效活动区间无效')
    return result


class AnalyticsMixin:
    def analytics_request(self, method, path, user, app, body):
        parsed = urlsplit(path)
        if parsed.path not in ('/v1/analytics/events', '/v1/admin/analytics'):
            return None
        if parsed.path == '/v1/analytics/events':
            if method != 'POST' or parsed.query:
                raise Fault(400, '统计上传请求无效')
            return 200, {}, self.ingest_analytics(user['id'], app, body)
        if not user['is_admin']:
            raise Fault(403, '仅管理员可访问')
        query = parse_qs(parsed.query, keep_blank_values=True)
        if method != 'GET' or set(query) != {'start', 'end'} or any(len(v) != 1 for v in query.values()):
            raise Fault(400, '请选择统计起止日期')
        return 200, {}, self.analytics_overview(app, query['start'][0], query['end'][0])

    def ingest_analytics(self, user, app, body):
        now = time.time()
        if not isinstance(body, dict) or set(body) != {'events'} or not isinstance(body['events'], list) or not 1 <= len(body['events']) <= 100:
            raise Fault(400, '每批须包含 1 至 100 条统计事件')
        events, rejected = [], []
        for raw in body['events']:
            try:
                events.append(valid_event(raw, now))
            except Fault as error:
                if error.code != 'analytics_time_out_of_range':
                    raise
                rejected.append({'id': raw['id'], 'code': error.code})
        accepted = duplicates = 0
        with self.db(timeout=2) as db:
            db.execute('BEGIN IMMEDIATE')
            for event in events:
                fingerprint = hashlib.sha256(json.dumps(event, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                previous = db.execute('SELECT payload FROM analytics_receipts WHERE user=? AND app=? AND id=?', (user, app, event['id'])).fetchone()
                if previous:
                    if previous['payload'] != fingerprint:
                        raise Fault(409, '同一统计事件标识不能修改内容')
                    duplicates += 1
                    continue
                db.execute('INSERT INTO analytics_receipts VALUES(?,?,?,?,?)', (user, app, event['id'], fingerprint, event['at']))
                accepted += 1
                db.execute('INSERT INTO analytics_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=MIN(value,excluded.value)', ('started_at:' + app, event.get('start', event['at'])))
                if event['kind'] == 'feature':
                    feature = event['feature']
                    if feature in ('subtitle', 'translation'):
                        inserted = db.execute('INSERT OR IGNORE INTO analytics_feature_sessions VALUES(?,?,?,?,?)', (user, app, event['session'], feature, event['at'])).rowcount
                        if not inserted:
                            continue
                    day = day_of(event['at'])
                    db.execute('INSERT INTO analytics_features VALUES(?,?,?,?,1,?) ON CONFLICT(user,app,day,feature) DO UPDATE SET uses=uses+1,last_seen=MAX(last_seen,excluded.last_seen)', (user, app, day, feature, event['at']))
                    db.execute('INSERT INTO analytics_days(user,app,day,features,last_seen,active) VALUES(?,?,?,1,?,1) ON CONFLICT(user,app,day) DO UPDATE SET features=features+1,last_seen=MAX(last_seen,excluded.last_seen),active=1', (user, app, day, event['at']))
                    self.analytics_mark_first(db, user, app, day)
                else:
                    for day, interval in split_days(event['start'], event['end']):
                        db.execute('INSERT OR IGNORE INTO analytics_days(user,app,day) VALUES(?,?,?)', (user, app, day))
                        row = db.execute('SELECT * FROM analytics_days WHERE user=? AND app=? AND day=?', (user, app, day)).fetchone()
                        effective = union(json.loads(row['effective']), [interval])
                        watch = union(json.loads(row['watch']), [interval] if event['watch'] else [])
                        seconds, watch_seconds = duration(effective), duration(watch)
                        active = int(seconds >= 60 or row['features'] > 0)
                        db.execute('UPDATE analytics_days SET effective=?,watch=?,seconds=?,watch_seconds=?,last_seen=MAX(last_seen,?),active=? WHERE user=? AND app=? AND day=?', (json.dumps(effective), json.dumps(watch), seconds, watch_seconds, interval[1], active, user, app, day))
                        if active:
                            self.analytics_mark_first(db, user, app, day)
                        if event['watch']:
                            course = event['course_id']
                            row = db.execute('SELECT watch,title FROM analytics_courses WHERE user=? AND app=? AND day=? AND course_id=?', (user, app, day, course)).fetchone()
                            watched = union(json.loads(row['watch']) if row else [], [interval])
                            title = event['course_title'] or (row['title'] if row else '未命名课节')
                            db.execute('INSERT INTO analytics_courses VALUES(?,?,?,?,?,?,?) ON CONFLICT(user,app,day,course_id) DO UPDATE SET title=excluded.title,watch=excluded.watch,seconds=excluded.seconds', (user, app, day, course, title, json.dumps(watched), duration(watched)))
            # Receipts older than the accepted offline window cannot be replayed.
            # Bounded cleanup keeps a batch from holding the writer lock too long.
            db.execute('DELETE FROM analytics_receipts WHERE rowid IN (SELECT rowid FROM analytics_receipts WHERE created<? ORDER BY created LIMIT 1000)', (now - 8 * DAY,))
            db.execute('DELETE FROM analytics_feature_sessions WHERE rowid IN (SELECT rowid FROM analytics_feature_sessions WHERE created<? ORDER BY created LIMIT 1000)', (now - 8 * DAY,))
        return {'ok': True, 'accepted': accepted, 'duplicates': duplicates, 'rejected': rejected, 'server_time': now}

    @staticmethod
    def analytics_mark_first(db, user, app, day):
        db.execute('INSERT INTO analytics_first VALUES(?,?,?) ON CONFLICT(user,app) DO UPDATE SET day=MIN(day,excluded.day)', (user, app, day))

    def analytics_overview(self, app, start, end):
        lo, hi = day_start(start), day_start(end) + DAY
        if not 0 < hi - lo <= 93 * DAY:
            raise Fault(400, '统计范围须为 1 至 93 天')
        now = time.time()
        if lo > now:
            raise Fault(400, '开始日期不能在未来')
        with self.db(readonly=True) as db:
            # All sections share a SQLite read snapshot, including during uploads.
            db.execute('BEGIN')
            days = [dict(r) for r in db.execute('SELECT user,day,seconds,watch_seconds,features,last_seen,active FROM analytics_days WHERE app=? AND day>=? AND day<=?', (app, start, end))]
            features = [dict(r) for r in db.execute('SELECT user,day,feature,uses FROM analytics_features WHERE app=? AND day>=? AND day<=?', (app, start, end))]
            courses = [dict(r) for r in db.execute('SELECT user,day,course_id,title,seconds FROM analytics_courses WHERE app=? AND day>=? AND day<=?', (app, start, end))]
            calls = [dict(r) for r in db.execute('SELECT * FROM calls WHERE app=? AND created>=? AND created<?', (app, lo, hi))]
            names = {r['id']: r['username'] for r in db.execute('SELECT u.id,u.username FROM users u WHERE EXISTS(SELECT 1 FROM grants g WHERE g.user=u.id AND g.app=?)', (app,))}
            started_row = db.execute('SELECT value FROM analytics_meta WHERE key=?', ('started_at:' + app,)).fetchone()
            observed = db.execute('SELECT COUNT(*) FROM analytics_first WHERE app=?', (app,)).fetchone()[0]
            first = [dict(r) for r in db.execute('SELECT user,day FROM analytics_first WHERE app=? AND day>=? AND day<=?', (app, start, end))]
            retention_days = {(r['user'], r['day']) for r in db.execute('SELECT user,day FROM analytics_days WHERE app=? AND day>=? AND day<=? AND active=1', (app, start, shifted_day(end, 7)))}
        started = started_row[0] if started_row else None
        covered = started is not None and hi > started
        summary = {key: sum(c[key] for c in calls) for key in ('input_tokens', 'output_tokens', 'total_tokens')}
        summary.update(requests=len(calls), uncertain=sum(c['state'] in ('unknown', 'reserved') for c in calls), registered_users=len(names))
        active = {r['user'] for r in days if r['active']}
        user_stats = {}
        def user_stat(user):
            if user not in user_stats:
                user_stats[user] = {'user_id': user, 'username': names.get(user, '账号 ' + str(user)), 'last_seen': None, 'lessons': 0 if covered else None, 'effective_seconds': 0 if covered else None, 'watch_seconds': 0 if covered else None, 'total_tokens': 0, 'ai_uses': 0 if covered else None}
            return user_stats[user]
        trend = {day_of(stamp): {'date': day_of(stamp), 'tokens': 0, 'users': set(), 'lessons': 0, 'effective_seconds': 0} for stamp in range(lo, hi, DAY)}
        for row in days:
            item = user_stat(row['user'])
            item['effective_seconds'] += row['seconds']; item['watch_seconds'] += row['watch_seconds']
            item['last_seen'] = max(item['last_seen'] or 0, row['last_seen'])
            trend[row['day']]['effective_seconds'] += row['seconds']
            if row['active']:
                trend[row['day']]['users'].add(row['user'])
        for call in calls:
            user_stat(call['user'])['total_tokens'] += call['total_tokens']
            trend[day_of(call['created'])]['tokens'] += call['total_tokens']
        feature_stats = []
        for feature in FEATURES:
            selected = [r for r in features if r['feature'] == feature]
            feature_stats.append({'feature': feature, 'users': len({r['user'] for r in selected}) if covered else None, 'uses': sum(r['uses'] for r in selected) if covered else None})
            if feature == 'ai':
                for row in selected:
                    user_stat(row['user'])['ai_uses'] += row['uses']
        course_users = defaultdict(float)
        course_stats = {}
        for row in courses:
            key = (row['user'], row['course_id'])
            course_users[key] += row['seconds']
            item = course_stats.setdefault(row['course_id'], {'course_id': row['course_id'], 'title': row['title'], 'users': set(), 'lessons': 0, 'watch_seconds': 0})
            item['watch_seconds'] += row['seconds']
            if row['seconds'] >= 60:
                trend[row['day']]['lessons'] += 1
        qualifying = {key for key, seconds in course_users.items() if seconds >= 60}
        for user, course in qualifying:
            course_stats[course]['users'].add(user); course_stats[course]['lessons'] += 1
            user_stat(user)['lessons'] += 1
        for item in course_stats.values():
            item['users'] = len(item['users']); item['watch_seconds'] = round(item['watch_seconds'], 3)
        summary.update(active_users=len(active) if covered else None, learning_lessons=len(qualifying) if covered else None, unique_courses=len({course for _, course in qualifying}) if covered else None, effective_seconds=round(sum(r['seconds'] for r in days), 3) if covered else None, watch_seconds=round(sum(r['watch_seconds'] for r in days), 3) if covered else None, ai_uses=feature_stats[-1]['uses'])
        # A course_id is a recording/lesson ID, not a curriculum course ID.
        summary['unique_lessons'] = summary['unique_courses']
        for day, item in trend.items():
            available = started is not None and day >= day_of(started) and day_start(day) <= now
            item['users'] = len(item['users']) if available else None
            item['lessons'] = item['lessons'] if available else None
            item['effective_seconds'] = round(item['effective_seconds'], 3) if available else None
        cohorts = defaultdict(list)
        for row in first:
            cohorts[row['day']].append(row['user'])
        retention = {'cohorts': [], 'first_observed': True}
        for day, users in sorted(cohorts.items()):
            cohort = {'date': day, 'users': len(users)}
            for offset, key in ((1, 'd1'), (7, 'd7')):
                target = shifted_day(day, offset)
                mature = day_start(target) + DAY <= now
                count = sum((user, target) in retention_days for user in users)
                cohort[key + '_mature'] = mature
                cohort[key + '_users'] = count if mature else None
                cohort[key + '_rate'] = count / len(users) if mature else None
            count = sum(any((user, shifted_day(day, offset)) in retention_days for offset in range(1, 8)) for user in users)
            cohort['within7_users'] = count if cohort['d7_mature'] else None
            cohort['within7_rate'] = count / len(users) if cohort['d7_mature'] else None
            retention['cohorts'].append(cohort)
        for key in ('d1', 'd7', 'within7'):
            mature = [r for r in retention['cohorts'] if r[key + '_users'] is not None]
            denominator = sum(r['users'] for r in mature)
            retention[key + '_eligible_users'] = denominator
            retention[key + '_rate'] = sum(r[key + '_users'] for r in mature) / denominator if denominator else None
        try:
            from .pricing import summarize_token_cost, pricing_catalog
        except ImportError:
            from pricing import summarize_token_cost, pricing_catalog
        summary['token_estimate'] = summarize_token_cost(calls)
        return {'start': start, 'end': end, 'timezone': 'Asia/Shanghai', 'generated_at': now, 'summary': summary, 'features': feature_stats, 'trend': list(trend.values()), 'courses': sorted(course_stats.values(), key=lambda row: (-row['users'], -row['watch_seconds'], row['course_id'])), 'users': sorted(user_stats.values(), key=lambda row: (-row['total_tokens'], -(row['effective_seconds'] or 0), row['user_id'])), 'retention': retention, 'pricing_catalog': pricing_catalog(), 'coverage': {'started_at': started, 'observed_users': observed, 'partial': started is None or lo < started, 'metric_scope': 'recording', 'note': '功能、看课与留存仅统计已登录且启用采集的客户端；首次观测不代表新用户。有效使用为每日成功使用功能或有效活动满 60 秒。时间为客户端可观测活动，离线最多补报 7 天，统计可随补报修正。每日课次独立去重，不应相加作为跨日课次。'}}
