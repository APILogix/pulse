-- =============================================================================
-- Module      : Billing
-- Migration   : 028a2_seed_billing_features_projects.sql
-- Description : Seed organization, project and access management features
-- PostgreSQL  : 16+
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('organization.enabled','Organizations','Multi-organization capability','organization','organization','boolean','none','{}'::jsonb,TRUE,FALSE),
('organization.custom_domains','Custom Domains','Custom domains for organization','organization','organization','boolean','none','{}'::jsonb,TRUE,FALSE),
('organization.audit_logs','Audit Logs','Organization audit log access','organization','organization','boolean','none','{}'::jsonb,TRUE,FALSE),
('organization.invites','Member Invites','Invite members into organization','organization','organization','boolean','none','{}'::jsonb,TRUE,FALSE),

('projects.enabled','Projects','Project management','organization','projects','boolean','none','{}'::jsonb,TRUE,FALSE),
('projects.max_projects','Maximum Projects','Maximum projects allowed','quota','projects','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('projects.environments','Project Environments','Multiple deployment environments','organization','projects','boolean','none','{}'::jsonb,TRUE,FALSE),
('projects.archiving','Project Archiving','Archive inactive projects','organization','projects','boolean','none','{}'::jsonb,TRUE,FALSE),
('projects.templates','Project Templates','Reusable project templates','organization','projects','boolean','none','{}'::jsonb,TRUE,FALSE),

('members.max_members','Maximum Members','Maximum organization members','quota','members','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('members.custom_roles','Custom Roles','Create custom RBAC roles','security','members','boolean','none','{}'::jsonb,TRUE,FALSE),
('members.project_roles','Project Roles','Project scoped permissions','security','members','boolean','none','{}'::jsonb,TRUE,FALSE),
('members.teams','Teams','Create and manage teams','organization','members','boolean','none','{}'::jsonb,TRUE,FALSE),
('members.service_accounts','Service Accounts','Machine identities','security','members','boolean','none','{}'::jsonb,TRUE,FALSE),

('api_keys.max_keys','Maximum API Keys','Maximum API keys','quota','api_keys','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('api_keys.scoped_keys','Scoped API Keys','Fine grained API key scopes','security','api_keys','boolean','none','{}'::jsonb,TRUE,FALSE),
('api_keys.rotation','API Key Rotation','Automatic key rotation','security','api_keys','boolean','none','{}'::jsonb,TRUE,FALSE),
('api_keys.expiration','API Key Expiration','Expiring API keys','security','api_keys','boolean','none','{}'::jsonb,TRUE,FALSE),
('api_keys.audit','API Key Audit','API key audit history','security','api_keys','boolean','none','{}'::jsonb,TRUE,FALSE),

('environments.custom','Custom Environments','Create custom environments','organization','environments','boolean','none','{}'::jsonb,TRUE,FALSE),
('environments.production','Production Environment','Production environment support','organization','environments','boolean','none','{}'::jsonb,TRUE,FALSE),
('environments.staging','Staging Environment','Staging environment support','organization','environments','boolean','none','{}'::jsonb,TRUE,FALSE),
('environments.development','Development Environment','Development environment support','organization','environments','boolean','none','{}'::jsonb,TRUE,FALSE)
)

INSERT INTO billing_features
(feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root)
SELECT
feature_key,
name,
description,
category::billing_feature_category,
module,
value_type::billing_feature_value_type,
usage_behavior::billing_usage_behavior,
configuration,
is_public,
is_module_root
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