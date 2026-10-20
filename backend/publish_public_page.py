"""Publish the public introduction page with backup, narrow router patch and rollback.

The default publishes only public page files. --include-client additionally
publishes the complete userscript, update metadata and full extension ZIP.
SSH passwords are entered in the local terminal with getpass, never arguments.
"""
import argparse,getpass,hashlib,io,json,posixpath,re,shlex,stat,sys,time,urllib.request,zipfile
from pathlib import Path
from datetime import datetime,timezone
try:
    from .public_page import PUBLIC_PAGE_FILES
except ImportError:
    from public_page import PUBLIC_PAGE_FILES

ROOT=Path(__file__).resolve().parent.parent
ORIGIN='https://47.77.182.216.sslip.io/gateway'
REMOTE='/opt/zhiyun-gateway/backend'
IMPORT_BLOCK="""# Public introduction page routing
try:
    from .public_page import public_page_file
except ImportError:
    from public_page import public_page_file


"""


def patch_public_page_routes(source):
    """Patch the deployed static dispatcher without shipping pending API changes."""
    source=source.replace('\r\n','\n')
    if '# Public introduction page routing' not in source:
        marker='def make_server(gateway,'
        assert source.count(marker)==1,'Unexpected deployed server entry point'
        source=source.replace(marker,IMPORT_BLOCK+marker,1)
    if 'public_file=public_page_file(self.path)' not in source:
        pattern=r"(?m)^( +)if self\.command=='GET' and self\.path in (\([^\n]+\)):"
        assert len(re.findall(pattern,source))==1,'Unexpected deployed static dispatcher'
        source=re.sub(pattern,lambda m:m[1]+"public_file=public_page_file(self.path)\n"+m[1]+"if self.command=='GET' and (public_file is not None or self.path in "+m[2]+"):",source,count=1)
        pattern=r'(?m)^( +)name=(.+)$'
        assert len(re.findall(pattern,source))==1,'Unexpected deployed static filename mapping'
        source=re.sub(pattern,lambda m:m[1]+'name=public_file or ('+m[2]+')',source,count=1)
    if "mime='image/webp'" not in source:
        needle="mime='text/html; charset=utf-8'"
        assert source.count(needle)==1,'Unexpected deployed static MIME mapping'
        source=source.replace(needle,"mime='image/webp' if name.endswith('.webp') else 'image/png' if name.endswith('.png') else 'text/html; charset=utf-8'",1)
    compile(source,'server.py','exec')
    return source


def publish(include_client=False):
    sys.path.insert(0,str(ROOT/'.testdeps/ssh'))
    import paramiko
    client_version=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
    version=json.loads((ROOT/'backend/public-page.json').read_text(encoding='utf-8-sig')).get('pageVersion',client_version)
    content={name:(ROOT/'backend'/name).read_bytes() for name in sorted(set(PUBLIC_PAGE_FILES.values())|{'public_page.py'})}
    html=content['download.html'].decode('utf-8-sig')
    assert 'content="'+version+'"' in html,'Build the current public page first'
    assert html.count('class="art-link"')==6 and 'chromewebstore.google.com/detail/' in html
    if include_client:
        for name in ['install.user.js','install.meta.js']:
            content[name]=(ROOT/'backend'/name).read_bytes()
            assert re.search(rb'^// @version\s+([^\r\n]+)',content[name],re.M).group(1).decode().strip()==client_version
        content['extension.zip']=(ROOT/'dist'/('zhiyun-subtitles-'+client_version+'.zip')).read_bytes()
        with zipfile.ZipFile(io.BytesIO(content['extension.zip'])) as z:
            assert json.loads(z.read('manifest.json'))['version']==client_version
            assert z.read('content.js')==(ROOT/'dist/extension/content.js').read_bytes()
    for name in content:
        assert not name.startswith('/') and '..' not in name.split('/')
        assert posixpath.normpath(REMOTE+'/'+name).startswith(REMOTE+'/')
    client=paramiko.SSHClient();client.load_host_keys(str(ROOT/'backend/.known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    password=getpass.getpass('SSH password (not echoed): ')
    try:client.connect('47.77.182.216',username='root',password=password,look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15)
    finally:password=None
    sftp=client.open_sftp();stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup=REMOTE+'/.rollback-public-page-'+version+'-'+stamp
    old_files={};published=[];q=shlex.quote

    def command(value):
        _,out,err=client.exec_command(value,timeout=180)
        result=out.read().decode();error=err.read().decode()
        assert out.channel.recv_exit_status()==0,'Remote check failed: '+error[:200]
        return result.strip()

    def public(endpoint):
        with urllib.request.urlopen(urllib.request.Request(ORIGIN+endpoint,headers={'Cache-Control':'no-cache','User-Agent':'Zhiyun-public-page-verifier'}),timeout=30) as response:
            assert response.status==200
            return response.read()

    try:
        with sftp.open(REMOTE+'/server.py','rb') as f:server_old=f.read(sftp.stat(REMOTE+'/server.py').st_size)
        server_new=patch_public_page_routes(server_old.decode('utf-8-sig')).encode()
        content['server.py']=server_new
        sftp.mkdir(backup,0o700);sftp.mkdir(backup+'/landing',0o700)
        try:assert stat.S_ISDIR(sftp.stat(REMOTE+'/landing').st_mode)
        except FileNotFoundError:sftp.mkdir(REMOTE+'/landing',0o755)
        for name,data in content.items():
            dest=REMOTE+'/'+name
            try:
                info=sftp.stat(dest);assert stat.S_ISREG(info.st_mode)
                with sftp.open(dest,'rb') as f:old_files[name]=f.read(info.st_size)
                command('cp '+q(dest)+' '+q(backup+'/'+name));sftp.chmod(backup+'/'+name,0o600)
            except FileNotFoundError:old_files[name]=None
            candidate=dest+'.candidate-'+stamp
            with sftp.open(candidate,'wb') as f:f.set_pipelined(True);f.write(data)
            sftp.chmod(candidate,0o644)
            assert command('sha256sum '+q(candidate)).split()[0]==hashlib.sha256(data).hexdigest()
        with sftp.open(backup+'/new-files.json','wb') as f:f.write(json.dumps([n for n,v in old_files.items() if v is None]).encode())
        sftp.chmod(backup+'/new-files.json',0o600)
        for name in ['server.py','public_page.py']:
            expression="compile(open('/app/backend/"+name+".candidate-"+stamp+"',encoding='utf-8-sig').read(), '"+name+"', 'exec')"
            command('docker exec zhiyun-gateway python -c '+q(expression))
        print('Backup and candidate hashes verified. Publishing public page '+version+'...',flush=True)
        try:
            for name in content:
                sftp.posix_rename(REMOTE+'/'+name+'.candidate-'+stamp,REMOTE+'/'+name);published.append(name)
            command('docker restart --time 130 zhiyun-gateway')
            healthy=False
            for _ in range(12):
                try:
                    with urllib.request.urlopen(ORIGIN+'/health',timeout=5) as r:healthy=r.status==200 and json.load(r)['ok']
                    if healthy:break
                except Exception:pass
                time.sleep(1)
            assert healthy,'Gateway did not recover'
            checks={}
            endpoints={path:name for path,name in PUBLIC_PAGE_FILES.items()}
            endpoints.update({'/?from=qr':'download.html','/download?from=mobile':'download.html'})
            if include_client:endpoints.update({'/install.user.js':'install.user.js','/install.meta.js':'install.meta.js','/extension.zip':'extension.zip'})
            for endpoint,name in endpoints.items():
                data=public(endpoint);assert data==content[name],'Anonymous public content mismatch: '+endpoint
                checks[endpoint]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
            report={'page_version':version,'backup':backup,'public_files':checks,'health':'ok','home_url':ORIGIN+'/','qr_url':ORIGIN+'/download','included_client':include_client,'backend_scope':'public static router patch only; no pending API/plan migration'}
            report_name=('acceptance-' if include_client else 'public-page-acceptance-')+version+'.json'
            (ROOT/'backend'/report_name).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
            print('PASS: public home, QR page, query URLs and all six images are anonymous and byte-identical to local build.',flush=True)
        except Exception:
            for name in reversed(published):
                if old_files[name] is None:command('rm -- '+q(REMOTE+'/'+name))
                else:command('cp '+q(backup+'/'+name)+' '+q(REMOTE+'/'+name))
            command('docker restart --time 130 zhiyun-gateway')
            print('Publication failed; prior files restored from '+backup,file=sys.stderr)
            raise
    finally:sftp.close();client.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--include-client',action='store_true');args=parser.parse_args();publish(args.include_client)
