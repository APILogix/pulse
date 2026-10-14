-- AI Conversations, Chat Requests, Messages, and Tool Calls for PrimaryDB
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
