-- =============================================================================
-- Module      : Billing
-- Migration   : 035_seed_invoice_templates.sql
-- Description : Seed invoice templates, numbering, payment terms and reminders
-- =============================================================================

BEGIN;

INSERT INTO billing_invoice_settings (
    template_key,
    display_name,
    invoice_prefix,
    next_invoice_number,
    payment_terms_days,
    reminder_days_before_due,
    reminder_days_after_due,
    auto_finalize,
    auto_email,
    default_currency,
    footer_text,
    is_default
)
VALUES (
    'default',
    'Default Invoice Template',
    'INV',
    100000,
    30,
    ARRAY[7,3,1],
    ARRAY[1,7,14],
    TRUE,
    TRUE,
    'USD',
    'Thank you for your business.',
    TRUE
)
ON CONFLICT (template_key)
DO UPDATE SET
    display_name = EXCLUDED.display_name,
    invoice_prefix = EXCLUDED.invoice_prefix,
    payment_terms_days = EXCLUDED.payment_terms_days,
    reminder_days_before_due = EXCLUDED.reminder_days_before_due,
    reminder_days_after_due = EXCLUDED.reminder_days_after_due,
    auto_finalize = EXCLUDED.auto_finalize,
    auto_email = EXCLUDED.auto_email,
    default_currency = EXCLUDED.default_currency,
    footer_text = EXCLUDED.footer_text,
    is_default = EXCLUDED.is_default,
    updated_at = NOW(),
    deleted_at = NULL;

COMMIT;