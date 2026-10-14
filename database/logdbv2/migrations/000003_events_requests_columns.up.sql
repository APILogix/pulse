-- Migration: 000003_events_requests_columns.up.sql
-- Database: LogDB v2
-- Description: Add route, url, and latency_ms to events_requests to support full telemetry analytics contracts

ALTER TABLE events_requests
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS url TEXT,
  ADD COLUMN IF NOT EXISTS latency_ms NUMERIC(12,3);
