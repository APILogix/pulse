-- Phase 3 auth: scheduled account deletion support.
-- Safe to re-run (idempotent).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_deletion_scheduled
  ON users(deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN users.deletion_scheduled_at IS
  'When set, a worker or confirm endpoint may soft-delete the account after this timestamp.';

COMMIT;
