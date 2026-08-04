-- =============================================================================
-- Module      : Billing
-- Migration   : 040_seed_email_templates.sql
-- Description : Seed default transactional email templates for billing
-- =============================================================================

BEGIN;

INSERT INTO billing_email_templates (
    template_key,
    category,
    subject_template,
    body_template,
    enabled,
    is_default
)
VALUES
(
'trial_expiring',
'billing',
'Your trial expires in {{days_remaining}} day(s)',
'Hi {{customer_name}}, your trial will expire on {{trial_end_date}}. Upgrade to keep your services running.',
TRUE,TRUE
),
(
'invoice_ready',
'billing',
'Invoice {{invoice_number}} is ready',
'Your invoice totaling {{invoice_total}} is ready. You can download and pay it from your billing portal.',
TRUE,TRUE
),
(
'payment_failed',
'billing',
'Payment failed for invoice {{invoice_number}}',
'We could not process your payment. Please update your payment method to avoid service interruption.',
TRUE,TRUE
),
(
'subscription_renewal',
'billing',
'Your subscription has renewed',
'Your {{plan_name}} subscription has been successfully renewed.',
TRUE,TRUE
),
(
'usage_warning',
'usage',
'You have reached {{usage_percent}}% of your plan',
'Your organization has consumed {{usage_percent}}% of the allotted {{resource_name}} quota.',
TRUE,TRUE
),
(
'overage_started',
'usage',
'Overage billing has started',
'Your organization exceeded the included quota. Additional usage will be billed according to your plan.',
TRUE,TRUE
),
(
'coupon_redeemed',
'promotion',
'Coupon {{coupon_code}} applied',
'Your discount has been successfully applied to your subscription.',
TRUE,TRUE
),
(
'subscription_canceled',
'billing',
'Your subscription has been canceled',
'Your subscription will remain active until {{subscription_end_date}}.',
TRUE,TRUE
)
ON CONFLICT (template_key)
DO UPDATE SET
    category = EXCLUDED.category,
    subject_template = EXCLUDED.subject_template,
    body_template = EXCLUDED.body_template,
    enabled = EXCLUDED.enabled,
    is_default = EXCLUDED.is_default,
    updated_at = NOW(),
    deleted_at = NULL;

COMMIT;