-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS auto_revoke_backup_codes ON user_mfa_devices;
CREATE TRIGGER auto_revoke_backup_codes
  AFTER UPDATE ON user_mfa_devices
  FOR EACH ROW
  WHEN (NEW.is_verified = TRUE AND OLD.is_verified = FALSE)
  EXECUTE FUNCTION revoke_and_regenerate_backup_codes();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_mfa_devices_updated_at ON user_mfa_devices;
CREATE TRIGGER trg_mfa_devices_updated_at
  BEFORE UPDATE ON user_mfa_devices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Source: migrations/002_create_all.sql
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
