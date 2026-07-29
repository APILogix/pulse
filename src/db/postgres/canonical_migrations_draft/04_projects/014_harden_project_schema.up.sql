BEGIN;

-- Log/usage hardening, aggregation functions, and runtime usage constraints were
-- moved to database/migrations/logdb/01_usage. Primary project schema hardening
-- remains in the surrounding primary-only project migrations.

COMMIT;
