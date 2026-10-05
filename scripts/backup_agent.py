"""Daily encrypted recovery bundle. Credentials stay in macOS Keychain, never logs."""
import argparse, hashlib, io, json, os, shutil, subprocess, tempfile, urllib.request, uuid, zipfile
from datetime import datetime, timezone
from pathlib import Path
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import base64
SERVICE = 'br.com.direct.backup'
API = 'https://jxthqgtzybcyediyciqc.supabase.co/rest/v1/rpc/'
PUBLIC_KEY = 'sb_publishable_sulYm_YcfXUosfNvhQnDXg_I4lgxjth'

def keychain(account):
    return subprocess.check_output(['/usr/bin/security','find-generic-password','-s',SERVICE,'-a',account,'-w'],stderr=subprocess.DEVNULL,text=True,timeout=15).strip()

def rpc(name, payload):
    request=urllib.request.Request(API+name,json.dumps(payload).encode(),headers={'apikey':PUBLIC_KEY,'Content-Type':'application/json'},method='POST')
    with urllib.request.urlopen(request,timeout=90) as response:
        content=response.read()
        return json.loads(content) if content else None

def encrypt(content, password):
    salt, nonce=os.urandom(16),os.urandom(12)
    key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=400000).derive(password.encode())
    aad=b'direct-recovery-encrypted-v1'
    return json.dumps({'format':aad.decode(),'iterations':400000,'salt':base64.b64encode(salt).decode(),'nonce':base64.b64encode(nonce).decode(),'content':base64.b64encode(AESGCM(key).encrypt(nonce,content,aad)).decode()},separators=(',',':')).encode()

def decrypt(content, password):
    value=json.loads(content)
    if value.get('format')!='direct-recovery-encrypted-v1' or value.get('iterations')!=400000:raise ValueError('Formato de cópia inválido')
    decode=lambda name:base64.b64decode(value[name],validate=True)
    key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=decode('salt'),iterations=value['iterations']).derive(password.encode())
    return AESGCM(key).decrypt(decode('nonce'),decode('content'),value['format'].encode())

def validate_bundle(content):
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if archive.testzip():raise ValueError('Arquivo danificado')
        data=json.loads(archive.read('database.json'))
        if data['format']!='direct-recovery-v1' or data['data']['format'] not in ('direct-data-v7','direct-data-v8'):raise ValueError('Formato inválido')
        from restore_backup import ALL_TABLES, V7_TABLES, relationship_errors
        operational=data['data'];tables=operational['tables'];required=ALL_TABLES if operational['format']=='direct-data-v8' else V7_TABLES
        if set(tables)!=set(required) or any(not isinstance(tables[t],list) for t in required):raise ValueError('Tabelas incompletas')
        if relationship_errors(tables):raise ValueError('Vínculos incompletos')
        if not operational['snapshot']['consistent'] or any(len(rows)!=operational['snapshot']['counts'][name] for name,rows in tables.items()):raise ValueError('Contagens inválidas')
        auth_ids={u['id'] for u in data['auth']['users']}
        if any(i['user_id'] not in auth_ids for i in data['auth']['identities']):raise ValueError('Identidade sem usuário')
        manifest=json.loads(archive.read('manifest.json'))
        for name,digest in manifest['files'].items():
            if hashlib.sha256(archive.read(name)).hexdigest()!=digest:raise ValueError('Código divergente')
        if not any(n.startswith('source/supabase/migrations/') for n in manifest['files']):raise ValueError('Migrações ausentes')
        return {'tables':len(tables),'records':sum(map(len,tables.values())),'auth_users':len(auth_ids),'files':len(manifest['files'])}

def bundle(data, source):
    stream=io.BytesIO();files={}
    copied_manifest=source/'.direct-source-manifest.json'
    metadata=json.loads(copied_manifest.read_text()) if copied_manifest.exists() else None
    tracked=metadata['files'] if metadata else subprocess.check_output(['git','ls-files','-z'],cwd=source).decode().split('\0')
    # Source including the agent itself; only a reviewed, explicit set of untracked directories.
    candidates=set(tracked)
    for folder in (() if metadata else ('scripts','supabase/migrations')):
        candidates.update(str(f.relative_to(source)) for f in (source/folder).rglob('*') if f.is_file())
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('database.json',json.dumps(data,ensure_ascii=False))
        for name in sorted(candidates):
            if not name or name.startswith(('.env','.design-qa','supabase/.temp','node_modules','.git/')):continue
            file=source/name
            if not file.is_file() or file.is_symlink():continue
            target='source/'+name;content=file.read_bytes();archive.writestr(target,content);files[target]=hashlib.sha256(content).hexdigest()
        archive.writestr('manifest.json',json.dumps({'format':'direct-recovery-manifest-v1','createdAt':datetime.now(timezone.utc).isoformat(),'sourceCommit':metadata['commit'] if metadata else subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip(),'workingTreeChanged':metadata['changed'] if metadata else bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=source)),'files':files,'excluded':['active sessions','backup credential','environment secrets','external provider infrastructure'],'recovery':'See source/docs/RECUPERACAO.md. Access identities are encrypted; do not publish the decrypted bundle.'}))
    result=stream.getvalue();validate_bundle(result);return result

def run(source, target, mirror=None):
    os.umask(0o077);target.mkdir(parents=True,exist_ok=True);os.chmod(target,0o700)
    token,password=keychain('agent'),keychain('encryption');run_id=str(uuid.uuid4());started=False
    try:
        data=rpc('direct_backup_bundle',{'p_token':token,'p_run':run_id});started=True
        content=bundle(data,source);encrypted=encrypt(content,password)
        checked=validate_bundle(decrypt(encrypted,password))
        name='direct-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+run_id+'.directbackup'
        final=target/name
        with tempfile.NamedTemporaryFile(dir=target,delete=False) as temp:
            temp.write(encrypted);temp.flush();os.fsync(temp.fileno());temporary=Path(temp.name)
        temporary.replace(final)
        # Verify the file actually persisted, not only the in-memory buffer.
        validate_bundle(decrypt(final.read_bytes(),password))
        if mirror:
            mirror.mkdir(parents=True,exist_ok=True);destination=mirror/name;shutil.copyfile(final,destination)
            if hashlib.sha256(destination.read_bytes()).digest()!=hashlib.sha256(encrypted).digest():raise ValueError('Cópia secundária divergente')
        digest=hashlib.sha256(encrypted).hexdigest()
        rpc('direct_backup_agent_result',{'p_token':token,'p_run':run_id,'p_ok':True,'p_checksum':digest,'p_bytes':len(encrypted),'p_verified':True,'p_message':'Cópia criptografada, código e identidades verificados. '+('Cópia secundária criada.' if mirror else 'Cópia local fora do projeto.')})
        for folder in [target]+([mirror] if mirror else []):
            for old in sorted(folder.glob('direct-*.directbackup'),key=lambda f:f.name,reverse=True)[30:]:old.unlink()
        print(json.dumps({'state':'ok','file':str(final),'sha256':digest,**checked}))
    except Exception as error:
        # Never log API bodies, credentials or personal information.
        if started:
            try:rpc('direct_backup_agent_result',{'p_token':token,'p_run':run_id,'p_ok':False,'p_checksum':None,'p_bytes':0,'p_verified':False,'p_message':'Falha na cópia: '+type(error).__name__})
            except Exception:pass
        raise RuntimeError('Backup falhou: '+type(error).__name__) from None

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--target',type=Path,required=True);parser.add_argument('--mirror',type=Path);args=parser.parse_args()
    run(args.source,args.target,args.mirror)
if __name__=='__main__':main()
