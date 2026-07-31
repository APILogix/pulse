-- =============================================================================
-- Module      : Billing
-- Migration   : 028b5_seed_billing_features_profiling.sql
-- Description : Seed Continuous Profiling feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('profiling.enabled','Continuous Profiling','Enable continuous profiling','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.cpu','CPU Profiling','CPU profile collection','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.memory','Memory Profiling','Heap and allocation profiling','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.wall_time','Wall Time Profiles','Wall-clock execution profiling','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.flamegraphs','Flame Graphs','Interactive flame graph viewer','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.call_tree','Call Tree','Hierarchical call tree','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.hotspots','Hotspot Analysis','Identify performance hotspots','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.diff','Profile Diff','Compare two profiles','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.symbolication','Native Symbolication','Resolve native symbols','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.trace_correlation','Trace Correlation','Link profiles to traces','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.release_comparison','Release Comparison','Compare profiles across releases','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('profiling.continuous','Continuous Collection','Always-on profiling','feature','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('sampling.profile_dynamic','Dynamic Profile Sampling','Adaptive profile sampling','sampling','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.profile_insights','AI Profile Insights','AI-assisted performance insights','ai','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.profile_regressions','AI Performance Regression','Detect performance regressions','ai','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('quota.monthly_profiles','Monthly Profiles','Maximum profiles collected','quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),
('quota.profile_retention_days','Profile Retention Days','Maximum profile retention','quota','quota','integer','hard_limit','{"unit":"days"}'::jsonb,TRUE,FALSE),
('integration.profile_exports','Profile Export','Export profiles','integration','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('integration.pprof','pprof Export','Export in pprof format','integration','profiling','boolean','none','{}'::jsonb,TRUE,FALSE),
('integration.parca','Parca Integration','Parca compatible integration','integration','profiling','boolean','none','{}'::jsonb,TRUE,FALSE)
)

INSERT INTO billing_features
(feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root)
SELECT
feature_key,name,description,
category::billing_feature_category,
module,
value_type::billing_feature_value_type,
usage_behavior::billing_usage_behavior,
configuration,is_public,is_module_root
FROM feature_seed
ON CONFLICT (feature_key)
DO UPDATE SET
name=EXCLUDED.name,
description=EXCLUDED.description,
category=EXCLUDED.category,
module=EXCLUDED.module,
value_type=EXCLUDED.value_type,
usage_behavior=EXCLUDED.usage_behavior,
configuration=EXCLUDED.configuration,
is_public=EXCLUDED.is_public,
is_module_root=EXCLUDED.is_module_root,
updated_at=NOW(),
deleted_at=NULL;

COMMIT;