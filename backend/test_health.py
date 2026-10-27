"""Database readiness and safe failure responses through the real HTTP server."""
import io
import json
import sqlite3
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch

from backend.server import Fault, Gateway, digest, make_server


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'private-database.sqlite'
        self.gateway = Gateway(self.path)
        self.origin = 'https://classroom.example.test'
        self.server = make_server(self.gateway, port=0, allowed_web_origins=(self.origin,))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, path='/health', body=None, headers=None, method=None):
        request = urllib.request.Request(self.base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Origin': self.origin, 'Content-Type': 'application/json', **(headers or {})},
            method=method)
        try:
            response = urllib.request.urlopen(request, timeout=4)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, response.headers, json.loads(raw) if raw else None

    def assert_unavailable(self, response, diagnostic, name=None, health=False):
        status, headers, body = response
        self.assertEqual(status, 503)
        self.assertEqual(body['error_code'], 'database_unavailable')
        self.assertEqual(headers['Retry-After'], '5')
        self.assertEqual(headers['Access-Control-Allow-Origin'], self.origin)
        self.assertEqual(headers['X-Request-Id'], body['request_id'])
        if health:
            self.assertIs(body['ok'], False)
        events = [json.loads(line) for line in diagnostic.getvalue().splitlines()]
        database_events = [event for event in events if event['event'] == 'gateway_database_error']
        self.assertEqual(len(database_events), 1)
        if name:
            self.assertEqual(database_events[0]['sqlite_errorname'], name)
            self.assertIsInstance(database_events[0]['sqlite_errorcode'], int)
        rejection = next(event for event in events if event['event'] == 'gateway_rejection')
        self.assertEqual(rejection['request_id'], body['request_id'])
        public_and_logs = json.dumps(body) + diagnostic.getvalue()
        for private in (str(self.path), 'private-database', 'private-user', 'private-token', 'private-prompt'):
            self.assertNotIn(private, public_and_logs)
        self.assertNotIn('sqlite_errorcode', body)
        self.assertNotIn('sqlite_errorname', body)

    def test_healthy_readiness_keeps_capabilities_and_does_not_change_database(self):
        before = self.path.read_bytes()
        for _ in range(2):
            status, headers, body = self.request()
            self.assertEqual(status, 200)
            self.assertIs(body['ok'], True)
            self.assertEqual(body['api_version'], 1)
            self.assertIn('speech_stream', body['capabilities'])
            self.assertEqual(headers['Access-Control-Allow-Origin'], self.origin)
        self.assertEqual(self.path.read_bytes(), before)

    def test_corrupted_database_is_not_healthy_and_recovers_without_process_restart(self):
        pristine = self.path.read_bytes()
        with self.path.open('r+b') as file:
            file.write(b'not a database: private-user private-token')
        diagnostic = io.StringIO()
        with redirect_stderr(diagnostic):
            response = self.request()
        self.assert_unavailable(response, diagnostic, 'SQLITE_NOTADB', health=True)
        self.path.write_bytes(pristine)
        self.assertIs(self.request()[2]['ok'], True)

    def test_missing_database_is_not_silently_recreated_by_health(self):
        self.path.rename(self.path.with_suffix('.saved'))
        diagnostic = io.StringIO()
        with redirect_stderr(diagnostic):
            response = self.request()
        self.assert_unavailable(response, diagnostic, 'SQLITE_CANTOPEN', health=True)
        self.assertFalse(self.path.exists())

    def test_missing_business_table_is_not_healthy(self):
        with self.gateway.db() as db:
            db.execute('DROP TABLE activity_client_metadata')
        diagnostic = io.StringIO()
        with redirect_stderr(diagnostic):
            response = self.request()
        self.assert_unavailable(response, diagnostic, 'SQLITE_ERROR', health=True)

    def seed_session(self):
        token = 'private-token'
        with self.gateway.db() as db:
            db.execute("INSERT INTO users(id,email,salt,password,username) VALUES(1,'private-user@example.test','salt','password','private-user')")
            db.execute("INSERT INTO grants(user,app,requests,audio) VALUES(1,'zhiyun-subtitles',100,100)")
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (digest(token), 1, int(time.time()) + 60))
            db.execute('INSERT INTO activity_sessions VALUES(?,?,?,?,?,?,NULL,?)',
                       (digest(token), 1, 'zhiyun-subtitles', 'api', 1, 1, int(time.time()) + 60))
        return {'Authorization': 'Bearer ' + token, 'X-App-Id': 'zhiyun-subtitles'}

    def test_real_readonly_write_failure_blocks_ai_and_speech_with_safe_503(self):
        headers = self.seed_session()
        connect = sqlite3.connect
        def readonly_connect(*args, **kwargs):
            return connect(self.path.resolve().as_uri() + '?mode=ro', uri=True, timeout=1)
        with patch('backend.server.sqlite3.connect', side_effect=readonly_connect):
            # Readiness promises bounded database reads, not a paid/write probe.
            self.assertIs(self.request()[2]['ok'], True)
            for route in ('/v1/learning/jobs/create', '/v1/speech/stream/create'):
                diagnostic = io.StringIO()
                with redirect_stderr(diagnostic):
                    response = self.request(route, {'prompt': 'private-prompt'}, headers)
                self.assert_unavailable(response, diagnostic, 'SQLITE_READONLY')
        self.assertEqual(self.gateway.active_requests, 0)

    def test_escaped_database_error_is_sanitized_at_http_boundary(self):
        error = sqlite3.DatabaseError('private-user private-token private-prompt ' + str(self.path))
        error.sqlite_errorcode = sqlite3.SQLITE_IOERR
        error.sqlite_errorname = 'SQLITE_IOERR'
        diagnostic = io.StringIO()
        with patch.object(self.gateway, 'handle', side_effect=error), redirect_stderr(diagnostic):
            response = self.request('/v1/speech/query', {})
        self.assert_unavailable(response, diagnostic, 'SQLITE_IOERR')

    def test_cors_preflight_and_denial_still_work_when_database_is_broken(self):
        self.path.write_bytes(b'broken database')
        status, headers, body = self.request(method='OPTIONS')
        self.assertEqual(status, 204)
        self.assertIsNone(body)
        self.assertEqual(headers['Access-Control-Allow-Origin'], self.origin)
        with redirect_stderr(io.StringIO()):
            status, headers, body = self.request(headers={'Origin': 'https://denied.example.test'})
        self.assertEqual(status, 403)
        self.assertIsNone(headers.get('Access-Control-Allow-Origin'))
        self.assertNotEqual(body['error_code'], 'database_unavailable')

    def test_expected_unique_conflict_remains_available_to_business_handlers(self):
        with self.gateway.db() as db:
            db.execute("INSERT INTO users(email,salt,password) VALUES('same@example.test','salt','password')")
        with self.assertRaises(sqlite3.IntegrityError):
            with self.gateway.db() as db:
                db.execute("INSERT INTO users(email,salt,password) VALUES('same@example.test','salt','password')")


if __name__ == '__main__':
    unittest.main()
