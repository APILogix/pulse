-- Rollback: Reverse the dangerous queries fix migration
-- =============================================================================
-- WARNING: This rollback re-creates the redundant indexes that cause
-- write amplification. Only use if you must revert to the prior schema state.
-- =============================================================================

-- ─── Reverse 5.3: Re-create the redundant public_key indexes ──────────────
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_project_api_keys_public_key
  ON project_api_keys(public_key) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_api_keys_public_key
  ON project_api_keys(public_key) WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_public_key
  ON project_api_keys(public_key) WHERE deleted_at IS NULL;

-- ─── Reverse 5.2: Drop the composite unique constraint ────────────────────
-- NOTE: Dropping this will cause ON CONFLICT (user_id, email, purpose) to
-- fail with error 42P10 on every email verification request.
DROP INDEX CONCURRENTLY IF EXISTS uq_email_verifications_user_email_purpose;
