-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_partman;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Use UUIDv7 for better time-sorting performance (PostgreSQL 16+)
-- For older versions, use uuid-ossp but add a BIGSERIAL time_sortable column

-- ==========================================
-- 1. BASE EVENTS TABLE (Partitioned by Month)
-- ==========================================
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    
    -- Event classification
    type VARCHAR(20) NOT NULL CHECK (type IN ('error', 'request', 'custom')),
    request_id UUID,
    
    -- Time-based partitioning key
    timestamp TIMESTAMPTZ NOT NULL,
    
    -- Payload with compression
    payload JSONB NOT NULL COMPRESSION lz4,
    
    -- Enterprise audit columns
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ingested_at TIMESTAMPTZ DEFAULT NOW(),
    partition_key DATE GENERATED ALWAYS AS (DATE_TRUNC('month', timestamp)) STORED,
    
    -- Constraints
    CONSTRAINT chk_timestamp_not_future CHECK (timestamp <= NOW() + INTERVAL '1 minute')
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions (automated via pg_partman later)
CREATE TABLE events_default PARTITION OF events DEFAULT;

-- ==========================================
-- 2. REQUEST EVENTS (Partitioned + Optimized)
-- ==========================================
CREATE TABLE request_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL,
    project_id UUID NOT NULL,
    
    request_id UUID,
    url TEXT,
    method VARCHAR(10) CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD')),
    status_code INT CHECK (status_code BETWEEN 100 AND 599),
    latency_ms INT NOT NULL CHECK (latency_ms >= 0),
    
    body_size_bytes INT DEFAULT 0,
    user_id TEXT,
    ip_address INET,
    user_agent TEXT,
    
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Foreign key to events with deferred constraint
    CONSTRAINT fk_request_event 
        FOREIGN KEY (event_id) 
        REFERENCES events(id) 
        ON DELETE CASCADE 
        DEFERRABLE INITIALLY DEFERRED
) PARTITION BY RANGE (timestamp);

-- ==========================================
-- 3. ERROR EVENTS (Partitioned + Critical)
-- ==========================================
CREATE TABLE error_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL,
    project_id UUID NOT NULL,
    
    request_id UUID,
    message TEXT NOT NULL,
    error_type VARCHAR(100) NOT NULL,
    
    -- Fingerprinting for grouping (hash of error_type + normalized stack)
    fingerprint VARCHAR(64) NOT NULL,
    
    -- Structured data with compression
    stack JSONB COMPRESSION lz4,
    context JSONB COMPRESSION lz4,
    metadata JSONB DEFAULT '{}',
    
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ, -- For error tracking workflow
    resolved_by UUID,
    
    CONSTRAINT fk_error_event 
        FOREIGN KEY (event_id) 
        REFERENCES events(id) 
        ON DELETE CASCADE
) PARTITION BY RANGE (timestamp);

-- ==========================================
-- 4. ERROR AGGREGATION (Hot table - Not partitioned)
-- ==========================================
CREATE TABLE error_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    
    -- Aggregation metrics
    first_seen TIMESTAMPTZ NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL,
    occurrences BIGINT DEFAULT 1,
    occurrences_today INT DEFAULT 1,
    
    -- Metadata
    last_message TEXT,
    error_type VARCHAR(100),
    is_resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    priority INT DEFAULT 3 CHECK (priority BETWEEN 1 AND 5), -- 1=Critical, 5=Low
    
    -- Rate limiting / alerting
    last_alerted_at TIMESTAMPTZ,
    alert_count INT DEFAULT 0,
    
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(project_id, fingerprint)
);

-- ==========================================
-- ENTERPRISE INDEXING STRATEGY
-- ==========================================

-- Events: Covering indexes for hot queries
CREATE INDEX CONCURRENTLY idx_events_project_time_type 
ON events(project_id, timestamp DESC, type) 
INCLUDE (payload) 
WHERE timestamp > NOW() - INTERVAL '7 days'; -- Partial index for hot data

CREATE INDEX CONCURRENTLY idx_events_request_id 
ON events(request_id) 
WHERE request_id IS NOT NULL;

-- BRIN index for time-series (much smaller than BTREE, good for old data)
CREATE INDEX idx_events_timestamp_brin ON events USING BRIN (timestamp);

-- Request Events: High-performance indexes
CREATE INDEX CONCURRENTLY idx_req_project_time_method 
ON request_events(project_id, timestamp DESC, method);

CREATE INDEX CONCURRENTLY idx_req_latency_analysis 
ON request_events(project_id, latency_ms, timestamp DESC) 
WHERE timestamp > NOW() - INTERVAL '24 hours';

CREATE INDEX CONCURRENTLY idx_req_status_errors 
ON request_events(project_id, status_code, timestamp DESC) 
WHERE status_code >= 400;

-- Error Events: Observability focused
CREATE INDEX CONCURRENTLY idx_error_fingerprint_time 
ON error_events(fingerprint, timestamp DESC);

CREATE INDEX CONCURRENTLY idx_error_project_unresolved 
ON error_events(project_id, timestamp DESC) 
WHERE resolved_at IS NULL;

CREATE INDEX CONCURRENTLY idx_error_type_analysis 
ON error_events(error_type, timestamp DESC);

-- Error Groups: Fast lookups
CREATE INDEX CONCURRENTLY idx_err_groups_project_active 
ON error_groups(project_id, last_seen DESC) 
WHERE is_resolved = FALSE;

CREATE INDEX CONCURRENTLY idx_err_groups_fingerprint_lookup 
ON error_groups(fingerprint, project_id);

-- ==========================================
-- ROW LEVEL SECURITY (Multi-tenant Isolation)
-- ==========================================
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_events ON events 
    USING (project_id = current_setting('app.current_project_id')::UUID);

CREATE POLICY tenant_isolation_requests ON request_events 
    USING (project_id = current_setting('app.current_project_id')::UUID);

CREATE POLICY tenant_isolation_errors ON error_events 
    USING (project_id = current_setting('app.current_project_id')::UUID);

CREATE POLICY tenant_isolation_groups ON error_groups 
    USING (project_id = current_setting('app.current_project_id')::UUID);

-- ==========================================
-- FUNCTIONS & TRIGGERS
-- ==========================================

-- Auto-update error_groups on new error
CREATE OR REPLACE FUNCTION upsert_error_group()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO error_groups (
        project_id, 
        fingerprint, 
        first_seen, 
        last_seen, 
        occurrences,
        occurrences_today,
        last_message,
        error_type
    ) VALUES (
        NEW.project_id,
        NEW.fingerprint,
        NEW.timestamp,
        NEW.timestamp,
        1,
        1,
        NEW.message,
        NEW.error_type
    )
    ON CONFLICT (project_id, fingerprint) 
    DO UPDATE SET
        last_seen = NEW.timestamp,
        occurrences = error_groups.occurrences + 1,
        occurrences_today = CASE 
            WHEN DATE(error_groups.last_seen) = CURRENT_DATE 
            THEN error_groups.occurrences_today + 1 
            ELSE 1 
        END,
        last_message = NEW.message,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_error_group_upsert
    AFTER INSERT ON error_events
    FOR EACH ROW
    EXECUTE FUNCTION upsert_error_group();

-- Reset daily error counts at midnight (via pg_cron)
CREATE OR REPLACE FUNCTION reset_daily_error_counts()
RETURNS void AS $$
BEGIN
    UPDATE error_groups 
    SET occurrences_today = 0 
    WHERE DATE(last_seen) < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;