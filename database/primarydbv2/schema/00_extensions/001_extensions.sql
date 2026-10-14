-- Source: canonical_migrations_draft/00_shared/001_enable_pgcrypto.up.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Source: canonical_migrations_draft/18_ai/001_extensions.up.sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Optional native C extension for RFC 9562 UUIDv7
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- Safe fallback when compiled pg_uuidv7 library is not present on host OS
END $$;

