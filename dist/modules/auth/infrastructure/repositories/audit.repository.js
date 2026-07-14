import { pool } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
const repositoryLogger = logger.child({ component: 'auth-repository' });
const MFA_DEVICE_SELECT = `
  id,
  user_id,
  CASE
    WHEN type::text = 'webauthn' THEN 'hardware_key'
    WHEN type::text = 'backup_code' THEN 'backup_codes'
    ELSE type::text
  END AS device_type,
  type::text AS type,
  device_type AS mfa_device_type,
  device_name,
  secret_encrypted,
  phone_e164,
  email,
  credential_id,
  public_key,
  sign_count,
  is_verified,
  verified_at,
  last_used_at,
  last_used_ip,
  is_primary,
  is_active,
  disabled_at,
  disabled_reason,
  device_metadata,
  created_at,
  updated_at,
  CASE WHEN is_active THEN NULL ELSE COALESCE(disabled_at, updated_at) END AS deleted_at,
  NULL::text AS display_hint,
  NULL::text AS phone_number_encrypted,
  NULL::jsonb AS backup_codes_hash,
  0::integer AS failed_attempts,
  NULL::timestamptz AS last_failed_at,
  0::integer AS use_count
`;
function shouldDestroyTransactionClient(error) {
    const pgCode = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return (pgCode.startsWith('08') ||
        pgCode === '57P01' ||
        pgCode === '57P02' ||
        pgCode === '57P03' ||
        message.includes('Query read timeout') ||
        message.includes('Connection terminated') ||
        message.includes('Connection ended unexpectedly') ||
        message.includes('Connection terminated unexpectedly'));
}
// ============================================================================
// PHASE 3 — EMAIL, POLICY, AUDIT, SSO DISCOVERY
// ============================================================================
export async function scheduleAccountDeletion(userId, scheduledAt, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET deletion_scheduled_at = $2, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`, [userId, scheduledAt]);
    return result.rows[0] || null;
}
export async function clearScheduledAccountDeletion(userId, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET deletion_scheduled_at = NULL, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`, [userId]);
    return result.rows[0] || null;
}
export async function listUsersDueForDeletion(client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM users
     WHERE deleted_at IS NULL
       AND deletion_scheduled_at IS NOT NULL
       AND deletion_scheduled_at <= NOW()`);
    return result.rows;
}
export async function listOrgAuthPoliciesForUser(userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT o.id AS org_id,
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
     WHERE om.user_id = $1 AND om.status = 'active'`, [userId]);
    return result.rows;
}
export async function findSsoProvidersByEmailDomain(domain, client) {
    const db = client || pool;
    const normalizedDomain = domain.trim().toLowerCase();
    const result = await db.query(`SELECT o.id AS org_id,
            o.name AS org_name,
            osp.id AS provider_id,
            osp.provider_type,
            osp.provider_name
     FROM organization_sso_providers osp
     JOIN organizations o ON o.id = osp.org_id AND o.deleted_at IS NULL
     WHERE osp.is_active = TRUE
       AND LOWER(osp.domain) = $1
     ORDER BY o.name ASC`, [normalizedDomain]);
    return result.rows;
}
export async function findSsoProviderRef(providerId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_type
     FROM organization_sso_providers
     WHERE id = $1 AND is_active = TRUE`, [providerId]);
    return result.rows[0] || null;
}
export async function findSamlProviderById(providerId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
            entity_id, sso_url, x509_certificate,
            COALESCE(oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers
     WHERE id = $1 AND is_active = TRUE AND provider_type = 'saml'
       AND entity_id IS NOT NULL AND sso_url IS NOT NULL
       AND x509_certificate IS NOT NULL`, [providerId]);
    return result.rows[0] || null;
}
export async function findSamlProviderByEntityId(idpEntityId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
            entity_id, sso_url, x509_certificate,
            COALESCE(oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers
     WHERE is_active = TRUE AND provider_type = 'saml'
       AND entity_id = $1
       AND sso_url IS NOT NULL AND x509_certificate IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 1`, [idpEntityId]);
    return result.rows[0] || null;
}
export async function findSamlProviderForEmailDomain(domain, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
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
     LIMIT 1`, [domain.trim().toLowerCase()]);
    return result.rows[0] || null;
}
export async function findOidcProviderById(providerId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
            oidc_issuer, oidc_client_id, oidc_client_secret_encrypted, oidc_scopes,
            COALESCE(oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers
     WHERE id = $1 AND is_active = TRUE AND provider_type = 'oidc'
       AND oidc_issuer IS NOT NULL AND oidc_client_id IS NOT NULL
       AND oidc_client_secret_encrypted IS NOT NULL`, [providerId]);
    return result.rows[0] || null;
}
export async function findOidcProviderForEmailDomain(domain, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
            oidc_issuer, oidc_client_id, oidc_client_secret_encrypted, oidc_scopes,
            COALESCE(osp.oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(osp.oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers osp
     JOIN organizations o ON o.id = osp.org_id AND o.deleted_at IS NULL
     WHERE osp.is_active = TRUE AND osp.provider_type = 'oidc'
       AND LOWER(osp.domain) = $1
       AND osp.oidc_issuer IS NOT NULL
     ORDER BY osp.created_at ASC
     LIMIT 1`, [domain.trim().toLowerCase()]);
    return result.rows[0] || null;
}
/** SSO JIT: passwordless user with verified email from IdP. */
export async function createSsoJitUser(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO users (
       id, email, full_name, password_hash, status, email_verified, email_verified_at,
       data_processing_consent
     ) VALUES ($1, $2, $3, NULL, 'active', TRUE, NOW(), TRUE)
     RETURNING *`, [data.id, data.email, data.full_name]);
    return result.rows[0];
}
export async function addOrgMemberSsoProvision(orgId, userId, role, client) {
    const db = client || pool;
    await db.query(`INSERT INTO organization_members (
       org_id, user_id, role, status, joined_at, joined_method, last_active_at
     ) VALUES ($1, $2, $3, 'active', NOW(), 'sso_auto_provision', NOW())
     ON CONFLICT (org_id, user_id) DO UPDATE SET
       status = 'active',
       role = EXCLUDED.role,
       joined_method = COALESCE(organization_members.joined_method, EXCLUDED.joined_method),
       deactivated_at = NULL,
       deactivated_by = NULL,
       deactivation_reason = NULL,
       last_active_at = NOW()`, [orgId, userId, role]);
}
export async function updateMFADeviceName(deviceId, userId, deviceName, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_mfa_devices
     SET device_name = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_active = TRUE
     RETURNING *`, [deviceId, userId, deviceName]);
    return result.rows[0] || null;
}
export async function findWebAuthnDeviceByCredentialId(credentialId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT ${MFA_DEVICE_SELECT} FROM user_mfa_devices
     WHERE credential_id = $1 AND type = 'webauthn'::mfa_type
       AND is_verified = TRUE AND is_active = TRUE`, [credentialId]);
    return result.rows[0] || null;
}
export async function createWebAuthnDevice(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO user_mfa_devices (
       user_id, type, device_type, device_name, credential_id, public_key,
       sign_count, is_verified, verified_at, is_primary, is_active
     ) VALUES ($1, 'webauthn'::mfa_type, 'hardware_key', $2, $3, $4, $5, TRUE, NOW(), $6, TRUE)
     RETURNING ${MFA_DEVICE_SELECT}`, [
        data.user_id,
        data.device_name,
        data.credential_id,
        data.public_key,
        data.sign_count,
        data.is_primary,
    ]);
    return result.rows[0];
}
export async function updateWebAuthnSignCount(deviceId, signCount, ipAddress, client) {
    const db = client || pool;
    await db.query(`UPDATE user_mfa_devices
     SET sign_count = $2, last_used_at = NOW(), last_used_ip = $3::inet, updated_at = NOW()
     WHERE id = $1`, [deviceId, signCount, ipAddress]);
}
export async function upsertTrustedDevice(userId, fingerprint, data, client) {
    const db = client || pool;
    await db.query(`INSERT INTO user_trusted_devices (
       user_id, device_fingerprint, device_name, ip_address, user_agent, expires_at
     ) VALUES ($1, $2, $3, $4::inet, $5, $6)
     ON CONFLICT (user_id, device_fingerprint) DO UPDATE SET
       device_name = COALESCE(EXCLUDED.device_name, user_trusted_devices.device_name),
       last_seen_at = NOW(),
       expires_at = EXCLUDED.expires_at,
       revoked_at = NULL`, [
        userId,
        fingerprint,
        data.device_name ?? null,
        data.ip_address,
        data.user_agent,
        data.expires_at,
    ]);
}
export async function isTrustedDevice(userId, fingerprint, client) {
    const db = client || pool;
    const result = await db.query(`SELECT 1 AS ok FROM user_trusted_devices
     WHERE user_id = $1 AND device_fingerprint = $2
       AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`, [userId, fingerprint]);
    return (result.rowCount ?? 0) > 0;
}
export async function listTrustedDevices(userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, device_name, device_fingerprint, trusted_at, expires_at, last_seen_at
     FROM user_trusted_devices
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY trusted_at DESC`, [userId]);
    return result.rows;
}
export async function listLinkedIdentities(userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at
     FROM user_linked_identities
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY linked_at DESC`, [userId]);
    return result.rows;
}
export async function findLinkedIdentityByProviderSubject(provider, providerSubject, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at
     FROM user_linked_identities
     WHERE provider = $1 AND provider_subject = $2 AND revoked_at IS NULL`, [provider, providerSubject]);
    return result.rows[0] || null;
}
export async function findLinkedIdentityByUserProvider(userId, provider, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at
     FROM user_linked_identities
     WHERE user_id = $1 AND provider = $2 AND revoked_at IS NULL`, [userId, provider]);
    return result.rows[0] || null;
}
export async function createLinkedIdentity(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO user_linked_identities (
       user_id, provider, provider_subject, provider_email, profile_metadata
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at`, [
        data.user_id,
        data.provider,
        data.provider_subject,
        data.provider_email,
        JSON.stringify(data.profile_metadata ?? {}),
    ]);
    return result.rows[0];
}
export async function findScimTokenByHash(tokenHash, orgId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT t.id,
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
     GROUP BY t.id, t.org_id, t.expires_at, t.revoked_at, t.grace_period_ends_at`, [tokenHash, orgId]);
    return result.rows[0] || null;
}
export async function isScimTokenIpAllowed(tokenId, ipAddress, client) {
    const db = client || pool;
    const result = await db.query(`SELECT
       EXISTS(
         SELECT 1 FROM organization_scim_token_ips
         WHERE token_id = $1
       ) AS has_rules,
       EXISTS(
         SELECT 1 FROM organization_scim_token_ips
         WHERE token_id = $1
           AND $2::inet <<= ip_cidr
       ) AS allowed`, [tokenId, ipAddress]);
    const row = result.rows[0];
    if (!row)
        return true;
    return row.has_rules ? row.allowed : true;
}
export async function touchScimToken(tokenId, client) {
    const db = client || pool;
    await db.query(`UPDATE organization_scim_tokens SET last_used_at = NOW() WHERE id = $1`, [tokenId]);
}
export async function upsertScimUserMapping(orgId, userId, externalId, client) {
    const db = client || pool;
    await db.query(`INSERT INTO scim_user_mappings (org_id, user_id, external_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, external_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       updated_at = NOW()`, [orgId, userId, externalId]);
}
export async function listScimTokenScopes(tokenId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT scope
     FROM organization_scim_token_scopes
     WHERE token_id = $1
     ORDER BY scope ASC`, [tokenId]);
    return result.rows.map((row) => row.scope);
}
export async function listScimTokenIps(tokenId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT text(ip_cidr) AS ip_cidr
     FROM organization_scim_token_ips
     WHERE token_id = $1
     ORDER BY ip_cidr ASC`, [tokenId]);
    return result.rows.map((row) => row.ip_cidr);
}
export async function createScimToken(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO organization_scim_tokens (org_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`, [data.orgId, data.tokenHash, data.expiresAt, data.createdBy]);
    return result.rows[0];
}
export async function insertScimTokenScopes(tokenId, scopes, client) {
    if (scopes.length === 0)
        return;
    const db = client || pool;
    const values = scopes.map((_, index) => `($1, $${index + 2})`).join(', ');
    await db.query(`INSERT INTO organization_scim_token_scopes (token_id, scope)
     VALUES ${values}
     ON CONFLICT (token_id, scope) DO NOTHING`, [tokenId, ...scopes]);
}
export async function insertScimTokenIps(tokenId, ipCidrs, client) {
    if (ipCidrs.length === 0)
        return;
    const db = client || pool;
    const values = ipCidrs.map((_, index) => `($1, $${index + 2}::cidr)`).join(', ');
    await db.query(`INSERT INTO organization_scim_token_ips (token_id, ip_cidr)
     VALUES ${values}
     ON CONFLICT (token_id, ip_cidr) DO NOTHING`, [tokenId, ...ipCidrs]);
}
export async function findScimTokenById(tokenId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, revoked_at
     FROM organization_scim_tokens
     WHERE id = $1`, [tokenId]);
    return result.rows[0] || null;
}
export async function rotateScimToken(tokenId, newTokenId, gracePeriodEndsAt, client) {
    const db = client || pool;
    await db.query(`UPDATE organization_scim_tokens
     SET revoked_at = NOW(),
         rotated_at = NOW(),
         rotated_from = $2,
         grace_period_ends_at = $3
     WHERE id = $1`, [tokenId, newTokenId, gracePeriodEndsAt]);
}
export async function revokeScimToken(tokenId, client) {
    const db = client || pool;
    await db.query(`UPDATE organization_scim_tokens
     SET revoked_at = NOW()
     WHERE id = $1`, [tokenId]);
}
export async function listScimTokensForOrg(orgId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT t.id,
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
     ORDER BY t.created_at DESC`, [orgId]);
    return result.rows.map((row) => ({
        ...row,
        scopes: row.scopes ?? [],
        allowed_ips: row.allowed_ips ?? [],
    }));
}
export async function findScimMappingByExternalId(orgId, externalId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT user_id FROM scim_user_mappings WHERE org_id = $1 AND external_id = $2`, [orgId, externalId]);
    return result.rows[0] || null;
}
export async function findScimMappingByUserId(orgId, userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT external_id FROM scim_user_mappings WHERE org_id = $1 AND user_id = $2`, [orgId, userId]);
    return result.rows[0] || null;
}
export async function deleteScimUserMapping(orgId, externalId, client) {
    const db = client || pool;
    await db.query(`DELETE FROM scim_user_mappings WHERE org_id = $1 AND external_id = $2`, [orgId, externalId]);
}
export async function listScimMappingsForOrg(orgId, startIndex, count, client) {
    const db = client || pool;
    const totalRes = await db.query(`SELECT COUNT(*)::text AS count FROM scim_user_mappings WHERE org_id = $1`, [orgId]);
    const rowsRes = await db.query(`SELECT external_id, user_id FROM scim_user_mappings
     WHERE org_id = $1 ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`, [orgId, count, Math.max(0, startIndex - 1)]);
    return {
        rows: rowsRes.rows,
        total: parseInt(totalRes.rows[0]?.count ?? '0', 10),
    };
}
export async function listOrgMembersForScim(orgId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT user_id, role::text AS role, status::text AS status
     FROM organization_members WHERE org_id = $1`, [orgId]);
    return result.rows;
}
export async function updateOrgMemberRole(orgId, userId, role, client) {
    const db = client || pool;
    await db.query(`UPDATE organization_members SET role = $3::org_role
     WHERE org_id = $1 AND user_id = $2 AND status = 'active'`, [orgId, userId, role]);
}
export async function deactivateOrgMemberScim(orgId, userId, client) {
    const db = client || pool;
    await db.query(`UPDATE organization_members
     SET status = 'removed',
         deactivated_at = NOW(),
         deactivation_reason = 'SCIM deprovision'
     WHERE org_id = $1 AND user_id = $2`, [orgId, userId]);
}
export async function listOrgMemberScimIdsByRole(orgId, role, client) {
    const db = client || pool;
    const result = await db.query(`SELECT COALESCE(m.external_id, om.user_id::text) AS scim_id
     FROM organization_members om
     LEFT JOIN scim_user_mappings m
       ON m.org_id = om.org_id AND m.user_id = om.user_id
     WHERE om.org_id = $1 AND om.role = $2::org_role AND om.status = 'active'`, [orgId, role]);
    return result.rows.map((r) => r.scim_id);
}
export async function findActiveOrgMember(orgId, userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT user_id, role::text AS role FROM organization_members
     WHERE org_id = $1 AND user_id = $2 AND status = 'active'`, [orgId, userId]);
    return result.rows[0] || null;
}
export async function updateLinkedIdentityLastUsed(linkId, client) {
    const db = client || pool;
    await db.query(`UPDATE user_linked_identities SET last_used_at = NOW() WHERE id = $1`, [linkId]);
}
export async function findActiveSessionBySamlNameId(nameId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM user_sessions
     WHERE saml_name_id = $1 AND status = 'active'
     ORDER BY last_active_at DESC LIMIT 1`, [nameId]);
    return result.rows[0] || null;
}
export async function createSamlSession(data, client) {
    const db = client || pool;
    await db.query(`INSERT INTO saml_sessions (
       session_id, provider_id, saml_name_id, saml_name_id_format,
       saml_session_index, issuer, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        data.sessionId,
        data.providerId,
        data.samlNameId,
        data.samlNameIdFormat ?? null,
        data.samlSessionIndex ?? null,
        data.issuer,
        data.expiresAt,
    ]);
}
export async function findLatestSamlSessionByProviderAndNameId(providerId, nameId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT s.session_id, s.provider_id, s.saml_name_id, s.saml_session_index, s.issuer, us.user_id
     FROM saml_sessions s
     JOIN user_sessions us ON us.id = s.session_id
     WHERE s.provider_id = $1
       AND s.saml_name_id = $2
       AND us.status = 'active'
       AND s.expires_at > NOW()
     ORDER BY us.last_active_at DESC
     LIMIT 1`, [providerId, nameId]);
    return result.rows[0] || null;
}
export async function listActiveSamlSessionsForLogout(providerId, nameId, sessionIndex, client) {
    const db = client || pool;
    const params = [providerId, nameId];
    const sessionIndexClause = sessionIndex
        ? `AND s.saml_session_index = $3`
        : '';
    if (sessionIndex) {
        params.push(sessionIndex);
    }
    const result = await db.query(`SELECT s.session_id, us.user_id
     FROM saml_sessions s
     JOIN user_sessions us ON us.id = s.session_id
     WHERE s.provider_id = $1
       AND s.saml_name_id = $2
       ${sessionIndexClause}
       AND us.status = 'active'
       AND s.expires_at > NOW()`, params);
    return result.rows;
}
export async function expireSamlSessionsBySessionIds(sessionIds, client) {
    if (sessionIds.length === 0)
        return;
    const db = client || pool;
    await db.query(`UPDATE saml_sessions
     SET expires_at = NOW()
     WHERE session_id = ANY($1::uuid[])`, [sessionIds]);
}
export async function findScimGroupById(orgId, groupId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, external_id, display_name, meta_version, meta_created, meta_last_modified, active
     FROM scim_groups
     WHERE org_id = $1 AND id = $2`, [orgId, groupId]);
    return result.rows[0] || null;
}
export async function findScimGroupByExternalId(orgId, externalId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id
     FROM scim_groups
     WHERE org_id = $1 AND external_id = $2`, [orgId, externalId]);
    return result.rows[0] || null;
}
export async function createScimGroup(orgId, externalId, displayName, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO scim_groups (org_id, external_id, display_name)
     VALUES ($1, $2, $3)
     RETURNING id, external_id, display_name, meta_version, meta_created, meta_last_modified, active`, [orgId, externalId, displayName]);
    return result.rows[0];
}
export async function updateScimGroup(orgId, groupId, displayName, client) {
    const db = client || pool;
    await db.query(`UPDATE scim_groups
     SET display_name = COALESCE($3, display_name),
         meta_last_modified = NOW(),
         meta_version = meta_version + 1
     WHERE org_id = $1 AND id = $2`, [orgId, groupId, displayName]);
}
export async function deleteScimGroup(orgId, groupId, client) {
    const db = client || pool;
    await db.query(`DELETE FROM scim_groups
     WHERE org_id = $1 AND id = $2`, [orgId, groupId]);
}
export async function listScimGroups(orgId, startIndex, count, filter, client) {
    const db = client || pool;
    const params = [orgId];
    const where = [`org_id = $1`];
    let paramIndex = 2;
    if (filter) {
        const displayNameMatch = filter.match(/displayName\s+eq\s+"([^"]+)"/i);
        const externalIdMatch = filter.match(/(?:externalId|id)\s+eq\s+"([^"]+)"/i);
        if (displayNameMatch?.[1]) {
            where.push(`display_name = $${paramIndex++}`);
            params.push(displayNameMatch[1]);
        }
        else if (externalIdMatch?.[1]) {
            where.push(`external_id = $${paramIndex++}`);
            params.push(externalIdMatch[1]);
        }
    }
    const whereSql = where.join(' AND ');
    const totalRes = await db.query(`SELECT COUNT(*)::text AS count
     FROM scim_groups
     WHERE ${whereSql}`, params);
    const rowsRes = await db.query(`SELECT id, external_id, display_name, meta_version, meta_created, meta_last_modified, active
     FROM scim_groups
     WHERE ${whereSql}
     ORDER BY display_name ASC, id ASC
     LIMIT $${paramIndex++} OFFSET $${paramIndex++}`, [...params, count, Math.max(0, startIndex - 1)]);
    return {
        rows: rowsRes.rows,
        total: parseInt(totalRes.rows[0]?.count ?? '0', 10),
    };
}
export async function listScimGroupMembers(groupId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT COALESCE(m.external_id, u.id::text) AS value,
            u.email AS display
     FROM scim_group_memberships gm
     JOIN users u ON u.id = gm.user_id
     LEFT JOIN scim_user_mappings m ON m.org_id = gm.org_id AND m.user_id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY u.email ASC`, [groupId]);
    return result.rows;
}
export async function replaceScimGroupMembers(orgId, groupId, userIds, client) {
    const db = client || pool;
    await db.query(`DELETE FROM scim_group_memberships WHERE group_id = $1`, [groupId]);
    if (userIds.length === 0)
        return;
    const values = userIds
        .map((_, index) => `($1, $${index + 2}, $${userIds.length + 2})`)
        .join(', ');
    await db.query(`INSERT INTO scim_group_memberships (group_id, user_id, org_id)
     VALUES ${values}
     ON CONFLICT (group_id, user_id) DO NOTHING`, [groupId, ...userIds, orgId]);
}
export async function addScimGroupMember(orgId, groupId, userId, client) {
    const db = client || pool;
    await db.query(`INSERT INTO scim_group_memberships (group_id, user_id, org_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_id, user_id) DO NOTHING`, [groupId, userId, orgId]);
}
export async function removeScimGroupMember(groupId, userId, client) {
    const db = client || pool;
    await db.query(`DELETE FROM scim_group_memberships
     WHERE group_id = $1 AND user_id = $2`, [groupId, userId]);
}
/** Permanently remove a social identity link from the account. */
export async function deleteLinkedIdentity(userId, linkId, client) {
    const db = client || pool;
    const result = await db.query(`DELETE FROM user_linked_identities
     WHERE id = $1 AND user_id = $2`, [linkId, userId]);
    return (result.rowCount ?? 0) > 0;
}
export async function revokeTrustedDevice(userId, deviceId, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_trusted_devices SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [deviceId, userId]);
    return (result.rowCount ?? 0) > 0;
}
export async function revokeAllTrustedDevices(userId, _reason, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_trusted_devices
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`, [userId]);
    return result.rowCount ?? 0;
}
export async function listAuditLogsForUser(userId, options, client) {
    const db = client || pool;
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const countRes = await db.query(`SELECT COUNT(*)::text AS count FROM audit_logs WHERE user_id = $1`, [userId]);
    const rowsRes = await db.query(`SELECT id, action, resource_type, resource_id, org_id,
            host(ip_address)::text AS ip_address, created_at, metadata
     FROM audit_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`, [userId, limit, offset]);
    return {
        rows: rowsRes.rows,
        total: parseInt(countRes.rows[0]?.count ?? '0', 10),
    };
}
//# sourceMappingURL=audit.repository.js.map