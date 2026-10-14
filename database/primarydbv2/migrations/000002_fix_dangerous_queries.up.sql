-- Migration: Fix Dangerous Queries & Outage Mechanisms
-- =============================================================================
-- Fixes three production-threatening SQL anti-patterns:
--
-- 5.1  Non-sargable LOWER() in tenant lookups — fixed at app layer (no DDL).
--
-- 5.2  Missing composite unique constraint on email_verifications.
--      ON CONFLICT (user_id, email, purpose) requires this constraint;
--      without it PostgreSQL aborts with error 42P10.
--
-- 5.3  Write amplification from 4 duplicate B-Tree indexes on
--      project_api_keys.public_key. The inline UNIQUE on the column
--      definition is sufficient. Drop the 3 redundant indexes.
-- =============================================================================

-- ─── 5.2: Add missing composite unique constraint ──────────────────────────
-- CONCURRENTLY avoids an ACCESS EXCLUSIVE lock during the build.
-- IF NOT EXISTS makes this idempotent for re-runs / partial failures.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_email_verifications_user_email_purpose
  ON email_verifications(user_id, email, purpose);

-- ─── 5.3: Drop redundant public_key indexes ────────────────────────────────
-- The inline `UNIQUE` on `public_key VARCHAR(64) NOT NULL UNIQUE` already
-- creates an implicit unique B-Tree index. The three indexes below are
-- fully redundant and quadruple WAL records + lock contention on writes.

-- 1. Partial unique (redundant — inline UNIQUE is already total)
DROP INDEX CONCURRENTLY IF EXISTS uq_project_api_keys_public_key;

-- 2. Non-unique partial on public_key (fully covered by inline UNIQUE)
DROP INDEX CONCURRENTLY IF EXISTS idx_project_api_keys_public_key;

-- 3. Another non-unique partial on public_key (also fully covered)
DROP INDEX CONCURRENTLY IF EXISTS idx_api_keys_public_key;
