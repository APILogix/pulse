import { createHash } from 'crypto';
import * as authRepository from '../auth/repository.js';
import { AuthError, AuthErrorCodes } from '../auth/types.js';
function hashScimToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
export async function authenticateScim(request, reply) {
    const { orgId } = request.params;
    if (!orgId) {
        return reply.status(401).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '401',
            detail: 'Missing organization id',
        });
    }
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '401',
            detail: 'Bearer token required',
        });
    }
    const rawToken = authHeader.slice(7).trim();
    if (!rawToken.startsWith('scim_')) {
        return reply.status(401).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '401',
            detail: 'Invalid token format',
        });
    }
    const tokenRow = await authRepository.findScimTokenByHash(hashScimToken(rawToken), orgId);
    if (!tokenRow || tokenRow.org_id !== orgId) {
        return reply.status(401).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status: '401',
            detail: 'Unauthorized',
        });
    }
    await authRepository.touchScimToken(tokenRow.id);
    request.scim = { orgId: tokenRow.org_id, tokenId: tokenRow.id };
}
export function assertScimOrg(request, orgId) {
    if (request.scim?.orgId !== orgId) {
        throw new AuthError('SCIM token org mismatch', AuthErrorCodes.SCIM_UNAUTHORIZED, 403);
    }
}
//# sourceMappingURL=scim.middleware.js.map