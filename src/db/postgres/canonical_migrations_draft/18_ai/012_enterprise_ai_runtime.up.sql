-- Enterprise runtime hardening for the AI Reliability Assistant.
BEGIN;

ALTER TABLE credit_balances
  ADD COLUMN IF NOT EXISTS unlimited BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ai_jobs
  ADD COLUMN IF NOT EXISTS input_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS model_route TEXT,
  ADD COLUMN IF NOT EXISTS response_id UUID REFERENCES ai_responses(response_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_jobs_tenant_idempotency
  ON ai_jobs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE ai_requests DROP CONSTRAINT IF EXISTS ai_requests_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_requests_tenant_idempotency
  ON ai_requests (tenant_id, idempotency_key);

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_owner_idempotency
  ON credit_ledger (owner_type, owner_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_responses_request
  ON ai_responses (request_id);

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
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

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
  PRIMARY KEY (tenant_id,request_id,feature_key)
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (conversation_id,tenant_id)
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
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens>=0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens>=0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms>=0),
  completed_at TIMESTAMPTZ,
  usage_logged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (conversation_id,tenant_id)
    REFERENCES ai_conversations(conversation_id,tenant_id) ON DELETE CASCADE,
  UNIQUE (tenant_id,idempotency_key),
  UNIQUE (request_id,tenant_id)
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
  UNIQUE (tenant_id,request_id,role),
  FOREIGN KEY (conversation_id,tenant_id)
    REFERENCES ai_conversations(conversation_id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (request_id,tenant_id)
    REFERENCES ai_chat_requests(request_id,tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  invocation_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  arguments JSONB NOT NULL,
  result JSONB,
  duration_ms INTEGER NOT NULL CHECK (duration_ms>=0),
  status VARCHAR(20) NOT NULL CHECK (status IN ('success','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (request_id,tenant_id)
    REFERENCES ai_chat_requests(request_id,tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant_user
  ON ai_conversations (tenant_id,user_id,updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_chat_requests_pending_usage
  ON ai_chat_requests (completed_at) WHERE status='success' AND usage_logged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_time
  ON ai_conversation_messages (tenant_id,conversation_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_request
  ON ai_tool_calls (tenant_id,request_id,created_at);

-- Guarantee a partition exists for dates not pre-created by billing migrations.
-- The draft chain may be applied over legacy schemas where billing is promoted
-- separately, so this hardening remains safely idempotent in either order.
DO $$
BEGIN
  IF to_regclass('public.ai_usage_logs') IS NOT NULL
     AND to_regclass('public.ai_usage_logs_default') IS NULL THEN
    EXECUTE 'CREATE TABLE ai_usage_logs_default PARTITION OF ai_usage_logs DEFAULT';
    EXECUTE 'CREATE INDEX idx_ai_usage_default_org_time ON ai_usage_logs_default (organization_id, occurred_at DESC)';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ai_refund_credit(
  p_owner_id UUID,
  p_request_id TEXT,
  p_idempotency_key TEXT,
  p_ai_mode TEXT,
  p_amount BIGINT,
  p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  original_amount BIGINT;
  refunded_amount BIGINT;
  original_unlimited BOOLEAN;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Refund amount must be positive'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_request_id,0));

  IF EXISTS (
    SELECT 1 FROM credit_ledger
    WHERE owner_type='organization' AND owner_id=p_owner_id AND idempotency_key=p_idempotency_key
  ) THEN RETURN FALSE; END IF;

  SELECT amount,COALESCE((metadata->>'unlimited')::boolean,FALSE)
  INTO original_amount,original_unlimited
  FROM credit_ledger
  WHERE owner_type='organization' AND owner_id=p_owner_id
    AND request_id=p_request_id AND ai_mode=p_ai_mode
    AND direction='debit' AND status='completed'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF original_amount IS NULL THEN
    RAISE EXCEPTION 'No completed AI debit exists for this refund';
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO refunded_amount
  FROM credit_ledger
  WHERE owner_type='organization' AND owner_id=p_owner_id
    AND request_id=p_request_id AND ai_mode=p_ai_mode
    AND direction='refund' AND status='completed';

  IF p_amount > original_amount-refunded_amount THEN
    RAISE EXCEPTION 'Refund exceeds remaining refundable AI debit';
  END IF;

  IF NOT original_unlimited THEN
    UPDATE credit_balances
    SET balance=balance+p_amount,version=version+1
    WHERE owner_type='organization' AND owner_id=p_owner_id AND unlimited=FALSE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Refund credit balance is unavailable'; END IF;
  END IF;

  INSERT INTO credit_ledger
    (owner_type,owner_id,request_id,idempotency_key,ai_mode,amount,direction,reason,status,metadata)
  VALUES
    ('organization',p_owner_id,p_request_id,p_idempotency_key,p_ai_mode,p_amount,'refund',
     LEFT(COALESCE(p_reason,'AI credit refund'),500),'completed',
     jsonb_build_object('original_debit_amount',original_amount,'unlimited',original_unlimited));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION ai_release_stale_reservations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  item RECORD;
  released INTEGER := 0;
BEGIN
  PERFORM set_config('ai.allow_ledger_mutation','on',true);
  FOR item IN
    SELECT ledger_id,owner_id,amount,(metadata->>'unlimited')::boolean AS unlimited
    FROM credit_ledger
    WHERE direction='debit' AND status='pending' AND created_at < NOW()-INTERVAL '15 minutes'
    FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT COALESCE(item.unlimited,FALSE) THEN
      UPDATE credit_balances
      SET reserved_credits=GREATEST(0,reserved_credits-item.amount),version=version+1
      WHERE owner_type='organization' AND owner_id=item.owner_id;
    END IF;
    UPDATE credit_ledger SET status='failed',reason='Stale reservation automatically released'
    WHERE ledger_id=item.ledger_id;
    released := released+1;
  END LOOP;
  RETURN released;
END;
$$;

-- SECURITY DEFINER functions are callable only by their owning runtime role;
-- do not inherit PostgreSQL's default PUBLIC execute privilege.
REVOKE ALL ON FUNCTION ai_refund_credit(UUID,TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_release_stale_reservations() FROM PUBLIC;

CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_response ON ai_jobs (tenant_id,response_id);
CREATE INDEX IF NOT EXISTS idx_ai_evaluations_tenant_mode ON ai_evaluations (tenant_id,ai_mode,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_reports_tenant_period ON ai_reports (tenant_id,period_start DESC);

COMMENT ON COLUMN ai_jobs.input_ciphertext IS
  'AES-256-GCM encrypted, redacted, bounded async input; cleared after successful processing.';
COMMENT ON TABLE knowledge_documents IS
  'Versioned tenant or global RAG source metadata. Every query must filter tenant and access control.';
COMMENT ON TABLE knowledge_chunks IS
  'Tenant-scoped hybrid vector/full-text retrieval chunks; raw source documents remain outside PostgreSQL.';
COMMENT ON TABLE ai_conversations IS
  'Organization-and-user-scoped monitoring chat conversations; never use provider conversation IDs for authorization.';
COMMENT ON TABLE ai_conversation_messages IS
  'Redacted bounded chat turns retained under the tenant AI retention policy.';
COMMENT ON TABLE ai_tool_calls IS
  'Auditable allowlisted monitoring tool invocations; arguments and results are redacted and bounded before persistence.';
COMMENT ON FUNCTION ai_refund_credit IS
  'Idempotent backend-only AI credit refund. The model can never invoke this function directly.';
COMMENT ON FUNCTION ai_release_stale_reservations IS
  'Releases reservations abandoned by process crashes without deducting credits.';

COMMIT;
