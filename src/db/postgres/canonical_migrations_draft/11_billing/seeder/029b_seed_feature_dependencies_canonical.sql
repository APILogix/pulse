BEGIN;

WITH dependency_seed(feature_key, depends_on_key, dependency_type) AS (
  VALUES
    ('tracing.service_map', 'tracing.enabled', 'required'),
    ('tracing.flame_graphs', 'tracing.enabled', 'required'),
    ('logging.live_tail', 'logging.enabled', 'required'),
    ('logging.search', 'logging.enabled', 'required'),
    ('profiling.trace_correlation', 'profiling.enabled', 'required'),
    ('replay.error_linking', 'replay.enabled', 'required'),
    ('alerting.escalation_policies', 'alerting.enabled', 'required'),
    ('ai.root_cause_analysis', 'ai.enabled', 'required'),
    ('security.scim', 'security.sso', 'required')
)
INSERT INTO feature_dependencies (feature_id, depends_on_feature_id, dependency_type)
SELECT child.id, parent.id, seed.dependency_type
FROM dependency_seed seed
JOIN billing_features child ON child.feature_key = seed.feature_key AND child.deleted_at IS NULL
JOIN billing_features parent ON parent.feature_key = seed.depends_on_key AND parent.deleted_at IS NULL
ON CONFLICT (feature_id, depends_on_feature_id)
DO UPDATE SET dependency_type = EXCLUDED.dependency_type;

COMMIT;
