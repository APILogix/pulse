BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_type') THEN
    CREATE TYPE connector_type AS ENUM (
      'slack', 'discord', 'teams', 'pagerduty', 'webhook', 'email', 'sms'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_status') THEN
    CREATE TYPE connector_status AS ENUM (
      'active', 'inactive', 'error', 'pending_setup'
    );
  END IF;
END $$;

COMMIT;
