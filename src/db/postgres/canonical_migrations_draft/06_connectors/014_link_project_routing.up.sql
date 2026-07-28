BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_configs_tenant_id
  ON connector_configs(id, organization_id);

DO $$
DECLARE invalid_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='connector_configs'
      AND column_name='project_id'
  ) THEN
    EXECUTE $sql$
      SELECT count(*) FROM connector_configs c
      LEFT JOIN projects p ON p.id=c.project_id
      WHERE c.project_id IS NOT NULL
        AND (p.id IS NULL OR p.org_id<>c.organization_id)
    $sql$ INTO invalid_count;
    IF invalid_count > 0 THEN
      RAISE EXCEPTION 'connector_configs contains invalid project ownership';
    END IF;

    EXECUTE $sql$
      INSERT INTO project_connector_subscriptions(
        project_id,organization_id,connector_id,enabled,
        created_by_user_id,updated_by_user_id
      )
      SELECT c.project_id,c.organization_id,c.id,c.status='active',c.created_by,c.updated_by
      FROM connector_configs c
      JOIN projects p ON p.id=c.project_id AND p.org_id=c.organization_id
      WHERE c.project_id IS NOT NULL
      ON CONFLICT DO NOTHING
    $sql$;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_connector_project;
ALTER TABLE connector_configs DROP COLUMN IF EXISTS project_id;
ALTER TABLE project_alert_channels
  DROP CONSTRAINT IF EXISTS fk_project_alert_channels_connector_tenant;
ALTER TABLE project_alert_channels
  ADD CONSTRAINT fk_project_alert_channels_connector_tenant
  FOREIGN KEY(connector_id,organization_id)
  REFERENCES connector_configs(id,organization_id) ON DELETE RESTRICT;
ALTER TABLE project_connector_subscriptions
  DROP CONSTRAINT IF EXISTS fk_project_connector_subscriptions_connector_tenant;
ALTER TABLE project_connector_subscriptions
  ADD CONSTRAINT fk_project_connector_subscriptions_connector_tenant
  FOREIGN KEY(connector_id,organization_id)
  REFERENCES connector_configs(id,organization_id) ON DELETE CASCADE;

COMMENT ON TABLE connector_configs IS
  'Organization-owned connector configuration; project routing uses project_connector_subscriptions.';

COMMIT;
