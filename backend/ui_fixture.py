import json,os,tempfile,threading,sys
from backend.server import Gateway,make_server
with tempfile.TemporaryDirectory() as folder:
    g=Gateway(folder+'/test.sqlite3')
    g.add_user('owner@example.test','fixture-admin-password','zhiyun-subtitles',username='owner',admin=True)
    server=make_server(g,port=0)
    os.environ['PUBLIC_ORIGIN']='http://127.0.0.1:'+str(server.server_port)
    t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
    print(json.dumps({'port':server.server_port}),flush=True)
    sys.stdin.readline()
    server.shutdown();server.server_close();t.join()
