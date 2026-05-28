/**
 * Authentication and authorization middleware.
 *
 * This middleware is the single gate every authenticated route passes
 * through. It MUST stay tight: every check runs in a fixed order, fails
 * closed, and never reveals more than `Unauthorized` to the caller.
 *
 * Order of checks (early-out on first failure):
 *   1. Authorization header is present and well-formed.
 *   2. JWT signature, algorithm, issuer, audience, and `type === 'access'`
 *      are all valid.
 *   3. Access-token JTI is not on the in-process blacklist (fast path).
 *   4. The user as a whole is not on the user-wide revocation list (set on
 *      password change, password reset, suspension, MFA disable).
 *   5. Persistent session row exists, is `active`, and not expired.
 *   6. Session belongs to the same user the JWT claims.
 *   7. User row exists, is not deleted, not suspended.
 *
 * Design notes:
 *   - The blacklist + user-revoke checks live in an in-process LRU cache
 *     (see `modules/auth/cache.ts`). The auth module is intentionally
 *     Redis-free per project decision; this means revocation is per-process.
 *   - Database session lookup remains the source of truth for revocation
 *     across processes. Even when the LRU misses (after a deploy), a session
 *     that was revoked still has `status != 'active'` and is rejected at
 *     step 5.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
declare module 'fastify' {
    interface FastifyRequest {
        user: {
            id: string;
            email: string;
            isAdmin: boolean;
            sessionId: string;
            mfaVerified: boolean;
            stepUpFresh: boolean;
        };
    }
}
export declare function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
/**
 * Hard-checks the platform-admin flag derived from `users.is_admin`. This is
 * a global flag and does NOT imply org-level admin rights. Org-level admin
 * is enforced inside the organization module.
 */
export declare function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
/**
 * Reject requests where the access token's `mfa_verified` claim is false.
 * Used by routes that need MFA at session level.
 */
export declare function requireMFA(request: FastifyRequest, reply: FastifyReply): Promise<void>;
/**
 * Reject requests that have not completed a fresh step-up MFA challenge in
 * the last STEP_UP_FRESHNESS_TTL_SECONDS. Used by sensitive in-session
 * actions such as password change.
 *
 * This is independent from `requireMFA`: a session can be `mfaVerified=true`
 * because MFA was performed at login, but step-up freshness is only set
 * when the user proves possession of MFA AGAIN via /auth/mfa/verify.
 */
export declare function requireStepUp(request: FastifyRequest, reply: FastifyReply): Promise<void>;
//# sourceMappingURL=auth.d.ts.map