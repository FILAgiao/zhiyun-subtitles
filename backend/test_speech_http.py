"""Offline regressions for the standard ASR HTTP response contract."""
import base64
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
import wave
from email.message import Message
from types import SimpleNamespace
from unittest.mock import patch

from backend.admin_api import Fault
from backend.server import (ARK, SPEECH, Gateway, make_server, official,
                            speech_response_fault, speech_status_code)


class Response:
    def __init__(self, code='20000000', raw=b'', status=200, extra=None):
        self.status = status
        self.headers = {'X-Api-Status-Code': code, **(extra or {})}
        self.raw, self.closed, self.reads = raw, False, 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def read(self, limit):
        self.reads += 1
        return self.raw[:limit]


def opener_for(response):
    return patch('backend.server.urllib.request.build_opener',
                 return_value=SimpleNamespace(open=lambda *args, **kwargs: response))


class TransportTests(unittest.TestCase):
    def test_empty_submit_is_accepted_and_only_numeric_status_is_forwarded(self):
        response = Response(extra={'X-Api-Message': 'private detail', 'X-Api-Key': 'private key'})
        with opener_for(response) as opener:
            self.assertEqual(official(SPEECH + 'submit', {}, {}),
                             (200, {'X-Api-Status-Code': '20000000'}, {}))
        opener.assert_called_once()
        self.assertTrue(response.closed)

    def test_empty_pending_query_is_accepted(self):
        for code in ('20000001', '20000002'):
            with self.subTest(code=code), opener_for(Response(code)):
                self.assertEqual(official(SPEECH + 'query', {}, {}),
                                 (200, {'X-Api-Status-Code': code}, {}))

    def test_complete_query_requires_json_object_and_bounded_response(self):
        for raw in (b'', b'not json private key', b'[]', b'x' * 8000001):
            with self.subTest(size=len(raw)), opener_for(Response(raw=raw)):
                with self.assertRaises(Fault) as caught:
                    official(SPEECH + 'query', {}, {})
                error = caught.exception
                self.assertEqual((error.status, error.code), (502, 'speech_upstream_response'))
                self.assertEqual(error.speech_status_code, '20000000')
                self.assertNotIn('private key', error.message)

    def test_complete_query_keeps_only_result_fields(self):
        data = {'result': {'text': 'hello'}, 'audio_info': {'duration': 1000}, 'secret': 'private key'}
        with opener_for(Response(raw=json.dumps(data).encode())):
            status, headers, result = official(SPEECH + 'query', {}, {})
        self.assertEqual(status, 200)
        self.assertEqual(result, {key: data[key] for key in ('result', 'audio_info')})
        self.assertNotIn('private key', json.dumps([headers, result]))

    def test_http_error_keeps_numeric_status_without_reading_or_echoing_body(self):
        body = io.BytesIO(b'private key and request body')
        error = urllib.error.HTTPError(SPEECH + 'query', 429, 'private reason',
            {'X-Api-Status-Code': '55000031', 'X-Api-Message': 'private key'}, body)
        with patch('backend.server.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = error
            self.assertEqual(official(SPEECH + 'query', {}, {}),
                             (429, {'X-Api-Status-Code': '55000031'}, {}))
            opener.return_value.open.assert_called_once()
        self.assertTrue(body.closed)

    def test_status_rejects_non_ascii_injection_and_duplicate_headers(self):
        for code in ('55000031 private key', '55000031\r\nX-Secret: private key', '５５００００３１', '', '1' * 100):
            with self.subTest(code=code):
                self.assertEqual(speech_status_code({'X-Api-Status-Code': code}), '')
        duplicate = Message()
        duplicate['X-Api-Status-Code'] = '20000000'
        duplicate['x-api-status-code'] = '55000031'
        self.assertEqual(speech_status_code(duplicate), '')

    def test_network_and_timeout_are_distinct_and_never_retried(self):
        cases = [(TimeoutError('private key'), 504, 'speech_upstream_timeout'),
                 (urllib.error.URLError(TimeoutError('private key')), 504, 'speech_upstream_timeout'),
                 (urllib.error.URLError('private key'), 502, 'speech_upstream_network'),
                 (ConnectionResetError('private key'), 502, 'speech_upstream_network')]
        for failure, status, code in cases:
            with self.subTest(code=code), patch('backend.server.urllib.request.build_opener') as opener:
                opener.return_value.open.side_effect = failure
                with self.assertRaises(Fault) as caught:
                    official(SPEECH + 'submit', {}, {})
                self.assertEqual((caught.exception.status, caught.exception.code), (status, code))
                self.assertNotIn('private key', caught.exception.message)
                opener.return_value.open.assert_called_once()

    def test_ark_still_requires_json_and_keeps_existing_error_contract(self):
        for url in (ARK, SPEECH + 'submit?unexpected=1'):
            with self.subTest(url=url), opener_for(Response()):
                with self.assertRaises(Fault) as caught:
                    official(url, {}, {})
                self.assertEqual((caught.exception.status, caught.exception.code), (502, 'request_failed'))
        response = Response(raw=b'{"output":[],"usage":{}}', extra={'Content-Type': 'application/json'})
        with opener_for(response):
            self.assertEqual(official(ARK, {}, {})[2], {'output': [], 'usage': {}})

    def test_auth_busy_audio_and_supplier_errors_are_classified(self):
        cases = [(401, '', 503, 'speech_upstream_auth'), (403, '', 503, 'speech_upstream_auth'),
                 (429, '', 503, 'speech_upstream_busy'), (200, '55000031', 503, 'speech_upstream_busy'),
                 (200, '45000131', 503, 'speech_upstream_busy'),
                 (200, '20000003', 422, 'speech_audio_empty'), (200, '45000002', 422, 'speech_audio_empty'),
                 (200, '45000151', 422, 'speech_audio_invalid'), (200, '45000001', 502, 'speech_upstream_rejected'),
                 (503, '', 503, 'speech_upstream_unavailable'), (200, '55000000', 503, 'speech_upstream_unavailable'),
                 (200, '', 502, 'speech_upstream_response')]
        for upstream_status, upstream_code, status, code in cases:
            with self.subTest(status=upstream_status, code=upstream_code):
                error = speech_response_fault(upstream_status, upstream_code)
                self.assertEqual((error.status, error.code), (status, code))
                self.assertEqual(error.speech_status_code, upstream_code)


class GatewaySpeechTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.environment = patch.dict(os.environ, {'SPEECH_API_KEY': 'server-test-only'})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.gateway = Gateway(self.tmp.name + '/gateway.sqlite')
        self.gateway.add_user('asr@example.test', 'long-test-password', 'zhiyun-subtitles', 100, 100)
        with self.gateway.db() as db:
            self.user = db.execute('SELECT id FROM users').fetchone()[0]
        self.task = str(uuid.uuid4())
        self.headers = {'X-App-Id': 'zhiyun-subtitles', 'X-Api-Request-Id': self.task}
        wav_bytes = io.BytesIO()
        with wave.open(wav_bytes, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(16000)
            wav.writeframes(b'\0\0' * 16000)
        self.body = {'audio': {'data': base64.b64encode(wav_bytes.getvalue()).decode()}}

    def call(self, action, body=None):
        return self.gateway.speech(self.user, 'zhiyun-subtitles', '/v1/speech/' + action,
                                   self.headers, self.body if body is None else body)

    def test_empty_submit_then_pending_then_complete_stays_one_task_and_one_charge(self):
        responses = [Response(), Response('20000002'), Response(raw=b'{"result":{"text":"hello"}}')]
        seen = []
        def open_request(request, **kwargs):
            seen.append((request.full_url, request.get_header('X-api-request-id')))
            return responses[len(seen)-1]
        with patch('backend.server.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = open_request
            self.assertEqual(self.call('submit')[1]['X-Api-Status-Code'], '20000000')
            self.assertEqual(self.call('query', {})[1]['X-Api-Status-Code'], '20000002')
            self.assertEqual(self.call('query', {})[2], {'result': {'text': 'hello'}})
            self.assertEqual(self.call('query', {})[2], {'result': {'text': 'hello'}})
        self.assertEqual([url for url, _ in seen], [SPEECH+'submit', SPEECH+'query', SPEECH+'query'])
        self.assertEqual({task for _, task in seen}, {self.task})
        usage = self.gateway.usage(self.user, 'zhiyun-subtitles')
        self.assertEqual((usage['requests'], usage['audio_seconds']), (1, 1))

    def test_query_transport_failure_preserves_original_job_for_recovery(self):
        with opener_for(Response()):
            self.call('submit')
        with patch('backend.server.urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = urllib.error.URLError('private network detail')
            with self.assertRaises(Fault) as caught:
                self.call('query', {})
            self.assertEqual(caught.exception.code, 'speech_upstream_network')
            opener.return_value.open.assert_called_once()
        with opener_for(Response(raw=b'{"result":{"text":"recovered"}}')):
            self.assertEqual(self.call('query', {})[2]['result']['text'], 'recovered')
        with self.gateway.db() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM calls').fetchone()[0], 1)

    def test_http_error_exposes_only_safe_status_and_user_message(self):
        self.gateway.handle = lambda *args, **kwargs: (_ for _ in ()).throw(speech_response_fault(429, '55000031'))
        server = make_server(self.gateway, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        request = urllib.request.Request('http://127.0.0.1:' + str(server.server_port) + '/v1/speech/query',
                                         data=b'{}', headers={'Content-Type': 'application/json'})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=3)
        with caught.exception as response:
            self.assertEqual(response.code, 503)
            self.assertEqual(response.headers['X-Api-Status-Code'], '55000031')
            self.assertEqual(response.headers['Retry-After'], '3')
            self.assertEqual(json.load(response)['error_code'], 'speech_upstream_busy')


if __name__ == '__main__':
    unittest.main()
