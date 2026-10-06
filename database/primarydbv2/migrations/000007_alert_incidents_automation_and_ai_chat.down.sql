-- Migration Rollback: 000007_alert_incidents_automation_and_ai_chat.down.sql
-- Database: PrimaryDB v2
-- Rollback for: 000007_alert_incidents_automation_and_ai_chat.up.sql

BEGIN;

-- AI tables
DROP TABLE IF EXISTS ai_tool_calls CASCADE;
DROP TABLE IF EXISTS ai_conversation_messages CASCADE;
DROP TABLE IF EXISTS ai_chat_requests CASCADE;
DROP TABLE IF EXISTS ai_conversations CASCADE;
DROP TABLE IF EXISTS ai_usage_receipts CASCADE;
DROP TABLE IF EXISTS ai_reports CASCADE;
DROP TABLE IF EXISTS ai_evaluations CASCADE;
DROP TABLE IF EXISTS knowledge_chunks CASCADE;
DROP TABLE IF EXISTS knowledge_documents CASCADE;
DROP TABLE IF EXISTS ai_cache CASCADE;
DROP TABLE IF EXISTS ai_jobs CASCADE;
DROP TABLE IF EXISTS ai_feedback CASCADE;
DROP TABLE IF EXISTS ai_responses CASCADE;
DROP TABLE IF EXISTS ai_requests CASCADE;

-- Automation tables
DROP TABLE IF EXISTS automation_audit_logs CASCADE;
DROP TABLE IF EXISTS automation_run_steps CASCADE;
DROP TABLE IF EXISTS automation_runs CASCADE;
DROP TABLE IF EXISTS automation_events_inbox CASCADE;
DROP TYPE IF EXISTS automation_inbox_status CASCADE;

-- Alert incident tables
DROP TABLE IF EXISTS alert_incident_events CASCADE;
DROP TYPE IF EXISTS alert_incident_event_action CASCADE;
DROP TABLE IF EXISTS alert_incidents CASCADE;
DROP TYPE IF EXISTS alert_incident_status CASCADE;

COMMIT;
