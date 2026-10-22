"""Bounded server-side Doubao streaming ASR; no browser-held supplier credentials.

The HTTPS bridge accepts raw 16 kHz mono signed little-endian PCM.  Only the
fixed official TLS WebSocket endpoint is reachable, using Python's stdlib.
"""
import base64
import copy
import gzip
import hashlib
import hmac
import io
import json
import os
import secrets
import socket
import ssl
import struct
import threading
import time
import uuid

try:
    from .admin_api import Fault
except ImportError:
    from admin_api import Fault

HOST = 'openspeech.bytedance.com'
PATH = '/api/v3/sauc/bigmodel_async'
RESOURCE_IDS = frozenset(('volc.seedasr.sauc.duration', 'volc.seedasr.sauc.concurrent',
                          'volc.bigasr.sauc.duration', 'volc.bigasr.sauc.concurrent'))
MAX_MESSAGE = 1000000
MAX_SECONDS = 30
BYTES_PER_SECOND = 32000
TERMINAL = frozenset(('complete', 'cancelled', 'error'))


def configuration():
    key = os.environ.get('SPEECH_STREAM_API_KEY') or os.environ.get('SPEECH_API_KEY', '')
    resource = os.environ.get('SPEECH_STREAM_RESOURCE_ID', 'volc.seedasr.sauc.duration')
    valid = bool(key and len(key) <= 2048 and not any(ord(c) < 33 or ord(c) > 126 for c in key))
    return (key, resource) if valid and resource in RESOURCE_IDS and os.environ.get('SPEECH_STREAM_ENABLED', '1') == '1' else ('', resource)


def client_packet(payload, audio=False, last=False):
    if not audio:
        payload = json.dumps(payload, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    payload = gzip.compress(payload)
    return bytes((0x11, (0x20 if audio else 0x10) | (2 if last else 0), 0x01 if audio else 0x11, 0)) + struct.pack('>I', len(payload)) + payload


def decode_packet(raw):
    if len(raw) < 8 or raw[0] >> 4 != 1:
        raise ValueError('invalid speech header')
    offset = (raw[0] & 15) * 4
    kind, flags = raw[1] >> 4, raw[1] & 15
    serialization, compression = raw[2] >> 4, raw[2] & 15
    if offset < 4 or offset + 4 > len(raw) or kind not in (9, 15) or flags not in (0, 1, 2, 3):
        raise ValueError('invalid speech message')
    code = 0
    if kind == 15:
        code = struct.unpack_from('>I', raw, offset)[0]
        offset += 4
    elif flags & 1:
        offset += 4
    if offset + 4 > len(raw):
        raise ValueError('missing speech size')
    size = struct.unpack_from('>I', raw, offset)[0]
    offset += 4
    if size > MAX_MESSAGE or len(raw) != offset + size:
        raise ValueError('invalid speech size')
    payload = raw[offset:]
    if compression == 1:
        with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
            payload = stream.read(MAX_MESSAGE + 1)
        if len(payload) > MAX_MESSAGE:
            raise ValueError('speech response too large')
    elif compression != 0:
        raise ValueError('unsupported speech compression')
    if kind == 15:
        # Never forward upstream error bodies, which can include request details.
        raise Fault(502, '流式语音服务返回异常，请检查服务配置或稍后重试。', 'speech_stream_upstream_error')
    if serialization != 1:
        raise ValueError('unsupported speech serialization')
    result = json.loads(payload)
    if not isinstance(result, dict):
        raise ValueError('invalid speech response')
    if result.get('code', 0) not in (0, 20000000):
        raise Fault(502, '流式语音服务未完成识别，请稍后重试。', 'speech_stream_upstream_error')
    return result, bool(flags & 2)


class OfficialWebSocket:
    """Minimal RFC 6455 binary client, restricted to the official ASR origin.

    TLS verifies the certificate/hostname, redirects and extensions are refused,
    every client frame is masked, and all reads/frames have strict upper bounds.
    """
    def __init__(self, headers):
        self.send_lock = threading.Lock()
        self.socket = None
        self.buffer = bytearray()
        self.closed = False
        self.fragments = bytearray()
        self.fragmented = False
        connection = socket.create_connection((HOST, 443), timeout=6)
        try:
            self.socket = ssl.create_default_context().wrap_socket(connection, server_hostname=HOST)
            key = base64.b64encode(secrets.token_bytes(16)).decode('ascii')
            values = {'Host': HOST, 'Upgrade': 'websocket', 'Connection': 'Upgrade',
                      'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13', **headers}
            if any('\r' in str(v) or '\n' in str(v) for v in values.values()):
                raise ValueError('invalid websocket header')
            request = 'GET ' + PATH + ' HTTP/1.1\r\n' + ''.join(str(k) + ': ' + str(v) + '\r\n' for k, v in values.items()) + '\r\n'
            self.socket.sendall(request.encode('ascii'))
            raw = bytearray()
            while b'\r\n\r\n' not in raw:
                part = self.socket.recv(4096)
                if not part or len(raw) + len(part) > 16384:
                    raise ValueError('invalid websocket handshake')
                raw.extend(part)
            head, rest = bytes(raw).split(b'\r\n\r\n', 1)
            lines = head.decode('iso-8859-1').split('\r\n')
            response = {}
            for line in lines[1:]:
                name, value = line.split(':', 1)
                name = name.lower().strip()
                if name in response:
                    raise ValueError('duplicate websocket header')
                response[name] = value.strip()
            expected = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            if (lines[0].split(' ')[1] != '101' or response.get('upgrade', '').lower() != 'websocket'
                    or 'upgrade' not in [v.strip().lower() for v in response.get('connection', '').split(',')]
                    or not hmac.compare_digest(response.get('sec-websocket-accept', ''), expected)
                    or response.get('sec-websocket-extensions') or response.get('sec-websocket-protocol')):
                raise Fault(503, '流式语音连接未获服务授权，请检查服务器语音配置。', 'speech_stream_unavailable')
            self.buffer.extend(rest)
            self.socket.settimeout(1)
        except Exception:
            if self.socket:
                self.socket.close()
            else:
                connection.close()
            raise

    def _read(self, size):
        while len(self.buffer) < size:
            part = self.socket.recv(min(65536, size - len(self.buffer)))
            if not part:
                raise EOFError('websocket closed')
            self.buffer.extend(part)
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    def send(self, payload, opcode=2):
        if len(payload) > MAX_MESSAGE:
            raise ValueError('websocket message too large')
        with self.send_lock:
            if self.closed:
                raise EOFError('websocket closed')
            size = len(payload)
            prefix = bytes((0x80 | opcode, 0x80 | (size if size < 126 else 126 if size < 65536 else 127)))
            if size >= 126:
                prefix += struct.pack('>H' if size < 65536 else '>Q', size)
            mask = secrets.token_bytes(4)
            masked = bytes(value ^ mask[i & 3] for i, value in enumerate(payload))
            self.socket.sendall(prefix + mask + masked)

    def _frame(self):
        # Do not consume any bytes until the complete frame is buffered.  A
        # timeout midway through a header or payload is safe to resume.
        def fill(size):
            while len(self.buffer) < size:
                part = self.socket.recv(min(65536, size - len(self.buffer)))
                if not part:
                    raise EOFError('websocket closed')
                self.buffer.extend(part)
        fill(2)
        first, second = self.buffer[:2]
        fin, opcode = bool(first & 128), first & 15
        if first & 112 or second & 128:
            raise ValueError('invalid websocket frame')
        size, offset = second & 127, 2
        if size == 126:
            fill(4)
            size, offset = struct.unpack_from('>H', self.buffer, 2)[0], 4
        elif size == 127:
            fill(10)
            size, offset = struct.unpack_from('>Q', self.buffer, 2)[0], 10
        if size > MAX_MESSAGE or len(self.fragments) + size > MAX_MESSAGE or (opcode >= 8 and (not fin or size > 125)):
            raise ValueError('invalid websocket frame size')
        fill(offset + size)
        payload = bytes(self.buffer[offset:offset + size])
        del self.buffer[:offset + size]
        return fin, opcode, payload

    def recv(self):
        while True:
            fin, opcode, payload = self._frame()
            if opcode == 8:
                raise EOFError('websocket closed')
            if opcode == 9:
                self.send(payload, 10)
                continue
            if opcode == 10:
                continue
            if opcode == 2 and not self.fragmented:
                self.fragmented = not fin
            elif opcode != 0 or not self.fragmented:
                raise ValueError('unsupported websocket opcode')
            self.fragments.extend(payload)
            if fin:
                result = bytes(self.fragments)
                self.fragments.clear()
                self.fragmented = False
                return result

    def close(self):
        # shutdown interrupts recv immediately, including cancellation during a
        # partial upstream frame; never wait on a remote close handshake.
        self.closed = True
        if self.socket:
            try:
                self.socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.socket.close()


class SpeechStreams:
    def __init__(self, gateway, connector=OfficialWebSocket):
        self.gateway, self.connector = gateway, connector
        # This lock protects the registry / admission only. No supplier socket
        # operation may run under it, or one slow user blocks every session.
        self.lock = threading.RLock()
        self.sessions = {}
        self.unavailable_until = 0
        with gateway.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS speech_stream_receipts(id TEXT PRIMARY KEY,user INTEGER,app TEXT,call TEXT,created INTEGER)')

    def available(self):
        return bool(configuration()[0]) and time.monotonic() >= self.unavailable_until

    def active(self):
        with self.lock:
            return any(not s['ended'].is_set() for s in self.sessions.values())

    def _snapshot(self, session):
        while True:
            with session['lock']:
                if session['state'] not in TERMINAL or session['ended'].is_set():
                    keys = ('id', 'state', 'revision', 'result', 'error', 'error_status', 'error_code')
                    value = {k: copy.deepcopy(session[k]) for k in keys if k in session}
                    return {**value, 'audio_seconds': session['bytes'] / BYTES_PER_SECOND,
                            'max_seconds': MAX_SECONDS, 'chunk_ms': 200}
            # Terminal is visible only after the socket has been shut down and
            # its final accounting transaction has closed. _end sets this event
            # without reacquiring session.lock, including on accounting errors,
            # so a nested snapshot from the duplicate-chunk path cannot deadlock.
            if not session['ended'].wait(12):
                raise Fault(503, '语音会话正在结束，请稍后查询。', 'speech_stream_settling')

    def _account(self, session, state=None, append_bytes=0):
        with self.gateway.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if append_bytes:
                limits = self.gateway.check_grant(db, session['user'], session['app'], 'speech')
                credits = self.gateway.monthly_credits(db, session['user'], session['app'])
                used = db.execute('SELECT COALESCE(SUM(seconds),0) FROM calls WHERE user=? AND app=? AND month=(SELECT month FROM calls WHERE id=?)',
                                  (session['user'], session['app'], session['call'])).fetchone()[0]
                if used + append_bytes / BYTES_PER_SECOND > limits['audio'] + credits['audio'] + 1e-8:
                    raise Fault(429, '本月语音额度已用完。', 'quota_exhausted')
                db.execute('UPDATE calls SET seconds=seconds+? WHERE id=?', (append_bytes / BYTES_PER_SECOND, session['call']))
            if state:
                db.execute('UPDATE calls SET state=?,finished=? WHERE id=?', (state, int(time.time()), session['call']))

    def _end(self, session, state, error=None):
        with session['lock']:
            if session['state'] in TERMINAL:
                return
            session['state'] = state
            session['revision'] += 1
            if error:
                session.update(error=error.message if isinstance(error, Fault) else '流式语音连接已中断，请手动重试。',
                               error_status=error.status if isinstance(error, Fault) else 502,
                               error_code=error.code if isinstance(error, Fault) else 'speech_stream_interrupted')
            upstream = session.get('socket')
            session['ready'].set()
        # Cancellation never waits for io_lock: shutdown must interrupt a
        # concurrent blocked send/recv before doing accounting or notification.
        try:
            if upstream:
                upstream.close()
        finally:
            try:
                self._account(session, 'complete' if state == 'complete' else 'unknown')
            finally:
                # Never take session.lock here: a duplicate push may own it
                # while waiting for the terminal snapshot to finish settling.
                session['ended'].set()
                with self.gateway.lifecycle:
                    self.gateway.lifecycle.notify_all()

    def _reader(self, session):
        try:
            while True:
                with session['lock']:
                    if session['state'] in TERMINAL:
                        return
                    deadline = session.get('finish_deadline', session['created'] + 45)
                    upstream = session['socket']
                if time.monotonic() > deadline:
                    raise Fault(504, '流式语音识别超时；本次不会自动重复提交。', 'speech_stream_timeout')
                try:
                    raw = upstream.recv()
                except socket.timeout:
                    continue
                payload, last = decode_packet(raw)
                with session['lock']:
                    if session['state'] in TERMINAL:
                        return
                    result = payload.get('result')
                    if isinstance(result, dict):
                        # Preserve provider timestamps and definite flags.
                        clean = {k: result[k] for k in ('text', 'utterances') if k in result}
                        if clean != session['result']:
                            session['result'] = clean
                            session['revision'] += 1
                if last:
                    self._end(session, 'complete')
                    return
        except Exception as error:
            self._end(session, 'error', error)

    def _open(self, session):
        upstream = None
        try:
            api_key, resource = configuration()
            upstream = self.connector({'X-Api-Key': api_key, 'X-Api-Resource-Id': resource,
                                       'X-Api-Request-Id': session['id'], 'X-Api-Connect-Id': str(uuid.uuid4()), 'X-Api-Sequence': '-1'})
            with session['lock']:
                cancelled = session['state'] in TERMINAL
                if not cancelled:
                    session['socket'] = upstream
            if cancelled:
                upstream.close()
                return
            with session['io_lock']:
                with session['lock']:
                    cancelled = session['state'] in TERMINAL
                if cancelled:
                    return
                upstream.send(client_packet({'user': {'uid': str(session['user'])},
                    'audio': {'format': 'pcm', 'codec': 'raw', 'rate': 16000, 'bits': 16, 'channel': 1},
                    'request': {'model_name': 'bigmodel', 'enable_itn': True, 'enable_punc': True,
                                'show_utterances': True, 'enable_nonstream': True}}))
            with session['lock']:
                if session['state'] in TERMINAL:
                    return
                session['state'] = 'listening'
            threading.Thread(target=self._reader, args=(session,), daemon=True).start()
        except Exception as error:
            with session['lock']:
                failed = session['state'] not in TERMINAL
            if failed:
                self.unavailable_until = time.monotonic() + 30
                self._end(session, 'error', error if isinstance(error, Fault) else Fault(503, '流式语音连接未完成，请检查服务器服务配置。', 'speech_stream_unavailable'))
        finally:
            session['ready'].set()

    def handle(self, user, app, action, body, headers):
        if action not in ('create', 'push', 'poll', 'finish', 'cancel'):
            raise Fault(404, '接口不存在')
        key = body.get('request_id', headers.get('X-Api-Request-Id', '')) if action == 'create' else body.get('id', '')
        try:
            if not isinstance(key, str):
                raise ValueError()
            key = str(uuid.UUID(key))
        except (ValueError, AttributeError):
            raise Fault(400, '流式语音会话 ID 无效。') from None
        # Control actions may create durable cancellation receipts. Use one
        # fixed owner/app bucket before registry access, rather than one new
        # rate-limit row per attacker-supplied UUID.
        if action in ('cancel', 'finish'):
            self.gateway.throttle('speech-stream-control:' + str(user) + ':' + app, 120)
        opening = False
        with self.lock:
            now = time.monotonic()
            for old_key, old in list(self.sessions.items()):
                if old['ended'].is_set() and now - old['created'] > 300:
                    del self.sessions[old_key]
            session = self.sessions.get(key)
            with self.gateway.db() as db:
                receipt = db.execute('SELECT * FROM speech_stream_receipts WHERE id=?', (key,)).fetchone()
            if receipt and (receipt['user'] != user or receipt['app'] != app):
                raise Fault(404, '未找到流式语音会话。')
            if session and (session['user'] != user or session['app'] != app):
                raise Fault(404, '未找到流式语音会话。')
            if not session and receipt:
                if action == 'cancel':
                    return 200, {}, {'id': key, 'state': 'cancelled', 'revision': 0, 'result': {}}
                raise Fault(409, '原流式语音会话已结束或服务已更新；不会重复提交，请手动开始新同步。', 'speech_stream_interrupted')
            if action == 'create' and not session:
                if not self.available():
                    raise Fault(503, '尚未配置可用的流式语音服务。', 'speech_stream_unavailable')
                if len(self.sessions) >= 128 or sum(not s['ended'].is_set() for s in self.sessions.values()) >= 16:
                    raise Fault(503, '流式语音会话较多，请稍后重试。', 'speech_stream_busy')
                if any(s['user'] == user and not s['ended'].is_set() for s in self.sessions.values()):
                    raise Fault(429, '请等待当前语音同步完成。', 'concurrency_limit', 5)
                self.gateway.throttle('speech-stream-create:' + str(user), 12)
                call = self.gateway.reserve(user, app, 'speech', 0, feature='speech')
                self.gateway.record_call_meta(call, 'volc.seedasr.sauc', 'alignment_stream', 0)
                session = {'id': key, 'user': user, 'app': app, 'call': call, 'created': now,
                           'state': 'connecting', 'revision': 0, 'result': {'text': '', 'utterances': []},
                           'bytes': 0, 'chunks': {}, 'next_sequence': 0, 'socket': None,
                           'lock': threading.RLock(), 'io_lock': threading.Lock(), 'ready': threading.Event(),
                           'ended': threading.Event()}
                with self.gateway.db() as db:
                    db.execute('INSERT INTO speech_stream_receipts VALUES(?,?,?,?,?)', (key, user, app, call, int(time.time())))
                # Reserve the registry / user slot before releasing the lock.
                # Retried creates wait on this same object, never reconnect.
                self.sessions[key] = session
                opening = True
            if not session:
                if action == 'cancel':
                    # A cancel arriving before create leaves a durable receipt,
                    # preventing that delayed create from opening paid work.
                    with self.gateway.db() as db:
                        db.execute('INSERT INTO speech_stream_receipts VALUES(?,?,?,?,?)', (key, user, app, None, int(time.time())))
                    return 200, {}, {'id': key, 'state': 'cancelled', 'revision': 0, 'result': {}}
                raise Fault(404, '未找到流式语音会话。')
        if action == 'create':
            if opening:
                self._open(session)
            else:
                # Bound waiting for this session only, never the whole registry.
                session['ready'].wait(10)
            return 202 if opening else 200, {}, self._snapshot(session)
        if action == 'poll':
            self.gateway.throttle('speech-stream-poll:' + key, 300)
            return 200, {}, self._snapshot(session)
        if action == 'cancel':
            self._end(session, 'cancelled')
            return 200, {}, self._snapshot(session)
        if action == 'finish':
            with session['io_lock']:
                with session['lock']:
                    send = session['state'] == 'listening'
                    if send:
                        session['state'] = 'finishing'
                        session['finish_deadline'] = time.monotonic() + 10
                        session['revision'] += 1
                        upstream = session['socket']
                if send:
                    try:
                        upstream.send(client_packet(b'', audio=True, last=True))
                    except Exception as error:
                        self._end(session, 'error', error)
            return 200, {}, self._snapshot(session)
        self.gateway.throttle('speech-stream-push:' + key, 400)
        sequence, audio = body.get('sequence'), body.get('audio')
        if type(sequence) is not int or not 0 <= sequence < 1200 or not isinstance(audio, str) or not 1 <= len(audio) <= 42668:
            raise Fault(400, '语音分包参数无效。')
        try:
            pcm = base64.b64decode(audio, validate=True)
        except ValueError:
            raise Fault(400, '语音分包编码无效。') from None
        if not 2 <= len(pcm) <= 32000 or len(pcm) % 2:
            raise Fault(400, '仅接受每包不超过 1 秒的 16kHz 单声道 PCM16 音频。')
        fingerprint = hashlib.sha256(pcm).digest()

        def already_received():
            if sequence not in session['chunks']:
                return False
            if not hmac.compare_digest(session['chunks'][sequence], fingerprint):
                raise Fault(409, '同一语音序号内容不一致。', 'speech_stream_sequence_conflict')
            return True

        # An acknowledgement lost during send can be retried without waiting
        # for that write or accounting for the same audio a second time.
        with session['lock']:
            if already_received():
                return 200, {}, self._snapshot(session)
        with session['io_lock']:
            with session['lock']:
                if already_received():
                    return 200, {}, self._snapshot(session)
                if session['state'] != 'listening':
                    raise Fault(409, '本次语音会话已停止接收音频。', 'speech_stream_closed')
                if sequence != session['next_sequence']:
                    raise Fault(409, '语音分包顺序不连续。', 'speech_stream_sequence_conflict')
                if session['bytes'] + len(pcm) > MAX_SECONDS * BYTES_PER_SECOND:
                    raise Fault(400, '本次流式语音最多 30 秒。', 'speech_stream_duration_limit')
                try:
                    self._account(session, append_bytes=len(pcm))
                    # Record acceptance before network IO: ambiguous delivery
                    # cannot evade quota or replay audio in a new paid session.
                    session['bytes'] += len(pcm)
                    session['chunks'][sequence] = fingerprint
                    session['next_sequence'] += 1
                    upstream = session['socket']
                except Exception as error:
                    accounting_error = error
                else:
                    accounting_error = None
            if accounting_error:
                self._end(session, 'error', accounting_error)
            else:
                try:
                    upstream.send(client_packet(pcm, audio=True))
                except Exception as error:
                    self._end(session, 'error', error)
        return 200, {}, self._snapshot(session)
