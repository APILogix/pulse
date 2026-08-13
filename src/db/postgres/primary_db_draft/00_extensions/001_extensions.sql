-- Source: canonical_migrations_draft/00_shared/001_enable_pgcrypto.up.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Source: canonical_migrations_draft/18_ai/001_extensions.up.sql
CREATE EXTENSION IF NOT EXISTS vector;
