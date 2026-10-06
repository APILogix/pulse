-- Knowledge Documents, Chunks, Evaluations, Reports, and Usage Receipts for PrimaryDB
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

CREATE INDEX IF NOT EXISTS idx_ai_evaluations_tenant_mode
  ON ai_evaluations (tenant_id, ai_mode, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_reports_tenant_period
  ON ai_reports (tenant_id, period_start DESC);
