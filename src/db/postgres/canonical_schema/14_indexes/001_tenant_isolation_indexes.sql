-- Tenant Isolation & Primary Composite Indexes
-- File: 14_indexes/001_tenant_isolation_indexes.sql

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_org_email ON organization_invitations(organization_id, email);

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_org_slug ON projects(organization_id, slug);
CREATE INDEX IF NOT EXISTS idx_proj_env_proj_id ON project_environments(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_members_proj_id ON project_members(project_id);

CREATE INDEX IF NOT EXISTS idx_proj_api_keys_proj_id ON project_api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_proj_api_keys_org_id ON project_api_keys(organization_id);
CREATE INDEX IF NOT EXISTS idx_proj_api_keys_key_hash ON project_api_keys(key_hash);

CREATE INDEX IF NOT EXISTS idx_org_sub_org_id ON organization_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org_id ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_payments_org_id ON payments(organization_id);

CREATE INDEX IF NOT EXISTS idx_connector_configs_org_id ON connector_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_org_proj ON alert_rules(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_alert_incidents_org_proj ON alert_incidents(organization_id, project_id);

CREATE INDEX IF NOT EXISTS idx_events_requests_org_proj ON events_requests(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_events_errors_org_proj ON events_errors(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_events_logs_org_proj ON events_logs(organization_id, project_id);
