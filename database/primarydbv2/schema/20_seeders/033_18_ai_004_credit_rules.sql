-- Source: canonical_migrations_draft/18_ai/004_credit_rules.up.sql
INSERT INTO credit_rules (scope, ai_mode, cost, cached_cost, partial_cost, priority, status)
SELECT 'platform', v.ai_mode, v.cost, 0, 0, 100, 'active'
FROM (VALUES
  ('AI_ERROR_EXPLANATION',      2),
  ('AI_ROOT_CAUSE_ANALYSIS',    3),
  ('AI_STACK_TRACE_ANALYSIS',   2),
  ('AI_TRACE_ANALYSIS',         3),
  ('AI_SPAN_ANALYSIS',          2),
  ('AI_SUGGESTED_FIXES',        3),
  ('AI_SQL_OPTIMIZATION',       3),
  ('AI_LOG_SUMMARY',            2),
  ('AI_DEPLOYMENT_CORRELATION', 3),
  ('AI_INCIDENT_SUMMARY',       5),
  ('AI_WEEKLY_REPORT',          5)
) AS v(ai_mode, cost)
WHERE NOT EXISTS (
  SELECT 1 FROM credit_rules cr
  WHERE cr.scope = 'platform' AND cr.ai_mode = v.ai_mode
);
