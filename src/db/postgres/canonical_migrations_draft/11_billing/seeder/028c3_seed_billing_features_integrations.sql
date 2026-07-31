-- =============================================================================
-- Module      : Billing
-- Migration   : 028c3_seed_billing_features_integrations.sql
-- Description : Seed Platform Integrations feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('integrations.enabled','Integrations','Enable third-party integrations','feature','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),

('integrations.github','GitHub','GitHub integration','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.gitlab','GitLab','GitLab integration','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.bitbucket','Bitbucket','Bitbucket integration','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),

('integrations.jira','Jira','Jira integration','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.linear','Linear','Linear integration','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),

('integrations.aws','AWS','Amazon Web Services integration','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.azure','Azure','Microsoft Azure integration','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.gcp','Google Cloud','Google Cloud integration','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.vercel','Vercel','Vercel deployment integration','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),

('integrations.opentelemetry','OpenTelemetry','OpenTelemetry interoperability','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.rest_api','REST API','Public REST API access','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.webhooks','Outgoing Webhooks','Outbound webhook support','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.incoming_webhooks','Incoming Webhooks','Inbound webhook endpoints','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.cli','CLI','Command-line interface','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.terraform','Terraform Provider','Terraform provider access','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),

('integrations.data_export','Data Export','Bulk data export','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.data_import','Data Import','Bulk data import','integration','integrations','boolean','none','{}'::jsonb,TRUE,FALSE),

('quota.integrations','Integrations','Maximum connected integrations','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.api_tokens','API Tokens','Maximum personal API tokens','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.webhooks','Webhooks','Maximum webhook endpoints','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE)
)

INSERT INTO billing_features
(feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root)
SELECT
feature_key,name,description,
category::billing_feature_category,
module,
value_type::billing_feature_value_type,
usage_behavior::billing_usage_behavior,
configuration,is_public,is_module_root
FROM feature_seed
ON CONFLICT (feature_key)
DO UPDATE SET
name=EXCLUDED.name,
description=EXCLUDED.description,
category=EXCLUDED.category,
module=EXCLUDED.module,
value_type=EXCLUDED.value_type,
usage_behavior=EXCLUDED.usage_behavior,
configuration=EXCLUDED.configuration,
is_public=EXCLUDED.is_public,
is_module_root=EXCLUDED.is_module_root,
updated_at=NOW(),
deleted_at=NULL;

COMMIT;
