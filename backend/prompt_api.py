"""Account-owned prompt catalog; prompt bodies never enter activity/audit logs."""
import json
import re
import time
import uuid
from pathlib import Path
try:
    from .admin_api import Fault
except ImportError:
    from admin_api import Fault


def migrate_prompts(db):
    db.executescript('''
CREATE TABLE IF NOT EXISTS prompt_templates(
 app TEXT NOT NULL, owner INTEGER NOT NULL, id TEXT NOT NULL,
 label TEXT NOT NULL, prompt TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 enabled INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL,
 PRIMARY KEY(app,owner,id));
CREATE TABLE IF NOT EXISTS prompt_catalog_seeds(version INTEGER PRIMARY KEY);
''')
    db.execute('BEGIN IMMEDIATE')
    if not db.execute('SELECT 1 FROM prompt_catalog_seeds WHERE version=1').fetchone():
        seeds=json.loads(Path(__file__).with_name('official-prompts.json').read_text(encoding='utf-8'))
        for item in seeds:
            db.execute('INSERT OR IGNORE INTO prompt_templates(app,owner,id,label,prompt,updated) VALUES(?,0,?,?,?,?)',
                       ('zhiyun-subtitles',item['id'],item['label'],item['prompt'],int(time.time())))
        db.execute('INSERT INTO prompt_catalog_seeds VALUES(1)')


class PromptMixin:
    def prompt_request(self,method,path,user,app,body):
        official=path.startswith('/v1/admin/prompts')
        if official and not user['is_admin']:
            raise Fault(403,'仅管理员可维护官方提示词')
        owner=0 if official else user['id']
        with self.db() as db:
            if method=='GET' and path in ('/v1/prompts','/v1/admin/prompts'):
                rows=db.execute('SELECT id,label,prompt,revision,enabled,updated,owner FROM prompt_templates WHERE app=? AND owner IN (0,?) ORDER BY owner,id',
                                (app,0 if official else owner)).fetchall()
                return 200,{}, {'prompts':[{**{k:r[k] for k in ('id','label','prompt','revision','enabled','updated')},
                                           'scope':'official' if r['owner']==0 else 'personal'} for r in rows if official or r['enabled']]}
            if method!='POST' or path not in ('/v1/prompts/save','/v1/prompts/delete','/v1/admin/prompts/save','/v1/admin/prompts/delete'):
                raise Fault(404,'提示词接口不存在')
            key=body.get('id')
            if key is None and path.endswith('/save'):
                key=('official-' if official else 'user-')+str(uuid.uuid4())
            pattern=r'[a-z][a-z0-9-]{0,79}' if official else r'user-[a-z0-9-]{1,75}'
            if not isinstance(key,str) or not re.fullmatch(pattern,key) or official and key.startswith('user-'):
                raise Fault(400,'提示词 ID 无效')
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT revision FROM prompt_templates WHERE app=? AND owner=? AND id=?',(app,owner,key)).fetchone()
            revision=body.get('revision')
            if type(revision) is not int or revision<0:
                raise Fault(400,'请提供提示词 revision；新建时为 0')
            if revision!=(old['revision'] if old else 0):
                raise Fault(409,'提示词已在其他设备修改，请刷新后重试','prompt_conflict')
            if path.endswith('/delete'):
                if not old: raise Fault(404,'提示词不存在')
                db.execute('DELETE FROM prompt_templates WHERE app=? AND owner=? AND id=?',(app,owner,key))
            else:
                label,prompt=body.get('label'),body.get('prompt')
                if not isinstance(label,str) or not 1<=len(label.strip())<=50 or not isinstance(prompt,str) or not 1<=len(prompt.strip())<=1800:
                    raise Fault(400,'名称为 1–50 字，提示词为 1–1800 字')
                enabled=body.get('enabled',True)
                if type(enabled) is not bool: raise Fault(400,'enabled 必须为布尔值')
                if not old and db.execute('SELECT COUNT(*) FROM prompt_templates WHERE app=? AND owner=?',(app,owner)).fetchone()[0]>=(100 if official else 30):
                    raise Fault(400,'官方最多 100 个、个人最多 30 个提示词')
                db.execute('INSERT INTO prompt_templates VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(app,owner,id) DO UPDATE SET label=excluded.label,prompt=excluded.prompt,revision=excluded.revision,enabled=excluded.enabled,updated=excluded.updated',
                           (app,owner,key,label.strip(),prompt.strip(),revision+1,1 if enabled or not official else 0,int(time.time())))
            if official:
                db.execute('INSERT INTO admin_actions(actor,target,app,action,created,details) VALUES(?,NULL,?,?,?,?)',
                           (user['id'],app,'prompt_delete' if path.endswith('/delete') else 'prompt_save',int(time.time()),json.dumps({'id':key})))
        return 200,{}, {'ok':True,'id':key,'revision':revision+1}
