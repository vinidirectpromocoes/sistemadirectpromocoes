"""Install a local daily job. Credential bootstrap file must have mode 0600."""
import argparse, json, os, plistlib, secrets, shutil, subprocess, sys
from pathlib import Path
from backup_agent import SERVICE

def main():
    p=argparse.ArgumentParser();p.add_argument('--credential-file',type=Path);p.add_argument('--source',type=Path,required=True);args=p.parse_args();os.umask(0o077)
    if args.credential_file:
        if args.credential_file.stat().st_mode & 0o077:raise ValueError('Credencial com permissões inseguras')
        credential=json.loads(args.credential_file.read_text());token=credential['token']
        if len(token)!=64 or any(c not in '0123456789abcdef' for c in token):raise ValueError('Credencial inválida')
        for account,value in [('agent',token),('encryption',secrets.token_hex(32))]:
            # Preserve the encryption key across reinstallation, to retain recovery of old copies.
            if account=='encryption' and subprocess.run(['/usr/bin/security','find-generic-password','-s',SERVICE,'-a',account],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:continue
            subprocess.run(['/usr/bin/security','add-generic-password','-U','-s',SERVICE,'-a',account,'-w',value],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        args.credential_file.unlink()
    folder=Path.home()/'Library/Application Support/Direct/BackupAgent';folder.mkdir(parents=True,exist_ok=True)
    for name in ('backup_agent.py','restore_backup.py','verify_recovery.py'):
        shutil.copyfile(args.source/'scripts'/name,folder/name)
    # Keep the scheduled job outside protected Documents and Git's shared worktree metadata.
    copied=folder/'Source';copied.mkdir(exist_ok=True)
    files=subprocess.check_output(['git','ls-files','-z'],cwd=args.source).decode().split('\0')
    for name in files:
        if not name or name.startswith(('.env','.design-qa','supabase/.temp','node_modules','.git/')):continue
        origin=args.source/name
        if origin.is_file() and not origin.is_symlink():
            destination=copied/name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(origin,destination)
    metadata={'files':[n for n in files if n and (copied/n).is_file()],'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.source,text=True).strip(),'changed':bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=args.source))}
    (copied/'.direct-source-manifest.json').write_text(json.dumps(metadata))
    target=Path.home()/'Library/Application Support/Direct/Backups';target.mkdir(parents=True,exist_ok=True)
    argv=[sys.executable,str(folder/'backup_agent.py'),'--source',str(copied),'--target',str(target)]
    cloud=Path.home()/'Library/Mobile Documents/com~apple~CloudDocs'
    if cloud.is_dir():argv+=['--mirror',str(cloud/'Direct Backups')]
    label='br.com.direct.backup';job=Path.home()/'Library/LaunchAgents'/f'{label}.plist';job.parent.mkdir(parents=True,exist_ok=True)
    job.write_bytes(plistlib.dumps({'Label':label,'ProgramArguments':argv,'StartCalendarInterval':{'Hour':2,'Minute':15},'RunAtLoad':True,'StandardOutPath':str(folder/'backup.log'),'StandardErrorPath':str(folder/'error.log'),'ProcessType':'Background'}))
    subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}',str(job)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(job)],check=True,stdout=subprocess.DEVNULL)
    print('Rotina diária instalada; executa às 02:15 ou quando o Mac retomar a sessão. Credenciais no Chaves do macOS.')
if __name__=='__main__':main()
