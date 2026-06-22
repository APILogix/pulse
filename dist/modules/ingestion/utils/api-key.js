/** Extract project API key from X-API-Key or Authorization header. */
export function extractApiKeyFromRequest(request) {
    const header = request.headers['x-api-key'];
    if (typeof header === 'string' && header.trim().length > 0) {
        return header.trim();
    }
    const auth = request.headers.authorization;
    if (typeof auth !== 'string')
        return null;
    const trimmed = auth.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
        return trimmed.slice(7).trim() || null;
    }
    if (trimmed.toLowerCase().startsWith('apikey ')) {
        return trimmed.slice(7).trim() || null;
    }
    return null;
}
/** Header-first API key resolution for ingest/init bodies. */
export function resolveApiKey(request, body) {
    const fromHeader = extractApiKeyFromRequest(request);
    if (fromHeader)
        return fromHeader;
    if (body && typeof body.apiKey === 'string' && body.apiKey.length > 0) {
        return body.apiKey;
    }
    return null;
}
//# sourceMappingURL=api-key.js.map