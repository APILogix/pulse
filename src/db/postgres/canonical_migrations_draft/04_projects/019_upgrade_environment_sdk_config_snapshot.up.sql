BEGIN;

-- =============================================================================
-- Enterprise remote SDK config: store the full compiled schema-v1 snapshot and
-- the editable requested intent as distinct columns on the immutable revisions
-- table, and make atomic environment provisioning seed a COMPLETE, valid
-- schema-v1 revision 1 (not an empty {}).
--
-- Invariants preserved:
--   * One head per environment; revisions remain append-only (immutability
--     trigger from migration 015 stays in force).
--   * The full compiled SDK config lives ONLY in
--     project_environment_sdk_config_revisions.compiled_snapshot.
--   * requested_config holds only editable intent (empty at initialization).
-- =============================================================================

ALTER TABLE project_environment_sdk_config_revisions
  ADD COLUMN IF NOT EXISTS requested_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS compiled_snapshot JSONB;

-- The revisions table carries a BEFORE UPDATE immutability trigger (migration
-- 015). Backfilling new columns on existing rows is a one-time migration action,
-- so disable that trigger for the duration of this transaction only.
ALTER TABLE project_environment_sdk_config_revisions
  DISABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

-- Backfill: the pre-existing config_value column already held the delivered
-- document, so it becomes the compiled snapshot for historical revisions.
UPDATE project_environment_sdk_config_revisions
   SET compiled_snapshot = config_value
 WHERE compiled_snapshot IS NULL;

ALTER TABLE project_environment_sdk_config_revisions
  ALTER COLUMN compiled_snapshot SET NOT NULL;

ALTER TABLE project_environment_sdk_config_revisions
  DROP CONSTRAINT IF EXISTS sdk_revisions_requested_config_object,
  DROP CONSTRAINT IF EXISTS sdk_revisions_compiled_snapshot_object;
ALTER TABLE project_environment_sdk_config_revisions
  ADD CONSTRAINT sdk_revisions_requested_config_object
    CHECK (jsonb_typeof(requested_config) = 'object'),
  ADD CONSTRAINT sdk_revisions_compiled_snapshot_object
    CHECK (jsonb_typeof(compiled_snapshot) = 'object'
           AND (compiled_snapshot ->> 'schemaVersion') = '1');

COMMENT ON COLUMN project_environment_sdk_config_revisions.compiled_snapshot IS
  'Sole authoritative store of the complete immutable schema-v1 SDK document.';
COMMENT ON COLUMN project_environment_sdk_config_revisions.requested_config IS
  'Editable allowlisted project intent only; never the full compiled document.';

-- -----------------------------------------------------------------------------
-- Deterministic SQL builder for the initial compiled schema-v1 document. It
-- mirrors the TypeScript compiler defaults + platform safety so that atomic
-- provisioning produces a complete, valid revision 1 before any publish. Route
-- URLs are derived from trusted platform topology; users never supply them.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pulse_build_initial_sdk_config(
  p_project_id uuid,
  p_environment_key text
) RETURNS jsonb AS $$
DECLARE
  v_base text := COALESCE(current_setting('pulse.ingest_base_url', true), 'https://ingest.pulse.local');
  v_route jsonb;
  v_routes jsonb := '{}'::jsonb;
  v_spec jsonb := jsonb_build_object(
    'traces',   jsonb_build_object('path','/api/v1/traces','priority',4),
    'requests', jsonb_build_object('path','/api/v1/requests','priority',6),
    'spans',    jsonb_build_object('path','/api/v1/spans','priority',5),
    'errors',   jsonb_build_object('path','/api/v1/errors','priority',1),
    'metrics',  jsonb_build_object('path','/api/v1/metrics','priority',8),
    'logs',     jsonb_build_object('path','/api/v1/logs','priority',7),
    'profiles', jsonb_build_object('path','/api/v1/profiles','priority',9),
    'events',   jsonb_build_object('path','/api/v1/events','priority',2),
    'crons',    jsonb_build_object('path','/api/v1/checkins','priority',3),
    'replays',  jsonb_build_object('path','/api/v1/replays','priority',10)
  );
  v_key text;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_spec) LOOP
    v_route := jsonb_build_object(
      'url', v_base || (v_spec -> v_key ->> 'path'),
      'priority', (v_spec -> v_key -> 'priority'),
      'batchSize', 100,
      'flushIntervalMs', 5000,
      'timeoutMs', 10000,
      'compression', 'gzip'
    );
    v_routes := v_routes || jsonb_build_object(v_key, v_route);
  END LOOP;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'sdk', jsonb_build_object('projectId', p_project_id::text, 'environment', p_environment_key),
    'features', jsonb_build_object(
      'tracing', true, 'requestCapture', true, 'errors', true, 'metrics', true, 'logging', true,
      'profiling', false, 'crons', false, 'sessionReplay', false, 'runtimeMetrics', false,
      'eventLoopMonitoring', false, 'gcMonitoring', false),
    'sampling', jsonb_build_object(
      'traces', 1, 'requests', 1, 'errors', 1, 'profiles', 0.1, 'replays', 0.1, 'metrics', 1,
      'routeOverrides', '[]'::jsonb),
    'instrumentation', jsonb_build_object(
      'http', jsonb_build_object('enabled', true),
      'https', jsonb_build_object('enabled', true),
      'fetch', jsonb_build_object('enabled', true),
      'axios', jsonb_build_object('enabled', false),
      'fastify', jsonb_build_object('enabled', true),
      'express', jsonb_build_object('enabled', true),
      'graphql', jsonb_build_object('enabled', false),
      'prisma', jsonb_build_object('enabled', false),
      'mongodb', jsonb_build_object('enabled', false),
      'redis', jsonb_build_object('enabled', false),
      'bullmq', jsonb_build_object('enabled', false)),
    'privacy', jsonb_build_object(
      'capture', jsonb_build_object('headers', false, 'body', false, 'query', false, 'cookies', false, 'response', false),
      'scrubbing', jsonb_build_object(
        'headers', jsonb_build_array('authorization','proxy-authorization','cookie','set-cookie','x-api-key'),
        'fields', jsonb_build_array('password','secret','token','apiKey','authorization')),
      'pii', jsonb_build_object('enabled', true, 'maskEmails', true, 'maskCreditCards', true, 'maskPhoneNumbers', true)),
    'limits', jsonb_build_object(
      'maxSpansPerTrace', 2000, 'maxSpanAttributes', 128, 'maxAttributeLength', 4096,
      'maxPayloadSize', 1048576, 'maxQueueSize', 10000, 'maxMemoryMb', 256, 'maxCpuOverheadPercent', 5),
    'killswitches', jsonb_build_object(
      'disableSDK', false, 'disableTracing', false, 'disableMetrics', false, 'disableTransport', false,
      'disableProfiling', false, 'disableErrors', false, 'disableLogs', false),
    'transport', jsonb_build_object(
      'retry', jsonb_build_object('maxRetries', 3, 'baseDelayMs', 500),
      'queue', jsonb_build_object('maxSize', 10000, 'criticalReserve', 1000),
      'keepAlive', true,
      'connections', jsonb_build_object('total', 50, 'acquireTimeoutMs', 5000),
      'routes', v_routes),
    'runtime', jsonb_build_object('configTtlSeconds', 300, 'staleWhileRevalidate', true),
    'meta', jsonb_build_object('generatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                               'generatedBy', 'pulse-config-compiler@1')
  );
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Atomic provisioning: on every environment insert, create the head and a
-- complete valid schema-v1 revision 1 in the same transaction (design.md F2).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION provision_environment_sdk_config() RETURNS trigger AS $$
DECLARE
  head_id UUID := gen_random_uuid();
  revision_id UUID := gen_random_uuid();
  v_snapshot JSONB := pulse_build_initial_sdk_config(NEW.project_id, NEW.slug);
  v_hash TEXT := encode(digest(v_snapshot::text, 'sha256'), 'hex');
BEGIN
  INSERT INTO project_environment_sdk_configs(
    id, organization_id, project_id, environment_id, published_revision_id,
    current_revision, current_hash, schema_version
  ) VALUES(
    head_id, NEW.organization_id, NEW.project_id, NEW.id, revision_id,
    1, v_hash, '1'
  );

  INSERT INTO project_environment_sdk_config_revisions(
    id, config_id, organization_id, project_id, environment_id, revision_number,
    requested_config, compiled_snapshot, config_value, config_hash,
    change_type, change_summary
  ) VALUES(
    revision_id, head_id, NEW.organization_id, NEW.project_id, NEW.id, 1,
    '{}'::jsonb, v_snapshot, v_snapshot, v_hash,
    'initial', 'Initial compiled schema-v1 SDK configuration'
  );

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Trigger definition is unchanged (still AFTER INSERT on project_environments);
-- CREATE OR REPLACE FUNCTION above swaps the body in place.

-- Backfill existing empty revision-1 snapshots that predate this migration.
UPDATE project_environment_sdk_config_revisions r
   SET compiled_snapshot = pulse_build_initial_sdk_config(e.project_id, e.slug),
       config_value = pulse_build_initial_sdk_config(e.project_id, e.slug)
  FROM project_environments e
 WHERE r.environment_id = e.id
   AND r.change_type = 'initial'
   AND (r.compiled_snapshot = '{}'::jsonb OR r.compiled_snapshot IS NULL);

-- Restore immutability enforcement for all future writes.
ALTER TABLE project_environment_sdk_config_revisions
  ENABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

COMMIT;
