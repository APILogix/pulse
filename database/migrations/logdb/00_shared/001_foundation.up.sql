BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE OR REPLACE FUNCTION logdb_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_job_state') THEN
    CREATE TYPE logdb_job_state AS ENUM ('pending', 'active', 'completed', 'failed', 'dead_letter', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_severity') THEN
    CREATE TYPE logdb_severity AS ENUM ('debug', 'info', 'warning', 'error', 'critical', 'fatal');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_delivery_status') THEN
    CREATE TYPE logdb_delivery_status AS ENUM ('pending', 'delivered', 'failed', 'retrying', 'discarded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logdb_ai_status') THEN
    CREATE TYPE logdb_ai_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS logdb_schema_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL UNIQUE,
  decision TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO logdb_schema_notes(subject, decision) VALUES
  ('database_boundary', 'Log DB tables intentionally store primary-database identifiers as UUID/TEXT values without REFERENCES constraints. Application services validate ownership and authorization.'),
  ('partitioning_policy', 'Continuously growing event, usage, runtime, audit, AI, automation, and retention tables are range-partitioned by bucket, occurred_at, created_at, or started_at to support retention pruning and dashboard time filters.'),
  ('indexing_policy', 'BRIN indexes support time-window scans on append-heavy tables; btree indexes target tenant-scoped dashboards and worker claims; GIN indexes are limited to JSONB payloads used by search or filtering.')
ON CONFLICT (subject) DO UPDATE SET decision = EXCLUDED.decision;

COMMIT;
