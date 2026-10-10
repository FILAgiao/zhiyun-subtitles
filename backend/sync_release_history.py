import sys,getpass,re,json,hashlib
from pathlib import Path
sys.path.insert(0,str(Path('.testdeps/ssh').resolve()))
import paramiko
root=Path(__file__).resolve().parent.parent
archive=root/'releases'
client=paramiko.SSHClient();client.load_host_keys(str(root/'backend/.known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
password=getpass.getpass('SSH password (not echoed): ')
try: client.connect('47.77.182.216',username='root',password=password,look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=15)
finally: password=None
# Read published installers only. Keep secret configuration and database outside the archive.
remote='/opt/zhiyun-gateway/backend'
program="""import os,json,base64,hashlib,re,gzip,sys
entries=[]
root='/opt/zhiyun-gateway/backend'
paths=[root+'/'+n for n in sorted(os.listdir(root),reverse=True) if n.startswith('.rollback-')]+[root]
seen=set()
for folder in paths:
    for name in ('install.user.js','zhiyun-subtitles.user.js'):
        path=folder+'/'+name
        if not os.path.isfile(path): continue
        data=open(path,'rb').read()
        m=re.search(rb'^// @version\\s+([^\\r\\n]+)',data,re.M)
        if not m: continue
        version=m.group(1).decode().strip()
        if not re.fullmatch(r'\\d+\\.\\d+\\.\\d+',version) or version in seen: continue
        seen.add(version)
        entries.append({'version':version,'source_path':path,'sha256':hashlib.sha256(data).hexdigest(),'data':base64.b64encode(data).decode()})
sys.stdout.buffer.write(gzip.compress(json.dumps(entries).encode()))
"""
import base64,shlex
command='docker exec -u 0 zhiyun-gateway python -c '+shlex.quote("import base64;exec(base64.b64decode('"+base64.b64encode(program.encode()).decode()+"'))")
# Container paths differ from host paths.
program=program.replace('/opt/zhiyun-gateway/backend','/app/backend')
command='docker exec -u 0 zhiyun-gateway python -c '+shlex.quote("import base64;exec(base64.b64decode('"+base64.b64encode(program.encode()).decode()+"'))")
try:
    _,out,err=client.exec_command(command,timeout=60)
    import gzip,time
    channel=out.channel;payload=bytearray();errors=bytearray();started=time.monotonic()
    while True:
        if channel.recv_ready(): payload.extend(channel.recv(65536))
        if channel.recv_stderr_ready(): errors.extend(channel.recv_stderr(65536))
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready(): break
        if time.monotonic()-started>60: raise TimeoutError('Remote history transfer timed out; received '+str(len(payload))+' bytes; stderr '+errors.decode(errors='replace')[:200])
        time.sleep(.01)
    assert channel.recv_exit_status()==0,errors.decode(errors='replace')[:200]
    entries=json.loads(gzip.decompress(payload))
finally: client.close()
records=json.loads((archive/'index.json').read_text(encoding='utf-8'))
seen={r['version'] for r in records}
for entry in entries:
    if entry['version'] in seen: continue
    data=base64.b64decode(entry.pop('data'));assert hashlib.sha256(data).hexdigest()==entry['sha256']
    metadata=re.search(rb'^// ==UserScript==[\s\S]*?// ==/UserScript==',data);assert metadata
    entry['source']='server-backup' if '.rollback-' in entry['source_path'] else 'server-current'
    folder=archive/('v'+entry['version']);folder.mkdir(exist_ok=True)
    (folder/'zhiyun-subtitles.user.js').write_bytes(data);(folder/'zhiyun-subtitles.meta.js').write_bytes(metadata.group()+b'\n')
    (folder/'source.json').write_text(json.dumps(entry,indent=2)+'\n',encoding='utf-8');records.append(entry);seen.add(entry['version'])
records.sort(key=lambda r:tuple(int(n) for n in r['version'].split('.')),reverse=True)
(archive/'index.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
print('Historical versions archived:',', '.join(r['version'] for r in records))
