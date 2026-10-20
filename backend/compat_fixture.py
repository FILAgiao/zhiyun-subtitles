"""Loopback-only, temporary-db fixture for the frozen 0.20.48 client test."""
import json,os,sys,tempfile,threading
from pathlib import Path
from unittest.mock import patch
from .server import Gateway,make_server

def upstream(url,headers,body):
    if url.endswith('/responses'):
        return 200,{}, {'id':'fixture','status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'compat answer'}]}],'usage':{'input_tokens':2,'output_tokens':3,'total_tokens':5}}
    return 200,{'X-Api-Status-Code':'20000000'},{'result':{'utterances':[{'text':'hello','start_time':0,'end_time':1000}]}}

def stream(*args):
    yield {'type':'response.output_text.delta','delta':'compat answer'}
    yield {'type':'response.completed','response':upstream('fixture/responses',{},{} )[2]}

def main():
    with tempfile.TemporaryDirectory(prefix='zhiyun-048-http-') as folder,patch.dict(os.environ,{'ARK_API_KEY':'fixture-only','SPEECH_API_KEY':'fixture-only','ALLOW_WEB_SEARCH':'0'}):
        gateway=Gateway(Path(folder)/'gateway.sqlite',upstream,stream)
        gateway.add_user('compat@example.test','compat-fixture-password','zhiyun-subtitles',1000,1000,username='compat')
        server=make_server(gateway,port=0)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        print(json.dumps({'port':server.server_port,'email':'compat@example.test','password':'compat-fixture-password'}),flush=True)
        try:
            for line in sys.stdin:
                if line.strip()=='exit':break
        finally:server.shutdown();server.server_close();worker.join(5)

if __name__=='__main__':main()
