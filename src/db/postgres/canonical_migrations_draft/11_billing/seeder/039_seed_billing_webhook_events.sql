-- =============================================================================
-- Module      : Billing
-- Migration   : 039_seed_billing_webhook_events.sql
-- Description : Seed supported billing webhook events and delivery policies
-- =============================================================================

BEGIN;

INSERT INTO billing_webhook_event_types (
    event_key,
    category,
    description,
    retry_enabled,
    max_retry_attempts,
    retry_backoff_strategy,
    signing_required,
    is_active
)
VALUES
('subscription.created','subscription','Subscription created',TRUE,10,'exponential',TRUE,TRUE),
('subscription.updated','subscription','Subscription updated',TRUE,10,'exponential',TRUE,TRUE),
('subscription.canceled','subscription','Subscription canceled',TRUE,10,'exponential',TRUE,TRUE),

('invoice.created','invoice','Invoice created',TRUE,10,'exponential',TRUE,TRUE),
('invoice.finalized','invoice','Invoice finalized',TRUE,10,'exponential',TRUE,TRUE),
('invoice.paid','invoice','Invoice paid',TRUE,10,'exponential',TRUE,TRUE),
('invoice.payment_failed','invoice','Invoice payment failed',TRUE,15,'exponential',TRUE,TRUE),

('payment.succeeded','payment','Payment succeeded',TRUE,10,'exponential',TRUE,TRUE),
('payment.failed','payment','Payment failed',TRUE,15,'exponential',TRUE,TRUE),
('payment.refunded','payment','Payment refunded',TRUE,10,'exponential',TRUE,TRUE),

('usage.threshold_reached','usage','Usage threshold reached',TRUE,8,'exponential',TRUE,TRUE),
('usage.limit_exceeded','usage','Usage limit exceeded',TRUE,12,'exponential',TRUE,TRUE),

('addon.purchased','addon','Add-on purchased',TRUE,10,'exponential',TRUE,TRUE),
('coupon.redeemed','coupon','Coupon redeemed',TRUE,8,'exponential',TRUE,TRUE),

('entitlement.updated','entitlement','Entitlements changed',TRUE,10,'exponential',TRUE,TRUE),
('feature.override_applied','entitlement','Feature override applied',TRUE,10,'exponential',TRUE,TRUE)
ON CONFLICT (event_key)
DO UPDATE SET
    category=EXCLUDED.category,
    description=EXCLUDED.description,
    retry_enabled=EXCLUDED.retry_enabled,
    max_retry_attempts=EXCLUDED.max_retry_attempts,
    retry_backoff_strategy=EXCLUDED.retry_backoff_strategy,
    signing_required=EXCLUDED.signing_required,
    is_active=EXCLUDED.is_active,
    updated_at=NOW(),
    deleted_at=NULL;

COMMIT;