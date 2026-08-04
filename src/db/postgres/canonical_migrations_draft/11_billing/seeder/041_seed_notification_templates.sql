-- =============================================================================
-- Module      : Billing
-- Migration   : 041_seed_notification_templates.sql
-- Description : Seed default in-app and webhook notification templates
-- =============================================================================

BEGIN;

INSERT INTO billing_notification_templates (
    template_key,
    channel,
    event_key,
    title_template,
    message_template,
    priority,
    enabled
)
VALUES
(
'usage_warning_inapp',
'in_app',
'usage.threshold_reached',
'Usage Warning',
'{{resource_name}} usage has reached {{usage_percent}}% of your plan.',
'medium',
TRUE
),
(
'usage_limit_webhook',
'webhook',
'usage.limit_exceeded',
'Usage Limit Exceeded',
'{{resource_name}} exceeded its included quota.',
'high',
TRUE
),
(
'invoice_paid_inapp',
'in_app',
'invoice.paid',
'Invoice Paid',
'Invoice {{invoice_number}} has been paid successfully.',
'low',
TRUE
),
(
'payment_failed_slack',
'slack',
'payment.failed',
'Payment Failed',
'Payment for invoice {{invoice_number}} failed. Update the payment method.',
'critical',
TRUE
),
(
'subscription_cancelled_inapp',
'in_app',
'subscription.canceled',
'Subscription Cancelled',
'Your subscription will end on {{subscription_end_date}}.',
'medium',
TRUE
)
ON CONFLICT (template_key)
DO UPDATE SET
    channel = EXCLUDED.channel,
    event_key = EXCLUDED.event_key,
    title_template = EXCLUDED.title_template,
    message_template = EXCLUDED.message_template,
    priority = EXCLUDED.priority,
    enabled = EXCLUDED.enabled,
    updated_at = NOW(),
    deleted_at = NULL;

COMMIT;