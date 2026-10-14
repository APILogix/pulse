-- Migration: Add partial index on user_sessions for periodic purge (MAINT-Q015)
-- Supports batch deletion of revoked, expired, and terminated sessions without table scans.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_purge
  ON user_sessions (status, terminated_at, expires_at)
  WHERE status IN ('revoked', 'expired', 'terminated_by_admin');
