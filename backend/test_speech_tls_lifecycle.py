"""Regression: an SSL connection and its fd cannot outlive a concurrent close."""
import concurrent.futures
import socket
import ssl
import threading
import time
import unittest
from unittest.mock import patch
from backend.speech_stream import OfficialWebSocket


def client(raw):
    ws = OfficialWebSocket.__new__(OfficialWebSocket)
    ws.socket, ws.closed = raw, False
    ws.tls_lock, ws.send_lock = threading.Lock(), threading.Lock()
    ws.buffer, ws.fragments, ws.fragmented = bytearray(), bytearray(), False
    return ws


class TLSLifecycleTests(unittest.TestCase):
    def test_close_waits_until_ssl_read_releases_its_file_descriptor(self):
        entered, release = threading.Event(), threading.Event()
        class Raw:
            closed = False
            late_write = False
            closes = 0
            def recv(self, size):
                entered.set()
                if not release.wait(2): raise TimeoutError()
                # SSL_read may itself write TLS alerts/control records. Closing
                # here could target a freshly reused SQLite fd in the real BIO.
                self.late_write = self.closed
                return b'\x82\x00'
            def shutdown(self, how): self.closed = True
            def close(self): self.closed = True; self.closes += 1
        raw = Raw();ws = client(raw)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            reading = pool.submit(ws.recv)
            self.assertTrue(entered.wait(1))
            closing = pool.submit(ws.close)
            try:
                time.sleep(.03)
                self.assertFalse(raw.closed, 'fd released while an SSL operation still owns it')
            finally: release.set()
            self.assertEqual(reading.result(1), b'')
            closing.result(1)
        ws.close();self.assertEqual(raw.closes,1);self.assertFalse(raw.late_write)
        with self.assertRaises(EOFError): ws.recv()
        with self.assertRaises(EOFError): ws.send(b'late')

    def test_ssl_read_write_calls_never_overlap_but_readiness_wait_does_not_block_send(self):
        waiting, wrote = threading.Event(), threading.Event()
        class Raw:
            active = 0
            overlaps = 0
            def recv(self, size):
                self.active += 1
                try:
                    self.overlaps += self.active > 1
                    if not wrote.is_set(): raise ssl.SSLWantReadError()
                    return b'\x82\x00'
                finally: self.active -= 1
            def send(self, data):
                self.active += 1
                try: self.overlaps += self.active > 1; wrote.set(); return len(data)
                finally: self.active -= 1
        raw=Raw();ws=client(raw)
        def ready(*args): waiting.set();wrote.wait(.05)
        with patch('backend.speech_stream.select.select', side_effect=ready):
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                reading=pool.submit(ws.recv);self.assertTrue(waiting.wait(1))
                pool.submit(ws.send,b'audio').result(.5);self.assertEqual(reading.result(.5),b'')
        self.assertEqual(raw.overlaps,0)

    def test_partial_ssl_writes_preserve_the_masked_frame(self):
        class Raw:
            data=bytearray()
            def send(self,value):
                part=bytes(value[:3]);self.data.extend(part);return len(part)
        raw=Raw();ws=client(raw);ws.send(b'abcdef')
        frame=bytes(raw.data);self.assertEqual(frame[:2],b'\x82\x86')
        self.assertEqual(bytes(x^frame[2+i%4] for i,x in enumerate(frame[6:])),b'abcdef')

    def test_ssl_readiness_timeout_is_bounded(self):
        class Raw:
            def recv(self,size):raise ssl.SSLWantReadError()
        clock=[0.0];ws=client(Raw())
        def ready(*args):clock[0]+=.05
        with patch('backend.speech_stream.time.monotonic',side_effect=lambda:clock[0]),patch('backend.speech_stream.select.select',side_effect=ready):
            with self.assertRaises(socket.timeout):ws.recv()
        self.assertLessEqual(clock[0],1.1)

    def test_cancelled_read_cannot_enter_reused_socket_after_select_returns(self):
        ready,closed=threading.Event(),threading.Event()
        class Raw:
            reads=0
            def recv(self,size):self.reads+=1;raise ssl.SSLWantReadError()
            def shutdown(self,how):closed.set()
            def close(self):closed.set()
        raw=Raw();ws=client(raw)
        def wait(*args):ready.set();closed.wait(.5)
        with patch('backend.speech_stream.select.select',side_effect=wait):
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                reading=pool.submit(ws.recv);self.assertTrue(ready.wait(1));ws.close()
                with self.assertRaises(EOFError):reading.result(.5)
        self.assertEqual(raw.reads,1)

if __name__=='__main__':unittest.main()
