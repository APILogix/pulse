import type { User } from './types.js';
export interface SsoLoginFlowContext {
    providerId: string;
    orgId: string;
    rememberMe: boolean;
    ipAddress: string;
    userAgent: string;
    deviceName?: string;
    clientDeviceType?: string;
}
export declare function finalizeEnterpriseSsoLogin(options: {
    user: User;
    provider: {
        id: string;
        org_id: string;
    };
    flow: SsoLoginFlowContext;
    ipAddress: string;
    userAgent: string;
    requestId: string;
    method: 'oidc' | 'saml';
    samlNameId?: string;
    samlSessionIndex?: string;
}): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
//# sourceMappingURL=sso-session.service.d.ts.map