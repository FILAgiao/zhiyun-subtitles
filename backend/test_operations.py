import concurrent.futures
import json
import time
import unittest
import uuid
from unittest.mock import patch

from backend import test_server as fixture
from backend.operations_api import COST_NOTE, utc_month
from backend.server import Gateway


class OperationsTests(unittest.TestCase):
    setUp = fixture.Tests.setUp
    upstream = fixture.Tests.upstream
    call = fixture.Tests.call
    fails = fixture.Tests.fails

    def owner(self):
        self.gateway.add_user('owner@example.test', 'long-admin-password', 'zhiyun-subtitles', admin=True, username='owner')
        token = self.call('/v1/auth/login', {'email': 'owner', 'password': 'long-admin-password'})[2]['token']
        return {**self.headers, 'Authorization': 'Bearer ' + token}

    def overview(self, owner, period=None):
        return self.call('/v1/admin/operations?month=' + (period or utc_month()), headers=owner, method='GET')[2]

    def insert_call(self, **changes):
        values = {'id': str(uuid.uuid4()), 'user': 1, 'app': 'zhiyun-subtitles', 'month': utc_month(), 'kind': 'ark', 'state': 'complete', 'input_tokens': 1000000, 'output_tokens': 500000, 'total_tokens': 1500000, 'web_search': 0, 'seconds': 0, 'created': int(time.time()), 'model': 'test-model', 'feature': 'learning', 'image_count': 0}
        values.update(changes)
        with self.gateway.db() as db:
            db.execute('INSERT INTO calls(' + ','.join(values) + ') VALUES(' + ','.join('?' for _ in values) + ')', tuple(values.values()))
        return values['id']

    def rate(self, owner, **changes):
        body = {'model': 'test-model', 'input_per_million': '2', 'output_per_million': '4', **changes}
        return self.call('/v1/admin/cost-rates', body, owner)[2]['rate']

    def credit(self, owner, **changes):
        return self.call('/v1/admin/credits', {'user_id': 1, 'request_credit': 5, 'audio_credit_seconds': 30, 'kind': 'gift', 'note': 'temporary gift', 'idempotency_key': str(uuid.uuid4()), **changes}, owner)[2]

    def test_admin_auth_and_public_data_separation(self):
        owner = self.owner()
        public = self.call('/v1/account/access', headers={'X-App-Id': 'zhiyun-subtitles'}, method='GET')[2]
        self.assertFalse(public['registration']['enabled']); self.assertFalse(public['recharge']['enabled'])
        self.assertEqual(public['registration']['status'], '暂未开放')
        for path, method, body in [('/v1/admin/operations', 'GET', {}), ('/v1/admin/cost-rates', 'POST', {}), ('/v1/admin/credits', 'POST', {}), ('/v1/admin/access-settings', 'POST', {})]:
            self.fails(403, lambda p=path, m=method, b=body: self.call(p, b, method=m))
            self.fails(401, lambda p=path, m=method, b=body: self.call(p, b, {'X-App-Id': 'zhiyun-subtitles'}, method=m))
        self.credit(owner, kind='manual_payment', amount_cny='12.34')
        public = self.call('/v1/account/access', headers={'X-App-Id': 'zhiyun-subtitles'}, method='GET')[2]
        self.assertNotIn('12.34', json.dumps(public)); self.assertNotIn('credits', public); self.assertNotIn('cost_rates', public)

    def test_month_aggregates_do_not_reuse_preview_limits(self):
        owner = self.owner()
        with self.gateway.db() as db:
            for index in range(210):
                user = db.execute('INSERT INTO users(email,salt,password,username) VALUES(?,?,?,?)', ('person' + str(index) + '@example.test', '', '', 'person' + str(index))).lastrowid
                db.execute('INSERT INTO grants(user,app,requests,audio) VALUES(?,?,?,?)', (user, 'zhiyun-subtitles', 10, 30))
        for _ in range(130): self.insert_call(input_tokens=10, output_tokens=2, total_tokens=12)
        self.insert_call(month='2000-01')
        result = self.overview(owner)
        self.assertEqual(result['summary']['users'], 212)
        self.assertEqual(len(result['users']), 212)
        self.assertEqual(result['summary']['requests'], 130)
        self.assertEqual(result['summary']['total_tokens'], 1560)
        self.assertEqual(result['summary']['estimated_cost_cny'], None)
        self.assertEqual(result['summary']['pricing_coverage'], 0)
        self.assertEqual(result['summary']['unpriced_calls'], 130)
        self.assertEqual(self.overview(owner, '2000-01')['summary']['requests'], 1)
        self.fails(400, lambda: self.overview(owner, '2026-13'))
        self.fails(400, lambda: self.call('/v1/admin/operations?month=2026-01&month=2026-02', headers=owner, method='GET'))

    def test_rates_are_historical_and_images_are_not_double_counted(self):
        owner = self.owner(); now = int(time.time())
        with patch('backend.operations_api.time.time', return_value=now - 20):
            first = self.rate(owner)
        self.insert_call(created=now - 21)  # No historic rate exists for this call.
        self.insert_call(created=now - 10, image_count=8)
        with patch('backend.operations_api.time.time', return_value=now):
            self.rate(owner, input_per_million='3', output_per_million='6')
        self.insert_call(created=now)
        result = self.overview(owner)['summary']
        self.assertIsNone(result['estimated_cost_cny'])
        self.assertEqual(result['known_cost_cny'], '10.000000')  # 4 + 6, images already in input.
        self.assertEqual(result['images'], 8); self.assertEqual(result['pricing_coverage'], 2 / 3)
        self.assertIn('图片已计入', COST_NOTE)
        self.fails(400, lambda: self.rate(owner, effective_from=now - 1))
        with patch('backend.operations_api.time.time', return_value=now - 20):
            self.fails(409, lambda: self.rate(owner))
        self.assertEqual(first['input_per_million'], '2')

    def test_unknown_usage_or_missing_component_never_becomes_zero(self):
        owner = self.owner(); now = int(time.time())
        with patch('backend.operations_api.time.time', return_value=now - 10): self.rate(owner, audio_per_minute='0.6')
        self.insert_call(seconds=30, web_search=1, created=now)  # Search unit rate missing.
        self.insert_call(state='unknown', input_tokens=0, output_tokens=0, total_tokens=0)
        self.insert_call(state='reserved', input_tokens=0, output_tokens=0, total_tokens=0)
        result = self.overview(owner)
        self.assertIsNone(result['summary']['estimated_cost_cny']); self.assertEqual(result['summary']['uncertain'], 2)
        self.assertEqual(result['summary']['priced_calls'], 0)
        self.assertTrue(any(a['type'] == 'uncertain' for a in result['alerts']))
        with patch('backend.operations_api.time.time', return_value=now + 1): self.rate(owner, audio_per_minute='0.6', web_search_per_call='0.05')
        self.insert_call(created=now + 2, input_tokens=0, output_tokens=0, total_tokens=0, seconds=30, web_search=2)
        self.assertEqual(self.overview(owner)['summary']['known_cost_cny'], '0.400000')

    def test_decimal_validation_and_unknown_rates(self):
        owner = self.owner()
        for invalid in ('-1', 'NaN', 'Infinity', '1e3', '0.000000001', True, '1000000001'):
            self.fails(400, lambda v=invalid: self.rate(owner, input_per_million=v))
        self.fails(400, lambda: self.rate(owner, currency='USD'))
        self.fails(400, lambda: self.rate(owner, input_per_million=None, output_per_million=None))
        self.rate(owner, input_per_million='0', output_per_million='0')
        self.insert_call()
        result = self.overview(owner)['summary']
        self.assertEqual(result['estimated_cost_cny'], '0.000000'); self.assertEqual(result['pricing_coverage'], 1)
        self.assertFalse(self.overview(owner)['actual_billing_connected'])

    def test_credit_is_atomic_idempotent_and_keeps_permissions(self):
        owner = self.owner(); key = str(uuid.uuid4())
        before = self.call('/v1/me', method='GET')[2]
        first = self.credit(owner, idempotency_key=key)
        second = self.credit(owner, idempotency_key=key)
        self.assertFalse(first['replayed']); self.assertTrue(second['replayed'])
        self.assertEqual(first['credit']['id'], second['credit']['id'])
        self.assertEqual(first['credit']['before_request_limit'], 10); self.assertEqual(first['credit']['after_request_limit'], 15)
        after = self.call('/v1/me', method='GET')[2]
        self.assertEqual(after['usage']['request_limit'], 15); self.assertEqual(after['usage']['audio_limit'], 50)
        self.assertEqual(before['permissions'], after['permissions']); self.assertEqual(before['membership'], after['membership'])
        self.fails(409, lambda: self.credit(owner, idempotency_key=key, request_credit=7))
        self.assertEqual(len(self.overview(owner)['credits']), 1)
        with self.gateway.db() as db:
            self.assertEqual(db.execute('SELECT requests,audio FROM grants WHERE user=1').fetchone()[:], (10,20))
            self.assertEqual(db.execute("SELECT COUNT(*) FROM admin_actions WHERE action='manual_credit'").fetchone()[0], 1)

    def test_concurrent_credit_double_click_cannot_duplicate(self):
        owner = self.owner(); key = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.credit(owner, idempotency_key=key), range(4)))
        self.assertEqual(sum(not r['replayed'] for r in results), 1)
        self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['request_limit'], 15)

    def test_credits_expire_at_month_boundary_and_quota_enforced(self):
        owner = self.owner()
        self.call('/v1/admin/grants', {'user_id':1, 'plan':'pro', 'request_limit':0, 'audio_limit':0}, owner)
        self.credit(owner, request_credit=1, audio_credit_seconds=2)
        self.gateway.reserve(1, 'zhiyun-subtitles', 'speech', 2, feature='speech')
        self.fails(429, lambda: self.gateway.reserve(1, 'zhiyun-subtitles', 'speech', 1, feature='speech'))
        with patch('backend.operations_api.utc_month', return_value='2099-01'):
            self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['request_limit'], 0)
            self.fails(429, lambda: self.gateway.reserve(1, 'zhiyun-subtitles', 'ark', feature='learning'))
        self.call('/v1/admin/grants', {'user_id':1, 'plan':'free', 'request_limit':0, 'audio_limit':0}, owner)
        self.credit(owner)
        self.fails(403, lambda: self.gateway.reserve(1, 'zhiyun-subtitles', 'ark', feature='learning'))

    def test_receipt_records_and_nullable_amount(self):
        owner = self.owner()
        self.credit(owner, kind='manual_payment', amount_cny='12.34')
        self.credit(owner, kind='manual_payment', amount_cny=None)
        self.credit(owner)
        result = self.overview(owner)
        self.assertEqual(result['summary']['received_amount_cny'], '12.34')
        self.assertEqual(result['summary']['received_unknown_count'], 1)
        self.assertEqual(result['summary']['gifted_requests'], 5)
        self.assertTrue(all(r['actor_name'] == 'owner' for r in result['credits']))
        self.assertTrue(all('payload_hash' not in r for r in result['credits']))
        self.fails(400, lambda: self.credit(owner, amount_cny='1.00'))
        self.fails(400, lambda: self.credit(owner, kind='manual_payment', amount_cny='0.001'))
        self.fails(400, lambda: self.credit(owner, request_credit=-1))
        self.fails(400, lambda: self.credit(owner, request_credit=0, audio_credit_seconds=0))
        self.fails(404, lambda: self.credit(owner, user_id=99999))

    def test_channel_switch_requires_https_qr_and_never_leaks_private_data(self):
        owner = self.owner()
        self.call('/v1/admin/access-settings', {'registration': {'enabled': True, 'contact': '联系管理员', 'instructions': '申请独立账号'}}, owner)
        value = self.call('/v1/account/access', method='GET')[2]
        self.assertFalse(value['registration']['enabled']); self.assertEqual(value['registration']['status'], '暂未开放')
        settings = {'registration': {'enabled': True, 'qr_url': 'https://cdn.example.com/account.png', 'contact': '请备注课程'}, 'recharge': {'enabled': False, 'qr_url': 'https://cdn.example.com/pay.png'}}
        self.call('/v1/admin/access-settings', settings, owner)
        value = self.call('/v1/account/access', method='GET')[2]
        self.assertTrue(value['registration']['enabled']); self.assertEqual(value['registration']['status'], '联系管理员办理')
        self.assertFalse(value['recharge']['enabled']); self.assertEqual(value['recharge']['qr_url'], '')
        for invalid in ('http://example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AA', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://192.168.1.2/a', 'https://user:pass@example.com/a', 'https://localhost/a', 'https://example.com/a#fragment', 'https://example.com:8443/a'):
            self.fails(400, lambda v=invalid: self.call('/v1/admin/access-settings', {'recharge': {'enabled': True, 'qr_url': v}}, owner))
        # Invalid batch cannot partially overwrite a valid channel.
        self.fails(400, lambda: self.call('/v1/admin/access-settings', {'registration': {'enabled': False}, 'recharge': {'enabled': True, 'qr_url': 'http://example.com'}}, owner))
        self.assertTrue(self.call('/v1/account/access', method='GET')[2]['registration']['enabled'])

    def test_quota_expiry_pause_and_model_summaries(self):
        owner = self.owner()
        self.call('/v1/admin/grants', {'user_id':1, 'request_limit':1, 'audio_limit':20, 'expires': int(time.time())+60}, owner)
        self.insert_call(input_tokens=10, output_tokens=2, total_tokens=12, seconds=18)
        self.insert_call(model='other', input_tokens=1, output_tokens=2, total_tokens=3)
        result = self.overview(owner)
        self.assertEqual({m['model'] for m in result['models']}, {'test-model','other'})
        self.assertTrue({'request_quota','audio_quota','expiring'} <= {a['type'] for a in result['alerts']})
        self.call('/v1/admin/grants', {'user_id':1, 'expires': int(time.time())-1}, owner)
        self.assertTrue(any(a['type']=='expired' for a in self.overview(owner)['alerts']))
        self.call('/v1/admin/grants', {'user_id':1, 'enabled': False}, owner)
        self.assertTrue(any(a['type']=='paused' for a in self.overview(owner)['alerts']))

    def test_migration_is_repeatable_and_keeps_old_call_data(self):
        owner = self.owner(); self.insert_call(); self.credit(owner)
        restarted = Gateway(self.gateway.path, self.upstream)
        self.assertEqual(restarted.usage(1, 'zhiyun-subtitles')['request_limit'], 15)
        self.assertEqual(self.overview(owner)['summary']['requests'], 1)


if __name__ == '__main__':
    unittest.main()
