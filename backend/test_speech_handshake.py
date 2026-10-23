"""WebSocket handshake regression from the production duplicate Server-Timing response."""
import base64
import hashlib
import socket
import ssl
import unittest
from unittest.mock import patch
from backend.admin_api import Fault
from backend.speech_stream import OfficialWebSocket

class HandshakeSocket:
    def __init__(self, extra=(), status=101, partial=False, clock=None):
        self.extra, self.status, self.partial, self.clock = extra, status, partial, clock
        self.buffer = b''
        self.closed = False
        self.timeouts = []
    def settimeout(self, value): self.timeouts.append(value)
    def sendall(self, data):
        key = next(line.split(b':', 1)[1].strip() for line in data.split(b'\r\n') if line.lower().startswith(b'sec-websocket-key:'))
        accept = base64.b64encode(hashlib.sha1(key + b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest()).decode()
        headers = [('Upgrade', 'websocket'), ('Connection', 'Upgrade'), ('Sec-WebSocket-Accept', accept)] + list(self.extra)
        self.buffer = ('HTTP/1.1 ' + str(self.status) + ' Response\r\n' + ''.join(k + ': ' + v + '\r\n' for k, v in headers) + '\r\n').encode() + b'\x82\x02ok'
    def recv(self, limit):
        if self.clock: self.clock[0] += 2
        size = 1 if self.partial else limit
        value, self.buffer = self.buffer[:size], self.buffer[size:]
        return value
    def close(self): self.closed = True
    def shutdown(self, how): pass

class HandshakeTests(unittest.TestCase):
    def open(self, raw):
        context = type('Context', (), {'wrap_socket': lambda self, connection, server_hostname: connection})()
        with patch('backend.speech_stream.socket.create_connection', return_value=raw), patch('backend.speech_stream.ssl.create_default_context', return_value=context):
            return OfficialWebSocket({'X-Api-Key':'synthetic-test-key'})
    def test_duplicate_server_timing_is_metadata_not_a_failed_upgrade(self):
        raw = HandshakeSocket([('Server-Timing', 'edge;dur=1'), ('server-timing', 'origin;dur=2')])
        ws = self.open(raw)
        self.assertEqual(ws.recv(), b'ok')
        ws.close()
        self.assertTrue(raw.closed)
    def test_connection_list_can_be_split_across_headers(self):
        ws = self.open(HandshakeSocket([('Connection', 'keep-alive')]))
        self.assertEqual(ws.recv(), b'ok')
        ws.close()
    def test_duplicate_accept_and_unsolicited_extensions_are_rejected(self):
        for extra in [[('Sec-WebSocket-Accept', 'bad')], [('Sec-WebSocket-Extensions', 'permessage-deflate')], [('Sec-WebSocket-Protocol', 'unexpected')]]:
            with self.subTest(extra=extra):
                raw = HandshakeSocket(extra)
                with self.assertRaises((Fault, ValueError)): self.open(raw)
                self.assertTrue(raw.closed)
    def test_http_auth_busy_and_upstream_failures_have_distinct_safe_codes(self):
        for status, code in [(401,'speech_stream_auth_failed'),(403,'speech_stream_auth_failed'),(429,'speech_stream_busy'),(502,'speech_stream_upstream_unavailable'),(503,'speech_stream_upstream_unavailable')]:
            with self.subTest(status=status):
                raw = HandshakeSocket(status=status)
                with self.assertRaises(Fault) as caught: self.open(raw)
                self.assertEqual(caught.exception.code, code)
                self.assertNotIn('synthetic-test-key', caught.exception.message)
                self.assertTrue(raw.closed)
    def test_slow_partial_handshake_has_a_total_deadline(self):
        clock = [100.0]
        raw = HandshakeSocket(partial=True, clock=clock)
        with patch('backend.speech_stream.time.monotonic', side_effect=lambda:clock[0]):
            with self.assertRaises(TimeoutError): self.open(raw)
        self.assertLessEqual(clock[0], 110)
        self.assertTrue(raw.closed)

if __name__ == '__main__': unittest.main()
