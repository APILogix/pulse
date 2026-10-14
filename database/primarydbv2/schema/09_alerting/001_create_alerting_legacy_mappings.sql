-- Normalized final definition for alerting_legacy_mappings.
-- Canonical/historical sources include:
-- - canonical_migrations_draft/08_alerting/022_alerting_consolidation_support.up.sql

CREATE TABLE IF NOT EXISTS alerting_legacy_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  legacy_source VARCHAR(64) NOT NULL,
  legacy_source_id UUID NOT NULL,
  canonical_rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  canonical_binding_id UUID REFERENCES alert_rule_bindings(id) ON DELETE SET NULL,
  source_revision VARCHAR(128),
  source_hash VARCHAR(64),
  mapping_status VARCHAR(24) NOT NULL DEFAULT 'pending'
  CHECK (mapping_status IN ('pending','mapped','quarantined','verified','failed')),
  mapping_error TEXT,
  checkpoint VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_alerting_legacy_mapping_source UNIQUE (legacy_source, legacy_source_id),
  CONSTRAINT ck_alerting_legacy_mapping_tenant CHECK (
  project_id IS NULL OR organization_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_alerting_legacy_mappings_pending
  ON alerting_legacy_mappings (organization_id, mapping_status, updated_at)
  WHERE mapping_status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS idx_alerting_legacy_mappings_canonical
  ON alerting_legacy_mappings (organization_id, canonical_rule_id, canonical_binding_id)
  WHERE canonical_rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alerting_legacy_mappings_project
  ON alerting_legacy_mappings (organization_id, project_id, legacy_source)
  WHERE project_id IS NOT NULL;
