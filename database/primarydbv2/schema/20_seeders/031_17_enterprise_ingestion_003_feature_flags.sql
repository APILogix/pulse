-- Source: canonical_migrations_draft/17_enterprise_ingestion/003_feature_flags.up.sql
INSERT INTO feature_flags (key, scope, scope_id, enabled, description)
VALUES
  ('ai_alert_analysis', 'platform', NULL, FALSE,
   'AI analysis hook between alert generation and notification delivery (extension point, not implemented).'),
  ('experimental_pipelines', 'platform', NULL, FALSE,
   'Enables experimental per-type worker pipelines.'),
  ('beta_processors', 'platform', NULL, FALSE,
   'Enables beta event processors before GA.')
ON CONFLICT DO NOTHING;
