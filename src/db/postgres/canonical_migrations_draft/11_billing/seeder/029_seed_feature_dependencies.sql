-- =============================================================================
-- Module      : Billing
-- Migration   : 029_seed_feature_dependencies.sql
-- Description : Seed feature dependency graph
-- =============================================================================

BEGIN;

WITH dependency_seed(parent_feature, child_feature, dependency_type, is_required) AS (
VALUES
-- Error Tracking
('error_tracking.enabled','error_tracking.stack_traces','required',TRUE),
('error_tracking.enabled','error_tracking.source_maps','required',TRUE),
('error_tracking.enabled','error_tracking.release_tracking','required',TRUE),
('error_tracking.enabled','error_tracking.ai_root_cause','required',TRUE),

-- Tracing
('tracing.enabled','tracing.service_map','required',TRUE),
('tracing.enabled','tracing.flame_graphs','required',TRUE),
('tracing.enabled','tracing.trace_compare','required',TRUE),
('tracing.enabled','tracing.live_traces','required',TRUE),

-- Logging
('logging.enabled','logging.live_tail','required',TRUE),
('logging.enabled','logging.search','required',TRUE),
('logging.enabled','logging.pipelines','required',TRUE),
('logging.enabled','logging.archives','required',TRUE),

-- Metrics
('metrics.enabled','metrics.metric_math','required',TRUE),
('metrics.enabled','metrics.recording_rules','required',TRUE),
('metrics.enabled','metrics.exemplars','required',TRUE),

-- Profiling
('profiling.enabled','profiling.flamegraphs','required',TRUE),
('profiling.enabled','profiling.hotspots','required',TRUE),
('tracing.enabled','profiling.trace_correlation','required',TRUE),
('profiling.enabled','profiling.trace_correlation','required',TRUE),

-- Replay
('replay.enabled','replay.error_linking','required',TRUE),
('error_tracking.enabled','replay.error_linking','required',TRUE),
('tracing.enabled','replay.trace_linking','required',TRUE),
('replay.enabled','replay.trace_linking','required',TRUE),

-- Uptime & Cron
('uptime.enabled','uptime.public_status_page','required',TRUE),
('cron.enabled','cron.failure_analysis','required',TRUE),

-- Alerting
('alerting.enabled','alerting.composite','required',TRUE),
('alerting.enabled','alerting.escalation_policies','required',TRUE),
('alerting.enabled','alerting.on_call','required',TRUE),

-- Dashboards
('dashboards.enabled','dashboards.custom_widgets','required',TRUE),
('dashboards.enabled','dashboards.embeds','required',TRUE),
('analytics.explorer','analytics.query_builder','required',TRUE),

-- AI
('ai.enabled','ai.root_cause_analysis','required',TRUE),
('error_tracking.enabled','ai.root_cause_analysis','required',TRUE),
('tracing.enabled','ai.root_cause_analysis','required',TRUE),
('ai.enabled','ai.forecasting','required',TRUE),
('metrics.enabled','ai.forecasting','required',TRUE),

-- Security
('security.enabled','security.sso','required',TRUE),
('security.sso','security.scim','required',TRUE),
('security.enabled','security.audit_logs','required',TRUE),
('security.enabled','security.byok','required',TRUE)
)

INSERT INTO billing_feature_dependencies
(parent_feature_key, child_feature_key, dependency_type, is_required)
SELECT
parent_feature,
child_feature,
dependency_type::billing_feature_dependency_type,
is_required
FROM dependency_seed
ON CONFLICT (parent_feature_key, child_feature_key)
DO UPDATE SET
dependency_type = EXCLUDED.dependency_type,
is_required = EXCLUDED.is_required,
updated_at = NOW(),
deleted_at = NULL;

COMMIT;