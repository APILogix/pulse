-- PrimaryDB Canonical Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
-- Vector extension (Docker pgvector or host-compiled)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'vector extension not available on this host, skipping';
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
