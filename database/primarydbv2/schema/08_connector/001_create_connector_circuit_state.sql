-- Normalized final definition for connector_circuit_state.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/06_connectors/015_create_connector_runtime_guards.up.sql

CREATE TABLE IF NOT EXISTS connector_circuit_state (
  connector_id          UUID PRIMARY KEY REFERENCES connector_configs(id) ON DELETE CASCADE,
  state                 VARCHAR(12) NOT NULL DEFAULT 'closed',
  consecutive_failures  INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  opened_at             TIMESTAMPTZ,
  half_open_at          TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_failure_at       TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_connector_circuit_state_state CHECK (
  state IN ('closed','open','half_open')
  )
);

CREATE INDEX IF NOT EXISTS idx_connector_circuit_state_open
  ON connector_circuit_state (state, opened_at)
  WHERE state <> 'closed';
