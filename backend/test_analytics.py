"""Deterministic accounting tests; no live accounts or paid model calls."""
import concurrent.futures
import time
import unittest
import uuid
from unittest.mock import patch

from backend import test_server as fixture
from backend.analytics_api import DAY, day_of, day_start, migrate_analytics, shifted_day
from backend.server import Fault

APP = 'zhiyun-subtitles'
COURSE = 'a' * 32


class AnalyticsTests(unittest.TestCase):
    setUp = fixture.Tests.setUp
    upstream = fixture.Tests.upstream
    call = fixture.Tests.call
    fails = fixture.Tests.fails

    def event(self, **changes):
        return {'id': uuid.uuid4().hex, 'kind': 'feature', 'at': time.time() - 5,
                'session': uuid.uuid4().hex, 'feature': 'screenshot', **changes}

    def activity(self, start, end, /, **changes):
        return {'id': uuid.uuid4().hex, 'kind': 'activity', 'at': end, 'session': uuid.uuid4().hex,
                'start': start, 'end': end, 'watch': True, 'course_id': COURSE,
                'course_title': '微积分第一讲', **changes}

    def ingest(self, *events, user=1, app=APP, now=None):
        with patch('backend.analytics_api.time.time', return_value=now or time.time()):
            return self.gateway.ingest_analytics(user, app, {'events': list(events)})

    def overview(self, start=None, end=None, app=APP, now=None):
        at = now or time.time()
        with patch('backend.analytics_api.time.time', return_value=at):
            return self.gateway.analytics_overview(app, start or day_of(at), end or day_of(at))

    def owner(self):
        with self.gateway.db() as db:
            db.execute('UPDATE users SET is_admin=1 WHERE id=1')
        return self.headers

    def insert_call(self, **changes):
        values = {'id': uuid.uuid4().hex, 'user': 1, 'app': APP, 'month': '2000-01', 'kind': 'ark',
                  'state': 'complete', 'input_tokens': 7, 'output_tokens': 3, 'total_tokens': 10,
                  'created': int(time.time()) - 5, 'feature': 'learning', 'model': 'doubao-seed-2-1-lite-260915'}
        values.update(changes)
        with self.gateway.db() as db:
            db.execute('INSERT INTO calls(' + ','.join(values) + ') VALUES(' + ','.join('?' for _ in values) + ')', tuple(values.values()))
        return values['id']

    def test_empty_is_unknown_and_server_tokens_remain_available(self):
        self.insert_call()
        result = self.overview()
        self.assertEqual(result['summary']['total_tokens'], 10)
        self.assertEqual(result['summary']['registered_users'], 1)
        self.assertIsNone(result['summary']['active_users'])
        self.assertIsNone(result['summary']['effective_seconds'])
        self.assertIsNone(result['features'][0]['uses'])
        self.assertIsNone(result['trend'][0]['users'])
        self.assertIsNone(result['coverage']['started_at'])
        self.assertIsNone(result['retention']['d1_rate'])
        self.assertIn('token_estimate', result['summary'])

    def test_completed_call_users_are_distinct_and_do_not_fill_client_metrics(self):
        day = day_of(time.time() - DAY)
        start = day_start(day)
        self.insert_call(created=start + 1)
        self.insert_call(created=start + 5)
        self.insert_call(created=start + 3, user=2, state='unknown')
        self.insert_call(created=start + DAY, user=3)
        self.insert_call(created=start + 4, user=4, app='other-app')
        result = self.overview(day, day)
        self.assertEqual(result['summary']['completed_call_users'], 1)
        for key in ('active_users', 'learning_lessons', 'effective_seconds'):
            self.assertIsNone(result['summary'][key])
        self.assertEqual({r['user_id']: r['last_seen'] for r in result['users']}, {1: start + 5, 2: start + 3})
        self.assertEqual(self.overview(shifted_day(day, -1), shifted_day(day, -1))['summary']['completed_call_users'], 0)

    def test_daily_ledger_and_login_data_without_client_events(self):
        day = day_of(time.time() - DAY)
        start = day_start(day)
        for offset in (1, 2):
            self.insert_call(created=start + offset, feature='learning')
        self.insert_call(created=start + 3, user=2, feature='translation')
        self.insert_call(created=start + 4, user=2, feature='translation_context')
        self.insert_call(created=start + 5, user=2, kind='speech', feature='alignment_stream', seconds=84)
        self.insert_call(created=start + 6, user=3, state='unknown')
        self.insert_call(created=start + 7, user=4, app='other-app')
        with self.gateway.db() as db:
            db.executemany('INSERT INTO activity_sessions VALUES(?,?,?,?,?,?,NULL,NULL)', [
                ('login1', 3, APP, 'chrome-extension', start+8, start+8),
                ('login2', 3, APP, 'admin-web', start+9, start+9),
            ])
        result = self.overview(day, day)
        row = result['trend'][0]
        self.assertEqual((row['completed_ai_calls'], row['completed_ai_users'], row['completed_translation_calls']), (2, 1, 2))
        self.assertEqual((row['speech_uses'], row['speech_seconds'], row['login_sessions'], row['login_users']), (1, 84, 2, 1))
        for metric in ('ai_uses', 'subtitle_uses', 'translation_uses', 'screenshot_uses', 'lessons', 'effective_seconds'):
            self.assertIsNone(row[metric])
        users = {item['user_id']: item for item in result['users']}
        self.assertEqual(users[1]['completed_ai_calls'], 2)
        self.assertEqual(users[3]['last_seen'], start+9)
        self.assertIsNone(users[3]['effective_seconds'])

    def test_auth_app_scope_and_derived_session_restrictions(self):
        date = day_of(time.time())
        url = '/v1/admin/analytics?start=' + date + '&end=' + date
        self.fails(401, lambda: self.call(url, headers={'X-App-Id': APP}, method='GET'))
        self.fails(403, lambda: self.call(url, method='GET'))
        self.call('/v1/analytics/events', {'events': [self.event()]})
        self.owner()
        self.assertEqual(self.call(url, method='GET')[2]['summary']['active_users'], 1)
        child = self.call('/v1/auth/web-session')[2]['token']
        headers = {**self.headers, 'Authorization': 'Bearer ' + child}
        self.fails(403, lambda: self.call('/v1/analytics/events', {'events': [self.event()]}, headers))
        self.fails(403, lambda: self.call(url, headers=headers, method='GET'))
        self.assertIsNone(self.overview(app='other-app')['coverage']['started_at'])
        self.assertIsNone(self.overview(app='other-app')['summary']['active_users'])
        self.assertTrue(self.gateway.capabilities()['analytics'])

    def test_concurrent_replay_and_feature_session_dedup(self):
        event = self.event(feature='subtitle', session='same-session')
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.ingest(event), range(12)))
        self.assertEqual(sum(r['accepted'] for r in results), 1)
        self.assertEqual(sum(r['duplicates'] for r in results), 11)
        self.ingest(self.event(feature='subtitle', session='same-session'))
        self.ingest(self.event(feature='translation', session='same-session'))
        self.ingest(self.event(feature='subtitle', session='different-session'))
        rows = {r['feature']: r for r in self.overview()['features']}
        self.assertEqual(rows['subtitle'], {'feature': 'subtitle', 'users': 1, 'uses': 2})
        self.assertEqual(rows['translation']['uses'], 1)
        self.assertEqual(self.overview()['summary']['active_users'], 1)

    def test_conflicting_event_is_atomic_and_structural_validation(self):
        event = self.event()
        self.ingest(event)
        extra = self.event(feature='ai')
        self.fails(409, lambda: self.ingest(extra, {**event, 'feature': 'ai'}))
        self.assertEqual(self.overview()['summary']['ai_uses'], 0)
        for changes in ({'user': 5}, {'at': True}, {'at': float('nan')}, {'feature': 'prompt'},
                        {'course_id': 'https://example.test/'}, {'course_id': COURSE, 'course_title': 'https://example.test'},
                        {'id': 'short'}, {'session': None}, {'kind': 'arbitrary'}):
            self.fails(400, lambda c=changes: self.ingest(self.event(**c)))
        self.fails(400, lambda: self.gateway.ingest_analytics(1, APP, {'events': [self.event()] * 101}))
        self.fails(400, lambda: self.gateway.ingest_analytics(1, APP, {'events': [], 'user': 2}))

    def test_expired_or_future_event_does_not_block_valid_batch(self):
        now = time.time()
        valid = self.event(at=now - 10)
        old = self.event(at=now - 7 * DAY - 1)
        future = self.event(at=now + 121)
        result = self.ingest(old, valid, future, now=now)
        self.assertEqual(result['accepted'], 1)
        self.assertEqual({r['id'] for r in result['rejected']}, {old['id'], future['id']})
        self.assertTrue(all(r['code'] == 'analytics_time_out_of_range' for r in result['rejected']))
        self.assertEqual(self.overview()['features'][2]['uses'], 1)
        near = self.activity(now - 7 * DAY - 2, now - 7 * DAY + 20)
        self.assertEqual(len(self.ingest(near, now=now)['rejected']), 1)

    def test_overlap_uses_union_not_sum_across_tabs_devices_and_features(self):
        base = time.time() - 180
        self.ingest(self.activity(base, base + 60), self.activity(base + 30, base + 90),
                    self.activity(base + 20, base + 80, watch=False, course_id='', course_title=''),
                    self.activity(base + 10, base + 70, course_id='b' * 32))
        result = self.overview()
        self.assertEqual(result['summary']['effective_seconds'], 90)
        self.assertEqual(result['summary']['watch_seconds'], 90)
        self.assertEqual(result['summary']['learning_lessons'], 2)
        self.assertEqual(result['summary']['unique_lessons'], 2)
        self.assertEqual(result['users'][0]['watch_seconds'], 90)
        self.assertEqual(sum(c['watch_seconds'] for c in result['courses']), 150)
        self.assertEqual(result['summary']['active_users'], 1)

    def test_midnight_split_and_range_lesson_threshold(self):
        day = day_of(time.time() - DAY)
        midnight = day_start(day) + DAY
        self.ingest(self.activity(midnight - 30, midnight + 30))
        result = self.overview(day, shifted_day(day, 1))
        self.assertEqual([r['effective_seconds'] for r in result['trend']], [30, 30])
        self.assertEqual(result['summary']['watch_seconds'], 60)
        self.assertEqual(result['summary']['learning_lessons'], 1)
        self.assertEqual([r['lessons'] for r in result['trend']], [0, 0])
        self.assertEqual(self.overview(day, day)['summary']['learning_lessons'], 0)
        self.assertEqual(result['coverage']['started_at'], midnight - 30)
        self.assertTrue(result['coverage']['partial'])
        before = shifted_day(day, -1)
        old = self.overview(before, before)
        self.assertIsNone(old['summary']['learning_lessons'])
        self.assertIsNone(old['trend'][0]['users'])

    def test_activity_boundaries_and_non_watch_interaction(self):
        now = time.time()
        for changes in ({'start': now - 100, 'end': now}, {'start': now, 'end': now}, {'watch': 1},
                        {'watch': True, 'course_id': ''}, {'at': now - 100}):
            self.fails(400, lambda c=changes: self.ingest(self.activity(now - 60, now, **c)))
        self.ingest(self.activity(now - 70, now - 11, watch=False, course_id='', course_title=''))
        result = self.overview()
        self.assertEqual(result['summary']['active_users'], 0)
        self.assertEqual(result['summary']['effective_seconds'], 59)
        self.assertEqual(result['summary']['watch_seconds'], 0)
        self.ingest(self.activity(now - 11, now - 10, watch=False, course_id='', course_title=''))
        self.assertEqual(self.overview()['summary']['active_users'], 1)

    def test_retention_maturity_d1_d7_and_within7_are_distinct(self):
        anchor = day_start(day_of(time.time() - 10 * DAY)) + 3600
        for user, offsets in ((1, [0, 1, 3]), (2, [0, 7]), (3, [1])):
            for offset in offsets:
                at = anchor + offset * DAY
                self.ingest(self.event(at=at, feature='ai'), user=user, now=at + 5)
        start, end = day_of(anchor), day_of(anchor + DAY)
        result = self.overview(start, end, now=anchor + 8 * DAY)['retention']
        first = result['cohorts'][0]
        self.assertEqual(first['users'], 2)
        self.assertEqual(first['d1_rate'], .5)
        self.assertEqual(first['d7_rate'], .5)
        self.assertEqual(first['within7_rate'], 1)
        second = result['cohorts'][1]
        self.assertTrue(second['d1_mature'])
        self.assertFalse(second['d7_mature'])
        self.assertIsNone(second['d7_rate'])
        self.assertEqual(result['d1_eligible_users'], 3)
        self.assertEqual(result['d7_eligible_users'], 2)
        self.assertTrue(result['first_observed'])
        # Late valid activity changes first observation rather than creating a new account.
        earlier = anchor - DAY
        self.ingest(self.event(at=earlier), user=3, now=anchor + 2 * DAY)
        result = self.overview(day_of(earlier), end, now=anchor + 9 * DAY)['retention']
        self.assertEqual(result['cohorts'][0]['date'], day_of(earlier))
        self.assertEqual(result['cohorts'][0]['users'], 1)

    def test_full_calls_and_daily_tokencount_use_beijing_not_month_field(self):
        day = day_of(time.time() - DAY)
        at = day_start(day) + DAY - 1
        with self.gateway.db() as db:
            for n in range(220):
                db.execute('INSERT INTO users(email,salt,password,username) VALUES(?,?,?,?)', ('u'+str(n)+'@example.test', '', '', 'u'+str(n)))
                db.execute('INSERT INTO grants(user,app,requests,audio) VALUES(?,?,1,0)', (n+2, APP))
        for n in range(130):
            self.insert_call(created=at, user=n+1)
        self.insert_call(created=at+1, total_tokens=90)
        self.insert_call(created=at, app='other-app', total_tokens=999)
        self.insert_call(created=at, state='unknown', input_tokens=0, output_tokens=0, total_tokens=0)
        result = self.overview(day, day)
        self.assertEqual(result['summary']['total_tokens'], 1300)
        self.assertEqual(result['summary']['registered_users'], 221)
        self.assertEqual(result['summary']['requests'], 131)
        self.assertEqual(result['summary']['uncertain'], 1)
        self.assertEqual(len(result['users']), 130)
        day_row = result['trend'][0]
        self.assertEqual([day_row[key] for key in ('tokens', 'input_tokens', 'output_tokens', 'requests')],
                         [1300, 910, 390, 131])

    def test_daily_accounts_are_app_scoped_and_distinguish_zero_from_missing(self):
        day = day_of(time.time() - 4 * DAY)
        start = day_start(day)
        self.insert_call(created=start - 1)
        self.insert_call(created=start, input_tokens=2, output_tokens=3, total_tokens=5)
        with self.gateway.db() as db:
            db.executemany('INSERT INTO activity_sessions VALUES(?,?,?,?,?,?,NULL,NULL)', [
                ('first', 1, APP, 'api', start - 1, start - 1),
                ('second', 1, APP, 'api', start, start),
                ('third', 1, APP, 'api', start + 1, start + 1),
                ('fourth', 2, APP, 'api', start + 2, start + 2),
                ('other-app', 2, 'other', 'api', start, start),
            ])
            db.execute('UPDATE analytics_meta SET value=? WHERE key=?', (start, 'registrations_started_at:' + APP))
            db.execute('INSERT INTO study_registrations VALUES(?,?,?)', (2, APP, start))
        trend = self.overview(shifted_day(day, -2), shifted_day(day, 2), now=start + DAY + 1)['trend']
        self.assertEqual([r['tokens'] for r in trend], [0, 10, 5, 0, None])
        self.assertEqual([r['requests'] for r in trend], [0, 1, 1, 0, None])
        self.assertEqual([r['login_sessions'] for r in trend], [None, 1, 3, 0, None])
        self.assertEqual([r['login_users'] for r in trend], [None, 1, 2, 0, None])
        self.assertEqual([r['registrations'] for r in trend], [None, None, 1, 0, None])

    def test_account_totals_follow_grant_changes_and_carry_over(self):
        today = day_of(time.time())
        with self.gateway.db() as db:
            day_total = lambda: db.execute('SELECT accounts FROM analytics_account_totals WHERE app=? AND day=?', (APP, today)).fetchone()[0]
            self.assertEqual(day_total(), 1)
            user = db.execute('INSERT INTO users(email,salt,password,username) VALUES(?,?,?,?)',
                              ('snapshot@example.test', '', '', 'snapshot')).lastrowid
            db.execute('INSERT INTO grants(user,app,requests,audio) VALUES(?,?,1,0)', (user, APP))
            self.assertEqual(day_total(), 2)
            db.execute('UPDATE grants SET enabled=0 WHERE app=? AND user=?', (APP, user))
            self.assertEqual(day_total(), 2)
            db.execute('DELETE FROM grants WHERE app=? AND user=?', (APP, user))
            self.assertEqual(day_total(), 1)
            db.executemany('INSERT INTO analytics_account_totals VALUES(?,?,?)', [
                (APP, shifted_day(today, -3), 4),
                (APP, shifted_day(today, -1), 6),
                ('other-app', shifted_day(today, -4), 9),
            ])
            migrate_analytics(db)
            self.assertEqual(day_total(), 1)
        rows = self.overview(shifted_day(today, -4), today)['trend']
        self.assertEqual([row['account_total'] for row in rows], [None, 4, 4, 6, 1])
        self.assertEqual([row['account_change'] for row in rows], [None, None, 0, 2, -5])
        after = self.overview(shifted_day(today, -2), shifted_day(today, -1))['trend']
        self.assertEqual([row['account_total'] for row in after], [4, 6])
        self.assertEqual([row['account_change'] for row in after], [0, 2])

    def test_daily_feature_counts_and_reference_price_coverage(self):
        yesterday = day_of(time.time() - DAY)
        today = shifted_day(yesterday, 1)
        at = day_start(yesterday) + 60
        self.ingest(self.event(at=at, feature='ai'), self.event(at=at, feature='ai'),
                    self.event(at=at), self.event(at=at, feature='translation'), self.event(at=at, feature='subtitle'))
        self.ingest(self.event(at=at, feature='ai'), user=2)
        self.insert_call(created=at)
        self.insert_call(created=at, model='unpriced')
        self.insert_call(created=at, kind='speech', input_tokens=0, output_tokens=0, total_tokens=0)
        self.insert_call(created=at, kind='speech', state='unknown', input_tokens=0, output_tokens=0, total_tokens=0)
        self.insert_call(created=day_start(today), model='unpriced')
        first, second = self.overview(yesterday, today)['trend']
        self.assertEqual([first[key] for key in ('requests', 'token_requests', 'speech_uses')], [4, 2, 1])
        self.assertEqual([first[key] for key in ('ai_uses', 'ai_users', 'screenshot_uses', 'translation_uses', 'subtitle_uses')], [3, 2, 1, 1, 1])
        self.assertEqual(first['api_cost_cny'], '0.000014')
        self.assertEqual(first['unpriced_token_calls'], 1)
        self.assertIsNone(second['api_cost_cny'])
        self.assertEqual(second['unpriced_token_calls'], 1)
        self.assertEqual(second['ai_uses'], 0)

    def test_date_limits_query_validation_and_indexed_ranges(self):
        today = day_of(time.time())
        for start, end in (('2026-13-01', today), ('2026-1-01', today), (today, shifted_day(today, -1)),
                           (shifted_day(today, -93), today), (shifted_day(today, 1), shifted_day(today, 1))):
            self.fails(400, lambda a=start,b=end: self.overview(a,b))
        self.owner()
        for query in ('', '?start='+today, '?start='+today+'&end='+today+'&end='+today,
                      '?start='+today+'&end='+today+'&user=2'):
            self.fails(400, lambda q=query: self.call('/v1/admin/analytics'+q, method='GET'))
        with self.gateway.db() as db:
            plan = db.execute('EXPLAIN QUERY PLAN SELECT user,day FROM analytics_days WHERE app=? AND day>=? AND day<=?', (APP,today,today)).fetchall()
            self.assertIn('analytics_day_range', str([tuple(r) for r in plan]))
            plan = db.execute('EXPLAIN QUERY PLAN SELECT * FROM calls WHERE app=? AND created>=? AND created<?', (APP,0,100)).fetchall()
            self.assertIn('analytics_call_range', str([tuple(r) for r in plan]))

    def test_session_receipt_cleanup_and_idempotent_migration(self):
        old = time.time() - 9 * DAY
        with self.gateway.db() as db:
            db.execute('INSERT INTO analytics_feature_sessions VALUES(?,?,?,?,?)', (1,APP,'expired-session','subtitle',old))
            db.execute('INSERT INTO analytics_receipts VALUES(?,?,?,?,?)', (1,APP,'expired-event','old',old))
            migrate_analytics(db); migrate_analytics(db)
        self.ingest(self.event())
        with self.gateway.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM analytics_feature_sessions').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM analytics_receipts').fetchone()[0], 1)

    def test_cache_tokens_only_accept_valid_integer_and_bounds(self):
        call = self.insert_call()
        for value, expected in ((0,0),(5,5),(True,None),(-1,None),(11,None),('5',None),(2.5,None),(None,None)):
            self.gateway.state(call, 'complete', {'input_tokens':10, 'output_tokens':2, 'total_tokens':12, 'input_tokens_details':{'cached_tokens':value}})
            with self.gateway.db() as db:
                self.assertEqual(db.execute('SELECT cached_input_tokens FROM calls WHERE id=?',(call,)).fetchone()[0], expected)
        self.gateway.state(call,'complete',{'input_tokens':10,'input_tokens_details':[]})
        with self.gateway.db() as db:
            self.assertIsNone(db.execute('SELECT cached_input_tokens FROM calls WHERE id=?',(call,)).fetchone()[0])


if __name__ == '__main__':
    unittest.main()
