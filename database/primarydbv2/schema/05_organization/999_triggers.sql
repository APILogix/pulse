-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_alert_thresholds_updated_at ON organization_alert_thresholds;
CREATE TRIGGER trg_org_alert_thresholds_updated_at
  BEFORE UPDATE ON organization_alert_thresholds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_members_updated_at ON organization_members;
CREATE TRIGGER trg_org_members_updated_at
  BEFORE UPDATE ON organization_members
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_settings_updated_at ON organization_settings;
CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON organization_settings
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_organization_verified_domains_updated_at ON organization_verified_domains;
CREATE TRIGGER trg_organization_verified_domains_updated_at
BEFORE UPDATE
ON organization_verified_domains
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_org_updated_at ON organizations;
CREATE TRIGGER trg_org_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_quota_requests_updated_at ON quota_requests;
CREATE TRIGGER trg_quota_requests_updated_at
  BEFORE UPDATE ON quota_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
