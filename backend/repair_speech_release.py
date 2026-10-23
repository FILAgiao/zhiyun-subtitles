"""Publish only the reviewed 0.20.81 speech repair. Default is a local plan, with no network."""
import argparse,getpass,hashlib,json,shlex,stat,sys,time,urllib.request
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
VERSION='0.20.81'
HOST='47.77.182.216'
ORIGIN='https://47.77.182.216.sslip.io/gateway'
REMOTE='/opt/zhiyun-gateway/backend'
ENV='/opt/zhiyun-gateway/gateway.env'
CANDIDATE=ROOT/'dist/speech-repair-0.20.81-candidate'
FILES={name:CANDIDATE/name for name in ('server.py','speech_stream.py','install.user.js','install.meta.js','extension.zip')}
def sha(data):return hashlib.sha256(data).hexdigest()
def plan():
    content={name:path.read_bytes() for name,path in FILES.items()}
    assert ('// @version      '+VERSION).encode() in content['install.meta.js']
    return content,{'version':VERSION,'host':HOST,'remote_directory':REMOTE,'files':{name:{'bytes':len(data),'sha256':sha(data)} for name,data in content.items()},'steps':['backup the five files, gateway.env and a consistent SQLite snapshot','upload and hash-check five candidates','compile the two Python candidates','replace five files and only RELEASE_VERSION in gateway.env','gracefully recreate the existing gateway container with its current limits/network/mounts','verify public health and exact installer, metadata and ZIP hashes','retain backups; restore old files/env/container automatically on activation failure']}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--deploy',action='store_true');args=parser.parse_args()
    content,report=plan()
    if not args.deploy:
        print(json.dumps(report,ensure_ascii=False,indent=2));return
    sys.path.insert(0,str(ROOT/'.testdeps/ssh'));import paramiko
    client=paramiko.SSHClient();client.load_host_keys(str(ROOT/'backend/.known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
    password=getpass.getpass('SSH password (hidden, not stored): ')
    try:client.connect(HOST,username='root',password=password,look_for_keys=False,allow_agent=False,timeout=12,auth_timeout=15)
    finally:password=None
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');backup=REMOTE+'/.rollback-speech-'+VERSION+'-'+stamp
    sftp=client.open_sftp();old='zhiyun-gateway-before-speech-'+stamp;activated=False;renamed=False;settings_changed=False
    def command(cmd,timeout=180):
        _,out,err=client.exec_command(cmd,timeout=timeout);result=out.read().decode();error=err.read().decode();status=out.channel.recv_exit_status()
        if status:raise RuntimeError('Fixed deployment step failed (exit '+str(status)+', stderr present='+str(bool(error))+')')
        return result.strip()
    q=shlex.quote
    try:
        config=json.loads(command('docker inspect zhiyun-gateway'))[0]
        assert config['Config']['WorkingDir']=='/app' and config['Config']['User']=='10001:10001'
        assert {m['Source']:m['Destination'] for m in config['Mounts'] if m['Type']=='bind'}=={'/opt/zhiyun-gateway/backend':'/app/backend','/opt/zhiyun-gateway/data':'/data'}
        networks=list(config['NetworkSettings']['Networks']);assert len(networks)==1 and networks[0]=='deploy_internal'
        sftp.mkdir(backup,0o700)
        for name,data in content.items():
            dest=REMOTE+'/'+name;assert stat.S_ISREG(sftp.stat(dest).st_mode)
            command('cp '+q(dest)+' '+q(backup+'/'+name));sftp.chmod(backup+'/'+name,0o600)
            candidate=dest+'.candidate-speech-'+stamp
            with sftp.open(candidate,'wb') as f:f.set_pipelined(True);f.write(data)
            sftp.chmod(candidate,0o644)
            assert command('sha256sum '+q(candidate)).split()[0]==sha(data)
        for name in ('server.py','speech_stream.py'):
            code="compile(open('/app/backend/"+name+'.candidate-speech-'+stamp+"').read(),'"+name+"','exec')"
            command('docker exec zhiyun-gateway python -c '+q(code))
        snapshot='/data/gateway-before-speech-'+VERSION+'-'+stamp+'.sqlite3'
        code="import sqlite3,os; a=sqlite3.connect(os.environ['DATABASE_PATH']); b=sqlite3.connect('"+snapshot+"'); a.backup(b); b.close(); a.close(); os.chmod('"+snapshot+"',0o600)"
        command('docker exec zhiyun-gateway python -c '+q(code))
        command('cp '+q(ENV)+' '+q(backup+'/gateway.env'));sftp.chmod(backup+'/gateway.env',0o600)
        with sftp.open(ENV,'rb') as f:settings=f.read(sftp.stat(ENV).st_size).decode()
        settings='\n'.join(line for line in settings.splitlines() if not line.startswith('RELEASE_VERSION='))+'\nRELEASE_VERSION='+VERSION+'\n'
        with sftp.open(ENV,'wb') as f:f.write(settings.encode())
        sftp.chmod(ENV,0o600);settings=None;settings_changed=True
        for name in FILES:sftp.posix_rename(REMOTE+'/'+name+'.candidate-speech-'+stamp,REMOTE+'/'+name)
        activated=True
        command('docker stop --time 130 zhiyun-gateway');command('docker rename zhiyun-gateway '+q(old));renamed=True
        h=config['HostConfig']
        argv=['docker','run','-d','--name','zhiyun-gateway','--restart','unless-stopped','--stop-timeout','130','--network',networks[0],'--user','10001:10001','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--memory',str(h['Memory']),'--cpus',str((h['NanoCpus'] or 500000000)/1000000000),'--pids-limit',str(h['PidsLimit'] or 64),'--cap-drop','ALL','--security-opt','no-new-privileges:true','--env-file',ENV,'-v','/opt/zhiyun-gateway/backend:/app/backend:ro','-v','/opt/zhiyun-gateway/data:/data:rw','-w','/app',config['Config']['Image'],'python','backend/server.py','serve']
        command(' '.join(q(a) for a in argv));healthy=False
        for _ in range(20):
            try:
                with urllib.request.urlopen(ORIGIN+'/health',timeout=5) as response:health=json.load(response);healthy=response.status==200 and health['ok'] and health['capabilities']['speech_stream']
                if healthy:break
            except Exception:pass
            time.sleep(1)
        assert healthy,'Gateway did not recover'
        for name,data in content.items():assert command('sha256sum '+q(REMOTE+'/'+name)).split()[0]==sha(data)
        public={}
        for name in ('install.user.js','install.meta.js','extension.zip'):
            with urllib.request.urlopen(urllib.request.Request(ORIGIN+'/'+name,headers={'Cache-Control':'no-cache'}),timeout=30) as response:data=response.read()
            assert data==content[name],'Public file mismatch'
            public[name]={'bytes':len(data),'sha256':sha(data)}
        report.update(status='deployed_and_verified',backup=backup,database_backup=snapshot,previous_container=old,public_files=public,health=health)
        (ROOT/'backend/acceptance-0.20.81.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print('PASS: deployed and verified '+VERSION+'; backups retained; no account/credit changes.',flush=True)
    except Exception:
        if activated or settings_changed:
            for name in FILES:command('cp '+q(backup+'/'+name)+' '+q(REMOTE+'/'+name));sftp.chmod(REMOTE+'/'+name,0o644)
            command('cp '+q(backup+'/gateway.env')+' '+q(ENV));sftp.chmod(ENV,0o600)
        if renamed:
            try:command('docker rm -f zhiyun-gateway')
            except Exception:pass
            command('docker rename '+q(old)+' zhiyun-gateway');command('docker start zhiyun-gateway')
        elif activated:command('docker start zhiyun-gateway')
        raise
    finally:sftp.close();client.close()
if __name__=='__main__':main()
