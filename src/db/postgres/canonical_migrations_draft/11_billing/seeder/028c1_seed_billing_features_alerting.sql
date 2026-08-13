-- =============================================================================
-- Module      : Billing
-- Migration   : 028c1_seed_billing_features_alerting.sql
-- Description : Seed Alerting & Notification feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('alerting.enabled','Alerting','Enable alerting platform','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.rules','Alert Rules','Create alert rules','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.threshold','Threshold Alerts','Static threshold alerts','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.anomaly','Anomaly Alerts','Anomaly-based alerts','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.composite','Composite Alerts','Combine multiple conditions','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.scheduled_mute','Scheduled Muting','Mute alerts on schedules','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.maintenance_windows','Maintenance Windows','Suppress alerts during maintenance','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.deduplication','Deduplication','Deduplicate repeated alerts','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.escalation_policies','Escalation Policies','Configure escalations','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.on_call','On-call Routing','Route alerts to on-call responders','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.incident_timeline','Incident Timeline','Timeline for incidents','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.routing.enabled','Advanced Routing','Enable complex route tables and conditions for alerts','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('alerting.managed_email_fallback','Managed Email Fallback','Use Pulse-managed SMTP when no organization email connector is available','feature','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),

('ai.alert_prioritization','AI Alert Prioritization','Rank alerts by importance','ai','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('ai.alert_deduplication','AI Alert Deduplication','Cluster similar alerts','ai','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),

('quota.alert_rules','Alert Rules','Maximum alert rules per organization','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.project_alert_rules','Project Alert Rules','Maximum alert rules per project','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.alert_channels','Alert Channels','Maximum alert channels per organization','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.connectors','Connectors','Maximum configured connector instances','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.notification_channels','Notification Channels','Maximum notification channels','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.routing_rules','Routing Rules','Maximum alert routing rules per organization','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.daily_alerts','Daily Alerts','Maximum alert notifications generated per day','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.monthly_alerts','Monthly Alerts','Maximum alert notifications generated per month','quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),
('quota.connector_sends','Connector Sends','Maximum connector delivery attempts per month','quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),
('quota.incidents','Monthly Incidents','Maximum tracked incidents','quota','quota','integer','overage','{}'::jsonb,TRUE,FALSE),

('integrations.email','Email Notifications','Notify via email','integration','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.slack','Slack Integration','Notify Slack','integration','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.discord','Discord Integration','Notify Discord','integration','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.microsoft_teams','Microsoft Teams','Notify Microsoft Teams','integration','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.webhook','Webhook Notifications','Custom webhook notifications','integration','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.sms','SMS Notifications','Notify via SMS','integration','alerting','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.pagerduty','PagerDuty','PagerDuty integration','integration','alerting','boolean','none','{}'::jsonb,TRUE,FALSE)
)

INSERT INTO billing_features
(feature_key,feature_name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root)
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
feature_name=EXCLUDED.feature_name,
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
