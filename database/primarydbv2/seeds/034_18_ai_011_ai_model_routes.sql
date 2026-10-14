-- Source: canonical_migrations_draft/18_ai/011_ai_model_routes.up.sql
INSERT INTO ai_model_routes (ai_mode, primary_model, fallback_model, temperature, max_tokens, timeout_ms, priority, status)
SELECT v.ai_mode, v.primary_model, v.fallback_model, v.temperature, v.max_tokens, 30000, 100, 'active'
FROM (VALUES
  ('AI_ERROR_EXPLANATION',      'gpt-4o-mini', 'gpt-4o',      0.30::numeric, 2048),
  ('AI_STACK_TRACE_ANALYSIS',   'gpt-4o-mini', 'gpt-4o',      0.20::numeric, 2048),
  ('AI_SPAN_ANALYSIS',          'gpt-4o-mini', 'gpt-4o',      0.20::numeric, 2048),
  ('AI_LOG_SUMMARY',            'gpt-4o-mini', 'gpt-4o',      0.30::numeric, 2048),
  ('AI_ROOT_CAUSE_ANALYSIS',    'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_TRACE_ANALYSIS',         'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_SUGGESTED_FIXES',        'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_SQL_OPTIMIZATION',       'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_DEPLOYMENT_CORRELATION', 'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_INCIDENT_SUMMARY',       'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096),
  ('AI_WEEKLY_REPORT',          'gpt-4o',      'gpt-4o-mini', 0.20::numeric, 4096)
) AS v(ai_mode, primary_model, fallback_model, temperature, max_tokens)
WHERE NOT EXISTS (
  SELECT 1 FROM ai_model_routes r
  WHERE r.ai_mode = v.ai_mode AND r.plan IS NULL AND r.tenant_id IS NULL
);
