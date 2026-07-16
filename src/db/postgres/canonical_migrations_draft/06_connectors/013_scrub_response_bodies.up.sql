BEGIN;

-- Scrub success bodies from previous deliveries (BUG-08)
UPDATE connector_deliveries
SET response_body = NULL,
    provider_response = NULL
WHERE status = 'sent' AND response_body IS NOT NULL;

-- Truncate error messages that are too long
UPDATE connector_deliveries
SET error_message = left(error_message, 2000)
WHERE length(error_message) > 2000;

COMMIT;
