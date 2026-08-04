BEGIN;

-- Intentionally inert. The canonical events_* tables are the only telemetry
-- persistence model. Recreating the former spans/traces/errors/requests tables
-- here would restore a second event schema and the removed environment UUID
-- contract after 10_lookup/003_environment_string_contract.up.sql.

COMMIT;
