-- Migration: 000007_alert_incidents_automation_and_ai_chat.up.sql
-- Database: PrimaryDB v2
-- Created: 2026-09-30T14:12:00.000Z
-- Description: Provision missing PrimaryDB control-plane and runtime tables:
--   1. alert_incidents and alert_incident_events
--   2. automation_events_inbox, automation_runs, automation_run_steps, automation_audit_logs
--   3. ai_requests, ai_responses, ai_feedback, ai_jobs, ai_cache, ai_conversations,
--      ai_chat_requests, ai_conversation_messages, ai_tool_calls, knowledge_documents,
--      knowledge_chunks, ai_evaluations, ai_reports, ai_usage_receipts

BEGIN;

-- =============================================================================
-- PART 1: ALERT INCIDENTS & INCIDENT EVENTS
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_incident_status') THEN
    CREATE TYPE alert_incident_status AS ENUM ('open', 'acknowledged', 'resolved');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS alert_incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id            UUID REFERENCES projects(id) ON DELETE CASCADE,
  environment           VARCHAR(64),
  rule_id               UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_revision         INTEGER,
  binding_id            UUID REFERENCES alert_rule_bindings(id) ON DELETE SET NULL,
  fingerprint           VARCHAR(255) NOT NULL,
  dimension_key         VARCHAR(500) NOT NULL DEFAULT 'global',
  status                alert_incident_status NOT NULL DEFAULT 'open',
  severity              alert_severity NOT NULL DEFAULT 'warning',
  title                 VARCHAR(500) NOT NULL,
  service               VARCHAR(255),
  route                 VARCHAR(500),
  observed_value        NUMERIC(20,6),
  threshold_value       NUMERIC(20,6),
  occurrence_count      INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at       TIMESTAMPTZ,
  acknowledged_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_to           UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_reason     VARCHAR(100),
  labels                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alert_incident_resolved_shape CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL)
    OR (status <> 'resolved' AND resolved_at IS NULL)
  ),
  CONSTRAINT ck_alert_incident_acknowledged_shape CHECK (
    status <> 'acknowledged' OR acknowledged_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_incident_active
  ON alert_incidents (organization_id, fingerprint)
  WHERE status IN ('open', 'acknowledged');

CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_status_last_seen
  ON alert_incidents (organization_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_project_status
  ON alert_incidents (organization_id, project_id, status, last_seen_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_incidents_rule
  ON alert_incidents (rule_id, last_seen_at DESC)
  WHERE rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_incidents_assignee
  ON alert_incidents (organization_id, assigned_to, status)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_incidents_acknowledged
  ON alert_incidents (organization_id, acknowledged_at DESC)
  WHERE status = 'acknowledged';

CREATE TABLE IF NOT EXISTS alert_incident_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id       UUID NOT NULL REFERENCES alert_incidents(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE CASCADE,
  kind              VARCHAR(48) NOT NULL,
  actor_type        VARCHAR(16) NOT NULL DEFAULT 'worker',
  actor_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  detail            JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_alert_incident_event_kind CHECK (kind IN (
    'incident_opened',
    'condition_still_breaching',
    'incident_acknowledged',
    'incident_assigned',
    'incident_resolved',
    'incident_reopened',
    'incident_escalated',
    'notification_created',
    'notification_suppressed'
  )),
  CONSTRAINT ck_alert_incident_event_actor CHECK (
    actor_type IN ('worker', 'user', 'system', 'api')
  ),
  CONSTRAINT ck_alert_incident_event_detail CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_alert_incident_events_incident
  ON alert_incident_events (incident_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_incident_events_org_occurred
  ON alert_incident_events (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_incident_events_org_project_occurred
  ON alert_incident_events (organization_id, project_id, occurred_at DESC)
  WHERE project_id IS NOT NULL;

-- =============================================================================
-- PART 2: AUTOMATION RUNTIME TABLES
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_inbox_status') THEN
    CREATE TYPE automation_inbox_status AS ENUM ('pending', 'processing', 'processed', 'retry', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS automation_events_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_module VARCHAR(80) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  source_event_id VARCHAR(200),
  dedupe_key VARCHAR(300) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  status automation_inbox_status NOT NULL DEFAULT 'pending',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(120),
  processed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_inbox_attempts_non_negative CHECK (attempts >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_events_inbox_org_dedupe
  ON automation_events_inbox (organization_id, dedupe_key) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_automation_events_inbox_claimable
  ON automation_events_inbox (received_at)
  WHERE status IN ('pending', 'retry', 'processing');

CREATE INDEX IF NOT EXISTS idx_automation_events_inbox_retry_due
  ON automation_events_inbox (next_retry_at)
  WHERE status = 'retry';

CREATE INDEX IF NOT EXISTS idx_automation_events_inbox_org_received
  ON automation_events_inbox (organization_id, received_at DESC);

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID NULL REFERENCES automation_workflow_versions(id) ON DELETE SET NULL,
  trigger_id UUID NULL REFERENCES automation_triggers(id) ON DELETE SET NULL,
  inbox_event_id UUID NULL REFERENCES automation_events_inbox(id) ON DELETE SET NULL,
  status automation_run_status NOT NULL DEFAULT 'queued',
  trigger_type VARCHAR(120) NOT NULL,
  source_module VARCHAR(80) NOT NULL,
  source_event_id VARCHAR(200),
  dedupe_key VARCHAR(300),
  idempotency_key VARCHAR(300) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(80),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_run_max_attempts_positive CHECK (max_attempts > 0),
  CONSTRAINT chk_run_attempt_positive CHECK (attempt > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_runs_idempotency_key
  ON automation_runs (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_automation_runs_workflow_org_created
  ON automation_runs (workflow_id, organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_org_created
  ON automation_runs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_active
  ON automation_runs (status, updated_at)
  WHERE status IN ('queued', 'running', 'waiting_approval');

CREATE INDEX IF NOT EXISTS idx_automation_runs_expiry
  ON automation_runs (expires_at)
  WHERE expires_at IS NOT NULL AND status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS automation_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  action_id UUID NULL REFERENCES automation_actions(id) ON DELETE SET NULL,
  step_key VARCHAR(100) NOT NULL,
  action_type VARCHAR(120) NOT NULL,
  status automation_step_status NOT NULL DEFAULT 'queued',
  sort_order INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approval_id UUID NULL REFERENCES automation_approvals(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(300),
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(80),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_step_max_attempts_positive CHECK (max_attempts > 0),
  CONSTRAINT chk_step_attempt_positive CHECK (attempt > 0),
  CONSTRAINT chk_step_sort_order_non_negative CHECK (sort_order >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_run_steps_idempotency_key
  ON automation_run_steps (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_run_order
  ON automation_run_steps (run_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_claimable
  ON automation_run_steps (run_id, sort_order)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_timeout
  ON automation_run_steps (timeout_at)
  WHERE status = 'running' AND timeout_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_approval
  ON automation_run_steps (approval_id)
  WHERE approval_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS automation_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  workflow_id UUID NULL REFERENCES automation_workflows(id) ON DELETE SET NULL,
  run_id UUID NULL REFERENCES automation_runs(id) ON DELETE SET NULL,
  step_id UUID NULL REFERENCES automation_run_steps(id) ON DELETE SET NULL,
  approval_id UUID NULL REFERENCES automation_approvals(id) ON DELETE SET NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(40) NOT NULL DEFAULT 'user',
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id UUID,
  request_id VARCHAR(120),
  ip_address INET,
  user_agent TEXT,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_org_occurred
  ON automation_audit_logs (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_workflow
  ON automation_audit_logs (workflow_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_run
  ON automation_audit_logs (run_id);

CREATE INDEX IF NOT EXISTS idx_automation_audit_logs_action
  ON automation_audit_logs (action, occurred_at DESC);

-- =============================================================================
-- PART 3: AI RELIABILITY ASSISTANT CONTROL-PLANE & RUNTIME
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  input_hash TEXT,
  cache_key TEXT,
  model_route TEXT,
  provider TEXT,
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  status TEXT,
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_requests_tenant_time
  ON ai_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_tenant_mode
  ON ai_requests (tenant_id, ai_mode);
CREATE INDEX IF NOT EXISTS idx_ai_requests_cache_key
  ON ai_requests (cache_key)
  WHERE cache_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_responses (
  response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES ai_requests(request_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  answer JSONB,
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  credit_action JSONB,
  status TEXT,
  prompt_template_version TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_responses_request
  ON ai_responses (request_id);
CREATE INDEX IF NOT EXISTS idx_ai_responses_tenant_time
  ON ai_responses (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_responses_tenant_mode
  ON ai_responses (tenant_id, ai_mode);

CREATE TABLE IF NOT EXISTS ai_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID REFERENCES ai_requests(request_id) ON DELETE SET NULL,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  helpful BOOLEAN,
  correction TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_response
  ON ai_feedback (response_id);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_tenant_time
  ON ai_feedback (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ai_mode TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  input_hash TEXT,
  input_ciphertext TEXT,
  idempotency_key TEXT,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  model_route TEXT,
  pgboss_job_id TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_status
  ON ai_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_time
  ON ai_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_pgboss
  ON ai_jobs (pgboss_job_id)
  WHERE pgboss_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_mode TEXT NOT NULL,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (ttl_seconds >= 0),
  etag TEXT,
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_tenant_mode
  ON ai_cache (tenant_id, ai_mode);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expiry
  ON ai_cache (expires_at)
  WHERE invalidated_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  uri TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  checksum TEXT NOT NULL,
  access_control JSONB NOT NULL DEFAULT '{}'::jsonb,
  service_tags TEXT[] NOT NULL DEFAULT '{}',
  environment_tags TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','deleted')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, source_type, checksum)
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES knowledge_documents(document_id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content_summary TEXT NOT NULL,
  embedding VECTOR(1536),
  access_control JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_weight NUMERIC(4,3) NOT NULL DEFAULT 1 CHECK (confidence_weight BETWEEN 0 AND 1),
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content_summary)) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_tenant_status
  ON knowledge_documents (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant
  ON knowledge_chunks (tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_fts
  ON knowledge_chunks USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS ai_evaluations (
  evaluation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES ai_responses(response_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ai_mode TEXT NOT NULL,
  correctness_score NUMERIC(5,2) CHECK (correctness_score BETWEEN 0 AND 100),
  groundedness_score NUMERIC(5,2) CHECK (groundedness_score BETWEEN 0 AND 100),
  safety_score NUMERIC(5,2) CHECK (safety_score BETWEEN 0 AND 100),
  evaluator TEXT NOT NULL,
  dataset_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_reports (
  report_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL,
  report_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  summary JSONB,
  storage_uri TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS ai_usage_receipts (
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  feature_key VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, request_id, feature_key)
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (conversation_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS ai_chat_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('processing','success','failed')),
  response JSONB,
  provider VARCHAR(50),
  model VARCHAR(100),
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  completed_at TIMESTAMPTZ,
  usage_logged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES ai_conversations(conversation_id, tenant_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (request_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS ai_conversation_messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  request_id UUID,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, request_id, role),
  FOREIGN KEY (conversation_id, tenant_id)
    REFERENCES ai_conversations(conversation_id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id, tenant_id)
    REFERENCES ai_chat_requests(request_id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  invocation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  arguments JSONB NOT NULL,
  result JSONB,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  status VARCHAR(20) NOT NULL CHECK (status IN ('success','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (request_id, tenant_id)
    REFERENCES ai_chat_requests(request_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant_user
  ON ai_conversations (tenant_id, user_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_chat_requests_pending_usage
  ON ai_chat_requests (completed_at) WHERE status = 'success' AND usage_logged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_time
  ON ai_conversation_messages (tenant_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_request
  ON ai_tool_calls (tenant_id, request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_response
  ON ai_jobs (tenant_id, response_id);

CREATE INDEX IF NOT EXISTS idx_ai_evaluations_tenant_mode
  ON ai_evaluations (tenant_id, ai_mode, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reports_tenant_period
  ON ai_reports (tenant_id, period_start DESC);

COMMIT;
