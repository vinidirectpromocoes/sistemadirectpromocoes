"""Replay approved migrations in an isolated real PostgreSQL, never production.

Requires pgserver and psycopg2-binary in the chosen Python environment. Auth is
represented by PostgreSQL session claims; tests exercise the actual RPCs/RLS.
"""
import json
import os
import re
import sys
from pathlib import Path

if Path('/tmp/direct-qa-pg-deps').exists():
    sys.path.insert(0,'/tmp/direct-qa-pg-deps')
try:
    import pgserver
except ImportError:
    pgserver=None
import psycopg2

ROOT=Path(__file__).resolve().parents[1]
PRELUDE="""
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;end if;end$$;

create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.identities(id uuid primary key,user_id uuid);
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
grant usage on schema public,auth,extensions to anon,authenticated,service_role;
grant execute on function auth.jwt(),auth.uid() to anon,authenticated,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select,insert,delete on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
"""

def start():
    if os.environ.get('DIRECT_QA_PG_DSN'):
        from urllib.parse import urlsplit,urlunsplit
        class ExistingQA:
            def get_uri(self,database=None):
                u=urlsplit(os.environ['DIRECT_QA_PG_DSN']);return urlunsplit((u.scheme,u.netloc,'/'+(database or u.path.strip('/')),u.query,u.fragment))
            def cleanup(self):pass
        return ExistingQA()
    if pgserver is None:raise RuntimeError('Install pgserver or set DIRECT_QA_PG_DSN to a disposable PostgreSQL.')
    return pgserver.get_server(Path(os.environ.get('DIRECT_QA_PG_DIR','/tmp/direct-enterprise-postgres')),cleanup_mode='stop')

def initialize(pg,history_path):
    admin=psycopg2.connect(pg.get_uri());admin.autocommit=True
    with admin.cursor() as c:
        c.execute('drop database if exists direct_enterprise_qa with (force)')
        c.execute('create database direct_enterprise_qa')
    admin.close()
    uri=pg.get_uri(database='direct_enterprise_qa')
    db=psycopg2.connect(uri);db.autocommit=True
    db.cursor().execute(PRELUDE)
    db.cursor().execute((ROOT/'tests/fixtures/enterprise_platform_rls.sql').read_text())
    files=list((ROOT/'supabase/migrations').glob('*.sql'))
    applied=[]
    for m in json.loads(Path(history_path).read_text())['migrations']:
        name=re.sub(r'^\d+_','',m['name'])
        candidates=[p for p in files if re.sub(r'^\d+_','',p.stem)==name]
        if len(candidates)!=1:raise RuntimeError(f'Migration match requires review: {name}: {candidates}')
        path=candidates[0]
        try:db.cursor().execute(path.read_text())
        except Exception as e:raise RuntimeError(f'Local migration failed: {path.name}: {e}') from e
        applied.append(path.name)
    db.close();Path('/tmp/direct-enterprise-postgres-uri').write_text(uri)
    print(f'Isolated PostgreSQL ready: {len(applied)} approved migrations. No production data copied.')
    return uri

if __name__=='__main__':
    pg=start()
    try:
        initialize(pg,sys.argv[1] if len(sys.argv)>1 else str(ROOT/'tests/fixtures/enterprise_migration_history.json'))
    finally:pg.cleanup()
