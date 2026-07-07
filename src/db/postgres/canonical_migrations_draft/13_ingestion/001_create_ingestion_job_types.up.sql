BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_job_state') THEN
    CREATE TYPE ingestion_job_state AS ENUM (
      'pending',
      'active',
      'completed',
      'failed',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_job_priority') THEN
    CREATE TYPE ingestion_job_priority AS ENUM (
      'critical', 'high', 'normal', 'low', 'background'
    );
  END IF;
END $$;

COMMIT;
