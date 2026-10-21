"""Private account/study tests use temporary databases and generated credentials only."""
import concurrent.futures
import http.client
import json
import os
import secrets
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import study_api
from backend.admin_api import Fault
from backend.server import Gateway, make_server
from backend.study_api import STUDY_APP, StudyMixin, migrate_study


BaseGateway = Gateway if issubclass(Gateway, StudyMixin) else type("StudyTestBase", (StudyMixin, Gateway), {})


class TestGateway(BaseGateway):
    def __init__(self, path):
        super().__init__(path)
        with self.db() as db:
            migrate_study(db)
        self.outbox = {}
        self.study_mailer = lambda recipient, code: self.outbox.__setitem__(recipient, code)


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.gateway = TestGateway(Path(self.temp.name) / 'test.sqlite3')
        self.headers = {'X-App-Id': STUDY_APP}
        self.password = secrets.token_urlsafe(24)

    def tearDown(self):
        self.temp.cleanup()

    def send(self, email='learner@example.test', ip='test-client'):
        return self.gateway.study_public('POST', '/v1/auth/register-code', self.headers, {'email': email}, ip)

    def register(self, email='learner@example.test', code=None, ip='test-client'):
        code = self.gateway.outbox[email] if code is None else code
        return self.gateway.study_public('POST', '/v1/auth/register', self.headers,
                                         {'email': email, 'code': code, 'password': self.password, 'username': '同学'}, ip)

    def user(self, email):
        with self.gateway.db() as db:
            return dict(db.execute('SELECT id,email,username,is_admin FROM users WHERE email=?', (email,)).fetchone())

    def save(self, owner, identifier='example', **extra):
        body = {'id': identifier, 'title': '重点', 'course': '课程', 'source': '文字提问',
                'origin': 'https://school.example/course?session=private#position',
                'history': [{'role': 'user', 'text': '为什么？'}, {'role': 'assistant', 'text': '这是解释。'}]}
        body.update(extra)
        return self.gateway.study_private('POST', '/v1/study/conversations', self.headers, body, owner, STUDY_APP)

    def call(self, method, path, user, app=STUDY_APP):
        return self.gateway.study_private(method, path, self.headers, {}, user, app)

    def assertFault(self, code, callback):
        with self.assertRaises(Fault) as caught:
            callback()
        self.assertEqual(code, caught.exception.code)
        return caught.exception

    def test_capabilities_expose_only_readiness_without_secrets(self):
        self.gateway.study_mailer = None
        with patch.dict(os.environ, {}, clear=True):
            response = self.gateway.study_public('GET', '/v1/study/capabilities', {}, {}, 'test')
            self.assertEqual({'enabled': True, 'registration': True, 'mail_configured': False}, response[2])
            self.assertTrue(self.gateway.capabilities()['study_sync'])
            self.assertTrue(self.gateway.capabilities()['email_registration'])
            self.assertFalse(self.gateway.capabilities()['mail_configured'])

    def test_integrated_gateway_requires_auth_and_free_records_work(self):
        def handle(method, path, body=None, headers=None):
            return self.gateway.handle(method, path, headers or self.headers, body or {}, 'integration-client')
        self.assertFault('request_failed', lambda: handle('GET', '/v1/study/conversations'))
        handle('POST', '/v1/auth/register-code', {'email': 'learner@example.test'})
        handle('POST', '/v1/auth/register', {'email': 'learner@example.test', 'code': self.gateway.outbox['learner@example.test'], 'password': self.password})
        login = handle('POST', '/v1/auth/login', {'email': 'learner@example.test', 'password': self.password})[2]
        signed = {**self.headers, 'Authorization': 'Bearer ' + login['token']}
        self.assertEqual('free', login['membership']['plan'])
        handle('POST', '/v1/study/conversations', {'id': 'integrated', 'history': [{'role': 'user', 'text': '已保存的问题'}]}, signed)
        detail = handle('GET', '/v1/study/conversations?id=integrated', headers=signed)[2]
        self.assertEqual('integrated', detail['conversation']['id'])
        self.assertTrue(handle('GET', '/v1/me', headers=signed)[2]['capabilities']['study_sync'])
        handle('DELETE', '/v1/study/conversations?id=integrated', headers=signed)
        self.assertEqual([], handle('GET', '/v1/study/conversations', headers=signed)[2]['items'])

    def test_http_delete_and_options_allow_method(self):
        self.send()
        self.register()
        user = self.user('learner@example.test')
        self.save(user)
        login = self.gateway.handle('POST', '/v1/auth/login', self.headers,
                                    {'email': 'learner@example.test', 'password': self.password}, 'http-test')[2]
        server = make_server(self.gateway, port=0)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=5)
        try:
            connection.request('OPTIONS', '/v1/study/conversations')
            response = connection.getresponse()
            self.assertEqual(204, response.status)
            self.assertIn('DELETE', response.getheader('Access-Control-Allow-Methods'))
            response.read()
            connection.request('DELETE', '/v1/study/conversations?id=example', headers={**self.headers, 'Authorization': 'Bearer ' + login['token']})
            response = connection.getresponse()
            self.assertEqual(200, response.status)
            self.assertEqual({'ok': True}, json.loads(response.read()))
            self.assertEqual([], self.call('GET', '/v1/study/conversations', user)[2]['items'])
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)

    def test_schema_idempotent_and_unknown_routes_passthrough(self):
        with self.gateway.db() as db:
            migrate_study(db)
        self.assertIsNone(self.gateway.study_public('GET', '/v1/other', {}, {}, 'test'))
        self.assertIsNone(self.gateway.study_private('GET', '/v1/other', {}, {}, {'id': 1}, STUDY_APP))

    def test_unconfigured_mail_fails_without_code_or_account(self):
        self.gateway.study_mailer = None
        with patch.dict(os.environ, {}, clear=True):
            self.assertFault('email_not_configured', self.send)
        with self.gateway.db() as db:
            self.assertEqual(0, db.execute('SELECT COUNT(*) FROM registration_codes').fetchone()[0])
            self.assertEqual(0, db.execute('SELECT COUNT(*) FROM users').fetchone()[0])

    def test_failed_send_does_not_leave_usable_code(self):
        def failed(recipient, code):
            raise RuntimeError('mail unavailable')
        self.gateway.study_mailer = failed
        self.assertFault('email_unavailable', self.send)
        with self.gateway.db() as db:
            self.assertEqual(0, db.execute('SELECT COUNT(*) FROM registration_codes').fetchone()[0])

    def test_code_is_hashed_short_lived_and_send_throttled(self):
        status, _, body = self.send('Person@Example.test')
        self.assertEqual(200, status)
        self.assertEqual(600, body['expires_in'])
        code = self.gateway.outbox['person@example.test']
        self.assertEqual(6, len(code))
        with self.gateway.db() as db:
            row = dict(db.execute('SELECT * FROM registration_codes').fetchone())
            self.assertNotEqual(code, row['code_hash'])
            self.assertNotIn('code', row)
            self.assertLessEqual(row['expires'] - row['created'], 600)
        self.assertFault('rate_limit', lambda: self.send('person@example.test'))

    def test_registration_is_free_zero_quota_not_admin_and_single_use(self):
        self.send()
        result = self.register()
        self.assertEqual('login', result[2]['next'])
        user = self.user('learner@example.test')
        self.assertEqual(0, user['is_admin'])
        with self.gateway.db() as db:
            grant = dict(db.execute('SELECT * FROM grants WHERE user=?', (user['id'],)).fetchone())
            self.assertEqual('free', grant['plan'])
            self.assertEqual((0, 0, 0, 0, 0), tuple(grant[k] for k in ('requests', 'audio', 'learning', 'translation', 'speech')))
        self.assertFault('invalid_code', self.register)
        self.assertFalse(self.gateway.permissions(user['id'], STUDY_APP)['learning'])

    def test_existing_account_response_is_same_without_password_or_grant_change(self):
        self.send()
        first = self.register()
        with self.gateway.db() as db:
            before = dict(db.execute('SELECT * FROM users').fetchone())
            db.execute('DELETE FROM attempts')
        self.send()
        self.password = secrets.token_urlsafe(24)
        self.assertEqual(first, self.register())
        with self.gateway.db() as db:
            after = dict(db.execute('SELECT * FROM users').fetchone())
        self.assertEqual(before, after)

    def test_five_wrong_guesses_destroy_code(self):
        self.send()
        correct = self.gateway.outbox['learner@example.test']
        wrong = '000000' if correct != '000000' else '111111'
        for _ in range(5):
            self.assertFault('invalid_code', lambda: self.register(code=wrong))
        self.assertFault('invalid_code', lambda: self.register(code=correct))
        with self.gateway.db() as db:
            self.assertEqual(0, db.execute('SELECT COUNT(*) FROM users').fetchone()[0])

    def test_expired_code_cannot_create_account(self):
        self.send()
        with self.gateway.db() as db:
            db.execute('UPDATE registration_codes SET expires=?', (int(time.time()) - 1,))
        self.assertFault('invalid_code', self.register)

    def test_registration_app_and_input_validation(self):
        self.assertFault('invalid_app', lambda: self.gateway.study_public('POST', '/v1/auth/register-code', {'X-App-Id': 'another-app'}, {'email': 'learner@example.test'}, 'test'))
        self.assertFault('invalid_email', lambda: self.send('invalid'))
        self.assertFault('method_not_allowed', lambda: self.gateway.study_public('GET', '/v1/auth/register', self.headers, {}, 'test'))
        self.send()
        self.password = 'short'
        self.assertFault('invalid_password', self.register)

    def test_concurrent_code_consumption_creates_one_account(self):
        self.send()
        def run():
            try:
                return self.register()[0]
            except Fault as fault:
                return fault.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: run(), range(2)))
        self.assertEqual([200, 'invalid_code'], sorted(results, key=str))
        with self.gateway.db() as db:
            self.assertEqual(1, db.execute('SELECT COUNT(*) FROM users').fetchone()[0])

    def test_free_users_save_list_read_update_delete_without_model_calls(self):
        self.send()
        self.register()
        user = self.user('learner@example.test')
        saved = self.save(user)[2]['conversation']
        self.assertEqual('https://school.example/course', saved['origin'])
        self.assertEqual(1, saved['questionCount'])
        listing = self.call('GET', '/v1/study/conversations', user)[2]
        self.assertEqual(1, len(listing['items']))
        self.assertNotIn('history', listing['items'][0])
        loaded = self.call('GET', '/v1/study/conversations?id=example', user)[2]['conversation']
        self.assertEqual(saved, loaded)
        self.save(user, title='更新标题')
        updated = self.call('GET', '/v1/study/conversations?id=example', user)[2]['conversation']
        self.assertEqual(saved['created'], updated['created'])
        self.assertEqual('更新标题', updated['title'])
        self.call('DELETE', '/v1/study/conversations?id=example', user)
        self.assertEqual([], self.call('GET', '/v1/study/conversations', user)[2]['items'])
        with self.gateway.db() as db:
            self.assertEqual(0, db.execute('SELECT COUNT(*) FROM calls').fetchone()[0])

    def test_records_are_isolated_by_user_and_app(self):
        self.send()
        self.register()
        first = self.user('learner@example.test')
        self.send('second@example.test', 'second-client')
        self.register('second@example.test', ip='second-client')
        second = self.user('second@example.test')
        self.save(first)
        self.assertFault('conversation_not_found', lambda: self.call('GET', '/v1/study/conversations?id=example', second))
        self.call('DELETE', '/v1/study/conversations?id=example', second)
        self.assertEqual(1, len(self.call('GET', '/v1/study/conversations', first)[2]['items']))
        self.save(second, title='另一位同学的记录')
        self.assertNotEqual(self.call('GET', '/v1/study/conversations?id=example', first)[2]['conversation']['title'], self.call('GET', '/v1/study/conversations?id=example', second)[2]['conversation']['title'])
        self.assertFault('invalid_app', lambda: self.call('GET', '/v1/study/conversations', first, 'other-app'))

    def test_media_unknown_fields_credential_headers_and_oversize_rejected(self):
        user = {'id': 1}
        invalid = [{'image': 'data:image/png;base64,AA=='}, {'user': 2},
                   {'history': [{'role': 'user', 'text': 'hi', 'image': 'image'}]},
                   {'history': [{'role': 'system', 'text': 'hi'}]},
                   {'history': [{'role': 'user', 'text': 'Cookie: secret'}]},
                   {'origin': 'https://name:private@example.test/page'},
                   {'origin': 'javascript:alert(1)'},
                   {'history': []}, {'title': 'x' * 201}]
        for extra in invalid:
            with self.subTest(fields=tuple(extra)):
                with self.assertRaises(Fault):
                    self.save(user, **extra)
        self.assertFault('conversation_too_large', lambda: self.save(user, history=[{'role': 'user', 'text': '中' * 50000}, {'role': 'assistant', 'text': '中' * 50000}]))

    def test_pagination_limits_record_cap_and_invalid_ids(self):
        user = {'id': 1}
        self.save(user, 'one')
        self.save(user, 'two')
        page = self.call('GET', '/v1/study/conversations?limit=1', user)[2]
        self.assertEqual(1, len(page['items']))
        self.assertEqual(1, page['next_offset'])
        self.assertIsNone(self.call('GET', '/v1/study/conversations?limit=1&offset=1', user)[2]['next_offset'])
        self.assertFault('invalid_pagination', lambda: self.call('GET', '/v1/study/conversations?limit=51', user))
        self.assertFault('invalid_conversation', lambda: self.call('DELETE', '/v1/study/conversations', user))
        self.assertFault('invalid_conversation', lambda: self.call('GET', '/v1/study/conversations?id=bad%27id', user))
        with patch.object(study_api, 'MAX_CONVERSATIONS', 2):
            self.assertFault('conversation_limit', lambda: self.save(user, 'three'))
            self.save(user, 'one', title='达到上限仍可更新')


if __name__ == '__main__':
    unittest.main()
