export interface ParsedSamlLogoutPayload {
    nameId: string | null;
    issuer: string | null;
    sessionIndex: string | null;
}
export declare function parseSamlLogoutPayload(base64Payload: string): ParsedSamlLogoutPayload;
//# sourceMappingURL=saml-xml.util.d.ts.map