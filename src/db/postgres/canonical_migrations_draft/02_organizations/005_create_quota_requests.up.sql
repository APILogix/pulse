BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quota_request_status') THEN
    CREATE TYPE quota_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS quota_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quota_type VARCHAR(50) NOT NULL,
  current_limit BIGINT NOT NULL CHECK (current_limit >= 0),
  requested_limit BIGINT NOT NULL CHECK (requested_limit > current_limit),
  reason TEXT NOT NULL,
  status quota_request_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quota_requests_org
  ON quota_requests(org_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_quota_requests_updated_at ON quota_requests;
CREATE TRIGGER trg_quota_requests_updated_at
  BEFORE UPDATE ON quota_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;
