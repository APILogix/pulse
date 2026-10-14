-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_notification_routes_updated_at ON notification_routes;
CREATE TRIGGER trg_notification_routes_updated_at
  BEFORE UPDATE ON notification_routes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
