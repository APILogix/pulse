export declare function startSamlSingleLogout(userId: string, sessionId: string, ipAddress: string, requestId: string): Promise<{
    logout_url: string | null;
}>;
/**
 * Revoke local session, then return IdP logout URL when SAML context exists.
 */
export declare function completeSamlLogoutForUser(userId: string, sessionId: string, ipAddress: string, requestId: string): Promise<{
    logout_url: string | null;
    logged_out: boolean;
}>;
export declare function handleSamlSingleLogout(body: {
    SAMLRequest?: string;
    SAMLResponse?: string;
    RelayState?: string;
}, ipAddress: string, requestId: string): Promise<{
    redirect_url: string | null;
    logged_out: boolean;
}>;
export declare function getSamlLogoutRedirectUrl(): string;
//# sourceMappingURL=saml-slo.service.d.ts.map