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
import type { MFADevice, User, UserSession } from '../../domain/types.js';
export declare function scheduleAccountDeletion(userId: string, scheduledAt: Date, client?: PoolClient): Promise<User | null>;
export declare function clearScheduledAccountDeletion(userId: string, client?: PoolClient): Promise<User | null>;
export declare function listUsersDueForDeletion(client?: PoolClient): Promise<User[]>;
export interface OrgAuthPolicyRow {
    org_id: string;
    org_name: string;
    enforce_sso: boolean;
    enforce_mfa: boolean;
    session_timeout_minutes: number | null;
    mfa_allowed_methods: string[];
    mfa_primary_method_preference: string | null;
    mfa_backup_codes_required: boolean;
    mfa_grace_period_days: number;
    mfa_max_devices_per_user: number;
    mfa_allow_sms_fallback: boolean;
    mfa_allow_email_fallback: boolean;
    mfa_remember_device_days: number;
}
export declare function listOrgAuthPoliciesForUser(userId: string, client?: PoolClient): Promise<OrgAuthPolicyRow[]>;
export interface SsoDiscoveryRow {
    org_id: string;
    org_name: string;
    provider_id: string;
    provider_type: string;
    provider_name: string;
}
export declare function findSsoProvidersByEmailDomain(domain: string, client?: PoolClient): Promise<SsoDiscoveryRow[]>;
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
export declare function findSsoProviderRef(providerId: string, client?: PoolClient): Promise<SsoProviderRef | null>;
export declare function findSamlProviderById(providerId: string, client?: PoolClient): Promise<SamlProviderRow | null>;
export declare function findSamlProviderByEntityId(idpEntityId: string, client?: PoolClient): Promise<SamlProviderRow | null>;
export declare function findSamlProviderForEmailDomain(domain: string, client?: PoolClient): Promise<SamlProviderRow | null>;
export declare function findOidcProviderById(providerId: string, client?: PoolClient): Promise<OidcProviderRow | null>;
export declare function findOidcProviderForEmailDomain(domain: string, client?: PoolClient): Promise<OidcProviderRow | null>;
/** SSO JIT: passwordless user with verified email from IdP. */
export declare function createSsoJitUser(data: {
    id: string;
    email: string;
    full_name: string;
}, client?: PoolClient): Promise<User>;
export declare function addOrgMemberSsoProvision(orgId: string, userId: string, role: string, client?: PoolClient): Promise<void>;
export declare function updateMFADeviceName(deviceId: string, userId: string, deviceName: string, client?: PoolClient): Promise<MFADevice | null>;
export declare function findWebAuthnDeviceByCredentialId(credentialId: string, client?: PoolClient): Promise<MFADevice | null>;
export declare function createWebAuthnDevice(data: {
    user_id: string;
    device_name: string;
    credential_id: string;
    public_key: string;
    sign_count: number;
    is_primary: boolean;
}, client?: PoolClient): Promise<MFADevice>;
export declare function updateWebAuthnSignCount(deviceId: string, signCount: number, ipAddress: string, client?: PoolClient): Promise<void>;
export declare function upsertTrustedDevice(userId: string, fingerprint: string, data: {
    device_name?: string;
    ip_address: string;
    user_agent: string;
    expires_at: Date;
}, client?: PoolClient): Promise<void>;
export declare function isTrustedDevice(userId: string, fingerprint: string, client?: PoolClient): Promise<boolean>;
export declare function listTrustedDevices(userId: string, client?: PoolClient): Promise<Array<{
    id: string;
    device_name: string | null;
    device_fingerprint: string;
    trusted_at: Date;
    expires_at: Date;
    last_seen_at: Date;
}>>;
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
export declare function listLinkedIdentities(userId: string, client?: PoolClient): Promise<LinkedIdentityRow[]>;
export declare function findLinkedIdentityByProviderSubject(provider: LinkedIdentityProvider, providerSubject: string, client?: PoolClient): Promise<LinkedIdentityRow | null>;
export declare function findLinkedIdentityByUserProvider(userId: string, provider: LinkedIdentityProvider, client?: PoolClient): Promise<LinkedIdentityRow | null>;
export declare function createLinkedIdentity(data: {
    user_id: string;
    provider: LinkedIdentityProvider;
    provider_subject: string;
    provider_email: string | null;
    profile_metadata?: Record<string, unknown>;
}, client?: PoolClient): Promise<LinkedIdentityRow>;
export interface ScimTokenAuthRow {
    id: string;
    org_id: string;
    expires_at: Date | null;
    revoked_at: Date | null;
    grace_period_ends_at: Date | null;
    scopes: string[] | null;
}
export declare function findScimTokenByHash(tokenHash: string, orgId: string, client?: PoolClient): Promise<ScimTokenAuthRow | null>;
export declare function isScimTokenIpAllowed(tokenId: string, ipAddress: string, client?: PoolClient): Promise<boolean>;
export declare function touchScimToken(tokenId: string, client?: PoolClient): Promise<void>;
export declare function upsertScimUserMapping(orgId: string, userId: string, externalId: string, client?: PoolClient): Promise<void>;
export declare function listScimTokenScopes(tokenId: string, client?: PoolClient): Promise<string[]>;
export declare function listScimTokenIps(tokenId: string, client?: PoolClient): Promise<string[]>;
export declare function createScimToken(data: {
    orgId: string;
    tokenHash: string;
    createdBy: string;
    expiresAt: Date | null;
}, client?: PoolClient): Promise<{
    id: string;
}>;
export declare function insertScimTokenScopes(tokenId: string, scopes: string[], client?: PoolClient): Promise<void>;
export declare function insertScimTokenIps(tokenId: string, ipCidrs: string[], client?: PoolClient): Promise<void>;
export declare function findScimTokenById(tokenId: string, client?: PoolClient): Promise<{
    id: string;
    org_id: string;
    revoked_at: Date | null;
} | null>;
export declare function rotateScimToken(tokenId: string, newTokenId: string, gracePeriodEndsAt: Date, client?: PoolClient): Promise<void>;
export declare function revokeScimToken(tokenId: string, client?: PoolClient): Promise<void>;
export declare function listScimTokensForOrg(orgId: string, client?: PoolClient): Promise<Array<{
    id: string;
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
    scopes: string[];
    allowed_ips: string[];
}>>;
export declare function findScimMappingByExternalId(orgId: string, externalId: string, client?: PoolClient): Promise<{
    user_id: string;
} | null>;
export declare function findScimMappingByUserId(orgId: string, userId: string, client?: PoolClient): Promise<{
    external_id: string;
} | null>;
export declare function deleteScimUserMapping(orgId: string, externalId: string, client?: PoolClient): Promise<void>;
export declare function listScimMappingsForOrg(orgId: string, startIndex: number, count: number, client?: PoolClient): Promise<{
    rows: Array<{
        external_id: string;
        user_id: string;
    }>;
    total: number;
}>;
export declare function listOrgMembersForScim(orgId: string, client?: PoolClient): Promise<Array<{
    user_id: string;
    role: string;
    status: string;
}>>;
export declare function updateOrgMemberRole(orgId: string, userId: string, role: string, client?: PoolClient): Promise<void>;
export declare function deactivateOrgMemberScim(orgId: string, userId: string, client?: PoolClient): Promise<void>;
export declare function listOrgMemberScimIdsByRole(orgId: string, role: string, client?: PoolClient): Promise<string[]>;
export declare function findActiveOrgMember(orgId: string, userId: string, client?: PoolClient): Promise<{
    user_id: string;
    role: string;
} | null>;
export declare function updateLinkedIdentityLastUsed(linkId: string, client?: PoolClient): Promise<void>;
export declare function findActiveSessionBySamlNameId(nameId: string, client?: PoolClient): Promise<UserSession | null>;
export declare function createSamlSession(data: {
    sessionId: string;
    providerId: string;
    samlNameId: string;
    samlNameIdFormat?: string | null;
    samlSessionIndex?: string | null;
    issuer: string;
    expiresAt: Date;
}, client?: PoolClient): Promise<void>;
export declare function findLatestSamlSessionByProviderAndNameId(providerId: string, nameId: string, client?: PoolClient): Promise<{
    session_id: string;
    provider_id: string;
    saml_name_id: string;
    saml_session_index: string | null;
    issuer: string;
    user_id: string;
} | null>;
export declare function listActiveSamlSessionsForLogout(providerId: string, nameId: string, sessionIndex?: string, client?: PoolClient): Promise<Array<{
    session_id: string;
    user_id: string;
}>>;
export declare function expireSamlSessionsBySessionIds(sessionIds: string[], client?: PoolClient): Promise<void>;
export declare function findScimGroupById(orgId: string, groupId: string, client?: PoolClient): Promise<{
    id: string;
    external_id: string;
    display_name: string;
    meta_version: number;
    meta_created: Date;
    meta_last_modified: Date;
    active: boolean;
} | null>;
export declare function findScimGroupByExternalId(orgId: string, externalId: string, client?: PoolClient): Promise<{
    id: string;
} | null>;
export declare function createScimGroup(orgId: string, externalId: string, displayName: string, client?: PoolClient): Promise<{
    id: string;
    external_id: string;
    display_name: string;
    meta_version: number;
    meta_created: Date;
    meta_last_modified: Date;
    active: boolean;
}>;
export declare function updateScimGroup(orgId: string, groupId: string, displayName: string | null, client?: PoolClient): Promise<void>;
export declare function deleteScimGroup(orgId: string, groupId: string, client?: PoolClient): Promise<void>;
export declare function listScimGroups(orgId: string, startIndex: number, count: number, filter?: string, client?: PoolClient): Promise<{
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
}>;
export declare function listScimGroupMembers(groupId: string, client?: PoolClient): Promise<Array<{
    value: string;
    display: string;
}>>;
export declare function replaceScimGroupMembers(orgId: string, groupId: string, userIds: string[], client?: PoolClient): Promise<void>;
export declare function addScimGroupMember(orgId: string, groupId: string, userId: string, client?: PoolClient): Promise<void>;
export declare function removeScimGroupMember(groupId: string, userId: string, client?: PoolClient): Promise<void>;
export declare function revokeLinkedIdentity(userId: string, linkId: string, client?: PoolClient): Promise<boolean>;
export declare function revokeTrustedDevice(userId: string, deviceId: string, client?: PoolClient): Promise<boolean>;
export declare function revokeAllTrustedDevices(userId: string, _reason: string, client?: PoolClient): Promise<number>;
export declare function listAuditLogsForUser(userId: string, options: {
    limit?: number;
    offset?: number;
}, client?: PoolClient): Promise<{
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
}>;
//# sourceMappingURL=audit.repository.d.ts.map