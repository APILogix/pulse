-- Comparison state between software releases
CREATE TABLE IF NOT EXISTS release_comparison (
  organization_id        UUID NOT NULL,
  project_id             UUID NOT NULL,
  environment            TEXT NOT NULL,
  release                TEXT NOT NULL,
  baseline_release       TEXT,
  request_count          BIGINT NOT NULL DEFAULT 0,
  baseline_request_count BIGINT NOT NULL DEFAULT 0,
  error_rate_pct         NUMERIC(7,4),
  baseline_error_rate_pct NUMERIC(7,4),
  error_rate_delta_pct   NUMERIC(10,4),
  latency_p95_ms         NUMERIC(14,3),
  baseline_latency_p95_ms NUMERIC(14,3),
  p95_delta_ms           NUMERIC(14,3),
  throughput_delta_pct   NUMERIC(10,4),
  new_error_groups       INTEGER NOT NULL DEFAULT 0,
  verdict                TEXT NOT NULL DEFAULT 'stable',
  first_seen_at          TIMESTAMPTZ,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, project_id, environment, release),
  CONSTRAINT release_comparison_verdict_ck
    CHECK (verdict IN ('improved', 'stable', 'degraded', 'insufficient_data'))
);

CREATE INDEX IF NOT EXISTS idx_release_comparison_recent
  ON release_comparison (organization_id, project_id, computed_at DESC);
