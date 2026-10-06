-- Migration: 000002_analytics_user_sessions_columns.up.sql
-- Database: LogDB v2
-- Description: Add missing session metric and timeline columns to analytics_user_sessions

ALTER TABLE analytics_user_sessions
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS event_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS error_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pages TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
