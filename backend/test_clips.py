"""Real temporary DB/API tests. No provider, email or production account access."""
import base64
import concurrent.futures
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch
from backend import clips_api
from backend.admin_api import Fault
from backend.server import Gateway


def image(width=8,height=6):
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    raw=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff\x91\x40\xff'*width)*height))+chunk(b'IEND',b'')
    return 'data:image/png;base64,'+base64.b64encode(raw).decode()


class ClipsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        def blocked(*args,**kwargs):raise AssertionError('No provider calls allowed')
        self.gateway=Gateway(Path(self.temp.name)/'clips.sqlite',upstream=blocked,upstream_stream=blocked)
        self.users=[]
        for email in ['one@example.test','two@example.test']:
            self.gateway.add_user(email,'test-only-password-2026','zhiyun-subtitles',0,0,plan='free')
            with self.gateway.db() as db:self.users.append(dict(db.execute('SELECT * FROM users WHERE email=?',(email,)).fetchone()))
        self.headers={'X-App-Id':'zhiyun-subtitles'}
    def call(self,method,path='/v1/study/clips',body=None,user=0,app='zhiyun-subtitles'):
        return self.gateway.study_private(method,path,self.headers,body or {},self.users[user],app)[2]
    def payload(self,identifier='one',**extra):
        return {'id':identifier,'title':'动量守恒','course':'大学物理','courseKey':'physics','origin':'https://school.test/course?token=SECRET#hidden','note':'忽略外力','position':'12:30','image':image(),'thumbnail':image(),**extra}
    def fault(self,code,callback):
        with self.assertRaises(Fault) as caught:callback()
        self.assertEqual(code,caught.exception.code)
    def test_free_save_private_list_and_lazy_image(self):
        self.call('POST',body=self.payload())
        row=self.call('GET')['items'][0]
        self.assertEqual('https://school.test/course',row['origin']);self.assertNotIn('image',row)
        self.assertTrue(row['thumbnail'].startswith('data:image/png;base64,'))
        self.assertEqual(image(),self.call('GET','/v1/study/clip-image?id=one')['image'])
        self.assertEqual([],self.call('GET',user=1)['items'])
        self.fault('clip_not_found',lambda:self.call('GET','/v1/study/clip-image?id=one',user=1))
        self.fault('invalid_app',lambda:self.call('GET',app='other'))
    def test_capabilities_advertise_current_image_limits(self):
        limits=self.gateway.capabilities()['study_clip_limits']
        self.assertEqual({'max_edge':3840,'max_image':4000000,'max_thumbnail_edge':320,'max_thumbnail':80000},limits)

    def test_high_resolution_image_keeps_pixels_and_is_lazy_loaded(self):
        original=image(3840,2160)
        self.call('POST',body=self.payload('high-resolution',image=original))
        row=self.call('GET')['items'][0]
        self.assertEqual((3840,2160),(row['width'],row['height']))
        self.assertNotIn('image',row)
        self.assertEqual(original,self.call('GET','/v1/study/clip-image?id=high-resolution')['image'])
        with patch.object(clips_api,'MAX_IMAGE',45):
            self.fault('invalid_clip_image',lambda:self.call('POST',body=self.payload('too-large',image=original)))

    def test_retry_upsert_is_idempotent_and_preserves_creation(self):
        self.call('POST',body=self.payload());created=self.call('GET')['items'][0]['created']
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _:self.call('POST',body=self.payload(note='重试')),range(4)))
        rows=self.call('GET')['items'];self.assertEqual(1,len(rows));self.assertEqual(created,rows[0]['created']);self.assertEqual('重试',rows[0]['note'])
    def test_delete_scoped_and_releases_storage(self):
        self.call('POST',body=self.payload());self.call('DELETE','/v1/study/clips?id=one',user=1)
        self.assertEqual(1,len(self.call('GET')['items']));self.call('DELETE','/v1/study/clips?id=one')
        self.assertEqual(0,self.call('GET')['usedBytes']);self.fault('clip_not_found',lambda:self.call('GET','/v1/study/clip-image?id=one'))
    def test_invalid_media_and_owner_injection(self):
        for media in ['data:image/svg+xml;base64,PHN2Zz4=','https://school.test/secret.png',image()[:-8],image(clips_api.MAX_IMAGE_EDGE+1,1)]:
            self.fault('invalid_clip_image',lambda:self.call('POST',body=self.payload(image=media)))
        self.fault('invalid_clip',lambda:self.call('POST',body=self.payload(user=1)))
        self.fault('invalid_clip',lambda:self.call('POST',body=self.payload(note='Authorization: Bearer secret')))
        self.assertEqual([],self.call('GET')['items'])
    def test_capacity_and_pagination(self):
        self.call('POST',body=self.payload());self.call('POST',body=self.payload('two'))
        data=self.call('GET','/v1/study/clips?limit=1');self.assertEqual(1,data['next_offset']);self.assertEqual(1,len(data['items']))
        with patch.object(clips_api,'MAX_CLIPS',2):
            self.call('POST',body=self.payload());self.fault('clip_limit',lambda:self.call('POST',body=self.payload('three')))
        with patch.object(clips_api,'MAX_STORAGE',1):self.fault('clip_limit',lambda:self.call('POST',body=self.payload('three')))
        self.fault('invalid_pagination',lambda:self.call('GET','/v1/study/clips?limit=51'))
    def test_auth_and_free_integration_no_paid_quota(self):
        with self.assertRaises(Fault):self.gateway.handle('GET','/v1/study/clips',self.headers,{},'test')
        login=self.gateway.handle('POST','/v1/auth/login',self.headers,{'email':'one@example.test','password':'test-only-password-2026'},'test')[2]
        signed={**self.headers,'Authorization':'Bearer '+login['token']}
        self.gateway.handle('POST','/v1/study/clips',signed,self.payload(),'test')
        self.assertEqual(1,len(self.gateway.handle('GET','/v1/study/clips',signed,{},'test')[2]['items']))
        with self.gateway.db() as db:self.assertEqual(0,db.execute('SELECT COUNT(*) FROM calls').fetchone()[0])
    def test_corrupt_png_crc_and_inflate_bomb(self):
        raw=bytearray(base64.b64decode(image()[22:]));raw[-5]^=1
        self.fault('invalid_clip_image',lambda:self.call('POST',body=self.payload(image=clips_api.data_url(raw))))
        self.fault('invalid_clip_image',lambda:self.call('POST',body=self.payload(thumbnail=image(321,1))))
        def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
        bomb=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',8,6,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0'*1000000))+chunk(b'IEND',b'')
        self.fault('invalid_clip_image',lambda:self.call('POST',body=self.payload(image=clips_api.data_url(bomb))))

if __name__=='__main__':unittest.main()
