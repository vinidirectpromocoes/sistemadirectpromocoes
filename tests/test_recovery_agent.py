import io, json, sys, tempfile, unittest, zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import backup_agent as agent
from restore_backup import ALL_TABLES
class RecoveryAgentTests(unittest.TestCase):
    def data(self):
        tables={t:[] for t in ALL_TABLES}
        return {'format':'direct-recovery-v1','exportedAt':'2026-10-04T12:00:00Z','data':{'format':'direct-data-v10','tables':tables,'snapshot':{'consistent':True,'counts':{t:0 for t in tables}}},'auth':{'users':[{'id':'test-user'}],'identities':[{'user_id':'test-user'}]}}
    def test_encryption_tamper_and_wrong_password(self):
        original=agent.bundle(self.data(),Path(__file__).resolve().parents[1]);encrypted=agent.encrypt(original,'test-password')
        self.assertEqual(agent.validate_bundle(agent.decrypt(encrypted,'test-password'))['tables'],len(ALL_TABLES))
        with self.assertRaises(Exception):agent.decrypt(encrypted,'wrong')
        corrupted=json.loads(encrypted);corrupted['content']=corrupted['content'][:-4]+'AAAA'
        with self.assertRaises(Exception):agent.decrypt(json.dumps(corrupted).encode(),'test-password')
    def test_v10_real_photos_and_enterprise_records_restore_encrypted_bundle(self):
        import base64, hashlib, sqlite3
        from verify_recovery import verify
        data=self.data();raw=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3FYAAAAASUVORK5CYII=');sha=hashlib.sha256(raw).hexdigest();photo_path='1/'+sha
        tables=data['data']['tables'];tables['empresa_registros']=[dict(id=1,tipo='cliente',titulo='Cliente fictício do ensaio',status='ativo',dados={'segmento':'eventos'},chave='qa-recovery-record',versao=1,autor='QA',criado_em='2026-10-08T12:00:00Z',atualizado_em='2026-10-08T12:00:00Z')]
        tables['empresa_anexos']=[dict(id=1,registro_id=1,nome='foto.png',mime='image/png',bytes=len(raw),caminho=photo_path,sha256=sha,criado_em='2026-10-08T12:00:00Z',autor='QA')]
        data['data']['snapshot']['counts']={t:len(r) for t,r in tables.items()}
        content=agent.bundle(data,Path(__file__).resolve().parents[1],{photo_path:raw});self.assertEqual(agent.validate_bundle(content)['attachments'],1)
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'complete.directbackup';target.write_bytes(agent.encrypt(content,'qa-recovery-password'));result=verify(target,'qa-recovery-password');self.assertEqual(result['attachments'],1)
        with self.assertRaises(ValueError):agent.bundle(data,Path(__file__).resolve().parents[1],{photo_path:raw+b'corrupt'})

    def test_orphan_identity_and_missing_table_rejected(self):
        for mutate in [lambda d:d['auth']['identities'].append({'user_id':'missing'}),lambda d:d['data']['tables'].pop('pedidos')]:
            data=self.data();mutate(data)
            with self.assertRaises(ValueError):agent.bundle(data,Path(__file__).resolve().parents[1])
    def test_real_file_and_secondary_copy_verified(self):
        calls=[]
        def rpc(name,payload):
            calls.append((name,payload));return self.data() if name=='direct_backup_bundle' else None
        with tempfile.TemporaryDirectory() as directory,patch.object(agent,'keychain',return_value='test-secret'),patch.object(agent,'rpc',side_effect=rpc):
            root=Path(directory);agent.run(Path(__file__).resolve().parents[1],root/'primary',root/'mirror')
            first=next((root/'primary').glob('*.directbackup'));second=next((root/'mirror').glob('*.directbackup'))
            self.assertEqual(first.read_bytes(),second.read_bytes());self.assertEqual(first.stat().st_mode&0o777,0o600)
            self.assertTrue(calls[-1][1]['p_verified']);self.assertTrue(calls[-1][1]['p_ok'])
if __name__=='__main__':unittest.main()
