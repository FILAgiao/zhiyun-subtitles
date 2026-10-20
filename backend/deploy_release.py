"""Back up and deploy reviewed gateway code, installer, metadata and store ZIP."""
import getpass,hashlib,json,shlex,stat,sys,time,urllib.request
from pathlib import Path
from datetime import datetime,timezone
sys.path.insert(0,str(Path('.testdeps/ssh').resolve()))
import paramiko
root=Path(__file__).resolve().parent.parent
origin='https://47.77.182.216.sslip.io/gateway';remote='/opt/zhiyun-gateway/backend'
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
files=['public_page.py','server.py','admin_api.py','admin.html','admin.css','admin.js','privacy.html','download.html','download.css','install.user.js','install.meta.js','extension.zip']
files += ['landing/'+name for name in ['brand-logo.png','image-02.webp','image-01.webp','image-03.webp','image-04.webp','image-05.webp','image-06.webp']]
content={name:(root/'backend'/name).read_bytes() if name!='extension.zip' else (root/'dist'/('zhiyun-subtitles-'+version+'.zip')).read_bytes() for name in files}
client=paramiko.SSHClient();client.load_host_keys(str(root/'backend/.known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
password=getpass.getpass('SSH password (not echoed): ')
try:client.connect('47.77.182.216',username='root',password=password,look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15)
finally:password=None
sftp=client.open_sftp();backup=remote+'/.rollback-release-'+version+'-'+stamp

def command(cmd):
 _,out,err=client.exec_command(cmd,timeout=180);result=out.read().decode();error=err.read().decode();assert out.channel.recv_exit_status()==0,'Remote operation failed: '+error[:200];return result.strip()
def q(value):return shlex.quote(value)
try:
 sftp.mkdir(backup,0o700);sftp.mkdir(backup+'/landing',0o700)
 try:assert stat.S_ISDIR(sftp.stat(remote+'/landing').st_mode)
 except FileNotFoundError:sftp.mkdir(remote+'/landing',0o755)
 changed=[]
 for name,data in content.items():
  dest=remote+'/'+name
  try:
   info=sftp.stat(dest);assert stat.S_ISREG(info.st_mode)
   with sftp.open(dest,'rb') as f:previous=f.read(info.st_size)
   if previous!=data:changed.append(name)
   command('cp '+q(dest)+' '+q(backup+'/'+name));sftp.chmod(backup+'/'+name,0o600)
  except FileNotFoundError:changed.append(name)
  candidate=dest+'.candidate-'+stamp
  with sftp.open(candidate,'wb') as f:f.set_pipelined(True);f.write(data)
  sftp.chmod(candidate,0o644)
  assert command('sha256sum '+q(candidate)).split()[0]==hashlib.sha256(data).hexdigest()
 print('Upload hashes verified. Changed files: '+', '.join(changed),flush=True)
 config=json.loads(command("docker inspect zhiyun-gateway"))[0]
 assert config['Config']['WorkingDir']=='/app' and config['Config']['User']=='10001:10001'
 assert {m['Source']:m['Destination'] for m in config['Mounts'] if m['Type']=='bind'}=={'/opt/zhiyun-gateway/backend':'/app/backend','/opt/zhiyun-gateway/data':'/data'}
 for name in ['server.py','admin_api.py','public_page.py']:
  code="compile(open('/app/backend/"+name+".candidate-"+stamp+"').read(), '"+name+"', 'exec')"
  command('docker exec zhiyun-gateway python -c '+q(code))
 snapshot='/data/gateway-before-'+version+'-'+stamp+'.sqlite3'
 code="import sqlite3,os; source=sqlite3.connect(os.environ['DATABASE_PATH']); target=sqlite3.connect('"+snapshot+"'); source.backup(target); target.close(); source.close(); os.chmod('"+snapshot+"',0o600)"
 command('docker exec zhiyun-gateway python -c '+q(code))
 env='/opt/zhiyun-gateway/gateway.env';command('cp '+q(env)+' '+q(backup+'/gateway.env'));sftp.chmod(backup+'/gateway.env',0o600)
 with sftp.open(env,'rb') as f:settings=f.read(sftp.stat(env).st_size).decode()
 settings='\n'.join(line for line in settings.splitlines() if not line.startswith(('ALLOW_EXTENSION_ORIGINS=','RELEASE_VERSION=')))+'\nALLOW_EXTENSION_ORIGINS=1\nRELEASE_VERSION='+version+'\n'
 with sftp.open(env,'wb') as f:f.write(settings.encode())
 sftp.chmod(env,0o600);settings=None
 for name in files:sftp.posix_rename(remote+'/'+name+'.candidate-'+stamp,remote+'/'+name)
 old='zhiyun-gateway-before-'+stamp
 command('docker stop --time 130 zhiyun-gateway');command('docker rename zhiyun-gateway '+q(old))
 h=config['HostConfig'];image=config['Config']['Image']
 args=['docker','run','-d','--name','zhiyun-gateway','--restart','unless-stopped','--stop-timeout','130','--network','deploy_internal','--user','10001:10001','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--memory',str(h['Memory']),'--cpus',str((h['NanoCpus'] or 500000000)/1000000000),'--pids-limit',str(h['PidsLimit'] or 64),'--cap-drop','ALL','--security-opt','no-new-privileges:true','--env-file',env,'-v','/opt/zhiyun-gateway/backend:/app/backend:ro','-v','/opt/zhiyun-gateway/data:/data:rw','-w','/app',image,'python','backend/server.py','serve']
 command(' '.join(q(a) for a in args));healthy=False
 for _ in range(20):
  try:
   with urllib.request.urlopen(origin+'/health',timeout=5) as r:healthy=r.status==200 and json.load(r)['ok']
   if healthy:break
  except Exception:pass
  time.sleep(1)
 assert healthy,'Gateway did not recover; retained prior container '+old+' and backups at '+backup
 checks={}
 for name in files:
  dest=remote+'/'+name
  assert command('sha256sum '+q(dest)).split()[0]==hashlib.sha256(content[name]).hexdigest()
 for name in ['install.user.js','install.meta.js','admin.html','admin.js','admin.css','privacy.html','download.html','download.css','extension.zip']+[name for name in files if name.startswith('landing/')]:
  public='admin' if name=='admin.html' else 'privacy' if name=='privacy.html' else 'download' if name=='download.html' else name
  with urllib.request.urlopen(urllib.request.Request(origin+'/'+public,headers={'Cache-Control':'no-cache'}),timeout=30) as r:data=r.read()
  assert data==content[name],'Public file differs: '+name
  checks[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 command('docker rm '+q(old))
 report={'version':version,'backup':backup,'database_backup':snapshot,'changed':changed,'public_files':checks,'health':'ok','url':origin+'/install.user.js'}
 (root/'backend'/('acceptance-'+version+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print('PASS: deployed '+version+', backup of code/env/SQLite created; all public files match; gateway healthy.',flush=True)
finally:sftp.close();client.close()
