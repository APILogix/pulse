-- Destructive, schema-scoped application-data reset. Run in the intended schema.
-- Migration ledgers are deliberately excluded and no CASCADE is used, so a ledger
-- dependency causes a safe failure instead of truncating the ledger.
BEGIN;
DO $$
DECLARE
  target_schema TEXT := current_schema();
  table_list TEXT;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
    INTO table_list
    FROM pg_tables
   WHERE schemaname = target_schema
     AND tablename NOT IN ('schema_migrations', 'migrations', 'flyway_schema_history',
                           'goose_db_version', 'knex_migrations', 'typeorm_migrations',
                           '_prisma_migrations', 'databasechangelog', 'databasechangeloglock');
  IF table_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || table_list || ' RESTART IDENTITY';
  END IF;
END $$;
COMMIT;
