"""Local preview of the actual public gateway page, including the /gateway prefix."""
import argparse,base64,json,struct,tempfile,zlib
from urllib.parse import urlsplit
from .server import Gateway,Fault,make_server


def make_preview_server(gateway,port=0):
    # The preview accepts only its actual loopback origin, independent of the
    # production PUBLIC_ORIGIN. The prefix wrapper mirrors Caddy handle_path.
    origins=[]
    server=make_server(gateway,port=port,allowed_web_origins=origins)
    origins.append('http://127.0.0.1:'+str(server.server_port))
    original=server.RequestHandlerClass.dispatch
    def prefixed(handler):
        if handler.path.startswith('/gateway/'):
            handler.path=handler.path[8:]
        original(handler)
    for method in ('GET','POST','DELETE','OPTIONS'):
        setattr(server.RequestHandlerClass,'do_'+method,prefixed)
    return server


def preview_clip_png(index,width,height):
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
    accent=bytes((48+index*17,102,142,255))
    paper=bytes((251,247,237,255))
    rows=[]
    for y in range(height):
        row=paper*width
        if y<height//12:
            row=accent*width
        elif height//4<y<height*3//4 and y%(height//7)<height//24:
            margin=width//8
            length=width*(8+index)//20
            row=paper*margin+accent*length+paper*(width-margin-length)
        rows.append(b'\0'+row)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))
    png+=chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
    return 'data:image/png;base64,'+base64.b64encode(png).decode('ascii')


def seed_preview(gateway,*,clips=False):
    """Ephemeral, explicitly labelled sample data. Never called by production."""
    email='preview@example.test'
    password='local-preview-only-2026'
    gateway.add_user(email,password,'zhiyun-subtitles',0,0,username='本地示例同学',plan='free')
    headers={'X-App-Id':'zhiyun-subtitles'}
    token=gateway.handle('POST','/v1/auth/login',headers,{'email':email,'password':password},'preview')[2]['token']
    headers['Authorization']='Bearer '+token
    for record in [
        {'id':'demo-physics','title':'示例 · 如何理解动量守恒？','course':'大学物理 · 示例课程','source':'示例文字提问','history':[{'role':'user','text':'为什么两辆小车碰撞时，总动量可以保持不变？'},{'role':'assistant','text':'先把两辆小车看作一个系统。它们之间的碰撞力属于内力，大小相等、方向相反；如果外力合力可以忽略，系统总动量就保持不变。注意：动能未必守恒。'}]},
        {'id':'demo-math','title':'示例 · 导数为什么能表示变化率？','course':'微积分 · 示例课程','source':'示例文字提问','history':[{'role':'user','text':'导数和一段区间的平均变化率有什么关系？'},{'role':'assistant','text':'平均变化率是两点连线的斜率。当两点逐渐靠近，割线斜率如果趋近一个确定值，这个极限就是导数，也就是该点的瞬时变化率。'}]}
    ]:
        gateway.handle('POST','/v1/study/conversations',headers,record,'preview')
    if clips:
        samples=[
            ('大学物理','physics','https://interactivemeta.cmc.zju.edu.cn/lesson','物理截图 1'),
            ('大学物理','physics','https://interactivemeta.cmc.zju.edu.cn/lesson','物理截图 2'),
            ('大学物理','physics','https://interactivemeta.cmc.zju.edu.cn/lesson','物理截图 3'),
            ('大学物理','physics','https://interactivemeta.cmc.zju.edu.cn/lesson','物理截图 4'),
            ('高等数学','math','https://classroom.zju.edu.cn/livingpage','高数截图'),
            ('B 站视频一','bili-1','https://www.bilibili.com/video/BV1','B 站截图 1'),
            ('B 站视频二','bili-2','https://www.bilibili.com/video/BV2','B 站截图 2'),
            ('网页笔记','blog','https://example.test/notes','站外网页截图')
        ]
        for index,(course,key,origin,title) in enumerate(samples):
            gateway.handle('POST','/v1/study/clips',headers,{
                'id':f'demo-clip-{index}','course':course,'courseKey':key,'origin':origin,
                'title':title,'note':'用于本地验收的示例截图。',
                'image':preview_clip_png(index,960,600),'thumbnail':preview_clip_png(index,240,150)
            },'preview')
    gateway.handle('POST','/v1/auth/logout',headers,{},'preview')
    return {'username':email,'password':password,'data':'temporary sample only'}


class PreviewGateway(Gateway):
    """The preview cannot send real email, call providers or administer real accounts."""
    def handle(self,method,path,headers,body,ip,stream_sink=None):
        route=urlsplit(path).path
        if method=='POST' and route in ('/v1/auth/register-code','/v1/auth/register') and getattr(self,'study_mailer',None):
            email=body.get('email') if isinstance(body,dict) else None
            if not isinstance(email,str) or not email.strip().lower().endswith('@example.test'):
                raise Fault(400,'本地预览请使用 @example.test 示例邮箱')
            return super().handle(method,path,headers,body,ip,stream_sink)
        allowed={('GET','/health'),('GET','/v1/me'),('GET','/v1/account/access'),
                 ('GET','/v1/study/clips'),('GET','/v1/study/clip-image'),('POST','/v1/study/clips'),('DELETE','/v1/study/clips'),
                 ('GET','/v1/study/capabilities'),('GET','/v1/study/conversations'),
                 ('POST','/v1/auth/login'),('POST','/v1/auth/logout'),('POST','/v1/auth/web-session'),('POST','/v1/auth/extension-session'),
                 ('POST','/v1/study/conversations'),('DELETE','/v1/study/conversations')}
        if (method,route) not in allowed:
            raise Fault(503,'本地验收不开放真实邮件、模型或管理写入')
        return super().handle(method,path,headers,body,ip,stream_sink)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=0);parser.add_argument('--demo',action='store_true',help='Create an isolated free sample account in a temporary database');args=parser.parse_args()
    with tempfile.TemporaryDirectory() as folder:
        def offline(*args,**kwargs):raise Fault(503,'本地预览不连接模型服务')
        gateway=PreviewGateway(folder+'/preview.sqlite3',upstream=offline,upstream_stream=offline)
        if args.demo:
            def preview_mailer(recipient,code):
                print(f'本地注册验证码（{recipient}）：{code}',flush=True)
            gateway.study_mailer=preview_mailer
        demo=seed_preview(gateway,clips=True) if args.demo else None
        server=make_preview_server(gateway,args.port)
        print(json.dumps({'url':'http://127.0.0.1:'+str(server.server_port)+'/gateway/','port':server.server_port,**({'demo':demo} if demo else {})},ensure_ascii=False),flush=True)
        try:server.serve_forever()
        except KeyboardInterrupt:pass
        finally:server.server_close()


if __name__=='__main__':main()
