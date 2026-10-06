-- Full-text inverted index for distributed traces and span hierarchies (range-partitioned by occurred_at)
CREATE TABLE IF NOT EXISTS trace_search_index (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  project_id UUID,
  environment TEXT NOT NULL,
  source_event_id UUID,
  source_table TEXT NOT NULL,
  search_text TEXT NOT NULL,
  facets JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding REAL[],
  occurred_at TIMESTAMPTZ NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT trace_search_index_environment_string_ck CHECK (
    char_length(environment) BETWEEN 1 AND 64
    AND environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  )
) PARTITION BY RANGE (occurred_at);

CREATE TABLE IF NOT EXISTS trace_search_index_default PARTITION OF trace_search_index DEFAULT;

CREATE INDEX IF NOT EXISTS idx_trace_search_index_text_gin ON trace_search_index USING GIN (to_tsvector('english', search_text));
CREATE INDEX IF NOT EXISTS idx_trace_search_index_facets_gin ON trace_search_index USING GIN (facets);
CREATE INDEX IF NOT EXISTS idx_trace_search_index_tenant_env_time ON trace_search_index (organization_id, project_id, environment, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_trace_search_index_occurred_brin ON trace_search_index USING BRIN (occurred_at);
