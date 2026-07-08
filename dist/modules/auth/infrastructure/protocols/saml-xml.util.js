/**
 * Minimal SAML XML helpers for logout request/response parsing (no extra deps).
 */
import { inflateRawSync } from 'zlib';
function decodeSamlPayload(base64Payload) {
    const raw = Buffer.from(base64Payload, 'base64');
    try {
        return inflateRawSync(raw).toString('utf8');
    }
    catch {
        return raw.toString('utf8');
    }
}
function firstMatch(xml, patterns) {
    for (const pattern of patterns) {
        const match = xml.match(pattern);
        const value = match?.[1]?.trim();
        if (value)
            return value;
    }
    return null;
}
export function parseSamlLogoutPayload(base64Payload) {
    const xml = decodeSamlPayload(base64Payload);
    const nameId = firstMatch(xml, [
        /<(?:samlp:|saml2p:)?LogoutRequest[^>]*>[\s\S]*?<(?:saml:|saml2:)?NameID[^>]*>([^<]+)<\/(?:saml:|saml2:)?NameID>/i,
        /<(?:saml:|saml2:)?NameID[^>]*>([^<]+)<\/(?:saml:|saml2:)?NameID>/i,
        /<NameID[^>]*>([^<]+)<\/NameID>/i,
    ]);
    const issuer = firstMatch(xml, [
        /<(?:samlp:|saml2p:)?LogoutRequest[^>]*>[\s\S]*?<(?:saml:|saml2:)?Issuer[^>]*>([^<]+)<\/(?:saml:|saml2:)?Issuer>/i,
        /<(?:saml:|saml2:)?Issuer[^>]*>([^<]+)<\/(?:saml:|saml2:)?Issuer>/i,
        /<Issuer[^>]*>([^<]+)<\/Issuer>/i,
    ]);
    const sessionIndex = firstMatch(xml, [
        /SessionIndex="([^"]+)"/i,
        /<(?:samlp:|saml2p:)?SessionIndex[^>]*>([^<]+)<\/(?:samlp:|saml2p:)?SessionIndex>/i,
    ]);
    return { nameId, issuer, sessionIndex };
}
//# sourceMappingURL=saml-xml.util.js.map