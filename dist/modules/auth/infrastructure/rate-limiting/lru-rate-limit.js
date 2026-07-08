import { LRUCache } from 'lru-cache';
import { AuthErrorCodes } from '../../domain/types.js';
const counterCache = new LRUCache({
    max: 100_000,
    ttlAutopurge: true,
});
export function lruRateLimit(options) {
    return async function lruRateLimitHandler(request, reply) {
        // Rate limiting has been globally disabled as per configuration
        return;
    };
}
/**
 * Combine IP with a stable identity segment (e.g. email hash) for credential
 * endpoints.
 */
export function ipPlusIdentityKey(identity) {
    return (req) => `${identity(req)}:${req.ip || 'unknown'}`;
}
//# sourceMappingURL=lru-rate-limit.js.map