-- =============================================================================
-- Module      : AI Reliability Assistant
-- Migration   : 001_extensions.up.sql
-- Description : pgvector extension for RAG embeddings (knowledge_chunks).
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

COMMIT;
