-- PostgreSQL cannot safely remove enum labels once deployed. This migration is intentionally a no-op rollback.
BEGIN;
COMMIT;
