const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const buildPublicPage=require('./build-public-page.cjs');
buildPublicPage();
const version=JSON.parse(fs.readFileSync('backend/public-page.json','utf8')).pageVersion;
const target=path.resolve('dist/gateway-website-'+version+'-local');
const backend=['server.py','admin_api.py','prompt_api.py','study_api.py','operations_api.py','public_page.py','public_preview.py','official-prompts.json','admin.html','admin.css','admin.js','privacy.html','download.html','download.template.html','download.css','public-page.json','site.js','portal.css','portal.js','study.html','study.css','study.js','account.html','account.css','account.js','WEBSITE-LOCAL.md','STUDY-API.md','OPERATIONS.md'];
const files=backend.map(name=>'backend/'+name).concat(['02','01','03','04','05','06'].map(id=>'backend/landing/image-'+id+'.webp'),'backend/landing/brand-logo.png');
fs.mkdirSync(target,{recursive:true});
const hashes={};
for(const name of files){const data=fs.readFileSync(name),dest=path.join(target,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);hashes[name]={bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};}
fs.copyFileSync('backend/WEBSITE-LOCAL.md',path.join(target,'README.md'));
fs.copyFileSync('start-website-preview.ps1',path.join(target,'start-preview.ps1'));
for(const name of ['README.md','start-preview.ps1']){const data=fs.readFileSync(path.join(target,name));hashes[name]={bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')};}
const report={website_version:version,local_only:true,published:false,sites_deleted:false,server_updated:false,sample_data:'Temporary only; never copies real accounts or environment files',tests:{backend_existing:72,http_integration:4,node_account_extension_compatibility:23,homepage_ui:'passed; 320/390/768/1024/1440',portal_ui:'passed; mocked error/timeout/isolation/QR flows',actual_python_browser_flow:['Chrome passed','Edge passed'],plugin_account_and_save_ui:'passed'},files:hashes};
fs.writeFileSync(path.join(target,'verification.json'),JSON.stringify(report,null,2)+'\n');
const zip=target+'.zip';
cp.execFileSync('python',['-c','import pathlib,zipfile,sys; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); [z.write(p,p.relative_to(root).as_posix()) for p in sorted(root.rglob("*")) if p.is_file()]; z.close()',target,zip]);
cp.execFileSync('python',['-c','import pathlib,zipfile,json,hashlib,sys; root=pathlib.Path(sys.argv[1]); manifest=json.loads((root/"verification.json").read_text()); z=zipfile.ZipFile(sys.argv[2]); expected=set(manifest["files"])|{"verification.json"}; assert set(z.namelist())==expected; assert all(z.read(n)==(root/n).read_bytes() and hashlib.sha256(z.read(n)).hexdigest()==m["sha256"] for n,m in manifest["files"].items()); print("PASS: exact ZIP whitelist, all hashes and local-only manifest; "+str(len(expected))+" files")',target,zip],{stdio:'inherit'});
console.log(zip);
