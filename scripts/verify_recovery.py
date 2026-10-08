"""Verify a persisted full bundle and rehearse its operational restore in a temporary database."""
import argparse, base64, json, os, tempfile, zipfile, io
from pathlib import Path
from backup_agent import decrypt, validate_bundle, keychain
from restore_backup import restore_operational
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def verify(path, password):
    content=decrypt(path.read_bytes(),password);checked=validate_bundle(content)
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        operational=json.loads(bundle.read('database.json'))['data']
        operational['attachments']={r['caminho']:base64.b64encode(bundle.read('evidencias/'+r['caminho'])).decode() for r in operational['tables'].get('empresa_anexos',[])}
    # Compatibility bridge; all intermediate files remain private and are removed after the drill.
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='direct-recovery-drill-') as directory:
        salt,iv=os.urandom(16),os.urandom(12);key=__import__('hashlib').pbkdf2_hmac('sha256',password.encode(),salt,200000,32)
        encrypted=AESGCM(key).encrypt(iv,json.dumps(operational).encode(),None)
        b64=lambda v:base64.b64encode(v).decode();archive=Path(directory)/'operational.json'
        archive.write_text(json.dumps({'format':'direct-encrypted-v1','salt':b64(salt),'iv':b64(iv),'data':b64(encrypted)}))
        counts=restore_operational(archive,password,Path(directory)/'isolated.db')
        if counts!={t:operational['snapshot']['counts'].get(t,0) for t in counts}:raise ValueError('Restauração divergente')
    return checked
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('file',type=Path);args=parser.parse_args()
    print(json.dumps({'state':'ok','operational_restore':'isolated SQLite',**verify(args.file,keychain('encryption'))}))
