-- Schema boundary and operational policy registry
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
