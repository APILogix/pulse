-- Extensions required by LogDB
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Optional native C extension for RFC 9562 UUIDv7
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_uuidv7;
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- Safe fallback when compiled pg_uuidv7 library is not present on host OS
END $$;

