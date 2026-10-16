-- LogDB Canonical Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Optional native C extension for RFC 9562 UUIDv7
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- Safe fallback when compiled pg_uuidv7 library is not present on host OS
END $$;
