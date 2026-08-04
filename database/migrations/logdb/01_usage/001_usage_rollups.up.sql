BEGIN;

-- Intentionally inert. Usage counters, billing attribution, API-key usage, and
-- project/environment usage rollups are authoritative control-plane data. The
-- dedicated Log DB stores typed telemetry and analytics facts, not a second
-- billing ledger.

COMMIT;
