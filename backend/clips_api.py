"""Explicit private screenshot bookmarks, independent of model requests."""
import base64
import binascii
import re
import struct
import time
import zlib
from urllib.parse import parse_qs, urlsplit, urlunsplit
try:
    from .admin_api import Fault
except ImportError:
    from admin_api import Fault

MAX_CLIPS = 500
MAX_IMAGE = 4000000
MAX_IMAGE_EDGE = 3840
MAX_THUMB = 80000
MAX_STORAGE = 64 * 1024 * 1024


def migrate_clips(db):
    db.executescript('''
CREATE TABLE IF NOT EXISTS study_clips(
 user INTEGER NOT NULL,app TEXT NOT NULL,id TEXT NOT NULL,
 title TEXT NOT NULL,course TEXT NOT NULL,course_key TEXT NOT NULL,
 origin TEXT NOT NULL,note TEXT NOT NULL,position TEXT NOT NULL,
 image BLOB NOT NULL,thumbnail BLOB NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,
 created INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(user,app,id));
CREATE INDEX IF NOT EXISTS study_clips_owner ON study_clips(user,app,created DESC,id);
''')


def png(value, maximum, edge):
    """Validate canvas PNGs with bounded inflate, complete chunks and CRCs."""
    if not isinstance(value, str) or not value.startswith('data:image/png;base64,') or len(value) > maximum * 4 // 3 + 32:
        raise Fault(400, '请使用有效的 PNG 截图，图片过大时请缩小选区', 'invalid_clip_image')
    try:
        raw = base64.b64decode(value[22:], validate=True)
        if not 45 <= len(raw) <= maximum or raw[:8] != b'\x89PNG\r\n\x1a\n':
            raise ValueError()
        offset, width, height, compressed, ended, seen_idat, closed_idat = 8, 0, 0, bytearray(), False, False, False
        while offset < len(raw):
            size, kind = struct.unpack('>I4s', raw[offset:offset + 8])
            chunk = raw[offset + 8:offset + 8 + size]
            if size > maximum or offset + 12 + size > len(raw):
                raise ValueError()
            if zlib.crc32(kind + chunk) & 0xffffffff != struct.unpack('>I', raw[offset + 8 + size:offset + 12 + size])[0]:
                raise ValueError()
            if offset == 8 and kind != b'IHDR':
                raise ValueError()
            if kind == b'IHDR':
                if width or size != 13:
                    raise ValueError()
                width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', chunk)
                if not 1 <= width <= edge or not 1 <= height <= edge or (depth, color, compression, filtering, interlace) != (8, 6, 0, 0, 0):
                    raise ValueError()
            elif kind == b'IDAT':
                if closed_idat:
                    raise ValueError()
                seen_idat = True
                compressed.extend(chunk)
            elif kind == b'IEND':
                if size or offset + 12 != len(raw) or not seen_idat:
                    raise ValueError()
                ended = True
            elif kind[:1].isupper():
                raise ValueError()
            if seen_idat and kind != b'IDAT':
                closed_idat = True
            offset += 12 + size
        expected = height * (1 + 4 * width)
        decoder = zlib.decompressobj()
        pixels = decoder.decompress(compressed, expected + 1)
        if not ended or len(pixels) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            raise ValueError()
        if any(pixels[row * (1 + 4 * width)] > 4 for row in range(height)):
            raise ValueError()
        return raw, width, height
    except (ValueError, binascii.Error, struct.error, zlib.error, OverflowError):
        raise Fault(400, '图片格式不完整或尺寸超限，请重新截图', 'invalid_clip_image') from None


def text(value, maximum):
    if not isinstance(value, str) or len(value) > maximum or any(ord(c) < 32 and c not in '\n\t' for c in value):
        raise Fault(400, '收藏文字格式无效或过长', 'invalid_clip')
    if re.search(r'data:[^\s,]*;base64,|(?:^|\n)\s*(cookie|authorization|set-cookie)\s*:', value, re.I):
        raise Fault(400, '请移除登录凭据', 'invalid_clip')
    return value.strip()


def data_url(raw):
    return 'data:image/png;base64,' + base64.b64encode(raw).decode('ascii')


def summary(row):
    result = {key: row[key] for key in ('id', 'title', 'course', 'origin', 'note', 'position', 'width', 'height', 'created', 'updated')}
    result['courseKey'] = row['course_key']
    result['thumbnail'] = data_url(row['thumbnail'])
    return result


class ClipsMixin:
    def clip_limits(self):
        return {'max_edge': MAX_IMAGE_EDGE, 'max_image': MAX_IMAGE,
                'max_thumbnail_edge': 320, 'max_thumbnail': MAX_THUMB}

    def clips_private(self, method, path, body, user, app):
        route = urlsplit(path)
        if route.path not in ('/v1/study/clips', '/v1/study/clip-image'):
            return None
        if app != 'zhiyun-subtitles':
            raise Fault(403, '此应用未开放随意摘', 'invalid_app')
        query = parse_qs(route.query, keep_blank_values=True)
        identifier = query.get('id', [''])[0]
        if identifier and not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier):
            raise Fault(400, '收藏编号无效', 'invalid_clip')
        owner = (user['id'], app)
        if route.path.endswith('/clip-image'):
            if method != 'GET' or not identifier:
                raise Fault(400, '请指定收藏图片', 'invalid_clip')
            with self.db() as db:
                row = db.execute('SELECT image FROM study_clips WHERE user=? AND app=? AND id=?', (*owner, identifier)).fetchone()
            if not row:
                raise Fault(404, '收藏不存在或已删除', 'clip_not_found')
            return 200, {}, {'image': data_url(row['image'])}
        if method == 'POST':
            if set(body) - {'id', 'title', 'course', 'courseKey', 'origin', 'note', 'position', 'image', 'thumbnail'}:
                raise Fault(400, '收藏包含不支持的字段', 'invalid_clip')
            identifier = body.get('id', '')
            if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identifier):
                raise Fault(400, '收藏编号无效', 'invalid_clip')
            image, width, height = png(body.get('image'), MAX_IMAGE, MAX_IMAGE_EDGE)
            thumbnail, _, _ = png(body.get('thumbnail'), MAX_THUMB, 320)
            title, course = text(body.get('title', ''), 200), text(body.get('course', ''), 200)
            course_key = text(body.get('courseKey', course), 200)
            origin, note, position = text(body.get('origin', ''), 2000), text(body.get('note', ''), 4000), text(body.get('position', ''), 100)
            parsed = urlsplit(origin)
            origin = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', '')) if parsed.scheme in ('https', 'http') and parsed.hostname and not parsed.username and not parsed.password else ''
            now = int(time.time() * 1000)
            size = len(image) + len(thumbnail)
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                existing = db.execute('SELECT created,length(image)+length(thumbnail) AS bytes FROM study_clips WHERE user=? AND app=? AND id=?', (*owner, identifier)).fetchone()
                count, used = db.execute('SELECT COUNT(*),COALESCE(SUM(length(image)+length(thumbnail)),0) FROM study_clips WHERE user=? AND app=?', owner).fetchone()
                if (not existing and count >= MAX_CLIPS) or used - (existing['bytes'] if existing else 0) + size > MAX_STORAGE:
                    raise Fault(409, '随意摘空间已满（500 张 / 64 MB），请先删除不需要的收藏', 'clip_limit')
                db.execute('INSERT INTO study_clips VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user,app,id) DO UPDATE SET title=excluded.title,course=excluded.course,course_key=excluded.course_key,origin=excluded.origin,note=excluded.note,position=excluded.position,image=excluded.image,thumbnail=excluded.thumbnail,width=excluded.width,height=excluded.height,updated=excluded.updated',
                           (*owner, identifier, title or '截图收藏', course, course_key, origin, note, position, image, thumbnail, width, height, existing['created'] if existing else now, now))
            return 200, {}, {'ok': True, 'id': identifier}
        if method == 'DELETE':
            if not identifier:
                raise Fault(400, '请指定收藏', 'invalid_clip')
            with self.db() as db:
                db.execute('DELETE FROM study_clips WHERE user=? AND app=? AND id=?', (*owner, identifier))
            return 200, {}, {'ok': True}
        if method != 'GET':
            raise Fault(405, '请求方式无效', 'method_not_allowed')
        try:
            offset, limit = int(query.get('offset', ['0'])[0]), int(query.get('limit', ['50'])[0])
            if not 0 <= offset <= MAX_CLIPS or not 1 <= limit <= 50:
                raise ValueError()
        except ValueError:
            raise Fault(400, '分页参数无效', 'invalid_pagination') from None
        with self.db() as db:
            rows = db.execute('SELECT id,title,course,course_key,origin,note,position,thumbnail,width,height,created,updated FROM study_clips WHERE user=? AND app=? ORDER BY created DESC,id LIMIT ? OFFSET ?', (*owner, limit + 1, offset)).fetchall()
            used = db.execute('SELECT COALESCE(SUM(length(image)+length(thumbnail)),0) FROM study_clips WHERE user=? AND app=?', owner).fetchone()[0]
        return 200, {}, {'items': [summary(row) for row in rows[:limit]], 'next_offset': offset + limit if len(rows) > limit else None, 'usedBytes': used, 'maxBytes': MAX_STORAGE}
