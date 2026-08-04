-- =============================================================================
-- Primary DB : P7 — Global connector runtime guards
-- Architecture : docs/alerting-redesign/02-data-model.md §9
--                docs/alerting-redesign/adr/0006-database-ownership.md (guards are
--                  primary-DB owned precisely because they must be transactional
--                  and global)
--                docs/alerting-redesign/adr/0008-connector-isolation.md
-- Increment    : 1 (schema ownership stabilization)
-- Deviation    : file number corrected 012 -> 015, see docs/alerting-redesign/DEVIATIONS.md DEV-001
--
-- Fixes audit findings:
--   C4 : two unsynchronized circuit breakers (in-process runtime.ts + DB-derived
--        consecutive_failures) collapse into ONE authoritative state row
--   C5 : the per-process sliding-window rate limiter multiplied the effective
--        limit by process count; a single-statement atomic token bucket makes the
--        limit global without Redis
--
-- Additive only. Nothing reads these tables until CONNECTOR_GLOBAL_LIMITS is
-- enabled in Increment 7, so applying this migration changes no behaviour.
-- =============================================================================

BEGIN;

-- ── Global sliding-window token bucket ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS connector_rate_buckets (
  connector_id    UUID PRIMARY KEY REFERENCES connector_configs(id) ON DELETE CASCADE,
  window_start    TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', now()),
  window_seconds  INTEGER NOT NULL CHECK (window_seconds > 0),
  consumed        INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_rate_buckets_window
  ON connector_rate_buckets (window_start);

COMMENT ON TABLE connector_rate_buckets IS
  'Global per-connector rate limit. Consumed atomically with a single INSERT ... ON '
  'CONFLICT DO UPDATE ... RETURNING statement so there is no read-modify-write race '
  'across worker processes. The in-process limiter in connectors/runtime.ts is demoted '
  'to a cheap pre-filter; this table is the authority.';

-- ── Single authoritative circuit breaker ─────────────────────────────────────
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

COMMENT ON TABLE connector_circuit_state IS
  'The ONE connector circuit breaker. Replaces the in-process breaker in '
  'connectors/runtime.ts and the DB-derived breaker previously computed from '
  'connector_configs.consecutive_failures, which could disagree with each other.';

-- Both tables carry mutable runtime counters but live in the primary DB by design
-- (ADR-0006): they require transactional correctness and a single global view,
-- which an append-oriented analytics store cannot provide.
DROP TRIGGER IF EXISTS trg_connector_rate_buckets_updated_at ON connector_rate_buckets;
CREATE TRIGGER trg_connector_rate_buckets_updated_at
  BEFORE UPDATE ON connector_rate_buckets
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

DROP TRIGGER IF EXISTS trg_connector_circuit_state_updated_at ON connector_circuit_state;
CREATE TRIGGER trg_connector_circuit_state_updated_at
  BEFORE UPDATE ON connector_circuit_state
  FOR EACH ROW EXECUTE FUNCTION connector_set_updated_at();

COMMIT;
