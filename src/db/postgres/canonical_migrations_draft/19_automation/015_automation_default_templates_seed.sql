-- =============================================================================
-- Module      : Automation
-- Migration   : 015_automation_default_templates_seed.sql
-- Description : Platform-level default automation templates (20 templates)
-- Author      : Pulse Platform
-- PostgreSQL  : 16+
-- Idempotent  : Yes (uses ON CONFLICT)
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. alert-route-by-service-severity
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'alert-route-by-service-severity',
  'platform', NULL,
  'Route Alerts by Service and Severity',
  'Automatically route alerts to the correct notification channel based on service ownership and severity level.',
  'alert_routing', 'alerting',
  TRUE, TRUE, TRUE, 'starter',
  'module_alerting_features_multi_channel',
  ARRAY['alerting','routing','notifications'],
  10,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"alert_routing","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.service","operator":"exists"},{"leftPath":"$.severity","operator":"in","rightValue":["warning","error","critical","fatal"]}],"actions":[{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{"channelStrategy":"by_service_owner"}}],"safety":{"maxRunsPerHour":500,"dedupeWindowSeconds":60,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.service","operator":"exists"},{"leftPath":"$.severity","operator":"in","rightValue":["warning","error","critical","fatal"]}]'::jsonb,
  '[{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:alert_route_v1_001', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 2. escalate-unresolved-critical-alert
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000002',
  'escalate-unresolved-critical-alert',
  'platform', NULL,
  'Escalate Unresolved Critical Alerts',
  'Automatically escalate critical alerts that remain unresolved after a configurable time window via PagerDuty and notifications.',
  'escalation', 'alerting',
  TRUE, TRUE, TRUE, 'growth',
  'module_alerting_features_escalation_policies',
  ARRAY['alerting','escalation','pagerduty'],
  20,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000002',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"escalation","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]},{"leftPath":"$.status","operator":"neq","rightValue":"resolved"}],"actions":[{"actionKey":"page_oncall","actionType":"pagerduty.trigger","riskLevel":"medium","requiresApproval":false,"config":{"waitMinutes":15}},{"actionKey":"notify_escalation","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":50,"dedupeWindowSeconds":900,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]},{"leftPath":"$.status","operator":"neq","rightValue":"resolved"}]'::jsonb,
  '[{"actionKey":"page_oncall","actionType":"pagerduty.trigger","riskLevel":"medium"},{"actionKey":"notify_escalation","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:escalate_critical_v1_002', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 3. create-incident-for-critical-alert
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000003',
  'create-incident-for-critical-alert',
  'platform', NULL,
  'Create Incident for Critical Alerts',
  'Automatically create an incident when a critical or fatal alert is triggered, notifying the relevant team.',
  'incident_creation', 'incidents',
  TRUE, TRUE, TRUE, 'growth',
  'module_incident_management_enabled',
  ARRAY['incidents','alerting','critical'],
  30,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000003',
  'a0000000-0000-4000-8000-000000000003',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"incident_creation","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]}],"actions":[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":100,"dedupeWindowSeconds":300,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]}]'::jsonb,
  '[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:incident_critical_v1_003', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 4. append-incident-timeline-from-alert
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000004',
  'append-incident-timeline-from-alert',
  'platform', NULL,
  'Append Incident Timeline from Alert',
  'Automatically append alert events to an associated incident timeline for context enrichment.',
  'incident_timeline', 'incidents',
  TRUE, TRUE, FALSE, 'growth',
  'module_incident_management_features_timelines',
  ARRAY['incidents','timeline','alerting'],
  40,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000004',
  'a0000000-0000-4000-8000-000000000004',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"incident_timeline","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.incident_id","operator":"exists"}],"actions":[{"actionKey":"append_timeline","actionType":"incident.timeline.append","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":500,"dedupeWindowSeconds":10,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.incident_id","operator":"exists"}]'::jsonb,
  '[{"actionKey":"append_timeline","actionType":"incident.timeline.append","riskLevel":"low"}]'::jsonb,
  'sha256:timeline_append_v1_004', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 5. generate-postmortem-draft
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000005',
  'generate-postmortem-draft',
  'platform', NULL,
  'Generate Postmortem Draft',
  'Use AI to generate a postmortem draft when a critical incident is resolved after a significant duration.',
  'postmortem', 'incidents',
  TRUE, TRUE, TRUE, 'business',
  'module_incident_management_features_postmortems',
  ARRAY['incidents','postmortem','ai'],
  50,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000005',
  'a0000000-0000-4000-8000-000000000005',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"postmortem","trigger":{"kind":"event","type":"alert.event.resolved","sourceModule":"alerting"},"conditions":[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]},{"leftPath":"$.duration_minutes","operator":"gt","rightValue":30}],"actions":[{"actionKey":"ai_summary","actionType":"ai.summary.generate","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"generate_postmortem","actionType":"incident.postmortem.generate_draft","riskLevel":"medium","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":20,"dedupeWindowSeconds":3600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.resolved","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.severity","operator":"in","rightValue":["critical","fatal"]},{"leftPath":"$.duration_minutes","operator":"gt","rightValue":30}]'::jsonb,
  '[{"actionKey":"ai_summary","actionType":"ai.summary.generate","riskLevel":"low"},{"actionKey":"generate_postmortem","actionType":"incident.postmortem.generate_draft","riskLevel":"medium"}]'::jsonb,
  'sha256:postmortem_draft_v1_005', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 6. release-health-guard
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000006',
  'release-health-guard',
  'platform', NULL,
  'Release Health Guard',
  'Monitor release health and warn when error rate, latency, or crash rate increases after a deployment.',
  'release_guard', 'releases',
  TRUE, TRUE, TRUE, 'business',
  'module_version_management_features_release_gates',
  ARRAY['releases','health','guard'],
  60,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000006',
  'a0000000-0000-4000-8000-000000000006',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"release_guard","trigger":{"kind":"event","type":"release.health_degraded","sourceModule":"releases"},"conditions":[{"leftPath":"$.error_rate_increased","operator":"eq","rightValue":true},{"leftPath":"$.latency_increased","operator":"eq","rightValue":true}],"actions":[{"actionKey":"warn_release","actionType":"release.guard.warn","riskLevel":"medium","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":50,"dedupeWindowSeconds":600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"release.health_degraded","sourceModule":"releases"}]'::jsonb,
  '[{"leftPath":"$.error_rate_increased","operator":"eq","rightValue":true},{"leftPath":"$.latency_increased","operator":"eq","rightValue":true}]'::jsonb,
  '[{"actionKey":"warn_release","actionType":"release.guard.warn","riskLevel":"medium"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:release_health_v1_006', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 7. rollback-recommendation-with-approval
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000007',
  'rollback-recommendation-with-approval',
  'platform', NULL,
  'Rollback Recommendation with Approval',
  'Recommend a rollback when release health severely degrades and require human approval before any action.',
  'rollback_recommendation', 'releases',
  TRUE, TRUE, TRUE, 'business',
  'module_version_management_features_release_gates',
  ARRAY['releases','rollback','approval'],
  70,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000007',
  'a0000000-0000-4000-8000-000000000007',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"rollback_recommendation","trigger":{"kind":"event","type":"release.health_degraded","sourceModule":"releases"},"conditions":[{"leftPath":"$.degradation_severe","operator":"eq","rightValue":true},{"leftPath":"$.confidence","operator":"gte","rightValue":0.8}],"actions":[{"actionKey":"recommend_rollback","actionType":"rollback.recommend","riskLevel":"high","requiresApproval":true,"config":{}},{"actionKey":"request_approval","actionType":"approval.request","riskLevel":"high","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":10,"dedupeWindowSeconds":1800,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"release.health_degraded","sourceModule":"releases"}]'::jsonb,
  '[{"leftPath":"$.degradation_severe","operator":"eq","rightValue":true},{"leftPath":"$.confidence","operator":"gte","rightValue":0.8}]'::jsonb,
  '[{"actionKey":"recommend_rollback","actionType":"rollback.recommend","riskLevel":"high"},{"actionKey":"request_approval","actionType":"approval.request","riskLevel":"high"}]'::jsonb,
  'sha256:rollback_approval_v1_007', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;


-- =============================================================================
-- 8. deduplicate-noisy-alerts
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000008',
  'deduplicate-noisy-alerts',
  'platform', NULL,
  'Deduplicate Noisy Alerts',
  'Automatically silence alerts with the same fingerprint when they exceed a noise threshold.',
  'noise_reduction', 'alerting',
  TRUE, TRUE, FALSE, 'growth',
  'module_alerting_features_deduplication',
  ARRAY['alerting','deduplication','noise'],
  80,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000008',
  'a0000000-0000-4000-8000-000000000008',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"noise_reduction","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.fingerprint_count","operator":"gt","rightValue":5}],"actions":[{"actionKey":"silence_alert","actionType":"alert.silence.create","riskLevel":"medium","requiresApproval":false,"config":{"durationMinutes":60}},{"actionKey":"notify_silence","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":200,"dedupeWindowSeconds":300,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.fingerprint_count","operator":"gt","rightValue":5}]'::jsonb,
  '[{"actionKey":"silence_alert","actionType":"alert.silence.create","riskLevel":"medium"},{"actionKey":"notify_silence","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:dedupe_noisy_v1_008', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 9. silence-known-maintenance-window
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000009',
  'silence-known-maintenance-window',
  'platform', NULL,
  'Silence Alerts During Maintenance Window',
  'Automatically create alert silences during scheduled maintenance windows.',
  'noise_reduction', 'alerting',
  TRUE, TRUE, FALSE, 'growth',
  'module_alerting_features_silencing',
  ARRAY['alerting','silencing','maintenance'],
  90,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000009',
  'a0000000-0000-4000-8000-000000000009',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"noise_reduction","trigger":{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler"},"conditions":[{"leftPath":"$.maintenance_window_active","operator":"eq","rightValue":true}],"actions":[{"actionKey":"silence_maintenance","actionType":"alert.silence.create","riskLevel":"medium","requiresApproval":false,"config":{"matchLabels":{"maintenance":"true"}}}],"safety":{"maxRunsPerHour":5,"dedupeWindowSeconds":3600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler"}]'::jsonb,
  '[{"leftPath":"$.maintenance_window_active","operator":"eq","rightValue":true}]'::jsonb,
  '[{"actionKey":"silence_maintenance","actionType":"alert.silence.create","riskLevel":"medium"}]'::jsonb,
  'sha256:silence_maint_v1_009', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 10. open-runbook-for-critical-service
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000010',
  'open-runbook-for-critical-service',
  'platform', NULL,
  'Open Runbook for Critical Service',
  'Automatically open the associated runbook and notify the team when a critical alert fires for a service with a configured runbook.',
  'runbook', 'incidents',
  TRUE, TRUE, FALSE, 'growth',
  'module_incident_management_enabled',
  ARRAY['incidents','runbook','critical'],
  100,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000010',
  'a0000000-0000-4000-8000-000000000010',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"runbook","trigger":{"kind":"event","type":"alert.event.created","sourceModule":"alerting"},"conditions":[{"leftPath":"$.severity","operator":"eq","rightValue":"critical"},{"leftPath":"$.service_runbook_url","operator":"exists"}],"actions":[{"actionKey":"open_runbook","actionType":"runbook.open","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":100,"dedupeWindowSeconds":300,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"alert.event.created","sourceModule":"alerting"}]'::jsonb,
  '[{"leftPath":"$.severity","operator":"eq","rightValue":"critical"},{"leftPath":"$.service_runbook_url","operator":"exists"}]'::jsonb,
  '[{"actionKey":"open_runbook","actionType":"runbook.open","riskLevel":"low"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:runbook_critical_v1_010', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 11. retry-connector-dead-letter
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000011',
  'retry-connector-dead-letter',
  'platform', NULL,
  'Retry Connector Dead Letter',
  'Automatically retry dead-lettered connector deliveries within a retry budget and notify on final failure.',
  'dead_letter', 'connectors',
  TRUE, TRUE, FALSE, 'starter',
  'module_connectors_enabled',
  ARRAY['connectors','dead_letter','retry'],
  110,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000011',
  'a0000000-0000-4000-8000-000000000011',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"dead_letter","trigger":{"kind":"event","type":"connector.delivery.dead_lettered","sourceModule":"connectors"},"conditions":[{"leftPath":"$.attempts","operator":"lt","rightValue":5}],"actions":[{"actionKey":"retry_delivery","actionType":"connector.delivery.retry","riskLevel":"low","requiresApproval":false,"config":{"maxRetries":3}},{"actionKey":"notify_failure","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{"onFinalFailure":true}}],"safety":{"maxRunsPerHour":200,"dedupeWindowSeconds":120,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"connector.delivery.dead_lettered","sourceModule":"connectors"}]'::jsonb,
  '[{"leftPath":"$.attempts","operator":"lt","rightValue":5}]'::jsonb,
  '[{"actionKey":"retry_delivery","actionType":"connector.delivery.retry","riskLevel":"low"},{"actionKey":"notify_failure","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:connector_dl_retry_v1_011', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 12. retry-ingestion-dead-letter
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000012',
  'retry-ingestion-dead-letter',
  'platform', NULL,
  'Retry Ingestion Dead Letter',
  'Notify and queue ingestion dead-letter events for retry when retryable and within retry budget.',
  'dead_letter', 'ingestion',
  TRUE, TRUE, FALSE, 'starter',
  'module_automation_enabled',
  ARRAY['ingestion','dead_letter','retry'],
  120,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000012',
  'a0000000-0000-4000-8000-000000000012',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"dead_letter","trigger":{"kind":"event","type":"ingestion.dead_letter.created","sourceModule":"ingestion"},"conditions":[{"leftPath":"$.retryable","operator":"eq","rightValue":true},{"leftPath":"$.attempts","operator":"lt","rightValue":3}],"actions":[{"actionKey":"notify_dead_letter","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"noop_retry","actionType":"noop","riskLevel":"low","requiresApproval":false,"config":{"reason":"ingestion_retry_action_pending"}}],"safety":{"maxRunsPerHour":500,"dedupeWindowSeconds":60,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"ingestion.dead_letter.created","sourceModule":"ingestion"}]'::jsonb,
  '[{"leftPath":"$.retryable","operator":"eq","rightValue":true},{"leftPath":"$.attempts","operator":"lt","rightValue":3}]'::jsonb,
  '[{"actionKey":"notify_dead_letter","actionType":"notification.send","riskLevel":"low"},{"actionKey":"noop_retry","actionType":"noop","riskLevel":"low"}]'::jsonb,
  'sha256:ingestion_dl_retry_v1_012', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 13. notify-quota-threshold
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000013',
  'notify-quota-threshold',
  'platform', NULL,
  'Notify on Quota Threshold Breach',
  'Send notifications when billing usage reaches 80%, 90%, or 100% of quota limits.',
  'quota', 'billing',
  TRUE, TRUE, FALSE, 'starter',
  'module_billing_ops_cost_alerts',
  ARRAY['billing','quota','notifications'],
  130,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000013',
  'a0000000-0000-4000-8000-000000000013',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"quota","trigger":{"kind":"event","type":"billing.usage.threshold_breached","sourceModule":"billing"},"conditions":[{"leftPath":"$.usage_percent","operator":"in","rightValue":[80,90,100]}],"actions":[{"actionKey":"notify_quota","actionType":"quota.notify","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":20,"dedupeWindowSeconds":3600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"billing.usage.threshold_breached","sourceModule":"billing"}]'::jsonb,
  '[{"leftPath":"$.usage_percent","operator":"in","rightValue":[80,90,100]}]'::jsonb,
  '[{"actionKey":"notify_quota","actionType":"quota.notify","riskLevel":"low"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:quota_threshold_v1_013', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;


-- =============================================================================
-- 14. ai-credit-usage-spike
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000014',
  'ai-credit-usage-spike',
  'platform', NULL,
  'AI Credit Usage Spike Alert',
  'Notify when AI credit consumption spikes beyond normal usage patterns.',
  'quota', 'ai',
  TRUE, TRUE, FALSE, 'growth',
  'module_ai_insights_enabled',
  ARRAY['ai','billing','credits'],
  140,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000014',
  'a0000000-0000-4000-8000-000000000014',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"quota","trigger":{"kind":"event","type":"billing.usage.threshold_breached","sourceModule":"billing"},"conditions":[{"leftPath":"$.meter","operator":"eq","rightValue":"ai_credits"}],"actions":[{"actionKey":"notify_ai_spike","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"quota_alert","actionType":"quota.notify","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":10,"dedupeWindowSeconds":3600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"billing.usage.threshold_breached","sourceModule":"billing"}]'::jsonb,
  '[{"leftPath":"$.meter","operator":"eq","rightValue":"ai_credits"}]'::jsonb,
  '[{"actionKey":"notify_ai_spike","actionType":"notification.send","riskLevel":"low"},{"actionKey":"quota_alert","actionType":"quota.notify","riskLevel":"low"}]'::jsonb,
  'sha256:ai_credit_spike_v1_014', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 15. security-api-key-anomaly
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000015',
  'security-api-key-anomaly',
  'platform', NULL,
  'Security API Key Anomaly Detection',
  'Notify security team when suspicious API key usage is detected with high confidence.',
  'security', 'security',
  TRUE, TRUE, TRUE, 'business',
  'module_enterprise_features_audit_logs',
  ARRAY['security','api_key','anomaly'],
  150,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000015',
  'a0000000-0000-4000-8000-000000000015',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"security","trigger":{"kind":"event","type":"security.api_key.suspicious_usage","sourceModule":"security"},"conditions":[{"leftPath":"$.confidence","operator":"gt","rightValue":0.7}],"actions":[{"actionKey":"security_notify","actionType":"security.notify","riskLevel":"medium","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":50,"dedupeWindowSeconds":600,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"security.api_key.suspicious_usage","sourceModule":"security"}]'::jsonb,
  '[{"leftPath":"$.confidence","operator":"gt","rightValue":0.7}]'::jsonb,
  '[{"actionKey":"security_notify","actionType":"security.notify","riskLevel":"medium"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:security_api_key_v1_015', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 16. daily-service-health-report
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000016',
  'daily-service-health-report',
  'platform', NULL,
  'Daily Service Health Report',
  'Generate and send a daily service health summary report via configured notification channels.',
  'report', 'reports',
  TRUE, TRUE, FALSE, 'growth',
  'module_analytics_features_custom_reports',
  ARRAY['reports','daily','health'],
  160,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000016',
  'a0000000-0000-4000-8000-000000000016',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"report","trigger":{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler","config":{"cron":"0 8 * * *","timezone":"UTC"}},"conditions":[],"actions":[{"actionKey":"export_report","actionType":"report.export","riskLevel":"low","requiresApproval":false,"config":{"reportType":"daily_service_health"}},{"actionKey":"notify_report","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":2,"dedupeWindowSeconds":43200,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler"}]'::jsonb,
  '[]'::jsonb,
  '[{"actionKey":"export_report","actionType":"report.export","riskLevel":"low"},{"actionKey":"notify_report","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:daily_health_v1_016', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 17. weekly-release-quality-report
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000017',
  'weekly-release-quality-report',
  'platform', NULL,
  'Weekly Release Quality Report',
  'Generate an AI-summarized weekly report on release quality, failure rates, and rollback frequency.',
  'report', 'reports',
  TRUE, TRUE, FALSE, 'business',
  'module_ai_insights_features_weekly_report',
  ARRAY['reports','weekly','releases','ai'],
  170,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000017',
  'a0000000-0000-4000-8000-000000000017',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"report","trigger":{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler","config":{"cron":"0 9 * * 1","timezone":"UTC"}},"conditions":[{"leftPath":"$.release_data_exists","operator":"eq","rightValue":true}],"actions":[{"actionKey":"ai_summarize","actionType":"ai.summary.generate","riskLevel":"low","requiresApproval":false,"config":{"context":"weekly_releases"}},{"actionKey":"export_report","actionType":"report.export","riskLevel":"low","requiresApproval":false,"config":{"reportType":"weekly_release_quality"}},{"actionKey":"notify_report","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":1,"dedupeWindowSeconds":86400,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"schedule","type":"schedule.cron","sourceModule":"scheduler"}]'::jsonb,
  '[{"leftPath":"$.release_data_exists","operator":"eq","rightValue":true}]'::jsonb,
  '[{"actionKey":"ai_summarize","actionType":"ai.summary.generate","riskLevel":"low"},{"actionKey":"export_report","actionType":"report.export","riskLevel":"low"},{"actionKey":"notify_report","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:weekly_release_v1_017', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 18. slo-burn-rate-incident
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000018',
  'slo-burn-rate-incident',
  'platform', NULL,
  'SLO Burn Rate Incident',
  'Create an incident and notify the team when SLO burn rate breaches the configured threshold.',
  'incident_creation', 'monitoring',
  TRUE, TRUE, FALSE, 'growth',
  'module_incident_management_enabled',
  ARRAY['slo','burn_rate','incidents'],
  180,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000018',
  'a0000000-0000-4000-8000-000000000018',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"incident_creation","trigger":{"kind":"event","type":"slo.burn_rate_breached","sourceModule":"monitoring"},"conditions":[{"leftPath":"$.burn_rate","operator":"gt","rightValue":1.5}],"actions":[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium","requiresApproval":false,"config":{"severity":"high"}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":20,"dedupeWindowSeconds":1800,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"slo.burn_rate_breached","sourceModule":"monitoring"}]'::jsonb,
  '[{"leftPath":"$.burn_rate","operator":"gt","rightValue":1.5}]'::jsonb,
  '[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"}]'::jsonb,
  'sha256:slo_burn_rate_v1_018', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 19. cron-missed-job-escalation
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000019',
  'cron-missed-job-escalation',
  'platform', NULL,
  'Cron Missed Job Escalation',
  'Create an incident and page on-call when a high-criticality cron job misses its expected schedule.',
  'escalation', 'monitoring',
  TRUE, TRUE, FALSE, 'growth',
  'module_cron_monitoring_enabled',
  ARRAY['cron','monitoring','escalation'],
  190,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000019',
  'a0000000-0000-4000-8000-000000000019',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"escalation","trigger":{"kind":"event","type":"cron.missed","sourceModule":"cron_monitoring"},"conditions":[{"leftPath":"$.job_criticality","operator":"eq","rightValue":"high"}],"actions":[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium","requiresApproval":false,"config":{}},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low","requiresApproval":false,"config":{}},{"actionKey":"page_oncall","actionType":"pagerduty.trigger","riskLevel":"medium","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":30,"dedupeWindowSeconds":900,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"cron.missed","sourceModule":"cron_monitoring"}]'::jsonb,
  '[{"leftPath":"$.job_criticality","operator":"eq","rightValue":"high"}]'::jsonb,
  '[{"actionKey":"create_incident","actionType":"incident.create","riskLevel":"medium"},{"actionKey":"notify_team","actionType":"notification.send","riskLevel":"low"},{"actionKey":"page_oncall","actionType":"pagerduty.trigger","riskLevel":"medium"}]'::jsonb,
  'sha256:cron_missed_v1_019', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

-- =============================================================================
-- 20. uptime-failure-status-page-draft
-- =============================================================================
INSERT INTO automation_templates (
  id, template_key, scope, organization_id, name, description, workflow_type,
  category, is_active, is_public, is_featured, minimum_plan_tier,
  required_feature_key, tags, sort_order, metadata
) VALUES (
  'a0000000-0000-4000-8000-000000000020',
  'uptime-failure-status-page-draft',
  'platform', NULL,
  'Uptime Failure Status Page Draft',
  'Draft a status page update when a public service uptime check fails for a configurable duration, requiring human approval.',
  'incident_creation', 'uptime',
  TRUE, TRUE, TRUE, 'business',
  'module_uptime_monitoring_enabled',
  ARRAY['uptime','status_page','approval'],
  200,
  '{"schemaVersion":1}'::jsonb
) ON CONFLICT (template_key) WHERE deleted_at IS NULL AND scope = 'platform' DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description,
      minimum_plan_tier = EXCLUDED.minimum_plan_tier,
      required_feature_key = EXCLUDED.required_feature_key,
      tags = EXCLUDED.tags, updated_at = NOW();

INSERT INTO automation_template_versions (
  id, template_id, version, is_current, definition, trigger_summary,
  condition_summary, action_summary, checksum, metadata
) VALUES (
  'b0000000-0000-4000-8000-000000000020',
  'a0000000-0000-4000-8000-000000000020',
  1, TRUE,
  '{"schemaVersion":1,"workflowType":"incident_creation","trigger":{"kind":"event","type":"uptime.failed","sourceModule":"uptime"},"conditions":[{"leftPath":"$.public_service","operator":"eq","rightValue":true},{"leftPath":"$.failure_duration_minutes","operator":"gt","rightValue":5}],"actions":[{"actionKey":"draft_status_page","actionType":"status_page.update","riskLevel":"high","requiresApproval":true,"config":{"mode":"draft"}},{"actionKey":"request_approval","actionType":"approval.request","riskLevel":"high","requiresApproval":false,"config":{}}],"safety":{"maxRunsPerHour":10,"dedupeWindowSeconds":1800,"requiresApprovalAboveRisk":"high"}}'::jsonb,
  '[{"kind":"event","type":"uptime.failed","sourceModule":"uptime"}]'::jsonb,
  '[{"leftPath":"$.public_service","operator":"eq","rightValue":true},{"leftPath":"$.failure_duration_minutes","operator":"gt","rightValue":5}]'::jsonb,
  '[{"actionKey":"draft_status_page","actionType":"status_page.update","riskLevel":"high"},{"actionKey":"request_approval","actionType":"approval.request","riskLevel":"high"}]'::jsonb,
  'sha256:uptime_status_page_v1_020', '{}'::jsonb
) ON CONFLICT (template_id, version) DO NOTHING;

COMMIT;
