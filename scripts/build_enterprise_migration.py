"""Build one reviewable migration from the same forms contract as the UI."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
contract=json.loads((ROOT/'static/enterprise-schema.json').read_text())
ddl="create function direct_private.empresa_contract() returns jsonb language sql immutable set search_path='' as $contract$select $json$"+json.dumps(contract,ensure_ascii=False,separators=(',',':'))+"$json$::jsonb$contract$;\n"
ddl+='\n'.join((ROOT/'scripts'/name).read_text() for name in ('enterprise_sql_base.sql','enterprise_sql_actions.sql','enterprise_sql_panels.sql','enterprise_sql_integrations.sql','enterprise_sql_backup.sql'))
(ROOT/'supabase/migrations/20261008185515_enterprise_operational_platform.sql').write_text(ddl)
print('Migration built from shared contract and reviewed SQL sources.')
