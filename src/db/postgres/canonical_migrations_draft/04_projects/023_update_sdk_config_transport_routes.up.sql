BEGIN;

-- The ingestion Fastify plugin is mounted under /api, so SDK transport URLs
-- must use /api/v1/* public paths. Older compiled SDK configs used /v1/*.

CREATE OR REPLACE FUNCTION pulse_rewrite_sdk_transport_routes(p_snapshot jsonb)
RETURNS jsonb AS $$
DECLARE
  v_routes jsonb := COALESCE(p_snapshot #> '{transport,routes}', '{}'::jsonb);
  v_key text;
  v_path text;
  v_url text;
  v_rewritten jsonb := v_routes;
BEGIN
  IF jsonb_typeof(v_routes) <> 'object' THEN
    RETURN p_snapshot;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_routes) LOOP
    v_url := v_routes -> v_key ->> 'url';
    IF v_url IS NULL OR v_url = '' THEN
      CONTINUE;
    END IF;

    v_path := CASE v_key
      WHEN 'traces' THEN '/api/v1/traces'
      WHEN 'requests' THEN '/api/v1/requests'
      WHEN 'spans' THEN '/api/v1/spans'
      WHEN 'errors' THEN '/api/v1/errors'
      WHEN 'metrics' THEN '/api/v1/metrics'
      WHEN 'logs' THEN '/api/v1/logs'
      WHEN 'profiles' THEN '/api/v1/profiles'
      WHEN 'events' THEN '/api/v1/events'
      WHEN 'crons' THEN '/api/v1/checkins'
      WHEN 'replays' THEN '/api/v1/replays'
      ELSE NULL
    END;

    IF v_path IS NULL THEN
      CONTINUE;
    END IF;

    v_rewritten := jsonb_set(
      v_rewritten,
      ARRAY[v_key, 'url'],
      to_jsonb(regexp_replace(v_url, '/v1/(traces|requests|spans|errors|metrics|logs|profiles|events|checkins|replays)$', v_path))
    );
  END LOOP;

  RETURN jsonb_set(p_snapshot, '{transport,routes}', v_rewritten);
END;
$$ LANGUAGE plpgsql;

ALTER TABLE project_environment_sdk_config_revisions
  DISABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

WITH rewritten AS (
  SELECT
    id,
    pulse_rewrite_sdk_transport_routes(compiled_snapshot) AS compiled_snapshot
  FROM project_environment_sdk_config_revisions
  WHERE compiled_snapshot #>> '{transport,routes,traces,url}' LIKE '%/v1/traces'
    AND compiled_snapshot #>> '{transport,routes,traces,url}' NOT LIKE '%/api/v1/traces'
), hashed AS (
  SELECT
    id,
    compiled_snapshot,
    encode(
      digest(
        jsonb_set(compiled_snapshot, '{meta}', COALESCE(compiled_snapshot -> 'meta', '{}'::jsonb) - 'configHash')::text,
        'sha256'
      ),
      'hex'
    ) AS config_hash
  FROM rewritten
)
UPDATE project_environment_sdk_config_revisions r
   SET compiled_snapshot = jsonb_set(hashed.compiled_snapshot, '{meta,configHash}', to_jsonb(hashed.config_hash)),
       config_value = jsonb_set(hashed.compiled_snapshot, '{meta,configHash}', to_jsonb(hashed.config_hash)),
       config_hash = hashed.config_hash
  FROM hashed
 WHERE r.id = hashed.id;

UPDATE project_environment_sdk_configs h
   SET current_hash = r.config_hash,
       updated_at = NOW(),
       version = version + 1
  FROM project_environment_sdk_config_revisions r
 WHERE r.id = h.published_revision_id
   AND h.current_hash IS DISTINCT FROM r.config_hash;

ALTER TABLE project_environment_sdk_config_revisions
  ENABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

DROP FUNCTION IF EXISTS pulse_rewrite_sdk_transport_routes(jsonb);

CREATE OR REPLACE FUNCTION pulse_add_sdk_spans_transport_route(p_snapshot jsonb)
RETURNS jsonb AS $$
DECLARE
  v_routes jsonb := COALESCE(p_snapshot #> '{transport,routes}', '{}'::jsonb);
  v_trace jsonb;
  v_base text;
  v_spans jsonb;
BEGIN
  IF jsonb_typeof(v_routes) <> 'object' OR v_routes ? 'spans' THEN
    RETURN p_snapshot;
  END IF;

  v_trace := v_routes -> 'traces';
  IF jsonb_typeof(v_trace) = 'object' AND COALESCE(v_trace ->> 'url', '') <> '' THEN
    v_base := regexp_replace(v_trace ->> 'url', '/api/v1/traces$', '');
  ELSE
    v_base := COALESCE(current_setting('pulse.ingest_base_url', true), 'https://ingest.pulse.local');
  END IF;

  v_spans := COALESCE(v_trace, '{}'::jsonb)
    || jsonb_build_object('url', v_base || '/api/v1/spans', 'priority', 5);

  RETURN jsonb_set(p_snapshot, '{transport,routes,spans}', v_spans, true);
END;
$$ LANGUAGE plpgsql;

ALTER TABLE project_environment_sdk_config_revisions
  DISABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

WITH added AS (
  SELECT
    id,
    pulse_add_sdk_spans_transport_route(compiled_snapshot) AS compiled_snapshot
  FROM project_environment_sdk_config_revisions
  WHERE NOT (compiled_snapshot #> '{transport,routes}' ? 'spans')
), hashed AS (
  SELECT
    id,
    compiled_snapshot,
    encode(
      digest(
        jsonb_set(compiled_snapshot, '{meta}', COALESCE(compiled_snapshot -> 'meta', '{}'::jsonb) - 'configHash')::text,
        'sha256'
      ),
      'hex'
    ) AS config_hash
  FROM added
)
UPDATE project_environment_sdk_config_revisions r
   SET compiled_snapshot = jsonb_set(hashed.compiled_snapshot, '{meta,configHash}', to_jsonb(hashed.config_hash)),
       config_value = jsonb_set(hashed.compiled_snapshot, '{meta,configHash}', to_jsonb(hashed.config_hash)),
       config_hash = hashed.config_hash
  FROM hashed
 WHERE r.id = hashed.id;

UPDATE project_environment_sdk_configs h
   SET current_hash = r.config_hash,
       updated_at = NOW(),
       version = version + 1
  FROM project_environment_sdk_config_revisions r
 WHERE r.id = h.published_revision_id
   AND h.current_hash IS DISTINCT FROM r.config_hash;

ALTER TABLE project_environment_sdk_config_revisions
  ENABLE TRIGGER trg_project_environment_sdk_revisions_immutable;

DROP FUNCTION IF EXISTS pulse_add_sdk_spans_transport_route(jsonb);

COMMIT;
