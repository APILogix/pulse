-- Normalized final definition for connector_rate_buckets.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql

CREATE TABLE IF NOT EXISTS connector_rate_buckets (
  connector_id    UUID PRIMARY KEY REFERENCES connector_configs(id) ON DELETE CASCADE,
  window_start    TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', now()),
  window_seconds  INTEGER NOT NULL CHECK (window_seconds > 0),
  consumed        INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_rate_buckets_window
  ON connector_rate_buckets (window_start);
