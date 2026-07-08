import { type User } from '../../domain/types.js';
export interface SsoProvisionProvider {
    id: string;
    org_id: string;
    domain: string | null;
    oidc_jit_provision: boolean;
    oidc_jit_default_role: string;
}
export declare function extractEmailFromSamlProfile(profile: Record<string, unknown>): string | null;
export declare function extractDisplayNameFromSamlProfile(profile: Record<string, unknown>, email: string): string;
/**
 * Resolve an SSO user by email. JIT-provisions when enabled on the org provider.
 */
export declare function resolveSsoUser(email: string, displayName: string | undefined, provider: SsoProvisionProvider, ipAddress: string, requestId: string, auditAction: 'user.sso_jit_provisioned' | 'user.saml_jit_provisioned'): Promise<User>;
//# sourceMappingURL=sso-provision.service.d.ts.map