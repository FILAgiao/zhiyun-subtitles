"""Local preview of the actual public gateway page, including the /gateway prefix."""
import argparse,json,tempfile
from .server import Gateway,make_server


def make_preview_server(gateway,port=0):
    server=make_server(gateway,port=port)
    original=server.RequestHandlerClass.do_GET
    def prefixed(handler):
        if handler.path.startswith('/gateway/'):
            handler.path=handler.path[8:]
        original(handler)
    server.RequestHandlerClass.do_GET=prefixed
    return server


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=0);args=parser.parse_args()
    with tempfile.TemporaryDirectory() as folder:
        server=make_preview_server(Gateway(folder+'/preview.sqlite3'),args.port)
        print(json.dumps({'url':'http://127.0.0.1:'+str(server.server_port)+'/gateway/','port':server.server_port}),flush=True)
        try:server.serve_forever()
        except KeyboardInterrupt:pass
        finally:server.server_close()


if __name__=='__main__':main()
