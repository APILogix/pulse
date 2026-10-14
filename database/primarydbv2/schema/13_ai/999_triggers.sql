-- Source: canonical_migrations_draft/18_ai/011_ai_model_routes.up.sql
DROP TRIGGER IF EXISTS trg_ai_model_routes_updated_at ON ai_model_routes;
CREATE TRIGGER trg_ai_model_routes_updated_at
  BEFORE UPDATE ON ai_model_routes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
