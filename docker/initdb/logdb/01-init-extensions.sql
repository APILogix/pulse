-- ============================================================================
-- LogDB Extensions Initialization
-- Executed on initial database creation by TimescaleDB entrypoint
-- ============================================================================

-- Standard UUID and cryptographic utilities
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Trigram text search and GIN indexing
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- Vector embeddings (pgvector)
CREATE EXTENSION IF NOT EXISTS "vector";

-- TimescaleDB for time-series hypertables, chunk intervals, compression & retention
CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;

-- Query performance metrics and profiling
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Optional native RFC 9562 UUIDv7 extension (graceful fallback if not compiled)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "pg_uuidv7";
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- Safe fallback when compiled pg_uuidv7 library is not present
END $$;
