-- Destructive, schema-scoped application-relation teardown. Run in the intended schema.
-- Migration ledgers are excluded. No CASCADE is used: unexpected dependencies,
-- including a ledger dependency, fail safely rather than deleting extra objects.
BEGIN;
DO $$
DECLARE
  target_schema TEXT := current_schema();
  object_list TEXT;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO object_list
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = target_schema AND c.relkind = 'v'
     AND c.relname NOT IN ('schema_migrations', 'migrations', 'flyway_schema_history', 'goose_db_version', 'knex_migrations', 'typeorm_migrations', '_prisma_migrations', 'databasechangelog', 'databasechangeloglock');
  IF object_list IS NOT NULL THEN EXECUTE 'DROP VIEW ' || object_list; END IF;
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO object_list
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = target_schema AND c.relkind = 'm';
  IF object_list IS NOT NULL THEN EXECUTE 'DROP MATERIALIZED VIEW ' || object_list; END IF;
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO object_list
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = target_schema AND c.relkind IN ('r', 'p')
     AND c.relname NOT IN ('schema_migrations', 'migrations', 'flyway_schema_history', 'goose_db_version', 'knex_migrations', 'typeorm_migrations', '_prisma_migrations', 'databasechangelog', 'databasechangeloglock');
  IF object_list IS NOT NULL THEN EXECUTE 'DROP TABLE ' || object_list; END IF;
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO object_list
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = target_schema AND c.relkind = 'f';
  IF object_list IS NOT NULL THEN EXECUTE 'DROP FOREIGN TABLE ' || object_list; END IF;
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO object_list
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = target_schema AND c.relkind = 'S';
  IF object_list IS NOT NULL THEN EXECUTE 'DROP SEQUENCE ' || object_list; END IF;
END $$;
COMMIT;
