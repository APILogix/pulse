BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerting_policy_versions_policy_org
  ON alerting_policy_versions(policy_id, organization_id);

ALTER TABLE alerting_policy_versions
  ADD CONSTRAINT fk_alerting_policy_version_policy_tenant
  FOREIGN KEY (policy_id, organization_id)
  REFERENCES alerting_policy_catalog(id, organization_id)
  ON DELETE CASCADE;

COMMIT;
