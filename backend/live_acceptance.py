"""Explicit deployment acceptance: synthetic preview image and generated speech only."""
import base64, io, json, sys, time, urllib.error, urllib.request, uuid, wave
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parent.parent
origin=json.loads((ROOT/'gateway.config.json').read_text(encoding='utf-8'))['url']
headers={'Content-Type':'application/json','X-App-Id':'zhiyun-subtitles','X-Client-Type':'userscript'}
report={}
def request(path,body=None,extra=None):
    return urllib.request.urlopen(urllib.request.Request(origin+path,None if body is None else json.dumps(body).encode(),{**headers,**(extra or {})},method='GET' if body is None else 'POST'),timeout=120)
def status(path):
    try:
        with request(path) as r:return r.status
    except urllib.error.HTTPError as e:return e.code
with request('/health') as r:
    assert r.status==200 and json.loads(r.read())['ok']
with request('/install.user.js') as r:
    installed=r.read();expected=(ROOT/'backend/install.user.js').read_bytes();assert installed==expected
with request('/install.meta.js') as r:
    metadata=r.read();assert metadata==(ROOT/'backend/install.meta.js').read_bytes();assert b'0.19.1' in metadata
report['installer']={'version':'0.19.1','script_matches_build':True,'update_metadata_matches':True}
assert status('/v1/me')==401
try:
    request('/v1/ark/responses',{'model':'doubao-seed-2-1-lite-260915','input':[{'role':'user','content':'test'}]})
    raise AssertionError('Guest AI must require login')
except urllib.error.HTTPError as e:assert e.code==401
print('PASS: public health, exact installer/update metadata, guest AI and account protection.',flush=True)
# Pad generated speech to exactly the same 12-second recording window as calibration.
with wave.open(str(ROOT/'.testdeps/guest-speech-check.wav'),'rb') as wav:
    assert (wav.getnchannels(),wav.getsampwidth(),wav.getframerate())==(1,2,16000)
    samples=wav.readframes(wav.getnframes())[:12*16000*2]
samples=samples.ljust(12*16000*2,b'\0')
audio=io.BytesIO()
with wave.open(audio,'wb') as wav:
    wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(samples)
job={'X-Api-Request-Id':str(uuid.uuid4())};began=time.monotonic()
with request('/v1/speech/submit',{'audio':{'data':base64.b64encode(audio.getvalue()).decode()}},job) as r:
    assert r.status==200;code=r.headers.get('X-Api-Status-Code');assert code in ('20000000','20000001','20000002');r.read()
utterances=[]
for attempt in range(30):
    time.sleep(2)
    with request('/v1/speech/query',{},job) as r:
        code=r.headers.get('X-Api-Status-Code');data=json.loads(r.read())
    if code=='20000000':
        utterances=data.get('result',{}).get('utterances',[]);break
    assert code in ('20000001','20000002')
assert utterances,'Guest speech did not return timestamped utterances'
transcript=' '.join(u.get('text','') for u in utterances)
assert 'hello' in transcript.lower() and 'world' in transcript.lower()
report['guest_speech']={'logged_in':False,'audio_seconds':12,'utterances':len(utterances),'seconds':round(time.monotonic()-began,2),'recognized_known_phrase':True}
print('PASS: real 12-second guest speech without login; timestamped Hello world recognized.',flush=True)
# Login credentials stay in the existing ignored account file; no values are printed.
account=json.loads((ROOT/'backend/.bootstrap-account.json').read_text(encoding='utf-8'))
with request('/v1/auth/login',account) as r:token=json.loads(r.read())['token']
auth={'Authorization':'Bearer '+token}
try:
    image='data:image/png;base64,'+base64.b64encode((ROOT/'simple-ui-preview.png').read_bytes()).decode()
    body={'model':'doubao-seed-2-1-lite-260915','stream':True,'store':False,'max_output_tokens':2200,'reasoning':{'effort':'minimal'},'input':[{'role':'user','content':[{'type':'input_text','text':'请用一句中文解释图中课件标题的含义。仅回答课件内容，不讨论插件界面。'},{'type':'input_image','image_url':image}]}]}
    began=time.monotonic();first_text=None;deltas=0;answer='';completed=None
    with request('/v1/ark/responses',body,auth) as r:
        assert r.status==200 and 'text/event-stream' in r.headers.get('Content-Type','')
        for raw in r:
            line=raw.decode('utf-8').strip()
            if not line.startswith('data:'):continue
            event=json.loads(line[5:].strip())
            if event['type']=='response.output_text.delta':
                if first_text is None:first_text=time.monotonic()-began
                deltas+=1;answer+=event.get('delta','')
            elif event['type']=='response.completed':completed=event['response']
            elif event['type']=='error':raise RuntimeError(event.get('message','Stream failed'))
    total=time.monotonic()-began
    assert completed and completed.get('status')=='completed' and answer.strip() and deltas>1
    assert completed.get('usage',{}).get('total_tokens',0)>0
    assert first_text is not None and first_text<total
    report['screenshot_stream']={'http':200,'first_text_seconds':round(first_text,2),'completed_seconds':round(total,2),'delta_events':deltas,'answer_characters':len(answer),'usage_recorded':True}
    print('PASS: real screenshot answer streamed before completion; usage returned.',flush=True)
finally:
    with request('/v1/auth/logout',{},auth) as r:r.read()
report['verified_at']='2026-10-09 Asia/Shanghai'
(ROOT/'backend/acceptance-0191.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
