-- =============================================================================
-- Module      : Billing
-- Migration   : 028d1_seed_billing_features_enterprise_security.sql
-- Description : Seed Enterprise Security & Governance feature catalog
-- =============================================================================

BEGIN;

WITH feature_seed(
feature_key,name,description,category,module,value_type,usage_behavior,configuration,is_public,is_module_root
) AS (
VALUES
('security.enabled','Enterprise Security','Enable enterprise security capabilities','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.sso','Single Sign-On','SAML/OIDC single sign-on','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.scim','SCIM Provisioning','Automated user provisioning','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.custom_roles','Custom Roles','Create custom RBAC roles','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.role_permissions','Granular Permissions','Fine-grained permissions','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.audit_logs','Audit Logs','Organization audit trail','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.approval_workflows','Approval Workflows','Approval-based administrative actions','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.ip_allowlist','IP Allowlist','Restrict access by IP','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.session_policies','Session Policies','Session timeout and policy controls','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.service_accounts','Service Accounts','Machine identities','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.api_key_governance','API Key Governance','API key lifecycle controls','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.secret_management','Secret Management','Manage sensitive credentials','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.data_residency','Data Residency','Regional data residency controls','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.byok','Bring Your Own Key','Customer-managed encryption keys','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.encryption_controls','Encryption Controls','Advanced encryption configuration','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.gdpr','GDPR Compliance','GDPR tooling','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.hipaa','HIPAA Compliance','HIPAA support','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.soc2','SOC2 Compliance','SOC2 controls','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('security.organization_policies','Organization Policies','Organization-wide security policies','feature','security','boolean','none','{}'::jsonb,TRUE,FALSE),

('quota.audit_log_retention_days','Audit Log Retention','Maximum audit log retention','quota','quota','integer','hard_limit','{"unit":"days"}'::jsonb,TRUE,FALSE),
('quota.service_accounts','Service Accounts','Maximum service accounts','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),
('quota.custom_roles','Custom Roles','Maximum custom roles','quota','quota','integer','hard_limit','{}'::jsonb,TRUE,FALSE),

('integrations.okta','Okta','Okta identity integration','integration','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.microsoft_entra','Microsoft Entra ID','Microsoft Entra integration','integration','security','boolean','none','{}'::jsonb,TRUE,FALSE),
('integrations.google_workspace','Google Workspace','Google Workspace integration','integration','security','boolean','none','{}'::jsonb,TRUE,FALSE)
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