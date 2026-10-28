"""Local preview of the actual public gateway page, including the /gateway prefix."""
import argparse,json,tempfile
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


def seed_preview(gateway):
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
    gateway.handle('POST','/v1/auth/logout',headers,{},'preview')
    return {'username':email,'password':password,'data':'temporary sample only'}


class PreviewGateway(Gateway):
    """The preview cannot send email, call providers or administer real accounts."""
    def handle(self,method,path,*args,**kwargs):
        allowed={('GET','/health'),('GET','/v1/me'),('GET','/v1/account/access'),
                 ('GET','/v1/study/clips'),('GET','/v1/study/clip-image'),('POST','/v1/study/clips'),('DELETE','/v1/study/clips'),
                 ('GET','/v1/study/capabilities'),('GET','/v1/study/conversations'),
                 ('POST','/v1/auth/login'),('POST','/v1/auth/logout'),('POST','/v1/auth/web-session'),
                 ('POST','/v1/study/conversations'),('DELETE','/v1/study/conversations')}
        if (method,urlsplit(path).path) not in allowed:
            raise Fault(503,'本地验收不开放邮件、模型或管理写入')
        return super().handle(method,path,*args,**kwargs)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=0);parser.add_argument('--demo',action='store_true',help='Create an isolated free sample account in a temporary database');args=parser.parse_args()
    with tempfile.TemporaryDirectory() as folder:
        def offline(*args,**kwargs):raise Fault(503,'本地预览不连接模型服务')
        gateway=PreviewGateway(folder+'/preview.sqlite3',upstream=offline,upstream_stream=offline)
        demo=seed_preview(gateway) if args.demo else None
        server=make_preview_server(gateway,args.port)
        print(json.dumps({'url':'http://127.0.0.1:'+str(server.server_port)+'/gateway/','port':server.server_port,**({'demo':demo} if demo else {})},ensure_ascii=False),flush=True)
        try:server.serve_forever()
        except KeyboardInterrupt:pass
        finally:server.server_close()


if __name__=='__main__':main()
