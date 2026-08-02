export declare const samlSpConfig: {
    /** SP entity ID published in metadata. */
    entityId: string;
    /** Assertion Consumer Service URL (IdP POST target). */
    acsUrl: string;
    /** Single Logout Service URL (SP endpoint for SAML SLO). */
    sloUrl: string;
    /** Optional PEM private key for signing AuthnRequests (enterprise IdPs). */
    privateKey: string | undefined;
    /** Optional PEM certificate for SP metadata / signature verification. */
    certificate: string | undefined;
};
export declare function getSamlCallbackUrl(): string;
//# sourceMappingURL=saml.config.d.ts.map