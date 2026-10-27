"""Offline transport, protocol, isolation and billing tests for streaming ASR."""
import base64
import concurrent.futures
import gzip
import hashlib
import io
import json
import os
import queue
import socket
import ssl
import struct
import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch

from backend.admin_api import Fault
from backend.server import Gateway
from backend.speech_stream import (BYTES_PER_SECOND, MAX_MESSAGE, OfficialWebSocket,
                                    SpeechStreams, client_packet, configuration, decode_packet)


def response_packet(payload, last=False, sequence=True, compressed=True):
    raw = json.dumps(payload, ensure_ascii=False).encode()
    if compressed:
        raw = gzip.compress(raw)
    flags = (2 if last else 0) | (1 if sequence else 0)
    return (bytes((0x11, 0x90 | flags, 0x11 if compressed else 0x10, 0))
            + (struct.pack('>i', -1 if last else 1) if sequence else b'')
            + struct.pack('>I', len(raw)) + raw)


class FakeSocket:
    def __init__(self, headers):
        self.headers, self.sent, self.closed = headers, [], False
        self.responses = queue.Queue()

    def send(self, raw):
        if self.closed:
            raise EOFError()
        self.sent.append(raw)

    def recv(self):
        try:
            value = self.responses.get(timeout=.02)
        except queue.Empty:
            if self.closed:
                raise EOFError()
            raise socket.timeout()
        if isinstance(value, Exception):
            raise value
        return value

    def close(self):
        self.closed = True


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.environment = patch.dict(os.environ, {'SPEECH_STREAM_API_KEY': 'server-only-test-key',
            'SPEECH_STREAM_ENABLED': '1', 'SPEECH_STREAM_RESOURCE_ID': 'volc.seedasr.sauc.duration'})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.gateway = Gateway(self.tmp.name + '/gateway.sqlite')
        self.gateway.add_user('stream@example.test', 'long-test-password', 'zhiyun-subtitles', 1000, 90)
        self.gateway.speech_streams.connector = FakeSocket
        self.headers = {'X-App-Id': 'zhiyun-subtitles'}
        token = self.gateway.handle('POST', '/v1/auth/login', self.headers,
            {'email': 'stream@example.test', 'password': 'long-test-password'}, 'test')[2]['token']
        self.headers['Authorization'] = 'Bearer ' + token
        self.ids = []
        self.addCleanup(self.close_sessions)

    def close_sessions(self):
        for key in self.ids:
            session = self.gateway.speech_streams.sessions.get(key)
            if session and session['state'] not in ('complete', 'error', 'cancelled'):
                self.gateway.speech_streams.handle(1, 'zhiyun-subtitles', 'cancel', {'id': key}, {})

    def call(self, action, body, headers=None):
        return self.gateway.handle('POST', '/v1/speech/stream/' + action,
                                  headers or self.headers, body, 'test')[2]

    def create(self):
        key = str(uuid.uuid4())
        self.ids.append(key)
        result = self.call('create', {'request_id': key})
        self.assertEqual(result['state'], 'listening')
        return key

    def push(self, key, sequence=0, seconds=.2):
        pcm = b'\x00\x01' * int(seconds * 16000)
        return self.call('push', {'id': key, 'sequence': sequence, 'audio': base64.b64encode(pcm).decode()})

    def wait_for(self, key, field, expected):
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            result = self.call('poll', {'id': key})
            if result.get(field) == expected:
                return result
            time.sleep(.005)
        self.fail('stream snapshot did not advance: ' + str(result))

    def fails(self, status, fn):
        with self.assertRaises(Fault) as caught:
            fn()
        self.assertEqual(caught.exception.status, status)
        return caught.exception

    def test_protocol_parameters_and_server_only_secret(self):
        key = self.create()
        session = self.gateway.speech_streams.sessions[key]
        upstream = session['socket']
        self.assertEqual(upstream.headers['X-Api-Key'], 'server-only-test-key')
        self.assertEqual(upstream.headers['X-Api-Resource-Id'], 'volc.seedasr.sauc.duration')
        initial = upstream.sent[0]
        size = struct.unpack_from('>I', initial, 4)[0]
        body = json.loads(gzip.decompress(initial[8:8 + size]))
        self.assertEqual(body['audio'], {'format': 'pcm', 'codec': 'raw', 'rate': 16000, 'bits': 16, 'channel': 1})
        self.assertTrue(body['request']['enable_nonstream'])
        self.assertTrue(body['request']['show_utterances'])
        self.assertNotIn('server-only-test-key', json.dumps(self.call('poll', {'id': key})))

    def test_create_retries_are_idempotent_and_cancel_is_tombstone(self):
        key = self.create()
        socket_object = self.gateway.speech_streams.sessions[key]['socket']
        again = self.call('create', {'request_id': key})
        self.assertEqual(again['id'], key)
        self.assertIs(socket_object, self.gateway.speech_streams.sessions[key]['socket'])
        self.call('cancel', {'id': key})
        self.assertTrue(socket_object.closed)
        self.assertEqual(self.call('create', {'request_id': key})['state'], 'cancelled')
        self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['requests'], 1)

    def test_cancel_before_delayed_create_prevents_paid_connection(self):
        key = str(uuid.uuid4())
        self.assertEqual(self.call('cancel', {'id': key})['state'], 'cancelled')
        self.fails(409, lambda: self.call('create', {'request_id': key.upper()}))
        self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['requests'], 0)
        self.assertEqual(self.gateway.speech_streams.sessions, {})

    def test_concurrent_create_is_one_upstream_and_one_call(self):
        key = str(uuid.uuid4())
        self.ids.append(key)
        with concurrent.futures.ThreadPoolExecutor(6) as pool:
            values = list(pool.map(lambda _: self.call('create', {'request_id': key}), range(6)))
        self.assertTrue(all(v['state'] == 'listening' for v in values))
        self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['requests'], 1)

    def test_incremental_partial_and_definite_words_are_preserved(self):
        key = self.create()
        upstream = self.gateway.speech_streams.sessions[key]['socket']
        partial = {'text': '电荷信号', 'utterances': [{'text': '电荷信号', 'definite': False,
                    'start_time': 200, 'end_time': 800}]}
        upstream.responses.put(response_packet({'result': partial}))
        self.wait_for(key, 'revision', 1)
        self.assertEqual(self.call('poll', {'id': key})['result'], partial)
        stable = {'text': '电荷信号再根据后面', 'utterances': [{'text': '电荷信号再根据后面', 'definite': True,
            'start_time': 200, 'end_time': 1800, 'words': [{'text': '电荷', 'start_time': 200, 'end_time': 520}]}]}
        upstream.responses.put(response_packet({'result': stable}))
        self.wait_for(key, 'revision', 2)
        self.assertEqual(self.call('poll', {'id': key})['result'], stable)

    def test_same_sequence_retry_does_not_duplicate_audio_or_billing(self):
        key = self.create()
        self.push(key)
        self.push(key)
        upstream = self.gateway.speech_streams.sessions[key]['socket']
        self.assertEqual(len(upstream.sent), 2)
        self.assertAlmostEqual(self.gateway.usage(1, 'zhiyun-subtitles')['audio_seconds'], .2)
        self.fails(409, lambda: self.call('push', {'id': key, 'sequence': 0,
            'audio': base64.b64encode(b'\x00\x00' * 3200).decode()}))

    def test_finish_is_idempotent_and_final_closes_socket(self):
        key = self.create()
        self.push(key)
        upstream = self.gateway.speech_streams.sessions[key]['socket']
        self.assertEqual(self.call('finish', {'id': key})['state'], 'finishing')
        self.call('finish', {'id': key})
        self.assertEqual(len(upstream.sent), 3)
        self.assertEqual(upstream.sent[-1][1], 0x22)
        upstream.responses.put(response_packet({'result': {'text': 'final', 'utterances': []}}, last=True))
        self.wait_for(key, 'state', 'complete')
        self.assertTrue(upstream.closed)
        with self.gateway.db() as db:
            row = db.execute('SELECT state,seconds FROM calls').fetchone()
        self.assertEqual(row['state'], 'complete')
        self.assertAlmostEqual(row['seconds'], .2)

    def test_cancel_releases_connection_and_preserves_actual_usage(self):
        key = self.create()
        self.push(key, seconds=.4)
        upstream = self.gateway.speech_streams.sessions[key]['socket']
        result = self.call('cancel', {'id': key})
        self.assertEqual(result['state'], 'cancelled')
        self.assertTrue(upstream.closed)
        self.assertEqual(self.call('cancel', {'id': key})['state'], 'cancelled')
        usage = self.gateway.usage(1, 'zhiyun-subtitles')
        self.assertAlmostEqual(usage['audio_seconds'], .4)
        self.assertEqual(usage['uncertain'], 1)
        new_key = self.create()
        self.assertNotEqual(key, new_key)

    def test_speech_permission_and_login_are_required(self):
        self.fails(401, lambda: self.call('create', {'request_id': str(uuid.uuid4())}, {'X-App-Id': 'zhiyun-subtitles'}))
        with self.gateway.db() as db:
            db.execute('UPDATE grants SET speech=0')
        self.fails(403, lambda: self.create())
        self.assertEqual(self.gateway.speech_streams.sessions, {})

    def test_sessions_are_isolated_by_account_and_app(self):
        key = self.create()
        self.fails(404, lambda: self.gateway.speech_streams.handle(2, 'zhiyun-subtitles', 'poll', {'id': key}, {}))
        self.fails(404, lambda: self.gateway.speech_streams.handle(1, 'other-app', 'cancel', {'id': key}, {}))
        self.fails(404, lambda: self.gateway.speech_streams.handle(2, 'other-app', 'create', {'request_id': key}, {}))
        self.assertFalse(self.gateway.speech_streams.sessions[key]['socket'].closed)

    def test_only_one_active_stream_per_user(self):
        self.create()
        self.fails(429, lambda: self.create())
        self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['requests'], 1)

    def test_unknown_interruption_does_not_reset_quota_or_replay(self):
        self.gateway.add_user('stream@example.test', 'long-test-password', 'zhiyun-subtitles', 1000, 1)
        key = self.create()
        self.push(key, seconds=.8)
        upstream = self.gateway.speech_streams.sessions[key]['socket']
        upstream.responses.put(EOFError('upstream disconnected'))
        self.wait_for(key, 'state', 'error')
        new_key = self.create()
        result = self.push(new_key, seconds=.4)
        self.assertEqual(result['state'], 'error')
        self.assertEqual(result['error_code'], 'quota_exhausted')
        self.assertAlmostEqual(self.gateway.usage(1, 'zhiyun-subtitles')['audio_seconds'], .8)
        self.assertEqual(len(self.gateway.speech_streams.sessions[new_key]['socket'].sent), 1)

    def test_create_with_less_than_thirty_seconds_remaining(self):
        self.gateway.add_user('stream@example.test', 'long-test-password', 'zhiyun-subtitles', 1000, 1)
        key = self.create()
        self.assertEqual(self.push(key, seconds=.4)['state'], 'listening')

    def test_restart_receipt_does_not_start_another_paid_call(self):
        key = self.create()
        self.push(key)
        self.call('cancel', {'id': key})
        restarted = SpeechStreams(self.gateway, FakeSocket)
        self.fails(409, lambda: restarted.handle(1, 'zhiyun-subtitles', 'create', {'request_id': key}, {}))
        self.assertEqual(restarted.handle(1, 'zhiyun-subtitles', 'cancel', {'id': key}, {})[2]['state'], 'cancelled')
        self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['requests'], 1)

    def test_push_limit_order_and_duration(self):
        key = self.create()
        self.fails(409, lambda: self.push(key, 1))
        for sequence in range(30):
            self.push(key, sequence, seconds=1)
        self.fails(400, lambda: self.push(key, 30))
        for audio in ('@@', base64.b64encode(b'x').decode(), base64.b64encode(b'x' * 32002).decode()):
            self.fails(400, lambda: self.call('push', {'id': key, 'sequence': 30, 'audio': audio}))
        self.assertAlmostEqual(self.gateway.usage(1, 'zhiyun-subtitles')['audio_seconds'], 30)

    def test_poll_and_push_use_bounded_independent_rates(self):
        key = self.create()
        for _ in range(100):
            self.call('poll', {'id': key})
        for sequence in range(100):
            self.push(key, sequence, seconds=.01)
        self.assertAlmostEqual(self.gateway.usage(1, 'zhiyun-subtitles')['audio_seconds'], 1)
        self.assertEqual(self.call('poll', {'id': key})['state'], 'listening')

    def test_invalid_configuration_is_not_advertised(self):
        self.assertTrue(self.gateway.capabilities()['speech_stream'])
        for name, value in [('SPEECH_STREAM_RESOURCE_ID', 'untrusted-url'), ('SPEECH_STREAM_API_KEY', 'bad\r\nheader'), ('SPEECH_STREAM_ENABLED', '0')]:
            with patch.dict(os.environ, {name: value}):
                self.assertFalse(self.gateway.capabilities()['speech_stream'])
                self.fails(503, lambda: self.create())

    def test_connect_error_is_sanitized_and_does_not_retry(self):
        self.gateway.speech_streams.connector = lambda headers: (_ for _ in ()).throw(ValueError('server-only-test-key'))
        key = str(uuid.uuid4())
        result = self.call('create', {'request_id': key})
        self.assertEqual(result['state'], 'error')
        self.assertEqual(result['error_code'], 'speech_stream_protocol_error')
        self.assertNotIn('server-only-test-key', json.dumps(result))
        self.assertTrue(self.gateway.capabilities()['speech_stream'])
        with self.assertRaises(Fault) as cooling:
            self.call('create', {'request_id': str(uuid.uuid4())})
        self.assertEqual(cooling.exception.code, 'speech_stream_cooling_down')
        self.assertGreater(cooling.exception.retry_after, 0)
        self.assertNotIn('未配置', cooling.exception.message)
        self.assertEqual(self.call('create', {'request_id': key})['state'], 'error')
        self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['requests'], 1)

    def test_connection_failures_keep_capability_and_report_safe_reason(self):
        for error, code in [(TimeoutError('private'), 'speech_stream_connect_timeout'),
                            (socket.gaierror('private'), 'speech_stream_network_error'),
                            (ssl.SSLError('private'), 'speech_stream_tls_error')]:
            with self.subTest(code=code):
                self.gateway.speech_streams.unavailable_until = 0
                self.gateway.speech_streams.connector = lambda headers, error=error: (_ for _ in ()).throw(error)
                result = self.call('create', {'request_id': str(uuid.uuid4())})
                self.assertEqual(result['error_code'], code)
                self.assertNotIn('private', json.dumps(result))
                self.assertTrue(self.gateway.capabilities()['speech_stream'])

    def test_drain_rejects_new_stream_and_waits_for_existing(self):
        key = self.create()
        self.gateway.begin_drain()
        self.fails(503, lambda: self.create())
        self.assertFalse(self.gateway.wait_for_drain(.02))
        self.call('cancel', {'id': key})
        self.assertTrue(self.gateway.wait_for_drain(.1))

    def test_expired_session_releases_upstream_without_client_poll(self):
        key = self.create()
        session = self.gateway.speech_streams.sessions[key]
        session['created'] = time.monotonic() - 46
        result = self.wait_for(key, 'state', 'error')
        self.assertEqual(result['error_code'], 'speech_stream_timeout')
        self.assertTrue(session['socket'].closed)



    def test_expired_feature_blocks_new_audio_but_allows_owner_poll_finish_and_cancel(self):
        key = self.create()
        self.push(key, seconds=.2)
        upstream = self.gateway.speech_streams.sessions[key]['socket']
        with self.gateway.db() as db:
            db.execute('UPDATE grants SET expires=? WHERE user=? AND app=?',
                       (int(time.time()) - 1, 1, 'zhiyun-subtitles'))
        self.assertEqual(self.call('poll', {'id': key})['state'], 'listening')
        self.assertEqual(self.fails(403, lambda: self.push(key, 1)).code, 'payment_required')
        self.assertEqual(self.fails(403, lambda: self.call('create',
            {'request_id': str(uuid.uuid4())})).code, 'payment_required')
        self.assertEqual(self.call('finish', {'id': key})['state'], 'finishing')
        self.assertEqual(self.call('finish', {'id': key})['state'], 'finishing')
        self.assertEqual(len(upstream.sent), 3)  # Init, accepted audio, one finish.
        self.assertEqual(self.call('cancel', {'id': key})['state'], 'cancelled')
        self.assertEqual(self.call('cancel', {'id': key})['state'], 'cancelled')
        self.assertEqual(self.call('poll', {'id': key})['state'], 'cancelled')
        self.assertTrue(upstream.closed)
        self.assertEqual(len(self.gateway.speech_streams.sessions), 1)
        usage = self.gateway.usage(1, 'zhiyun-subtitles')
        self.assertEqual(usage['requests'], 1)
        self.assertAlmostEqual(usage['audio_seconds'], .2)

    def test_control_rate_limit_bounds_unknown_cancel_receipts_with_one_owner_key(self):
        fixed_now = time.time()
        with patch('backend.server.time.time', return_value=fixed_now):
            for _ in range(120):
                self.assertEqual(self.call('cancel', {'id': str(uuid.uuid4())})['state'], 'cancelled')
            with self.gateway.db() as db:
                before = db.execute('SELECT COUNT(*) FROM speech_stream_receipts').fetchone()[0]
            self.assertEqual(before, 120)
            blocked = str(uuid.uuid4())
            self.assertEqual(self.fails(429, lambda: self.call('cancel', {'id': blocked})).code, 'rate_limit')
            self.assertEqual(self.fails(429, lambda: self.call('finish', {'id': blocked})).code, 'rate_limit')
            with self.gateway.db() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM speech_stream_receipts').fetchone()[0], before)
                rows = db.execute("SELECT key,count FROM attempts WHERE key LIKE 'speech-stream-control:%'").fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['key'], 'speech-stream-control:1:zhiyun-subtitles')
            self.assertEqual(rows[0]['count'], 122)
            self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['requests'], 0)

    def test_terminal_snapshot_and_active_wait_for_accounting_without_nested_lock_deadlock(self):
        key = self.create()
        streams = self.gateway.speech_streams
        session = streams.sessions[key]
        original_account = streams._account
        accounting, release, nested = threading.Event(), threading.Event(), threading.Event()
        def account(*args, **kwargs):
            accounting.set()
            if not release.wait(3):
                raise TimeoutError('test accounting was not released')
            return original_account(*args, **kwargs)
        def nested_snapshot():
            with session['lock']:
                nested.set()
                return streams._snapshot(session)
        with patch.object(streams, '_account', side_effect=account):
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                ending = pool.submit(streams._end, session, 'cancelled')
                try:
                    self.assertTrue(accounting.wait(1))
                    self.assertTrue(session['socket'].closed)
                    self.assertTrue(streams.active())
                    self.assertFalse(self.gateway.wait_for_drain(.01))
                    snapshot = pool.submit(nested_snapshot)
                    self.assertTrue(nested.wait(1))
                    with self.assertRaises(concurrent.futures.TimeoutError):
                        snapshot.result(.05)
                finally:
                    release.set()
                ending.result(.5)
                self.assertEqual(snapshot.result(.5)['state'], 'cancelled')
        self.assertTrue(session['ended'].is_set())
        self.assertFalse(streams.active())
        self.assertTrue(self.gateway.wait_for_drain(.1))

    def test_accounting_error_always_releases_terminal_event_and_notifies_drain(self):
        key = self.create()
        streams = self.gateway.speech_streams
        session = streams.sessions[key]
        with patch.object(streams, '_account', side_effect=Fault(503, 'test accounting failure')):
            with patch.object(self.gateway.lifecycle, 'notify_all',
                              wraps=self.gateway.lifecycle.notify_all) as notified:
                with self.assertRaises(Fault):
                    streams._end(session, 'cancelled')
                notified.assert_called_once()
        self.assertTrue(session['socket'].closed)
        self.assertTrue(session['ended'].is_set())
        self.assertFalse(streams.active())
        self.assertEqual(streams._snapshot(session)['state'], 'cancelled')

    def add_second_owner(self):
        self.gateway.add_user('second-stream@example.test', 'long-test-password',
                              'zhiyun-subtitles', 1000, 90)
        with self.gateway.db() as db:
            return db.execute("SELECT id FROM users WHERE email='second-stream@example.test'").fetchone()[0]

    def test_slow_connector_does_not_block_other_owner_poll_or_cancel(self):
        first = self.create()
        second_user = self.add_second_owner()
        entered, release = threading.Event(), threading.Event()
        sockets = []
        def connector(headers):
            entered.set()
            if not release.wait(3):
                raise TimeoutError('test connector was not released')
            upstream = FakeSocket(headers)
            sockets.append(upstream)
            return upstream
        self.gateway.speech_streams.connector = connector
        second = str(uuid.uuid4())
        streams = self.gateway.speech_streams
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            opening = pool.submit(streams.handle, second_user, 'zhiyun-subtitles',
                                  'create', {'request_id': second}, {})
            try:
                self.assertTrue(entered.wait(1))
                poll = pool.submit(self.call, 'poll', {'id': first})
                self.assertEqual(poll.result(.5)['state'], 'listening')
                cancel = pool.submit(self.call, 'cancel', {'id': first})
                self.assertEqual(cancel.result(.5)['state'], 'cancelled')
                self.assertFalse(release.is_set())
                # The pending connector already reserves its owner's slot.
                self.fails(429, lambda: streams.handle(second_user, 'zhiyun-subtitles',
                           'create', {'request_id': str(uuid.uuid4())}, {}))
            finally:
                release.set()
            self.assertEqual(opening.result(2)[2]['state'], 'listening')
        streams.handle(second_user, 'zhiyun-subtitles', 'cancel', {'id': second}, {})
        self.assertTrue(sockets[0].closed)
        self.assertEqual(self.gateway.usage(second_user, 'zhiyun-subtitles')['requests'], 1)

    def test_cancel_during_connector_tombstones_original_and_duplicate_create(self):
        entered, release = threading.Event(), threading.Event()
        sockets = []
        def connector(headers):
            entered.set()
            if not release.wait(3):
                raise TimeoutError('test connector was not released')
            upstream = FakeSocket(headers)
            sockets.append(upstream)
            return upstream
        self.gateway.speech_streams.connector = connector
        key = str(uuid.uuid4())
        self.ids.append(key)
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            opening = pool.submit(self.call, 'create', {'request_id': key})
            try:
                self.assertTrue(entered.wait(1))
                duplicate = pool.submit(self.call, 'create', {'request_id': key})
                cancel = pool.submit(self.call, 'cancel', {'id': key})
                self.assertEqual(cancel.result(.5)['state'], 'cancelled')
                self.assertEqual(duplicate.result(.5)['state'], 'cancelled')
                self.assertFalse(release.is_set())
            finally:
                release.set()
            self.assertEqual(opening.result(2)['state'], 'cancelled')
        self.assertEqual(len(sockets), 1)
        self.assertTrue(sockets[0].closed)
        self.assertEqual(sockets[0].sent, [])  # No request after cancellation.
        self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['requests'], 1)
        self.assertEqual(self.gateway.usage(1, 'zhiyun-subtitles')['audio_seconds'], 0)

    def test_slow_push_does_not_block_other_owner_poll_or_cancel(self):
        first = self.create()
        second_user = self.add_second_owner()
        second = str(uuid.uuid4())
        streams = self.gateway.speech_streams
        streams.handle(second_user, 'zhiyun-subtitles', 'create', {'request_id': second}, {})
        upstream = streams.sessions[first]['socket']
        original_send = upstream.send
        entered, release = threading.Event(), threading.Event()
        def slow_send(raw):
            entered.set()
            if not release.wait(3):
                raise TimeoutError('test send was not released')
            original_send(raw)
        upstream.send = slow_send
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            pushing = pool.submit(self.push, first)
            try:
                self.assertTrue(entered.wait(1))
                poll = pool.submit(streams.handle, second_user, 'zhiyun-subtitles',
                                   'poll', {'id': second}, {})
                self.assertEqual(poll.result(.5)[2]['state'], 'listening')
                cancel = pool.submit(streams.handle, second_user, 'zhiyun-subtitles',
                                     'cancel', {'id': second}, {})
                self.assertEqual(cancel.result(.5)[2]['state'], 'cancelled')
                self.assertFalse(release.is_set())
            finally:
                release.set()
            self.assertEqual(pushing.result(2)['state'], 'listening')
        self.assertAlmostEqual(self.gateway.usage(1, 'zhiyun-subtitles')['audio_seconds'], .2)

    def test_same_session_cancel_interrupts_blocked_push_and_retry_is_not_rebilled(self):
        key = self.create()
        upstream = self.gateway.speech_streams.sessions[key]['socket']
        original_send, original_close = upstream.send, upstream.close
        entered, shut_down = threading.Event(), threading.Event()
        attempts = []
        def blocked_send(raw):
            attempts.append(raw)
            entered.set()
            if not shut_down.wait(3):
                raise TimeoutError('test close did not interrupt send')
            raise EOFError('socket was shut down')
        def close():
            original_close()
            shut_down.set()
        upstream.send, upstream.close = blocked_send, close
        with concurrent.futures.ThreadPoolExecutor(3) as pool:
            pushing = pool.submit(self.push, key)
            try:
                self.assertTrue(entered.wait(1))
                # An identical retry can acknowledge acceptance while the
                # original network write is pending, without duplicate bytes.
                retry = pool.submit(self.push, key)
                self.assertEqual(retry.result(.5)['state'], 'listening')
                cancel = pool.submit(self.call, 'cancel', {'id': key})
                self.assertEqual(cancel.result(.5)['state'], 'cancelled')
                self.assertEqual(pushing.result(.5)['state'], 'cancelled')
            finally:
                shut_down.set()
        self.assertEqual(len(attempts), 1)
        self.assertEqual(len(upstream.sent), 1)  # Initial request only.
        self.assertTrue(upstream.closed)
        usage = self.gateway.usage(1, 'zhiyun-subtitles')
        self.assertEqual(usage['requests'], 1)
        self.assertAlmostEqual(usage['audio_seconds'], .2)


class ProtocolTests(unittest.TestCase):
    def test_client_packets_have_official_headers_and_gzip(self):
        packet = client_packet({'audio': {'format': 'pcm'}})
        self.assertEqual(packet[:4], b'\x11\x10\x11\x00')
        self.assertEqual(json.loads(gzip.decompress(packet[8:])), {'audio': {'format': 'pcm'}})
        self.assertEqual(gzip.decompress(client_packet(b'abc', audio=True)[8:]), b'abc')
        self.assertEqual(client_packet(b'', audio=True, last=True)[1], 0x22)

    def test_provider_final_flags_with_and_without_sequence(self):
        payload = {'result': {'text': '你好'}}
        for sequence in (True, False):
            for compressed in (True, False):
                decoded, last = decode_packet(response_packet(payload, last=True, sequence=sequence, compressed=compressed))
                self.assertTrue(last)
                self.assertEqual(decoded, payload)
        self.assertFalse(decode_packet(response_packet(payload))[1])

    def test_invalid_frames_and_bounded_decompression(self):
        for raw in (b'', b'\x11\x91\x11\x00', b'\x01' * 8,
                    response_packet({'result': {}})[:-1], response_packet({'result': {}}) + b'extra',
                    response_packet({'x': 'x' * (MAX_MESSAGE + 1)})):
            with self.assertRaises((ValueError, EOFError)):
                decode_packet(raw)
        error = b'\x11\xf0\x10\x00' + struct.pack('>II', 45000000, 4) + b'key!'
        with self.assertRaises(Fault) as caught:
            decode_packet(error)
        self.assertNotIn('key!', caught.exception.message)

    def test_websocket_masks_client_frames_and_resumes_partial_frames(self):
        class RawSocket:
            def __init__(self):
                self.sent = []
                self.parts = queue.Queue()
            def send(self, value):
                self.sent.append(bytes(value))
                return len(value)
            def recv(self, limit):
                value = self.parts.get_nowait()
                if isinstance(value, Exception):
                    raise value
                return value
        ws = OfficialWebSocket.__new__(OfficialWebSocket)
        ws.socket, ws.buffer, ws.closed = RawSocket(), bytearray(), False
        ws.send_lock, ws.tls_lock, ws.fragments, ws.fragmented = threading.Lock(), threading.Lock(), bytearray(), False
        ws.send(b'hello')
        sent = ws.socket.sent[0]
        self.assertEqual(sent[:2], b'\x82\x85')
        self.assertEqual(bytes(v ^ sent[2 + i % 4] for i, v in enumerate(sent[6:])), b'hello')
        ws.socket.parts.put(b'\x82\x05he')
        ws.socket.parts.put(socket.timeout())
        with self.assertRaises(socket.timeout):
            ws.recv()
        ws.socket.parts.put(b'llo')
        self.assertEqual(ws.recv(), b'hello')
        ws.socket.parts.put(b'\x02\x02ab')
        ws.socket.parts.put(socket.timeout())
        with self.assertRaises(socket.timeout):
            ws.recv()
        ws.socket.parts.put(b'\x80\x02cd')
        self.assertEqual(ws.recv(), b'abcd')



    def test_close_interrupts_nonblocking_write_readiness_wait(self):
        entered, shut_down = threading.Event(), threading.Event()
        class WaitingSocket:
            def send(self, value):
                entered.set()
                raise ssl.SSLWantWriteError()
            def shutdown(self, how): shut_down.set()
            def close(self): shut_down.set()
        ws = OfficialWebSocket.__new__(OfficialWebSocket)
        ws.socket, ws.closed = WaitingSocket(), False
        ws.send_lock, ws.tls_lock = threading.Lock(), threading.Lock()
        with patch('backend.speech_stream.select.select', side_effect=lambda *args:shut_down.wait(.05)):
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                sending = pool.submit(ws.send, b'audio')
                self.assertTrue(entered.wait(1))
                pool.submit(ws.close).result(.5)
                with self.assertRaises(EOFError): sending.result(.5)
        self.assertTrue(ws.closed)


if __name__ == '__main__':
    unittest.main()
