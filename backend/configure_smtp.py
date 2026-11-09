"""Enable DirectMail and the account registration page using hidden terminal prompts."""

import argparse
from datetime import datetime, timezone
import getpass
from io import BytesIO
import json
from pathlib import Path
import shlex
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


HOST = '47.77.182.216'
GATEWAY = 'zhiyun-gateway'
ROOT = Path(__file__).resolve().parent.parent
REMOTE_ROOT = '/opt/zhiyun-gateway'
ENV_FILE = REMOTE_ROOT + '/gateway.env'
ORIGIN = 'https://' + HOST + '.sslip.io/gateway'
SMTP_HOST = 'smtpdm.aliyun.com'
ACCOUNT_ASSETS = {'account.html': '/account', 'account.css': '/account.css', 'account.js': '/account.js'}
AUTH_CHECK = '''
import json, smtplib, ssl, sys
host, sender, password = json.load(sys.stdin)
with smtplib.SMTP_SSL(host, 465, timeout=12, context=ssl.create_default_context()) as smtp:
    smtp.login(sender, password)
'''


def smtp_environment(previous, sender, password):
    if not sender or not password or any(c in sender + password for c in '\r\n\0'):
        raise ValueError('Invalid sender or SMTP password.')
    settings = {
        'SMTP_HOST': SMTP_HOST, 'SMTP_PORT': '465', 'SMTP_TLS': 'ssl',
        'SMTP_FROM': sender, 'SMTP_USERNAME': sender, 'SMTP_PASSWORD': password,
    }
    keys = {key.encode() for key in settings}
    lines = [line for line in previous.splitlines() if line.partition(b'=')[0].strip() not in keys]
    lines.extend(f'{key}={value}'.encode('utf-8') for key, value in settings.items())
    return b'\n'.join(lines) + b'\n'


def remote(client, *args, data=None):
    stdin, stdout, stderr = client.exec_command(shlex.join(args), timeout=160)
    if data is not None:
        stdin.write(data)
        stdin.flush()
        stdin.channel.shutdown_write()
    output = stdout.read()
    stderr.read()
    if stdout.channel.recv_exit_status() != 0:
        # Docker/SMTP diagnostics can include secret-bearing arguments or configuration.
        raise RuntimeError('Remote step failed: ' + ' '.join(args[:2]))
    return output.decode().strip()


def inspect_container(client, name):
    return json.loads(remote(client, 'docker', 'inspect', name))[0]


def verify_public_registration(assets, stamp):
    for attempt in range(8):
        try:
            with urlopen(ORIGIN + '/health', timeout=5) as response:
                healthy = json.load(response).get('ok') is True
            with urlopen(ORIGIN + '/v1/study/capabilities', timeout=5) as response:
                capabilities = json.load(response)
            if healthy and capabilities.get('registration') is True and capabilities.get('mail_configured') is True:
                for name, route in ACCOUNT_ASSETS.items():
                    with urlopen(ORIGIN + route + '?smtp=' + stamp, timeout=8) as response:
                        if response.read() != assets[name]:
                            raise RuntimeError('Public account asset differs: ' + name)
                return
        except (URLError, TimeoutError, ValueError):
            pass
        if attempt < 7:
            time.sleep(2)
    raise RuntimeError('Public health or registration capability did not become ready.')


def configure(client, sender, password):
    assets = {name: (ROOT / 'backend' / name).read_bytes() for name in ACCOUNT_ASSETS}
    original = inspect_container(client, GATEWAY)
    config = original['Config']
    host = original['HostConfig']
    mounts = {(mount['Source'], mount['Destination'], mount['RW']) for mount in original['Mounts'] if mount['Type'] == 'bind'}
    if (not original['State']['Running'] or config['Cmd'] != ['python', 'backend/server.py', 'serve']
            or config['WorkingDir'] != '/app' or config['User'] != '10001:10001'
            or set(original['NetworkSettings']['Networks']) != {'deploy_internal'}
            or mounts != {(REMOTE_ROOT + '/backend', '/app/backend', False), (REMOTE_ROOT + '/data', '/data', True)}):
        raise RuntimeError('The live container does not match the recorded deployment. No changes made.')

    remote(client, 'docker', 'exec', '-i', GATEWAY, 'python', '-c', AUTH_CHECK,
           data=json.dumps([SMTP_HOST, sender, password]).encode())
    print('SMTP TLS login verified from the server.', flush=True)

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    staged_file = ENV_FILE + '.smtp-stage-' + stamp
    backup_file = ENV_FILE + '.before-smtp-' + stamp
    rollback_name = GATEWAY + '-before-smtp-' + stamp
    candidate_name = GATEWAY + '-smtp-stage-' + stamp
    asset_dir = REMOTE_ROOT + '/backend/'
    asset_suffix = '.smtp-stage-' + stamp
    asset_backup = REMOTE_ROOT + '/account-before-smtp-' + stamp
    candidate_id = None
    stopped = renamed = activated = False
    updated_assets = []
    try:
        with client.open_sftp() as sftp:
            with sftp.open(ENV_FILE, 'rb') as current:
                previous = current.read()
            with sftp.open(staged_file, 'wx') as candidate:
                sftp.chmod(staged_file, 0o600)
                candidate.write(smtp_environment(previous, sender, password))
            for name, content in assets.items():
                sftp.putfo(BytesIO(content), asset_dir + name + asset_suffix)
                sftp.chmod(asset_dir + name + asset_suffix, 0o644)
        candidate_id = remote(
            client, 'docker', 'create', '--name', candidate_name, '--restart', 'unless-stopped',
            '--stop-timeout', '130', '--network', 'deploy_internal', '--user', config['User'],
            '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--memory', str(host['Memory']),
            '--cpus', str((host['NanoCpus'] or 500000000) / 1000000000),
            '--pids-limit', str(host['PidsLimit'] or 64), '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--env-file', staged_file,
            '-v', REMOTE_ROOT + '/backend:/app/backend:ro', '-v', REMOTE_ROOT + '/data:/data:rw',
            '-w', config['WorkingDir'], original['Image'], *config['Cmd'],
        )
        staged = inspect_container(client, candidate_id)
        old_other_env = sorted(item for item in config['Env'] if not item.startswith('SMTP_'))
        new_other_env = sorted(item for item in staged['Config']['Env'] if not item.startswith('SMTP_'))
        comparable = ('Binds', 'CapAdd', 'CapDrop', 'CpuPeriod', 'CpuQuota', 'Memory', 'MemorySwap',
                      'NanoCpus', 'NetworkMode', 'PidsLimit', 'PortBindings', 'Privileged',
                      'ReadonlyRootfs', 'RestartPolicy', 'SecurityOpt', 'Tmpfs')
        mismatches=[]
        if old_other_env != new_other_env: mismatches.append('non-SMTP environment')
        mismatches.extend(key for key in comparable if host.get(key) != staged['HostConfig'].get(key))
        if mismatches:
            raise RuntimeError('Candidate differs beyond SMTP (' + ', '.join(mismatches) + '). The live gateway was left running.')
        remote(client, 'install', '-m', '600', ENV_FILE, backup_file)
        remote(client, 'mkdir', '-m', '700', asset_backup)
        for name in assets:
            remote(client, 'cp', '-p', asset_dir + name, asset_backup + '/' + name)
        remote(client, 'docker', 'stop', '--time', '130', original['Id'])
        stopped = True
        remote(client, 'docker', 'rename', original['Id'], rollback_name)
        renamed = True
        remote(client, 'mv', '-T', staged_file, ENV_FILE)
        activated = True
        for name in assets:
            remote(client, 'mv', '-T', asset_dir + name + asset_suffix, asset_dir + name)
            updated_assets.append(name)
        remote(client, 'docker', 'rename', candidate_id, GATEWAY)
        remote(client, 'docker', 'start', candidate_id)
        verify_public_registration(assets, stamp)
    except BaseException:
        if candidate_id is not None:
            remote(client, 'docker', 'rm', '-f', candidate_id)
        if activated:
            remote(client, 'install', '-m', '600', backup_file, staged_file)
            remote(client, 'mv', '-T', staged_file, ENV_FILE)
        for name in updated_assets:
            remote(client, 'cp', '-p', asset_backup + '/' + name, asset_dir + name + asset_suffix)
            remote(client, 'mv', '-T', asset_dir + name + asset_suffix, asset_dir + name)
        if renamed:
            remote(client, 'docker', 'rename', original['Id'], GATEWAY)
        if stopped:
            remote(client, 'docker', 'start', original['Id'])
        raise
    finally:
        remote(client, 'rm', '-f', '--', staged_file, *(asset_dir + name + asset_suffix for name in assets))
    print('Online registration reports mail_configured=true.', flush=True)
    print('Previous environment backup: ' + backup_file, flush=True)
    print('Previous account page backup: ' + asset_backup, flush=True)
    print('Stopped rollback container: ' + rollback_name, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sender', required=True, help='Verified DirectMail sender address')
    args = parser.parse_args()
    if not sys.stdin.isatty():
        parser.error('Run in an interactive terminal so passwords are not echoed.')

    sys.path.insert(0, str(ROOT / '.testdeps' / 'ssh'))
    import paramiko

    try:
        with paramiko.SSHClient() as client:
            client.load_host_keys(str(ROOT / 'backend' / '.known_hosts'))
            client.set_missing_host_key_policy(paramiko.RejectPolicy())
            client.connect(HOST, username='root', password=getpass.getpass('Server SSH password: '),
                           look_for_keys=False, allow_agent=False, timeout=15, auth_timeout=15)
            configure(client, args.sender, getpass.getpass('DirectMail SMTP password: '))
    except paramiko.AuthenticationException:
        parser.exit(1, 'Server SSH authentication failed.\n')
    except (OSError, ValueError, RuntimeError, paramiko.SSHException) as error:
        message = str(error) if isinstance(error, (RuntimeError, ValueError)) else type(error).__name__
        parser.exit(1, f'SMTP configuration failed: {message}\n')


if __name__ == '__main__':
    main()
