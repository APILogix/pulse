export declare function decodeSamlPostPayload(base64Payload: string): string;
export declare function parseSamlIssuer(base64Payload: string): string | null;
export interface ParsedSamlLogoutPayload {
    nameId: string | null;
    issuer: string | null;
    sessionIndex: string | null;
}
export declare function parseSamlLogoutPayload(base64Payload: string): ParsedSamlLogoutPayload;
//# sourceMappingURL=saml-xml.util.d.ts.map