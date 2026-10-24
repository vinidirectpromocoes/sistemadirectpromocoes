"""Compare the published static files with the reviewed Git checkout."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import re
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


def tracked_assets(root):
    paths = subprocess.check_output(
        ['git', 'ls-files', '-z', '--', 'static/'], cwd=root
    ).decode().split('\0')
    assets = {}
    for name in filter(None, paths):
        source = root / name
        if source.is_symlink() or not source.is_file():
            raise ValueError('Arquivo publicado ausente ou simbólico: ' + name)
        assets[str(Path(name).relative_to('static'))] = source.read_bytes()
    if not assets:
        raise ValueError('Nenhum arquivo versionado para verificar.')
    return assets


def check_assets(site, assets):
    if not assets:
        raise ValueError('A lista de arquivos não pode estar vazia.')

    def check(item):
        name, expected = item
        digest = hashlib.sha256(expected).hexdigest()
        request = Request(
            site.rstrip('/') + '/' + quote(name, safe='/') + '?direct_sha=' + digest,
            headers={'Cache-Control': 'no-cache', 'User-Agent': 'Direct-Deploy-Verification'},
        )
        try:
            with urlopen(request, timeout=10) as response:
                actual = response.read(len(expected) + 1)
                if response.status != 200:
                    return {'path': name, 'error': 'HTTP ' + str(response.status)}
            if hashlib.sha256(actual).hexdigest() != digest:
                return {'path': name, 'error': 'Conteúdo diferente do código revisado'}
        except HTTPError as error:
            return {'path': name, 'error': 'HTTP ' + str(error.code)}
        except (URLError, OSError, TimeoutError) as error:
            return {'path': name, 'error': type(error).__name__}
        return None

    with ThreadPoolExecutor(max_workers=16) as pool:
        return [failure for failure in pool.map(check, assets.items()) if failure]


def superseded(root, expected_commit):
    if not re.fullmatch(r'[a-f0-9]{40}', expected_commit):
        raise ValueError('Commit esperado inválido.')
    result = subprocess.run(
        ['git', 'ls-remote', 'origin', 'refs/heads/main'], cwd=root,
        capture_output=True, text=True, timeout=20, check=True,
    )
    fields = result.stdout.split()
    if len(fields) != 2 or not re.fullmatch(r'[a-f0-9]{40}', fields[0]):
        raise ValueError('Não foi possível conferir a versão principal.')
    return fields[0] != expected_commit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', default='https://sistemadirectpromocoes-zeta.vercel.app')
    parser.add_argument('--expected-commit')
    args = parser.parse_args()
    if urlsplit(args.site).scheme != 'https':
        parser.error('A verificação de produção exige HTTPS.')
    root = Path(__file__).resolve().parents[1]
    assets = tracked_assets(root)
    for attempt in range(1, 4):
        if args.expected_commit and superseded(root, args.expected_commit):
            print(json.dumps({'status': 'superseded', 'commit': args.expected_commit}))
            return 0
        failures = check_assets(args.site, assets)
        if not failures:
            print(json.dumps({'status': 'ok', 'files': len(assets), 'site': args.site}))
            return 0
        print(json.dumps({'status': 'waiting' if attempt < 3 else 'error',
                          'attempt': attempt, 'mismatches': len(failures),
                          'details': failures[:5]}, ensure_ascii=False), flush=True)
        if attempt < 3:
            time.sleep(10)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
