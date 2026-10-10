import sys, getpass, hashlib, json, re, stat
from pathlib import Path
from datetime import datetime, timezone
import urllib.request
sys.path.insert(0,str(Path('.testdeps/ssh').resolve()))
import paramiko
root=Path(__file__).resolve().parent.parent
origin='https://47.77.182.216.sslip.io/gateway'
remote='/opt/zhiyun-gateway/backend'
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
files=['install.user.js','install.meta.js']
content={name:(root/'backend'/name).read_bytes() for name in files}
for name,data in content.items():
    found=re.search(rb'^// @version\s+([^\r\n]+)',data,re.M)
    assert found and found.group(1).decode().strip()==version, 'Local version mismatch'
client=paramiko.SSHClient()
client.load_host_keys(str(root/'backend/.known_hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
password=getpass.getpass('SSH password (not echoed): ')
try:
    client.connect('47.77.182.216',username='root',password=password,look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15)
finally:
    password=None
sftp=client.open_sftp()
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=remote+'/.rollback-userscript-'+version+'-'+stamp
old={}
try:
    sftp.mkdir(backup,0o700)
    def remote_command(command):
        _,out,err=client.exec_command(command,timeout=30)
        result=out.read().decode().strip()
        assert out.channel.recv_exit_status()==0, 'Remote check failed: '+err.read().decode(errors='replace')[:200]
        return result
    for name in files:
        dest=remote+'/'+name
        info=sftp.stat(dest)
        assert stat.S_ISREG(info.st_mode), 'Installer target is not a regular file'
        remote_command('cp '+dest+' '+backup+'/'+name)
        sftp.chmod(backup+'/'+name,0o600)
        candidate=dest+'.candidate-'+stamp
        with sftp.open(candidate,'wb') as target:
            target.set_pipelined(True)
            target.write(content[name])
        sftp.chmod(candidate,0o644)
        actual_hash=remote_command('sha256sum '+candidate).split()[0]
        assert actual_hash==hashlib.sha256(content[name]).hexdigest(), 'Upload hash mismatch'
        print('Backup and upload hash verified: '+name,flush=True)
    print('Backup created; both uploaded candidates verified.',flush=True)
    for name in files: sftp.posix_rename(remote+'/'+name+'.candidate-'+stamp,remote+'/'+name)
    print('Published userscript and update metadata: '+version,flush=True)
    if '--learning-default' in sys.argv:
        server_path=remote+'/server.py'
        with sftp.open(server_path,'rb') as source: server_old=source.read(sftp.stat(server_path).st_size)
        needle=b"        models=os.environ.get('ARK_MODELS'"
        default=b"        if not body.get('model'):\n            body={**body,'model':os.environ.get('ARK_LEARNING_MODEL','doubao-seed-2-1-lite-260915')}\n"
        assert server_old.count(needle)==1, 'Unexpected remote model validation layout'
        server_new=server_old if default in server_old else server_old.replace(needle,default+needle)
        with sftp.open(backup+'/server.py','wb') as saved: saved.write(server_old)
        sftp.chmod(backup+'/server.py',0o600)
        candidate=server_path+'.candidate-'+stamp
        with sftp.open(candidate,'wb') as target: target.write(server_new)
        sftp.chmod(candidate,0o644)
        def checked(command):
            _,out,err=client.exec_command(command,timeout=30)
            code=out.channel.recv_exit_status()
            assert code==0, 'Remote validation failed: '+err.read().decode(errors='replace')[:200]
        checked('docker exec zhiyun-gateway python -c '+"\"compile(open('/app/backend/server.py.candidate-"+stamp+"').read(), 'server.py', 'exec')\"")
        sftp.posix_rename(candidate,server_path)
        try:
            checked('docker restart zhiyun-gateway')
            import time
            healthy=False
            for _ in range(10):
                try:
                    with urllib.request.urlopen(origin+'/health',timeout=5) as response: healthy=response.status==200
                    if healthy: break
                except Exception: pass
                time.sleep(1)
            assert healthy, 'Backend health did not recover'
            assert remote_command('sha256sum '+server_path).split()[0]==hashlib.sha256(server_new).hexdigest()
            print('Server learning default patched and verified; gateway healthy.',flush=True)
        except Exception:
            with sftp.open(server_path,'wb') as restore: restore.write(server_old)
            checked('docker restart zhiyun-gateway')
            raise

finally:
    sftp.close();client.close()
checks={}
for name in files:
    req=urllib.request.Request(origin+'/'+name,headers={'Cache-Control':'no-cache','User-Agent':'Zhiyun-release-verifier'})
    with urllib.request.urlopen(req,timeout=30) as response: data=response.read()
    assert data==content[name], 'Public installer content mismatch: '+name
    checks[name]={'version':version,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
with urllib.request.urlopen(origin+'/health',timeout=20) as response:
    assert response.status==200, 'Gateway health check failed'
report={'version':version,'backup':backup,'public_files':checks,'health':'ok','url':origin+'/install.user.js'}
(root/'backend'/('acceptance-'+version+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('PASS: public script and metadata exactly match local '+version+'; gateway health OK.',flush=True)

