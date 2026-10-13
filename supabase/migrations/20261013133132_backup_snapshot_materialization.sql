-- Evaluate each complete snapshot once. Preserve every table, row, role and backup format.
-- Nested wrappers otherwise repeat the older snapshot while producing tables and counts.
do $$declare f record;ddl text;optimized text;begin
 for f in select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='direct_private' and p.proname in ('backup_snapshot_v8','backup_snapshot_v9','backup_snapshot_v10','backup_snapshot_v11') loop
  ddl:=pg_catalog.pg_get_functiondef(f.oid);
  optimized:=pg_catalog.regexp_replace(ddl,'with[[:space:]]+data[[:space:]]+as[[:space:]]*[(]','with data as materialized (','gi');
  if optimized<>ddl then execute optimized;end if;
 end loop;
end$$;
