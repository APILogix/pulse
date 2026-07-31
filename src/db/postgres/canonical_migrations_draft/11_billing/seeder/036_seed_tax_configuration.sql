-- =============================================================================
-- Module      : Billing
-- Migration   : 036_seed_tax_configuration.sql
-- Description : Seed default tax configuration and regional tax behavior
-- =============================================================================

BEGIN;

INSERT INTO billing_tax_configs (
    tax_key,
    display_name,
    country_code,
    region_code,
    tax_rate,
    tax_behavior,
    reverse_charge_supported,
    vat_number_required,
    is_default,
    is_active
)
VALUES
('default_us','United States Default','US',NULL,0.0000,'exclusive',FALSE,FALSE,TRUE,TRUE),
('default_eu','European Union VAT',NULL,'EU',0.2000,'exclusive',TRUE,TRUE,FALSE,TRUE),
('default_gb','United Kingdom VAT','GB',NULL,0.2000,'exclusive',TRUE,TRUE,FALSE,TRUE),
('default_in','India GST','IN',NULL,0.1800,'exclusive',FALSE,TRUE,FALSE,TRUE)
ON CONFLICT (tax_key)
DO UPDATE SET
    display_name = EXCLUDED.display_name,
    country_code = EXCLUDED.country_code,
    region_code = EXCLUDED.region_code,
    tax_rate = EXCLUDED.tax_rate,
    tax_behavior = EXCLUDED.tax_behavior,
    reverse_charge_supported = EXCLUDED.reverse_charge_supported,
    vat_number_required = EXCLUDED.vat_number_required,
    is_default = EXCLUDED.is_default,
    is_active = EXCLUDED.is_active,
    updated_at = NOW(),
    deleted_at = NULL;

COMMIT;