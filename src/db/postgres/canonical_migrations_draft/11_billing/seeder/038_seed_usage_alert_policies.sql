-- =============================================================================
-- Module      : Billing
-- Migration   : 038_seed_usage_alert_policies.sql
-- Description : Seed default usage alert policies for plan consumption
-- =============================================================================

BEGIN;

INSERT INTO billing_usage_alert_policies (
    policy_key,
    display_name,
    resource_key,
    threshold_percent,
    notification_channels,
    cooldown_minutes,
    repeat_notifications,
    auto_action,
    is_default,
    is_active
)
VALUES
('events_50','Events 50%','events',50,ARRAY['email'],1440,TRUE,'none',TRUE,TRUE),
('events_75','Events 75%','events',75,ARRAY['email','in_app'],720,TRUE,'none',TRUE,TRUE),
('events_90','Events 90%','events',90,ARRAY['email','in_app','slack'],240,TRUE,'recommend_upgrade',TRUE,TRUE),
('events_100','Events 100%','events',100,ARRAY['email','in_app','slack','webhook'],60,TRUE,'enforce_plan_limits',TRUE,TRUE),

('ai_80','AI Credits 80%','ai_credits',80,ARRAY['email'],720,TRUE,'none',TRUE,TRUE),
('ai_100','AI Credits 100%','ai_credits',100,ARRAY['email','in_app'],60,TRUE,'stop_ai_requests',TRUE,TRUE),

('logs_90','Logs 90%','logs',90,ARRAY['email','slack'],240,TRUE,'recommend_addon',TRUE,TRUE),
('logs_100','Logs 100%','logs',100,ARRAY['email','slack','webhook'],60,TRUE,'bill_overage',TRUE,TRUE)
ON CONFLICT (policy_key)
DO UPDATE SET
    display_name = EXCLUDED.display_name,
    resource_key = EXCLUDED.resource_key,
    threshold_percent = EXCLUDED.threshold_percent,
    notification_channels = EXCLUDED.notification_channels,
    cooldown_minutes = EXCLUDED.cooldown_minutes,
    repeat_notifications = EXCLUDED.repeat_notifications,
    auto_action = EXCLUDED.auto_action,
    is_default = EXCLUDED.is_default,
    is_active = EXCLUDED.is_active,
    updated_at = NOW(),
    deleted_at = NULL;

COMMIT;