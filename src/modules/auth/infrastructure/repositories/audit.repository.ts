/**
 * Auth repository — pure SQL access for the auth module.
 *
 * Conventions:
 *   - Every public function accepts an optional PoolClient so callers can
 *     compose multiple writes inside a single withTransaction block.
 *   - Functions never throw on "not found"; they return null/0/false so the
 *     service layer is the single owner of business-rule errors.
 *   - Sensitive bearer credentials (refresh tokens, email-flow tokens) are
 *     stored only as SHA-256 hashes; the plaintext is never persisted.
 */
import type { PoolClient } from 'pg';

import { pool } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
import type { MFADevice, User, UserSession, UserStatus, MFAType } from '../../domain/types.js';

const repositoryLogger = logger.child({ component: 'auth-repository' });

function shouldDestroyTransactionClient(error: unknown): boolean {
  const pgCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const message = error instanceof Error ? error.message : String(error);

  return (
    pgCode.startsWith('08') ||
    pgCode === '57P01' ||
    pgCode === '57P02' ||
    pgCode === '57P03' ||
    message.includes('Query read timeout') ||
    message.includes('Connection terminated') ||
    message.includes('Connection ended unexpectedly') ||
    message.includes('Connection terminated unexpectedly')
  );
}


// ============================================================================
// PHASE 3 — EMAIL, POLICY, AUDIT, SSO DISCOVERY
// ============================================================================

export async function scheduleAccountDeletion(
  userId: string,
  scheduledAt: Date,
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `UPDATE users
     SET deletion_scheduled_at = $2, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [userId, scheduledAt],
  );
  return result.rows[0] || null;
}

export async function clearScheduledAccountDeletion(
  userId: string,
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `UPDATE users
     SET deletion_scheduled_at = NULL, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [userId],
  );
  return result.rows[0] || null;
}

export async function listUsersDueForDeletion(
  client?: PoolClient,
): Promise<User[]> {
  const db = client || pool;
  const result = await db.query<User>(
    `SELECT * FROM users
     WHERE deleted_at IS NULL
       AND deletion_scheduled_at IS NOT NULL
       AND deletion_scheduled_at <= NOW()`,
  );
  return result.rows;
}

export interface OrgAuthPolicyRow {
  org_id: string;
  org_name: string;
  enforce_sso: boolean;
  enforce_mfa: boolean;
  session_timeout_minutes: number | null;
  // MFA policy (migration 005). Defaulted via COALESCE so a missing
  // organization_settings row resolves to the platform defaults.
  mfa_allowed_methods: string[];
  mfa_primary_method_preference: string | null;
  mfa_backup_codes_required: boolean;
  mfa_grace_period_days: number;
  mfa_max_devices_per_user: number;
  mfa_allow_sms_fallback: boolean;
  mfa_allow_email_fallback: boolean;
  mfa_remember_device_days: number;
}

export async function listOrgAuthPoliciesForUser(
  userId: string,
  client?: PoolClient,
): Promise<OrgAuthPolicyRow[]> {
  const db = client || pool;
  const result = await db.query<OrgAuthPolicyRow>(
    `SELECT o.id AS org_id,
            o.name AS org_name,
            COALESCE(os.enforce_sso, FALSE) AS enforce_sso,
            COALESCE(os.enforce_mfa, FALSE) AS enforce_mfa,
            os.session_timeout_minutes,
            COALESCE(os.mfa_allowed_methods,
                     ARRAY['totp','email','hardware_key','backup_codes'])
              AS mfa_allowed_methods,
            os.mfa_primary_method_preference,
            COALESCE(os.mfa_backup_codes_required, TRUE) AS mfa_backup_codes_required,
            COALESCE(os.mfa_grace_period_days, 7)       AS mfa_grace_period_days,
            COALESCE(os.mfa_max_devices_per_user, 10)   AS mfa_max_devices_per_user,
            COALESCE(os.mfa_allow_sms_fallback, FALSE)  AS mfa_allow_sms_fallback,
            COALESCE(os.mfa_allow_email_fallback, TRUE) AS mfa_allow_email_fallback,
            COALESCE(os.mfa_remember_device_days, 30)   AS mfa_remember_device_days
     FROM organization_members om
     JOIN organizations o ON o.id = om.org_id AND o.deleted_at IS NULL
     LEFT JOIN organization_settings os ON os.org_id = o.id
     WHERE om.user_id = $1 AND om.status = 'active'`,
    [userId],
  );
  return result.rows;
}

export interface SsoDiscoveryRow {
  org_id: string;
  org_name: string;
  provider_id: string;
  provider_type: string;
  provider_name: string;
}

export async function findSsoProvidersByEmailDomain(
  domain: string,
  client?: PoolClient,
): Promise<SsoDiscoveryRow[]> {
  const db = client || pool;
  const normalizedDomain = domain.trim().toLowerCase();
  const result = await db.query<SsoDiscoveryRow>(
    `SELECT o.id AS org_id,
            o.name AS org_name,
            osp.id AS provider_id,
            osp.provider_type,
            osp.provider_name
     FROM organization_sso_providers osp
     JOIN organizations o ON o.id = osp.org_id AND o.deleted_at IS NULL
     WHERE osp.is_active = TRUE
       AND LOWER(osp.domain) = $1
     ORDER BY o.name ASC`,
    [normalizedDomain],
  );
  return result.rows;
}

export interface OidcProviderRow {
  id: string;
  org_id: string;
  provider_name: string;
  provider_type: string;
  domain: string | null;
  oidc_issuer: string;
  oidc_client_id: string;
  oidc_client_secret_encrypted: string;
  oidc_scopes: string | null;
  oidc_jit_provision: boolean;
  oidc_jit_default_role: string;
}

export interface SamlProviderRow {
  id: string;
  org_id: string;
  provider_name: string;
  provider_type: string;
  domain: string | null;
  entity_id: string;
  sso_url: string;
  x509_certificate: string;
  oidc_jit_provision: boolean;
  oidc_jit_default_role: string;
}

export interface SsoProviderRef {
  id: string;
  org_id: string;
  provider_type: string;
}

export async function findSsoProviderRef(
  providerId: string,
  client?: PoolClient,
): Promise<SsoProviderRef | null> {
  const db = client || pool;
  const result = await db.query<SsoProviderRef>(
    `SELECT id, org_id, provider_type
     FROM organization_sso_providers
     WHERE id = $1 AND is_active = TRUE`,
    [providerId],
  );
  return result.rows[0] || null;
}

export async function findSamlProviderById(
  providerId: string,
  client?: PoolClient,
): Promise<SamlProviderRow | null> {
  const db = client || pool;
  const result = await db.query<SamlProviderRow>(
    `SELECT id, org_id, provider_name, provider_type, domain,
            entity_id, sso_url, x509_certificate,
            COALESCE(oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers
     WHERE id = $1 AND is_active = TRUE AND provider_type = 'saml'
       AND entity_id IS NOT NULL AND sso_url IS NOT NULL
       AND x509_certificate IS NOT NULL`,
    [providerId],
  );
  return result.rows[0] || null;
}

export async function findSamlProviderByEntityId(
  idpEntityId: string,
  client?: PoolClient,
): Promise<SamlProviderRow | null> {
  const db = client || pool;
  const result = await db.query<SamlProviderRow>(
    `SELECT id, org_id, provider_name, provider_type, domain,
            entity_id, sso_url, x509_certificate,
            COALESCE(oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers
     WHERE is_active = TRUE AND provider_type = 'saml'
       AND entity_id = $1
       AND sso_url IS NOT NULL AND x509_certificate IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    [idpEntityId],
  );
  return result.rows[0] || null;
}

export async function findSamlProviderForEmailDomain(
  domain: string,
  client?: PoolClient,
): Promise<SamlProviderRow | null> {
  const db = client || pool;
  const result = await db.query<SamlProviderRow>(
    `SELECT id, org_id, provider_name, provider_type, domain,
            entity_id, sso_url, x509_certificate,
            COALESCE(osp.oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(osp.oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers osp
     JOIN organizations o ON o.id = osp.org_id AND o.deleted_at IS NULL
     WHERE osp.is_active = TRUE AND osp.provider_type = 'saml'
       AND LOWER(osp.domain) = $1
       AND osp.entity_id IS NOT NULL
       AND osp.sso_url IS NOT NULL
       AND osp.x509_certificate IS NOT NULL
     ORDER BY osp.created_at ASC
     LIMIT 1`,
    [domain.trim().toLowerCase()],
  );
  return result.rows[0] || null;
}

export async function findOidcProviderById(
  providerId: string,
  client?: PoolClient,
): Promise<OidcProviderRow | null> {
  const db = client || pool;
  const result = await db.query<OidcProviderRow>(
    `SELECT id, org_id, provider_name, provider_type, domain,
            oidc_issuer, oidc_client_id, oidc_client_secret_encrypted, oidc_scopes,
            COALESCE(oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers
     WHERE id = $1 AND is_active = TRUE AND provider_type = 'oidc'
       AND oidc_issuer IS NOT NULL AND oidc_client_id IS NOT NULL
       AND oidc_client_secret_encrypted IS NOT NULL`,
    [providerId],
  );
  return result.rows[0] || null;
}

export async function findOidcProviderForEmailDomain(
  domain: string,
  client?: PoolClient,
): Promise<OidcProviderRow | null> {
  const db = client || pool;
  const result = await db.query<OidcProviderRow>(
    `SELECT id, org_id, provider_name, provider_type, domain,
            oidc_issuer, oidc_client_id, oidc_client_secret_encrypted, oidc_scopes,
            COALESCE(osp.oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(osp.oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers osp
     JOIN organizations o ON o.id = osp.org_id AND o.deleted_at IS NULL
     WHERE osp.is_active = TRUE AND osp.provider_type = 'oidc'
       AND LOWER(osp.domain) = $1
       AND osp.oidc_issuer IS NOT NULL
     ORDER BY osp.created_at ASC
     LIMIT 1`,
    [domain.trim().toLowerCase()],
  );
  return result.rows[0] || null;
}

/** SSO JIT: passwordless user with verified email from IdP. */
export async function createSsoJitUser(
  data: { id: string; email: string; full_name: string },
  client?: PoolClient,
): Promise<User> {
  const db = client || pool;
  const result = await db.query<User>(
    `INSERT INTO users (
       id, email, full_name, password_hash, status, email_verified, email_verified_at,
       data_processing_consent
     ) VALUES ($1, $2, $3, NULL, 'active', TRUE, NOW(), TRUE)
     RETURNING *`,
    [data.id, data.email, data.full_name],
  );
  return result.rows[0]!;
}

export async function addOrgMemberSsoProvision(
  orgId: string,
  userId: string,
  role: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `INSERT INTO organization_members (
       org_id, user_id, role, status, joined_at, joined_method, last_active_at
     ) VALUES ($1, $2, $3, 'active', NOW(), 'sso_auto_provision', NOW())
     ON CONFLICT (org_id, user_id) DO UPDATE SET
       status = 'active',
       role = EXCLUDED.role,
       joined_method = COALESCE(organization_members.joined_method, EXCLUDED.joined_method),
       deactivated_at = NULL,
       deactivated_by = NULL,
       deactivation_reason = NULL,
       last_active_at = NOW()`,
    [orgId, userId, role],
  );
}

export async function updateMFADeviceName(
  deviceId: string,
  userId: string,
  deviceName: string,
  client?: PoolClient,
): Promise<MFADevice | null> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `UPDATE user_mfa_devices
     SET device_name = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_active = TRUE
     RETURNING *`,
    [deviceId, userId, deviceName],
  );
  return result.rows[0] || null;
}

export async function findWebAuthnDeviceByCredentialId(
  credentialId: string,
  client?: PoolClient,
): Promise<MFADevice | null> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `SELECT * FROM user_mfa_devices
     WHERE credential_id = $1 AND device_type = 'hardware_key'
       AND verified = TRUE AND is_active = TRUE`,
    [credentialId],
  );
  return result.rows[0] || null;
}

export async function createWebAuthnDevice(
  data: {
    user_id: string;
    device_name: string;
    credential_id: string;
    public_key: string;
    sign_count: number;
    is_primary: boolean;
  },
  client?: PoolClient,
): Promise<MFADevice> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `INSERT INTO user_mfa_devices (
       user_id, device_type, device_name, credential_id, public_key,
       sign_count, verified, verified_at, is_primary, is_active
     ) VALUES ($1, 'hardware_key', $2, $3, $4, $5, TRUE, NOW(), $6, TRUE)
     RETURNING *`,
    [
      data.user_id,
      data.device_name,
      data.credential_id,
      data.public_key,
      data.sign_count,
      data.is_primary,
    ],
  );
  return result.rows[0]!;
}

export async function updateWebAuthnSignCount(
  deviceId: string,
  signCount: number,
  ipAddress: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_mfa_devices
     SET sign_count = $2, last_used_at = NOW(), last_used_ip = $3::inet, updated_at = NOW()
     WHERE id = $1`,
    [deviceId, signCount, ipAddress],
  );
}

export async function upsertTrustedDevice(
  userId: string,
  fingerprint: string,
  data: {
    device_name?: string;
    ip_address: string;
    user_agent: string;
    expires_at: Date;
  },
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `INSERT INTO user_trusted_devices (
       user_id, device_fingerprint, device_name, ip_address, user_agent, expires_at
     ) VALUES ($1, $2, $3, $4::inet, $5, $6)
     ON CONFLICT (user_id, device_fingerprint) DO UPDATE SET
       device_name = COALESCE(EXCLUDED.device_name, user_trusted_devices.device_name),
       last_seen_at = NOW(),
       expires_at = EXCLUDED.expires_at,
       revoked_at = NULL`,
    [
      userId,
      fingerprint,
      data.device_name ?? null,
      data.ip_address,
      data.user_agent,
      data.expires_at,
    ],
  );
}

export async function isTrustedDevice(
  userId: string,
  fingerprint: string,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query<{ ok: number }>(
    `SELECT 1 AS ok FROM user_trusted_devices
     WHERE user_id = $1 AND device_fingerprint = $2
       AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [userId, fingerprint],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listTrustedDevices(
  userId: string,
  client?: PoolClient,
): Promise<
  Array<{
    id: string;
    device_name: string | null;
    device_fingerprint: string;
    trusted_at: Date;
    expires_at: Date;
    last_seen_at: Date;
  }>
> {
  const db = client || pool;
  const result = await db.query(
    `SELECT id, device_name, device_fingerprint, trusted_at, expires_at, last_seen_at
     FROM user_trusted_devices
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY trusted_at DESC`,
    [userId],
  );
  return result.rows;
}

export type LinkedIdentityProvider = 'google' | 'github';

export interface LinkedIdentityRow {
  id: string;
  user_id: string;
  provider: LinkedIdentityProvider;
  provider_subject: string;
  provider_email: string | null;
  linked_at: Date;
  last_used_at: Date | null;
}

export async function listLinkedIdentities(
  userId: string,
  client?: PoolClient,
): Promise<LinkedIdentityRow[]> {
  const db = client || pool;
  const result = await db.query<LinkedIdentityRow>(
    `SELECT id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at
     FROM user_linked_identities
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY linked_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function findLinkedIdentityByProviderSubject(
  provider: LinkedIdentityProvider,
  providerSubject: string,
  client?: PoolClient,
): Promise<LinkedIdentityRow | null> {
  const db = client || pool;
  const result = await db.query<LinkedIdentityRow>(
    `SELECT id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at
     FROM user_linked_identities
     WHERE provider = $1 AND provider_subject = $2 AND revoked_at IS NULL`,
    [provider, providerSubject],
  );
  return result.rows[0] || null;
}

export async function findLinkedIdentityByUserProvider(
  userId: string,
  provider: LinkedIdentityProvider,
  client?: PoolClient,
): Promise<LinkedIdentityRow | null> {
  const db = client || pool;
  const result = await db.query<LinkedIdentityRow>(
    `SELECT id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at
     FROM user_linked_identities
     WHERE user_id = $1 AND provider = $2 AND revoked_at IS NULL`,
    [userId, provider],
  );
  return result.rows[0] || null;
}

export async function createLinkedIdentity(
  data: {
    user_id: string;
    provider: LinkedIdentityProvider;
    provider_subject: string;
    provider_email: string | null;
    profile_metadata?: Record<string, unknown>;
  },
  client?: PoolClient,
): Promise<LinkedIdentityRow> {
  const db = client || pool;
  const result = await db.query<LinkedIdentityRow>(
    `INSERT INTO user_linked_identities (
       user_id, provider, provider_subject, provider_email, profile_metadata
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at`,
    [
      data.user_id,
      data.provider,
      data.provider_subject,
      data.provider_email,
      JSON.stringify(data.profile_metadata ?? {}),
    ],
  );
  return result.rows[0]!;
}

export interface ScimTokenAuthRow {
  id: string;
  org_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  grace_period_ends_at: Date | null;
  scopes: string[] | null;
}

export async function findScimTokenByHash(
  tokenHash: string,
  orgId: string,
  client?: PoolClient,
): Promise<ScimTokenAuthRow | null> {
  const db = client || pool;
  const result = await db.query<ScimTokenAuthRow>(
    `SELECT t.id,
            t.org_id,
            t.expires_at,
            t.revoked_at,
            t.grace_period_ends_at,
            COALESCE(
              array_agg(DISTINCT s.scope) FILTER (WHERE s.scope IS NOT NULL),
              ARRAY[]::varchar[]
            ) AS scopes
     FROM organization_scim_tokens t
     LEFT JOIN organization_scim_token_scopes s ON s.token_id = t.id
     WHERE t.org_id = $2 AND t.token_hash = $1
     GROUP BY t.id, t.org_id, t.expires_at, t.revoked_at, t.grace_period_ends_at`,
    [tokenHash, orgId],
  );
  return result.rows[0] || null;
}

export async function isScimTokenIpAllowed(
  tokenId: string,
  ipAddress: string,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query<{ has_rules: boolean; allowed: boolean }>(
    `SELECT
       EXISTS(
         SELECT 1 FROM organization_scim_token_ips
         WHERE token_id = $1
       ) AS has_rules,
       EXISTS(
         SELECT 1 FROM organization_scim_token_ips
         WHERE token_id = $1
           AND $2::inet <<= ip_cidr
       ) AS allowed`,
    [tokenId, ipAddress],
  );
  const row = result.rows[0];
  if (!row) return true;
  return row.has_rules ? row.allowed : true;
}

export async function touchScimToken(
  tokenId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE organization_scim_tokens SET last_used_at = NOW() WHERE id = $1`,
    [tokenId],
  );
}

export async function upsertScimUserMapping(
  orgId: string,
  userId: string,
  externalId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `INSERT INTO scim_user_mappings (org_id, user_id, external_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, external_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       updated_at = NOW()`,
    [orgId, userId, externalId],
  );
}

export async function listScimTokenScopes(
  tokenId: string,
  client?: PoolClient,
): Promise<string[]> {
  const db = client || pool;
  const result = await db.query<{ scope: string }>(
    `SELECT scope
     FROM organization_scim_token_scopes
     WHERE token_id = $1
     ORDER BY scope ASC`,
    [tokenId],
  );
  return result.rows.map((row) => row.scope);
}

export async function listScimTokenIps(
  tokenId: string,
  client?: PoolClient,
): Promise<string[]> {
  const db = client || pool;
  const result = await db.query<{ ip_cidr: string }>(
    `SELECT text(ip_cidr) AS ip_cidr
     FROM organization_scim_token_ips
     WHERE token_id = $1
     ORDER BY ip_cidr ASC`,
    [tokenId],
  );
  return result.rows.map((row) => row.ip_cidr);
}

export async function createScimToken(
  data: {
    orgId: string;
    tokenHash: string;
    createdBy: string;
    expiresAt: Date | null;
  },
  client?: PoolClient,
): Promise<{ id: string }> {
  const db = client || pool;
  const result = await db.query<{ id: string }>(
    `INSERT INTO organization_scim_tokens (org_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [data.orgId, data.tokenHash, data.expiresAt, data.createdBy],
  );
  return result.rows[0]!;
}

export async function insertScimTokenScopes(
  tokenId: string,
  scopes: string[],
  client?: PoolClient,
): Promise<void> {
  if (scopes.length === 0) return;
  const db = client || pool;
  const values = scopes.map((_, index) => `($1, $${index + 2})`).join(', ');
  await db.query(
    `INSERT INTO organization_scim_token_scopes (token_id, scope)
     VALUES ${values}
     ON CONFLICT (token_id, scope) DO NOTHING`,
    [tokenId, ...scopes],
  );
}

export async function insertScimTokenIps(
  tokenId: string,
  ipCidrs: string[],
  client?: PoolClient,
): Promise<void> {
  if (ipCidrs.length === 0) return;
  const db = client || pool;
  const values = ipCidrs.map((_, index) => `($1, $${index + 2}::cidr)`).join(', ');
  await db.query(
    `INSERT INTO organization_scim_token_ips (token_id, ip_cidr)
     VALUES ${values}
     ON CONFLICT (token_id, ip_cidr) DO NOTHING`,
    [tokenId, ...ipCidrs],
  );
}

export async function findScimTokenById(
  tokenId: string,
  client?: PoolClient,
): Promise<{ id: string; org_id: string; revoked_at: Date | null } | null> {
  const db = client || pool;
  const result = await db.query<{ id: string; org_id: string; revoked_at: Date | null }>(
    `SELECT id, org_id, revoked_at
     FROM organization_scim_tokens
     WHERE id = $1`,
    [tokenId],
  );
  return result.rows[0] || null;
}

export async function rotateScimToken(
  tokenId: string,
  newTokenId: string,
  gracePeriodEndsAt: Date,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE organization_scim_tokens
     SET revoked_at = NOW(),
         rotated_at = NOW(),
         rotated_from = $2,
         grace_period_ends_at = $3
     WHERE id = $1`,
    [tokenId, newTokenId, gracePeriodEndsAt],
  );
}

export async function revokeScimToken(
  tokenId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE organization_scim_tokens
     SET revoked_at = NOW()
     WHERE id = $1`,
    [tokenId],
  );
}

export async function listScimTokensForOrg(
  orgId: string,
  client?: PoolClient,
): Promise<
  Array<{
    id: string;
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
    scopes: string[];
    allowed_ips: string[];
  }>
> {
  const db = client || pool;
  const result = await db.query<{
    id: string;
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
    scopes: string[] | null;
    allowed_ips: string[] | null;
  }>(
    `SELECT t.id,
            t.created_at,
            t.last_used_at,
            t.expires_at,
            t.revoked_at,
            COALESCE(
              array_agg(DISTINCT s.scope) FILTER (WHERE s.scope IS NOT NULL),
              ARRAY[]::varchar[]
            ) AS scopes,
            COALESCE(
              array_agg(DISTINCT text(i.ip_cidr)) FILTER (WHERE i.ip_cidr IS NOT NULL),
              ARRAY[]::text[]
            ) AS allowed_ips
     FROM organization_scim_tokens t
     LEFT JOIN organization_scim_token_scopes s ON s.token_id = t.id
     LEFT JOIN organization_scim_token_ips i ON i.token_id = t.id
     WHERE t.org_id = $1
     GROUP BY t.id, t.created_at, t.last_used_at, t.expires_at, t.revoked_at
     ORDER BY t.created_at DESC`,
    [orgId],
  );
  return result.rows.map((row) => ({
    ...row,
    scopes: row.scopes ?? [],
    allowed_ips: row.allowed_ips ?? [],
  }));
}

export async function findScimMappingByExternalId(
  orgId: string,
  externalId: string,
  client?: PoolClient,
): Promise<{ user_id: string } | null> {
  const db = client || pool;
  const result = await db.query<{ user_id: string }>(
    `SELECT user_id FROM scim_user_mappings WHERE org_id = $1 AND external_id = $2`,
    [orgId, externalId],
  );
  return result.rows[0] || null;
}

export async function findScimMappingByUserId(
  orgId: string,
  userId: string,
  client?: PoolClient,
): Promise<{ external_id: string } | null> {
  const db = client || pool;
  const result = await db.query<{ external_id: string }>(
    `SELECT external_id FROM scim_user_mappings WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId],
  );
  return result.rows[0] || null;
}

export async function deleteScimUserMapping(
  orgId: string,
  externalId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `DELETE FROM scim_user_mappings WHERE org_id = $1 AND external_id = $2`,
    [orgId, externalId],
  );
}

export async function listScimMappingsForOrg(
  orgId: string,
  startIndex: number,
  count: number,
  client?: PoolClient,
): Promise<{ rows: Array<{ external_id: string; user_id: string }>; total: number }> {
  const db = client || pool;
  const totalRes = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM scim_user_mappings WHERE org_id = $1`,
    [orgId],
  );
  const rowsRes = await db.query<{ external_id: string; user_id: string }>(
    `SELECT external_id, user_id FROM scim_user_mappings
     WHERE org_id = $1 ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`,
    [orgId, count, Math.max(0, startIndex - 1)],
  );
  return {
    rows: rowsRes.rows,
    total: parseInt(totalRes.rows[0]?.count ?? '0', 10),
  };
}

export async function listOrgMembersForScim(
  orgId: string,
  client?: PoolClient,
): Promise<Array<{ user_id: string; role: string; status: string }>> {
  const db = client || pool;
  const result = await db.query<{ user_id: string; role: string; status: string }>(
    `SELECT user_id, role::text AS role, status::text AS status
     FROM organization_members WHERE org_id = $1`,
    [orgId],
  );
  return result.rows;
}

export async function updateOrgMemberRole(
  orgId: string,
  userId: string,
  role: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE organization_members SET role = $3::org_role
     WHERE org_id = $1 AND user_id = $2 AND status = 'active'`,
    [orgId, userId, role],
  );
}

export async function deactivateOrgMemberScim(
  orgId: string,
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE organization_members
     SET status = 'removed',
         deactivated_at = NOW(),
         deactivation_reason = 'SCIM deprovision'
     WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId],
  );
}

export async function listOrgMemberScimIdsByRole(
  orgId: string,
  role: string,
  client?: PoolClient,
): Promise<string[]> {
  const db = client || pool;
  const result = await db.query<{ scim_id: string }>(
    `SELECT COALESCE(m.external_id, om.user_id::text) AS scim_id
     FROM organization_members om
     LEFT JOIN scim_user_mappings m
       ON m.org_id = om.org_id AND m.user_id = om.user_id
     WHERE om.org_id = $1 AND om.role = $2::org_role AND om.status = 'active'`,
    [orgId, role],
  );
  return result.rows.map((r) => r.scim_id);
}

export async function findActiveOrgMember(
  orgId: string,
  userId: string,
  client?: PoolClient,
): Promise<{ user_id: string; role: string } | null> {
  const db = client || pool;
  const result = await db.query<{ user_id: string; role: string }>(
    `SELECT user_id, role::text AS role FROM organization_members
     WHERE org_id = $1 AND user_id = $2 AND status = 'active'`,
    [orgId, userId],
  );
  return result.rows[0] || null;
}

export async function updateLinkedIdentityLastUsed(
  linkId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_linked_identities SET last_used_at = NOW() WHERE id = $1`,
    [linkId],
  );
}

export async function findActiveSessionBySamlNameId(
  nameId: string,
  client?: PoolClient,
): Promise<UserSession | null> {
  const db = client || pool;
  const result = await db.query<UserSession>(
    `SELECT * FROM user_sessions
     WHERE saml_name_id = $1 AND status = 'active'
     ORDER BY last_active_at DESC LIMIT 1`,
    [nameId],
  );
  return result.rows[0] || null;
}

export async function createSamlSession(
  data: {
    sessionId: string;
    providerId: string;
    samlNameId: string;
    samlNameIdFormat?: string | null;
    samlSessionIndex?: string | null;
    issuer: string;
    expiresAt: Date;
  },
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `INSERT INTO saml_sessions (
       session_id, provider_id, saml_name_id, saml_name_id_format,
       saml_session_index, issuer, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      data.sessionId,
      data.providerId,
      data.samlNameId,
      data.samlNameIdFormat ?? null,
      data.samlSessionIndex ?? null,
      data.issuer,
      data.expiresAt,
    ],
  );
}

export async function findLatestSamlSessionByProviderAndNameId(
  providerId: string,
  nameId: string,
  client?: PoolClient,
): Promise<{
  session_id: string;
  provider_id: string;
  saml_name_id: string;
  saml_session_index: string | null;
  issuer: string;
  user_id: string;
} | null> {
  const db = client || pool;
  const result = await db.query<{
    session_id: string;
    provider_id: string;
    saml_name_id: string;
    saml_session_index: string | null;
    issuer: string;
    user_id: string;
  }>(
    `SELECT s.session_id, s.provider_id, s.saml_name_id, s.saml_session_index, s.issuer, us.user_id
     FROM saml_sessions s
     JOIN user_sessions us ON us.id = s.session_id
     WHERE s.provider_id = $1
       AND s.saml_name_id = $2
       AND us.status = 'active'
       AND s.expires_at > NOW()
     ORDER BY us.last_active_at DESC
     LIMIT 1`,
    [providerId, nameId],
  );
  return result.rows[0] || null;
}

export async function listActiveSamlSessionsForLogout(
  providerId: string,
  nameId: string,
  sessionIndex?: string,
  client?: PoolClient,
): Promise<Array<{ session_id: string; user_id: string }>> {
  const db = client || pool;
  const params: unknown[] = [providerId, nameId];
  const sessionIndexClause = sessionIndex
    ? `AND s.saml_session_index = $3`
    : '';
  if (sessionIndex) {
    params.push(sessionIndex);
  }
  const result = await db.query<{ session_id: string; user_id: string }>(
    `SELECT s.session_id, us.user_id
     FROM saml_sessions s
     JOIN user_sessions us ON us.id = s.session_id
     WHERE s.provider_id = $1
       AND s.saml_name_id = $2
       ${sessionIndexClause}
       AND us.status = 'active'
       AND s.expires_at > NOW()`,
    params,
  );
  return result.rows;
}

export async function expireSamlSessionsBySessionIds(
  sessionIds: string[],
  client?: PoolClient,
): Promise<void> {
  if (sessionIds.length === 0) return;
  const db = client || pool;
  await db.query(
    `UPDATE saml_sessions
     SET expires_at = NOW()
     WHERE session_id = ANY($1::uuid[])`,
    [sessionIds],
  );
}

export async function findScimGroupById(
  orgId: string,
  groupId: string,
  client?: PoolClient,
): Promise<{
  id: string;
  external_id: string;
  display_name: string;
  meta_version: number;
  meta_created: Date;
  meta_last_modified: Date;
  active: boolean;
} | null> {
  const db = client || pool;
  const result = await db.query<{
    id: string;
    external_id: string;
    display_name: string;
    meta_version: number;
    meta_created: Date;
    meta_last_modified: Date;
    active: boolean;
  }>(
    `SELECT id, external_id, display_name, meta_version, meta_created, meta_last_modified, active
     FROM scim_groups
     WHERE org_id = $1 AND id = $2`,
    [orgId, groupId],
  );
  return result.rows[0] || null;
}

export async function findScimGroupByExternalId(
  orgId: string,
  externalId: string,
  client?: PoolClient,
): Promise<{ id: string } | null> {
  const db = client || pool;
  const result = await db.query<{ id: string }>(
    `SELECT id
     FROM scim_groups
     WHERE org_id = $1 AND external_id = $2`,
    [orgId, externalId],
  );
  return result.rows[0] || null;
}

export async function createScimGroup(
  orgId: string,
  externalId: string,
  displayName: string,
  client?: PoolClient,
): Promise<{
  id: string;
  external_id: string;
  display_name: string;
  meta_version: number;
  meta_created: Date;
  meta_last_modified: Date;
  active: boolean;
}> {
  const db = client || pool;
  const result = await db.query<{
    id: string;
    external_id: string;
    display_name: string;
    meta_version: number;
    meta_created: Date;
    meta_last_modified: Date;
    active: boolean;
  }>(
    `INSERT INTO scim_groups (org_id, external_id, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, external_id, display_name, meta_version, meta_created, meta_last_modified, active`,
    [orgId, externalId, displayName],
  );
  return result.rows[0]!;
}

export async function updateScimGroup(
  orgId: string,
  groupId: string,
  displayName: string | null,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE scim_groups
     SET display_name = COALESCE($3, display_name),
         meta_last_modified = NOW(),
         meta_version = meta_version + 1
     WHERE org_id = $1 AND id = $2`,
    [orgId, groupId, displayName],
  );
}

export async function deleteScimGroup(
  orgId: string,
  groupId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `DELETE FROM scim_groups
     WHERE org_id = $1 AND id = $2`,
    [orgId, groupId],
  );
}

export async function listScimGroups(
  orgId: string,
  startIndex: number,
  count: number,
  filter?: string,
  client?: PoolClient,
): Promise<{
  rows: Array<{
    id: string;
    external_id: string;
    display_name: string;
    meta_version: number;
    meta_created: Date;
    meta_last_modified: Date;
    active: boolean;
  }>;
  total: number;
}> {
  const db = client || pool;
  const params: unknown[] = [orgId];
  const where = [`org_id = $1`];
  let paramIndex = 2;

  if (filter) {
    const displayNameMatch = filter.match(/displayName\s+eq\s+"([^"]+)"/i);
    const externalIdMatch = filter.match(/(?:externalId|id)\s+eq\s+"([^"]+)"/i);
    if (displayNameMatch?.[1]) {
      where.push(`display_name = $${paramIndex++}`);
      params.push(displayNameMatch[1]);
    } else if (externalIdMatch?.[1]) {
      where.push(`external_id = $${paramIndex++}`);
      params.push(externalIdMatch[1]);
    }
  }

  const whereSql = where.join(' AND ');
  const totalRes = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM scim_groups
     WHERE ${whereSql}`,
    params,
  );
  const rowsRes = await db.query<{
    id: string;
    external_id: string;
    display_name: string;
    meta_version: number;
    meta_created: Date;
    meta_last_modified: Date;
    active: boolean;
  }>(
    `SELECT id, external_id, display_name, meta_version, meta_created, meta_last_modified, active
     FROM scim_groups
     WHERE ${whereSql}
     ORDER BY display_name ASC, id ASC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...params, count, Math.max(0, startIndex - 1)],
  );
  return {
    rows: rowsRes.rows,
    total: parseInt(totalRes.rows[0]?.count ?? '0', 10),
  };
}

export async function listScimGroupMembers(
  groupId: string,
  client?: PoolClient,
): Promise<Array<{ value: string; display: string }>> {
  const db = client || pool;
  const result = await db.query<{ value: string; display: string }>(
    `SELECT COALESCE(m.external_id, u.id::text) AS value,
            u.email AS display
     FROM scim_group_memberships gm
     JOIN users u ON u.id = gm.user_id
     LEFT JOIN scim_user_mappings m ON m.org_id = gm.org_id AND m.user_id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY u.email ASC`,
    [groupId],
  );
  return result.rows;
}

export async function replaceScimGroupMembers(
  orgId: string,
  groupId: string,
  userIds: string[],
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(`DELETE FROM scim_group_memberships WHERE group_id = $1`, [groupId]);
  if (userIds.length === 0) return;
  const values = userIds
    .map((_, index) => `($1, $${index + 2}, $${userIds.length + 2})`)
    .join(', ');
  await db.query(
    `INSERT INTO scim_group_memberships (group_id, user_id, org_id)
     VALUES ${values}
     ON CONFLICT (group_id, user_id) DO NOTHING`,
    [groupId, ...userIds, orgId],
  );
}

export async function addScimGroupMember(
  orgId: string,
  groupId: string,
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `INSERT INTO scim_group_memberships (group_id, user_id, org_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_id, user_id) DO NOTHING`,
    [groupId, userId, orgId],
  );
}

export async function removeScimGroupMember(
  groupId: string,
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `DELETE FROM scim_group_memberships
     WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  );
}

export async function revokeLinkedIdentity(
  userId: string,
  linkId: string,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_linked_identities SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [linkId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function revokeTrustedDevice(
  userId: string,
  deviceId: string,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_trusted_devices SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [deviceId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function revokeAllTrustedDevices(
  userId: string,
  _reason: string,
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_trusted_devices
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [userId],
  );
  return result.rowCount ?? 0;
}

export async function listAuditLogsForUser(
  userId: string,
  options: { limit?: number; offset?: number },
  client?: PoolClient,
): Promise<{
  rows: Array<{
    id: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    org_id: string | null;
    ip_address: string | null;
    created_at: Date;
    metadata: Record<string, unknown> | null;
  }>;
  total: number;
}> {
  const db = client || pool;
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const countRes = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_logs WHERE user_id = $1`,
    [userId],
  );

  const rowsRes = await db.query<{
    id: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    org_id: string | null;
    ip_address: string | null;
    created_at: Date;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT id, action, resource_type, resource_id, org_id,
            host(ip_address)::text AS ip_address, created_at, metadata
     FROM audit_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  return {
    rows: rowsRes.rows,
    total: parseInt(countRes.rows[0]?.count ?? '0', 10),
  };
}
