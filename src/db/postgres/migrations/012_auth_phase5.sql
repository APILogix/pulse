-- Phase 5 auth: OIDC JIT provisioning flags.

BEGIN;

ALTER TABLE organization_sso_providers
  ADD COLUMN IF NOT EXISTS oidc_jit_provision BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS oidc_jit_default_role VARCHAR(50) NOT NULL DEFAULT 'member';

COMMENT ON COLUMN organization_sso_providers.oidc_jit_provision IS
  'When true, first SSO login for unknown email creates user and org membership.';

COMMIT;
