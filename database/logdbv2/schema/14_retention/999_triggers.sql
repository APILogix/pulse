-- Retention triggers
DROP TRIGGER IF EXISTS trg_retention_jobs_updated_at ON retention_jobs;
CREATE TRIGGER trg_retention_jobs_updated_at
  BEFORE UPDATE ON retention_jobs
  FOR EACH ROW EXECUTE FUNCTION logdb_set_updated_at();
